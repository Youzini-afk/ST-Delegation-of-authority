use axum::Json;
use axum::Router;
use axum::extract::Request;
use axum::middleware;
use axum::routing::{get, post};
use axum::{
    extract::State,
    http::StatusCode,
    middleware::Next,
    response::{IntoResponse, Response},
};
use base64::Engine;
use base64::engine::general_purpose::STANDARD as BASE64_STANDARD;
use half::f16;
use rusqlite::types::{Value as SqliteValue, ValueRef};
use rusqlite::{Connection, OptionalExtension, params, params_from_iter};
use serde::Deserialize;
use serde::Serialize;
use serde_json::{Map as JsonMap, Number as JsonNumber, Value as JsonValue, json};
use std::collections::{HashMap, HashSet, VecDeque};
use std::env;
use std::error::Error;
use std::fs;
use std::io::Read;
use std::net::{IpAddr, ToSocketAddrs};
use std::path::{Path, PathBuf};
use std::process;
#[cfg(test)]
use std::sync::OnceLock;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Condvar, Mutex};
use std::thread;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use time::OffsetDateTime;
use time::format_description::well_known::Rfc3339;
use tokio::net::TcpListener;
use tokio::sync::Semaphore;
use tower_http::limit::RequestBodyLimitLayer;
use tower_http::timeout::TimeoutLayer;
use triviumdb::database::{
    Config as TriviumConfig, Database as TriviumDatabase, SearchConfig as TriviumSearchConfig,
    StorageMode as TriviumStorageMode,
};
use triviumdb::filter::Filter as TriviumFilter;
use triviumdb::hook::HookContext as TriviumRawHookContext;
use triviumdb::node::{NodeView as TriviumRawNodeView, SearchHit as TriviumRawSearchHit};
use triviumdb::storage::wal::SyncMode as TriviumSyncMode;
use url::Url;

const MAX_REQUEST_SIZE: usize = 1024 * 1024;
const MAX_CONCURRENCY: usize = 64;
const REQUEST_TIMEOUT_SECS: u64 = 30;
const MAX_KV_VALUE_BYTES: usize = 128 * 1024;
const MAX_BLOB_BYTES: usize = 16 * 1024 * 1024;
const MAX_HTTP_INLINE_BODY_BYTES: usize = 512 * 1024;
const MAX_HTTP_INLINE_RESPONSE_BYTES: usize = 2 * 1024 * 1024;
const MAX_HTTP_BODY_BYTES: usize = MAX_BLOB_BYTES;
const MAX_HTTP_RESPONSE_BYTES: usize = MAX_BLOB_BYTES;
const MAX_EVENT_POLL_LIMIT: usize = 200;
const MAX_PRIVATE_READ_DIR_LIMIT: usize = 200;
const MAX_TRIVIUM_BULK_ITEMS: usize = 2000;
const JOB_PROGRESS_INTERVAL_MS: u64 = 250;
const JOB_WORKER_CONCURRENCY: usize = 4;
const MAX_JOB_QUEUE_SIZE: usize = 256;
const MAX_JOB_ATTEMPTS: i64 = 5;
const MAX_JOB_TIMEOUT_MS: i64 = 5 * 60 * 1000;
const JOB_RETRY_BACKOFF_BASE_MS: u64 = 250;
const JOB_RETRY_BACKOFF_MAX_MS: u64 = 5_000;
const MAX_HTTP_REDIRECTS: usize = 5;
const SLOW_SQL_LOG_MS: u128 = 250;
const SLOW_TRIVIUM_LOG_MS: u128 = 250;
const SLOW_JOB_LOG_MS: u128 = 1_000;
const SQL_BUSY_TIMEOUT_MS: u64 = 5_000;
const SQL_PAGED_QUERY_REQUIRES_ORDER_BY: bool = true;
const SQL_META_TABLE: &str = "_authority_sql_meta";
const SQL_LAST_SLOW_QUERY_AT_META_KEY: &str = "last_slow_query_at";
const SQL_LAST_SLOW_QUERY_ELAPSED_MS_META_KEY: &str = "last_slow_query_elapsed_ms";
const SQL_LAST_SLOW_QUERY_STATEMENT_PREVIEW_META_KEY: &str = "last_slow_query_statement_preview";
const SQL_SLOW_QUERY_COUNT_META_KEY: &str = "slow_query_count";

#[cfg(test)]
static HTTP_FETCH_ALLOW_LOCAL_TARGETS: AtomicBool = AtomicBool::new(false);
#[cfg(test)]
static HTTP_FETCH_TEST_MUTEX: OnceLock<Mutex<()>> = OnceLock::new();

struct RuntimeState {
    job_controls: Mutex<HashMap<String, Arc<AtomicBool>>>,
    job_queue: JobQueue,
    started_at_iso: String,
    queued_job_count: AtomicU64,
    queued_request_count: AtomicU64,
    request_count: AtomicU64,
    error_count: AtomicU64,
    current_concurrency: AtomicU64,
    concurrency_semaphore: Semaphore,
    last_error: Mutex<Option<String>>,
}

struct Config {
    token: String,
    version: String,
    build_hash: Option<String>,
    platform: String,
    api_version: String,
    started_at: String,
    runtime: Arc<RuntimeState>,
}

#[derive(Clone)]
struct JobDispatch {
    db_path: String,
    user_handle: String,
    job: ControlJobRecord,
}

struct JobQueueState {
    items: VecDeque<JobDispatch>,
}

struct JobQueue {
    state: Mutex<JobQueueState>,
    available: Condvar,
}

#[derive(Debug)]
struct ApiError {
    status_code: u16,
    message: String,
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        let status =
            StatusCode::from_u16(self.status_code).unwrap_or(StatusCode::INTERNAL_SERVER_ERROR);
        let body = json!({ "error": self.message });
        (status, Json(body)).into_response()
    }
}

#[derive(Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CursorPageRequest {
    cursor: Option<String>,
    limit: Option<usize>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct CursorPageInfo {
    next_cursor: Option<String>,
    limit: usize,
    has_more: bool,
    total_count: usize,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SqlRequest {
    db_path: String,
    statement: String,
    #[serde(default)]
    params: Vec<JsonValue>,
    page: Option<CursorPageRequest>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SqlStatRequest {
    db_path: String,
}

#[derive(Default, Deserialize)]
#[serde(rename_all = "lowercase")]
enum SqlStatementMode {
    Query,
    #[default]
    Exec,
}

#[derive(Deserialize)]
struct SqlBatchStatement {
    #[serde(default)]
    mode: SqlStatementMode,
    statement: String,
    #[serde(default)]
    params: Vec<JsonValue>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SqlBatchRequest {
    db_path: String,
    statements: Vec<SqlBatchStatement>,
}

#[derive(Clone, Deserialize)]
struct SqlMigrationInput {
    id: String,
    statement: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SqlMigrateRequest {
    db_path: String,
    migrations: Vec<SqlMigrationInput>,
    table_name: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SqlQueryResult {
    kind: &'static str,
    columns: Vec<String>,
    rows: Vec<JsonMap<String, JsonValue>>,
    row_count: usize,
    #[serde(skip_serializing_if = "Option::is_none")]
    page: Option<CursorPageInfo>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SqlExecResult {
    kind: &'static str,
    rows_affected: usize,
    last_insert_rowid: Option<i64>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SqlRuntimeConfigDiagnostics {
    journal_mode: String,
    synchronous: String,
    foreign_keys: bool,
    busy_timeout_ms: u64,
    paged_query_requires_order_by: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SqlSlowQueryDiagnostics {
    count: u64,
    last_occurred_at: Option<String>,
    last_elapsed_ms: Option<u64>,
    last_statement_preview: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SqlStatResponse {
    database: String,
    name: String,
    file_name: String,
    file_path: String,
    exists: bool,
    size_bytes: u64,
    updated_at: Option<String>,
    runtime_config: SqlRuntimeConfigDiagnostics,
    slow_query: SqlSlowQueryDiagnostics,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SqlTransactionResponse {
    committed: bool,
    results: Vec<JsonValue>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SqlMigrateResponse {
    table_name: String,
    applied: Vec<String>,
    skipped: Vec<String>,
    latest_id: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct TriviumOpenRequest {
    db_path: String,
    dim: Option<usize>,
    dtype: Option<String>,
    sync_mode: Option<String>,
    storage_mode: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct TriviumInsertRequest {
    #[serde(flatten)]
    open: TriviumOpenRequest,
    vector: Vec<f64>,
    payload: JsonValue,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct TriviumInsertWithIdRequest {
    #[serde(flatten)]
    open: TriviumOpenRequest,
    id: u64,
    vector: Vec<f64>,
    payload: JsonValue,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct TriviumBulkUpsertItem {
    id: u64,
    vector: Vec<f64>,
    payload: JsonValue,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct TriviumBulkUpsertRequest {
    #[serde(flatten)]
    open: TriviumOpenRequest,
    items: Vec<TriviumBulkUpsertItem>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct TriviumGetRequest {
    #[serde(flatten)]
    open: TriviumOpenRequest,
    id: u64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct TriviumUpdatePayloadRequest {
    #[serde(flatten)]
    open: TriviumOpenRequest,
    id: u64,
    payload: JsonValue,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct TriviumUpdateVectorRequest {
    #[serde(flatten)]
    open: TriviumOpenRequest,
    id: u64,
    vector: Vec<f64>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct TriviumDeleteRequest {
    #[serde(flatten)]
    open: TriviumOpenRequest,
    id: u64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct TriviumLinkRequest {
    #[serde(flatten)]
    open: TriviumOpenRequest,
    src: u64,
    dst: u64,
    label: Option<String>,
    weight: Option<f64>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct TriviumBulkLinkItem {
    src: u64,
    dst: u64,
    label: Option<String>,
    weight: Option<f64>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct TriviumBulkLinkRequest {
    #[serde(flatten)]
    open: TriviumOpenRequest,
    items: Vec<TriviumBulkLinkItem>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct TriviumUnlinkRequest {
    #[serde(flatten)]
    open: TriviumOpenRequest,
    src: u64,
    dst: u64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct TriviumBulkUnlinkItem {
    src: u64,
    dst: u64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct TriviumBulkUnlinkRequest {
    #[serde(flatten)]
    open: TriviumOpenRequest,
    items: Vec<TriviumBulkUnlinkItem>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct TriviumBulkDeleteItem {
    id: u64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct TriviumBulkDeleteRequest {
    #[serde(flatten)]
    open: TriviumOpenRequest,
    items: Vec<TriviumBulkDeleteItem>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct TriviumNeighborsRequest {
    #[serde(flatten)]
    open: TriviumOpenRequest,
    id: u64,
    depth: Option<usize>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct TriviumSearchRequest {
    #[serde(flatten)]
    open: TriviumOpenRequest,
    vector: Vec<f64>,
    top_k: Option<usize>,
    expand_depth: Option<usize>,
    min_score: Option<f32>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct TriviumSearchAdvancedRequest {
    #[serde(flatten)]
    open: TriviumOpenRequest,
    vector: Vec<f64>,
    query_text: Option<String>,
    top_k: Option<usize>,
    expand_depth: Option<usize>,
    min_score: Option<f32>,
    teleport_alpha: Option<f32>,
    enable_advanced_pipeline: Option<bool>,
    enable_sparse_residual: Option<bool>,
    fista_lambda: Option<f32>,
    fista_threshold: Option<f32>,
    enable_dpp: Option<bool>,
    dpp_quality_weight: Option<f32>,
    enable_refractory_fatigue: Option<bool>,
    enable_inverse_inhibition: Option<bool>,
    lateral_inhibition_threshold: Option<usize>,
    enable_bq_coarse_search: Option<bool>,
    bq_candidate_ratio: Option<f32>,
    text_boost: Option<f32>,
    enable_text_hybrid_search: Option<bool>,
    bm25_k1: Option<f32>,
    bm25_b: Option<f32>,
    payload_filter: Option<JsonValue>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct TriviumSearchHybridRequest {
    #[serde(flatten)]
    open: TriviumOpenRequest,
    vector: Vec<f64>,
    query_text: String,
    top_k: Option<usize>,
    expand_depth: Option<usize>,
    min_score: Option<f32>,
    hybrid_alpha: Option<f32>,
    payload_filter: Option<JsonValue>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct TriviumTqlRequest {
    #[serde(flatten)]
    open: TriviumOpenRequest,
    query: String,
    page: Option<CursorPageRequest>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct TriviumTqlMutRequest {
    #[serde(flatten)]
    open: TriviumOpenRequest,
    query: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct TriviumCreateIndexRequest {
    #[serde(flatten)]
    open: TriviumOpenRequest,
    field: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct TriviumDropIndexRequest {
    #[serde(flatten)]
    open: TriviumOpenRequest,
    field: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct TriviumIndexTextRequest {
    #[serde(flatten)]
    open: TriviumOpenRequest,
    id: u64,
    text: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct TriviumIndexKeywordRequest {
    #[serde(flatten)]
    open: TriviumOpenRequest,
    id: u64,
    keyword: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct TriviumBuildTextIndexRequest {
    #[serde(flatten)]
    open: TriviumOpenRequest,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct TriviumCompactRequest {
    #[serde(flatten)]
    open: TriviumOpenRequest,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct TriviumFlushRequest {
    #[serde(flatten)]
    open: TriviumOpenRequest,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct TriviumStatRequest {
    #[serde(flatten)]
    open: TriviumOpenRequest,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct TriviumInsertResponse {
    id: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct TriviumBulkFailure {
    index: usize,
    message: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct TriviumBulkMutationResponse {
    total_count: usize,
    success_count: usize,
    failure_count: usize,
    failures: Vec<TriviumBulkFailure>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct TriviumBulkUpsertResponseItem {
    index: usize,
    id: u64,
    action: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct TriviumBulkUpsertResponse {
    total_count: usize,
    success_count: usize,
    failure_count: usize,
    failures: Vec<TriviumBulkFailure>,
    items: Vec<TriviumBulkUpsertResponseItem>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct TriviumEdgeView {
    target_id: u64,
    label: String,
    weight: f64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct TriviumNodeView {
    id: u64,
    vector: Vec<f64>,
    payload: JsonValue,
    edges: Vec<TriviumEdgeView>,
    num_edges: usize,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct TriviumSearchHit {
    id: u64,
    score: f64,
    payload: JsonValue,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct TriviumNeighborsResponse {
    ids: Vec<u64>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct TriviumTqlResponse {
    rows: Vec<HashMap<String, TriviumNodeView>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    page: Option<CursorPageInfo>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct TriviumTqlMutResponse {
    affected: usize,
    created_ids: Vec<u64>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct TriviumSearchStageTiming {
    stage: String,
    elapsed_ms: f64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct TriviumSearchContext {
    custom_data: JsonValue,
    stage_timings: Vec<TriviumSearchStageTiming>,
    aborted: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct TriviumSearchHybridWithContextResponse {
    hits: Vec<TriviumSearchHit>,
    context: TriviumSearchContext,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct TriviumDatabaseRecord {
    name: String,
    file_name: String,
    dim: Option<usize>,
    dtype: Option<String>,
    sync_mode: Option<String>,
    storage_mode: Option<String>,
    size_bytes: u64,
    wal_size_bytes: u64,
    vec_size_bytes: u64,
    total_size_bytes: u64,
    updated_at: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct TriviumStatResponse {
    database: String,
    file_path: String,
    exists: bool,
    node_count: usize,
    edge_count: usize,
    text_index_count: Option<usize>,
    last_flush_at: Option<String>,
    vector_dim: Option<usize>,
    database_size: u64,
    wal_size: u64,
    vec_size: u64,
    estimated_memory_bytes: usize,
    #[serde(flatten)]
    record: TriviumDatabaseRecord,
}

#[derive(Clone, Copy)]
enum TriviumDTypeTag {
    F32,
    F16,
    U64,
}

impl TriviumDTypeTag {
    fn as_str(self) -> &'static str {
        match self {
            Self::F32 => "f32",
            Self::F16 => "f16",
            Self::U64 => "u64",
        }
    }
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct ControlUserInfo {
    handle: String,
    is_admin: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ControlInitConfig {
    extension_id: String,
    display_name: String,
    version: String,
    install_type: String,
    declared_permissions: JsonValue,
    ui_label: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ControlSessionInitRequest {
    db_path: String,
    session_token: String,
    timestamp: String,
    user: ControlUserInfo,
    config: ControlInitConfig,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ControlSessionGetRequest {
    db_path: String,
    user_handle: String,
    session_token: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ControlExtensionsListRequest {
    db_path: String,
    user_handle: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ControlExtensionGetRequest {
    db_path: String,
    user_handle: String,
    extension_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ControlAuditRecordInput {
    timestamp: String,
    kind: String,
    extension_id: String,
    message: String,
    details: Option<JsonValue>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ControlAuditLogRequest {
    db_path: String,
    user_handle: String,
    record: ControlAuditRecordInput,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ControlAuditRecentRequest {
    db_path: String,
    user_handle: String,
    extension_id: String,
    limit: Option<usize>,
    page: Option<CursorPageRequest>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ControlGrantListRequest {
    db_path: String,
    user_handle: String,
    extension_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ControlGrantGetRequest {
    db_path: String,
    user_handle: String,
    extension_id: String,
    key: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ControlGrantUpsertRequest {
    db_path: String,
    user_handle: String,
    extension_id: String,
    grant: ControlGrantRecord,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ControlGrantResetRequest {
    db_path: String,
    user_handle: String,
    extension_id: String,
    keys: Option<Vec<String>>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ControlPoliciesRequest {
    db_path: String,
    user_handle: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ControlPoliciesPartial {
    defaults: Option<HashMap<String, String>>,
    extensions: Option<HashMap<String, HashMap<String, ControlPolicyEntry>>>,
    limits: Option<ControlLimitsPoliciesDocument>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ControlPoliciesSaveRequest {
    db_path: String,
    actor: ControlUserInfo,
    partial: ControlPoliciesPartial,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ControlJobsListRequest {
    db_path: String,
    user_handle: String,
    extension_id: Option<String>,
    page: Option<CursorPageRequest>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ControlJobGetRequest {
    db_path: String,
    user_handle: String,
    job_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ControlJobUpsertRequest {
    db_path: String,
    user_handle: String,
    job: ControlJobRecord,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ControlJobCreateRequest {
    db_path: String,
    user_handle: String,
    extension_id: String,
    #[serde(rename = "type")]
    job_type: String,
    payload: Option<JsonValue>,
    #[serde(default)]
    timeout_ms: Option<i64>,
    #[serde(default)]
    idempotency_key: Option<String>,
    #[serde(default)]
    max_attempts: Option<i64>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ControlJobCancelRequest {
    db_path: String,
    user_handle: String,
    extension_id: String,
    job_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ControlJobRequeueRequest {
    db_path: String,
    user_handle: String,
    extension_id: String,
    job_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct StorageKvGetRequest {
    db_path: String,
    key: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct StorageKvSetRequest {
    db_path: String,
    key: String,
    value: JsonValue,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct StorageKvDeleteRequest {
    db_path: String,
    key: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct StorageKvListRequest {
    db_path: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct StorageBlobPutRequest {
    db_path: String,
    user_handle: String,
    extension_id: String,
    blob_dir: String,
    name: String,
    content: String,
    encoding: Option<String>,
    content_type: Option<String>,
    source_path: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct StorageBlobGetRequest {
    db_path: String,
    user_handle: String,
    extension_id: String,
    blob_dir: String,
    id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct StorageBlobDeleteRequest {
    db_path: String,
    user_handle: String,
    extension_id: String,
    blob_dir: String,
    id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct StorageBlobListRequest {
    db_path: String,
    user_handle: String,
    extension_id: String,
    blob_dir: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ControlEventsPollRequest {
    db_path: String,
    user_handle: String,
    channel: String,
    after_id: Option<i64>,
    limit: Option<usize>,
    page: Option<CursorPageRequest>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CoreHttpFetchRequest {
    url: String,
    method: Option<String>,
    headers: Option<HashMap<String, String>>,
    body: Option<String>,
    body_encoding: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CoreHttpFetchOpenRequest {
    url: String,
    method: Option<String>,
    headers: Option<HashMap<String, String>>,
    body: Option<String>,
    body_encoding: Option<String>,
    body_source_path: Option<String>,
    response_path: String,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct ControlGrantRecord {
    key: String,
    resource: String,
    target: String,
    status: String,
    scope: String,
    risk_level: String,
    updated_at: String,
    source: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    choice: Option<String>,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct ControlPolicyEntry {
    key: String,
    resource: String,
    target: String,
    status: String,
    risk_level: String,
    updated_at: String,
    source: String,
}

#[derive(Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct ControlExtensionLimitsPolicy {
    #[serde(default)]
    inline_threshold_bytes: HashMap<String, u64>,
    #[serde(default)]
    transfer_max_bytes: HashMap<String, u64>,
}

#[derive(Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct ControlLimitsPoliciesDocument {
    #[serde(default)]
    extensions: HashMap<String, ControlExtensionLimitsPolicy>,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct ControlPoliciesDocument {
    defaults: HashMap<String, String>,
    extensions: HashMap<String, HashMap<String, ControlPolicyEntry>>,
    #[serde(default)]
    limits: ControlLimitsPoliciesDocument,
    updated_at: String,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
enum JobAttemptEvent {
    Started,
    RetryScheduled,
    Completed,
    Failed,
    Cancelled,
    Recovered,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct JobAttemptRecord {
    attempt: i64,
    event: JobAttemptEvent,
    timestamp: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    summary: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    backoff_ms: Option<i64>,
}

fn is_none_or_empty_attempt_history(value: &Option<Vec<JobAttemptRecord>>) -> bool {
    value.as_ref().map(|items| items.is_empty()).unwrap_or(true)
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct ControlJobRecord {
    id: String,
    extension_id: String,
    #[serde(rename = "type")]
    job_type: String,
    status: String,
    created_at: String,
    updated_at: String,
    progress: i64,
    summary: Option<String>,
    error: Option<String>,
    payload: Option<JsonValue>,
    result: Option<JsonValue>,
    channel: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    started_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    finished_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    timeout_ms: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    idempotency_key: Option<String>,
    #[serde(default, skip_serializing_if = "is_zero")]
    attempt: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    max_attempts: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    cancel_requested_at: Option<String>,
    #[serde(default, skip_serializing_if = "is_none_or_empty_attempt_history")]
    attempt_history: Option<Vec<JobAttemptRecord>>,
}

fn is_zero(value: &i64) -> bool {
    *value == 0
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct BlobRecord {
    id: String,
    name: String,
    content_type: String,
    size: i64,
    updated_at: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct BlobGetResponse {
    record: BlobRecord,
    content: String,
    encoding: &'static str,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct BlobOpenReadResponse {
    record: BlobRecord,
    source_path: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ControlEventRecord {
    id: i64,
    timestamp: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    extension_id: Option<String>,
    channel: String,
    name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    payload: Option<JsonValue>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct HttpFetchResponse {
    url: String,
    hostname: String,
    status: u16,
    ok: bool,
    headers: HashMap<String, String>,
    body: String,
    body_encoding: String,
    content_type: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct HttpFetchOpenResponse {
    url: String,
    hostname: String,
    status: u16,
    ok: bool,
    headers: HashMap<String, String>,
    body_encoding: String,
    content_type: String,
    size_bytes: usize,
}

struct FetchedHttpResponse {
    status: u16,
    ok: bool,
    headers: HashMap<String, String>,
    content_type: String,
    body_encoding: String,
    body_bytes: Vec<u8>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ControlExtensionRecord {
    id: String,
    install_type: String,
    display_name: String,
    version: String,
    first_seen_at: String,
    last_seen_at: String,
    declared_permissions: JsonValue,
    #[serde(skip_serializing_if = "Option::is_none")]
    ui_label: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ControlSessionExtensionInfo {
    id: String,
    install_type: String,
    display_name: String,
    version: String,
    first_seen_at: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ControlSessionSnapshot {
    session_token: String,
    created_at: String,
    user: ControlUserInfo,
    extension: ControlSessionExtensionInfo,
    declared_permissions: JsonValue,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ControlAuditRecord {
    timestamp: String,
    kind: String,
    extension_id: String,
    message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    details: Option<JsonValue>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PrivateFileMkdirRequest {
    root_dir: String,
    path: String,
    recursive: Option<bool>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PrivateFileReadDirRequest {
    root_dir: String,
    path: String,
    limit: Option<usize>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PrivateFileWriteRequest {
    root_dir: String,
    path: String,
    content: String,
    encoding: Option<String>,
    create_parents: Option<bool>,
    source_path: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PrivateFileReadRequest {
    root_dir: String,
    path: String,
    encoding: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PrivateFileDeleteRequest {
    root_dir: String,
    path: String,
    recursive: Option<bool>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PrivateFileStatRequest {
    root_dir: String,
    path: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PrivateFileEntry {
    name: String,
    path: String,
    kind: String,
    size_bytes: i64,
    updated_at: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PrivateFileResponse {
    entry: PrivateFileEntry,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PrivateFileListResponse {
    entries: Vec<PrivateFileEntry>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PrivateFileReadResponse {
    entry: PrivateFileEntry,
    content: String,
    encoding: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PrivateFileOpenReadResponse {
    entry: PrivateFileEntry,
    source_path: String,
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn Error>> {
    let host = env::var("AUTHORITY_CORE_HOST").unwrap_or_else(|_| String::from("127.0.0.1"));
    let port = env::var("AUTHORITY_CORE_PORT")
        .ok()
        .and_then(|value| value.parse::<u16>().ok())
        .unwrap_or(8173);
    let token = env::var("AUTHORITY_CORE_TOKEN").unwrap_or_default();
    let version = env::var("AUTHORITY_CORE_VERSION").unwrap_or_else(|_| String::from("0.0.0-dev"));
    let build_hash = env::var("AUTHORITY_CORE_BUILD_HASH")
        .ok()
        .filter(|value| !value.trim().is_empty());
    let platform = format!("{}-{}", env::consts::OS, env::consts::ARCH);
    let api_version = env::var("AUTHORITY_CORE_API_VERSION")
        .unwrap_or_else(|_| String::from("authority-core/v1"));
    let started_at = SystemTime::now()
        .duration_since(UNIX_EPOCH)?
        .as_millis()
        .to_string();
    let runtime = create_runtime_state();
    let config = Arc::new(Config {
        token,
        version,
        build_hash,
        platform,
        api_version,
        started_at,
        runtime,
    });

    let v1_routes = Router::new()
        .route("/storage/kv/get", post(v1_storage_kv_get))
        .route("/storage/kv/set", post(v1_storage_kv_set))
        .route("/storage/kv/delete", post(v1_storage_kv_delete))
        .route("/storage/kv/list", post(v1_storage_kv_list))
        .route("/storage/blob/put", post(v1_storage_blob_put))
        .route("/storage/blob/open-read", post(v1_storage_blob_open_read))
        .route("/storage/blob/get", post(v1_storage_blob_get))
        .route("/storage/blob/delete", post(v1_storage_blob_delete))
        .route("/storage/blob/list", post(v1_storage_blob_list))
        .route("/fs/private/mkdir", post(v1_private_mkdir))
        .route("/fs/private/read-dir", post(v1_private_read_dir))
        .route("/fs/private/write-file", post(v1_private_write))
        .route("/fs/private/open-read", post(v1_private_open_read))
        .route("/fs/private/read-file", post(v1_private_read))
        .route("/fs/private/delete", post(v1_private_delete))
        .route("/fs/private/stat", post(v1_private_stat))
        .route("/http/fetch", post(v1_http_fetch))
        .route("/http/fetch-open", post(v1_http_fetch_open))
        .route("/sql/query", post(v1_sql_query))
        .route("/sql/exec", post(v1_sql_exec))
        .route("/sql/batch", post(v1_sql_batch))
        .route("/sql/transaction", post(v1_sql_transaction))
        .route("/sql/migrate", post(v1_sql_migrate))
        .route("/sql/stat", post(v1_sql_stat))
        .route("/trivium/insert", post(v1_trivium_insert))
        .route("/trivium/insert-with-id", post(v1_trivium_insert_with_id))
        .route("/trivium/bulk-upsert", post(v1_trivium_bulk_upsert))
        .route("/trivium/get", post(v1_trivium_get))
        .route("/trivium/update-payload", post(v1_trivium_update_payload))
        .route("/trivium/update-vector", post(v1_trivium_update_vector))
        .route("/trivium/delete", post(v1_trivium_delete))
        .route("/trivium/bulk-delete", post(v1_trivium_bulk_delete))
        .route("/trivium/link", post(v1_trivium_link))
        .route("/trivium/bulk-link", post(v1_trivium_bulk_link))
        .route("/trivium/unlink", post(v1_trivium_unlink))
        .route("/trivium/bulk-unlink", post(v1_trivium_bulk_unlink))
        .route("/trivium/neighbors", post(v1_trivium_neighbors))
        .route("/trivium/search", post(v1_trivium_search))
        .route("/trivium/search-advanced", post(v1_trivium_search_advanced))
        .route("/trivium/search-hybrid", post(v1_trivium_search_hybrid))
        .route(
            "/trivium/search-hybrid-context",
            post(v1_trivium_search_hybrid_with_context),
        )
        .route("/trivium/tql", post(v1_trivium_tql))
        .route("/trivium/tql-mut", post(v1_trivium_tql_mut))
        .route("/trivium/create-index", post(v1_trivium_create_index))
        .route("/trivium/drop-index", post(v1_trivium_drop_index))
        .route("/trivium/index-text", post(v1_trivium_index_text))
        .route("/trivium/index-keyword", post(v1_trivium_index_keyword))
        .route(
            "/trivium/build-text-index",
            post(v1_trivium_build_text_index),
        )
        .route("/trivium/compact", post(v1_trivium_compact))
        .route("/trivium/flush", post(v1_trivium_flush))
        .route("/trivium/stat", post(v1_trivium_stat))
        .route("/control/session/init", post(v1_control_session_init))
        .route("/control/session/get", post(v1_control_session_get))
        .route("/control/extensions/list", post(v1_control_extensions_list))
        .route("/control/extensions/get", post(v1_control_extension_get))
        .route("/control/audit/log", post(v1_control_audit_log))
        .route("/control/audit/recent", post(v1_control_audit_recent))
        .route("/control/grants/list", post(v1_control_grants_list))
        .route("/control/grants/get", post(v1_control_grant_get))
        .route("/control/grants/upsert", post(v1_control_grant_upsert))
        .route("/control/grants/reset", post(v1_control_grants_reset))
        .route("/control/policies/get", post(v1_control_policies_get))
        .route("/control/policies/save", post(v1_control_policies_save))
        .route("/control/jobs/list", post(v1_control_jobs_list))
        .route("/control/jobs/get", post(v1_control_job_get))
        .route("/control/jobs/create", post(v1_control_job_create))
        .route("/control/jobs/cancel", post(v1_control_job_cancel))
        .route("/control/jobs/requeue", post(v1_control_job_requeue))
        .route("/control/jobs/upsert", post(v1_control_job_upsert))
        .route("/control/events/poll", post(v1_control_events_poll))
        .layer(TimeoutLayer::new(Duration::from_secs(REQUEST_TIMEOUT_SECS)))
        .layer(RequestBodyLimitLayer::new(MAX_REQUEST_SIZE))
        .layer(middleware::from_fn_with_state(
            config.clone(),
            concurrency_guard,
        ))
        .layer(middleware::from_fn_with_state(
            config.clone(),
            auth_middleware,
        ));

    let app = Router::new()
        .route("/health", get(health_handler))
        .nest("/v1", v1_routes)
        .with_state(config);

    let listener = TcpListener::bind(format!("{host}:{port}")).await?;
    println!("AUTHORITY_CORE_READY {}", listener.local_addr()?);

    axum::serve(listener, app).await?;
    Ok(())
}

type JobRunner =
    fn(&str, &str, &ControlJobRecord, Arc<AtomicBool>, Option<u64>, i64) -> Result<(), ApiError>;

fn create_runtime_state() -> Arc<RuntimeState> {
    let runtime = Arc::new(RuntimeState {
        job_controls: Mutex::new(HashMap::new()),
        job_queue: JobQueue {
            state: Mutex::new(JobQueueState {
                items: VecDeque::new(),
            }),
            available: Condvar::new(),
        },
        started_at_iso: current_timestamp_iso(),
        queued_job_count: AtomicU64::new(0),
        queued_request_count: AtomicU64::new(0),
        request_count: AtomicU64::new(0),
        error_count: AtomicU64::new(0),
        current_concurrency: AtomicU64::new(0),
        concurrency_semaphore: Semaphore::new(MAX_CONCURRENCY),
        last_error: Mutex::new(None),
    });
    spawn_job_workers(&runtime);
    runtime
}

fn spawn_job_workers(runtime: &Arc<RuntimeState>) {
    for worker_index in 0..JOB_WORKER_CONCURRENCY {
        let runtime = Arc::clone(runtime);
        thread::Builder::new()
            .name(format!("authority-job-worker-{worker_index}"))
            .spawn(move || job_worker_loop(runtime))
            .expect("authority-core job worker should start");
    }
}

fn job_worker_loop(runtime: Arc<RuntimeState>) {
    loop {
        let dispatch = dequeue_job_dispatch(&runtime);
        process_job_dispatch(dispatch, &runtime);
    }
}

fn enqueue_job_dispatch(
    runtime: &Arc<RuntimeState>,
    dispatch: JobDispatch,
) -> Result<(), ApiError> {
    let mut state = runtime.job_queue.state.lock().map_err(|_| ApiError {
        status_code: 500,
        message: String::from("internal_error: job queue lock poisoned"),
    })?;
    if state.items.len() >= MAX_JOB_QUEUE_SIZE {
        set_runtime_last_error(runtime, "job_queue_full");
        emit_runtime_event(
            "warning",
            "job_queue_full",
            json!({
                "maxJobQueueSize": MAX_JOB_QUEUE_SIZE,
                "queuedJobCount": runtime.queued_job_count.load(Ordering::SeqCst),
            }),
        );
        return Err(ApiError {
            status_code: 503,
            message: String::from("job_queue_full"),
        });
    }
    state.items.push_back(dispatch);
    runtime.queued_job_count.fetch_add(1, Ordering::SeqCst);
    drop(state);
    runtime.job_queue.available.notify_one();
    Ok(())
}

fn dequeue_job_dispatch(runtime: &Arc<RuntimeState>) -> JobDispatch {
    let mut state = runtime
        .job_queue
        .state
        .lock()
        .expect("authority-core job queue lock should not be poisoned");
    loop {
        if let Some(dispatch) = state.items.pop_front() {
            runtime.queued_job_count.fetch_sub(1, Ordering::SeqCst);
            return dispatch;
        }
        state = runtime
            .job_queue
            .available
            .wait(state)
            .expect("authority-core job queue condvar should not be poisoned");
    }
}

fn process_job_dispatch(dispatch: JobDispatch, runtime: &Arc<RuntimeState>) {
    let current = match fetch_job_for_dispatch(&dispatch) {
        Ok(job) => job,
        Err(error) => {
            let _ = mark_job_failed(
                &dispatch.db_path,
                &dispatch.user_handle,
                &dispatch.job,
                &error.message,
            );
            set_runtime_last_error(runtime, error.message.clone());
            emit_runtime_event(
                "error",
                "job_dispatch_fetch_failed",
                json!({
                    "jobId": dispatch.job.id,
                    "jobType": dispatch.job.job_type,
                    "message": error.message,
                }),
            );
            return;
        }
    };
    if matches!(current.status.as_str(), "cancelled" | "completed") {
        return;
    }

    let control = Arc::new(AtomicBool::new(false));
    let key = job_control_key(&dispatch.user_handle, &dispatch.job.id);
    if let Ok(mut controls) = runtime.job_controls.lock() {
        controls.insert(key.clone(), Arc::clone(&control));
    }

    let started = Instant::now();
    let run_result = run_job_dispatch(&dispatch, Arc::clone(&control));
    if let Err(error) = run_result {
        let _ = mark_job_failed(
            &dispatch.db_path,
            &dispatch.user_handle,
            &dispatch.job,
            &error.message,
        );
        set_runtime_last_error(runtime, error.message.clone());
        emit_runtime_event(
            "error",
            "job_failed",
            json!({
                "jobId": dispatch.job.id,
                "jobType": dispatch.job.job_type,
                "message": error.message,
            }),
        );
    } else {
        emit_if_slow(
            "job_slow",
            started.elapsed(),
            SLOW_JOB_LOG_MS,
            json!({
                "jobId": dispatch.job.id,
                "jobType": dispatch.job.job_type,
            }),
        );
        if started.elapsed().as_millis() >= SLOW_JOB_LOG_MS as u128 {
            if let Ok(connection) = open_connection(&dispatch.db_path) {
                let _ = ensure_control_schema(&connection);
                let _ = append_control_audit_record(
                    &connection,
                    &dispatch.user_handle,
                    &dispatch.job.extension_id,
                    "warning",
                    "Slow job",
                    Some(json!({
                        "jobId": dispatch.job.id,
                        "jobType": dispatch.job.job_type,
                        "elapsedMs": started.elapsed().as_millis() as u64,
                    })),
                );
            }
        }
    }

    if let Ok(mut controls) = runtime.job_controls.lock() {
        controls.remove(&key);
    }
}

fn run_job_dispatch(dispatch: &JobDispatch, control: Arc<AtomicBool>) -> Result<(), ApiError> {
    let runner = resolve_job_runner(&dispatch.job.job_type).ok_or_else(|| ApiError {
        status_code: 400,
        message: format!("unsupported_job_type: {}", dispatch.job.job_type),
    })?;
    let timeout_ms = normalize_job_timeout_ms(dispatch.job.timeout_ms)?;
    let max_attempts = normalize_job_max_attempts(dispatch.job.max_attempts);

    loop {
        let current = fetch_job_for_dispatch(dispatch)?;
        if matches!(current.status.as_str(), "cancelled" | "completed")
            || control.load(Ordering::SeqCst)
        {
            return Ok(());
        }

        let attempt = current.attempt.saturating_add(1).max(1);
        match runner(
            &dispatch.db_path,
            &dispatch.user_handle,
            &current,
            Arc::clone(&control),
            timeout_ms,
            attempt,
        ) {
            Ok(()) => return Ok(()),
            Err(error) => {
                let latest = fetch_job_for_dispatch(dispatch).unwrap_or_else(|_| current.clone());
                if latest.status == "cancelled" || control.load(Ordering::SeqCst) {
                    return Ok(());
                }
                if attempt < max_attempts {
                    let backoff_ms = job_retry_backoff_ms(attempt);
                    mark_job_retry_scheduled(
                        &dispatch.db_path,
                        &dispatch.user_handle,
                        &latest,
                        &error.message,
                        backoff_ms,
                        attempt,
                    )?;
                    thread::sleep(Duration::from_millis(backoff_ms));
                    continue;
                }
                return Err(error);
            }
        }
    }
}

fn fetch_job_for_dispatch(dispatch: &JobDispatch) -> Result<ControlJobRecord, ApiError> {
    let connection = open_connection(&dispatch.db_path)?;
    ensure_control_schema(&connection)?;
    Ok(
        fetch_control_job(&connection, &dispatch.user_handle, &dispatch.job.id)?
            .unwrap_or_else(|| dispatch.job.clone()),
    )
}

fn recover_stale_jobs(
    connection: &Connection,
    user_handle: &str,
    runtime: &Arc<RuntimeState>,
) -> Result<usize, ApiError> {
    let mut statement = connection.prepare(
        "SELECT id, extension_id, type, status, created_at, updated_at, progress, summary, error, payload, result, channel, started_at, finished_at, timeout_ms, idempotency_key, attempt, max_attempts, cancel_requested_at
         FROM authority_jobs
         WHERE user_handle = ?1 AND status IN ('queued', 'running')
         ORDER BY updated_at ASC, id ASC",
    ).map_err(to_sql_error)?;
    let rows = statement
        .query_map(params![user_handle], control_job_from_row)
        .map_err(to_sql_error)?;

    let mut recovered = 0usize;
    for row in rows {
        let job = attach_job_attempt_history(connection, user_handle, row.map_err(to_sql_error)?)?;
        if !should_recover_stale_job(runtime, user_handle, &job)? {
            continue;
        }

        let previous_status = job.status.clone();
        let timestamp = current_timestamp_iso();
        let mut recovered_job = ControlJobRecord {
            status: String::from("failed"),
            updated_at: timestamp.clone(),
            finished_at: Some(timestamp),
            summary: Some(String::from("Recovered stale job after runtime restart")),
            error: Some(String::from("job_recovery_required")),
            result: None,
            ..job
        };
        let recovered_attempt_record = JobAttemptRecord {
            attempt: recovered_job.attempt,
            event: JobAttemptEvent::Recovered,
            timestamp: recovered_job.updated_at.clone(),
            summary: recovered_job.summary.clone(),
            error: recovered_job.error.clone(),
            backoff_ms: None,
        };
        append_attempt_history(&mut recovered_job, recovered_attempt_record);
        save_control_job_record(connection, user_handle, &recovered_job)?;
        publish_job_record(connection, user_handle, &recovered_job)?;
        append_control_audit_record(
            connection,
            user_handle,
            &recovered_job.extension_id,
            "warning",
            "Recovered stale job",
            Some(json!({
                "jobId": recovered_job.id,
                "jobType": recovered_job.job_type,
                "previousStatus": previous_status,
                "message": "job_recovery_required",
            })),
        )?;
        recovered += 1;
    }

    Ok(recovered)
}

fn should_recover_stale_job(
    runtime: &Arc<RuntimeState>,
    user_handle: &str,
    job: &ControlJobRecord,
) -> Result<bool, ApiError> {
    if !matches!(job.status.as_str(), "queued" | "running") {
        return Ok(false);
    }
    if !timestamp_is_before(&job.updated_at, &runtime.started_at_iso) {
        return Ok(false);
    }

    let key = job_control_key(user_handle, &job.id);
    if runtime
        .job_controls
        .lock()
        .map_err(|_| ApiError {
            status_code: 500,
            message: String::from("internal_error: job control lock poisoned"),
        })?
        .contains_key(&key)
    {
        return Ok(false);
    }

    let queue_state = runtime.job_queue.state.lock().map_err(|_| ApiError {
        status_code: 500,
        message: String::from("internal_error: job queue lock poisoned"),
    })?;
    Ok(!queue_state
        .items
        .iter()
        .any(|dispatch| dispatch.user_handle == user_handle && dispatch.job.id == job.id))
}

fn timestamp_is_before(left: &str, right: &str) -> bool {
    left < right
}

fn resolve_job_runner(job_type: &str) -> Option<JobRunner> {
    match job_type {
        "delay" => Some(run_delay_job),
        "sql.backup" => Some(run_sql_backup_job),
        "trivium.flush" => Some(run_trivium_flush_job),
        "fs.import-jsonl" => Some(run_fs_import_jsonl_job),
        _ => None,
    }
}

async fn health_handler(State(config): State<Arc<Config>>) -> Json<JsonValue> {
    Json(json!({
        "name": "authority-core",
        "apiVersion": config.api_version,
        "version": config.version,
        "buildHash": config.build_hash,
        "platform": config.platform,
        "pid": process::id(),
        "startedAt": config.started_at,
        "uptimeMs": runtime_uptime_ms(&config.started_at),
        "requestCount": config.runtime.request_count.load(Ordering::SeqCst),
        "errorCount": config.runtime.error_count.load(Ordering::SeqCst),
        "activeJobCount": active_job_count(&config.runtime),
        "queuedJobCount": config.runtime.queued_job_count.load(Ordering::SeqCst),
        "queuedRequestCount": config.runtime.queued_request_count.load(Ordering::SeqCst),
        "runtimeMode": "async",
        "maxConcurrency": MAX_CONCURRENCY,
        "currentConcurrency": config.runtime.current_concurrency.load(Ordering::SeqCst),
        "workerCount": JOB_WORKER_CONCURRENCY,
        "lastError": runtime_last_error(&config.runtime),
        "jobRegistrySummary": job_registry_summary_json(),
        "jobWorkerConcurrency": JOB_WORKER_CONCURRENCY,
        "maxJobQueueSize": MAX_JOB_QUEUE_SIZE,
        "timeoutMs": REQUEST_TIMEOUT_SECS * 1000,
        "limits": {
            "maxRequestBytes": MAX_REQUEST_SIZE,
            "maxKvValueBytes": MAX_KV_VALUE_BYTES,
            "maxBlobBytes": MAX_BLOB_BYTES,
            "maxHttpBodyBytes": MAX_HTTP_BODY_BYTES,
            "maxHttpResponseBytes": MAX_HTTP_RESPONSE_BYTES,
            "maxEventPollLimit": MAX_EVENT_POLL_LIMIT,
        },
    }))
}

async fn auth_middleware(
    State(config): State<Arc<Config>>,
    request: Request,
    next: Next,
) -> Result<Response, ApiError> {
    if !config.token.is_empty() {
        let token_header = request
            .headers()
            .get("x-authority-core-token")
            .and_then(|value| value.to_str().ok());
        if token_header != Some(config.token.as_str()) {
            config.runtime.error_count.fetch_add(1, Ordering::SeqCst);
            set_runtime_last_error(&config.runtime, "unauthorized");
            emit_runtime_event(
                "error",
                "auth_failed",
                json!({
                    "reason": "unauthorized",
                }),
            );
            return Err(ApiError {
                status_code: 401,
                message: String::from("unauthorized"),
            });
        }
    }
    config.runtime.request_count.fetch_add(1, Ordering::SeqCst);
    Ok(next.run(request).await)
}

async fn concurrency_guard(
    State(config): State<Arc<Config>>,
    request: Request,
    next: Next,
) -> Result<Response, ApiError> {
    config
        .runtime
        .queued_request_count
        .fetch_add(1, Ordering::SeqCst);
    let permit = config.runtime.concurrency_semaphore.try_acquire();
    config
        .runtime
        .queued_request_count
        .fetch_sub(1, Ordering::SeqCst);
    if permit.is_err() {
        config.runtime.error_count.fetch_add(1, Ordering::SeqCst);
        set_runtime_last_error(&config.runtime, "concurrency_limit_exceeded");
        emit_runtime_event(
            "warning",
            "queue_full",
            json!({
                "reason": "concurrency_limit_exceeded",
                "maxConcurrency": MAX_CONCURRENCY,
                "currentConcurrency": config.runtime.current_concurrency.load(Ordering::SeqCst),
            }),
        );
        return Err(ApiError {
            status_code: 503,
            message: String::from("concurrency_limit_exceeded"),
        });
    }
    config
        .runtime
        .current_concurrency
        .fetch_add(1, Ordering::SeqCst);
    let response = next.run(request).await;
    config
        .runtime
        .current_concurrency
        .fetch_sub(1, Ordering::SeqCst);
    drop(permit);
    Ok(response)
}

async fn v1_storage_kv_get(
    State(_config): State<Arc<Config>>,
    Json(body): Json<StorageKvGetRequest>,
) -> Result<Json<JsonValue>, ApiError> {
    spawn_blocking_handler(body, handle_storage_kv_get).await
}
async fn v1_storage_kv_set(
    State(_config): State<Arc<Config>>,
    Json(body): Json<StorageKvSetRequest>,
) -> Result<Json<JsonValue>, ApiError> {
    spawn_blocking_handler(body, handle_storage_kv_set).await
}
async fn v1_storage_kv_delete(
    State(_config): State<Arc<Config>>,
    Json(body): Json<StorageKvDeleteRequest>,
) -> Result<Json<JsonValue>, ApiError> {
    spawn_blocking_handler(body, handle_storage_kv_delete).await
}
async fn v1_storage_kv_list(
    State(_config): State<Arc<Config>>,
    Json(body): Json<StorageKvListRequest>,
) -> Result<Json<JsonValue>, ApiError> {
    spawn_blocking_handler(body, handle_storage_kv_list).await
}
async fn v1_storage_blob_put(
    State(_config): State<Arc<Config>>,
    Json(body): Json<StorageBlobPutRequest>,
) -> Result<Json<JsonValue>, ApiError> {
    spawn_blocking_handler(body, handle_storage_blob_put).await
}
async fn v1_storage_blob_open_read(
    State(_config): State<Arc<Config>>,
    Json(body): Json<StorageBlobGetRequest>,
) -> Result<Json<JsonValue>, ApiError> {
    spawn_blocking_handler(body, handle_storage_blob_open_read).await
}
async fn v1_storage_blob_get(
    State(_config): State<Arc<Config>>,
    Json(body): Json<StorageBlobGetRequest>,
) -> Result<Json<JsonValue>, ApiError> {
    spawn_blocking_handler(body, handle_storage_blob_get).await
}
async fn v1_storage_blob_delete(
    State(_config): State<Arc<Config>>,
    Json(body): Json<StorageBlobDeleteRequest>,
) -> Result<Json<JsonValue>, ApiError> {
    spawn_blocking_handler(body, handle_storage_blob_delete).await
}
async fn v1_storage_blob_list(
    State(_config): State<Arc<Config>>,
    Json(body): Json<StorageBlobListRequest>,
) -> Result<Json<JsonValue>, ApiError> {
    spawn_blocking_handler(body, handle_storage_blob_list).await
}
async fn v1_private_mkdir(
    State(_config): State<Arc<Config>>,
    Json(body): Json<PrivateFileMkdirRequest>,
) -> Result<Json<JsonValue>, ApiError> {
    spawn_blocking_handler(body, handle_private_file_mkdir).await
}
async fn v1_private_read_dir(
    State(_config): State<Arc<Config>>,
    Json(body): Json<PrivateFileReadDirRequest>,
) -> Result<Json<JsonValue>, ApiError> {
    spawn_blocking_handler(body, handle_private_file_read_dir).await
}
async fn v1_private_write(
    State(_config): State<Arc<Config>>,
    Json(body): Json<PrivateFileWriteRequest>,
) -> Result<Json<JsonValue>, ApiError> {
    spawn_blocking_handler(body, handle_private_file_write).await
}
async fn v1_private_open_read(
    State(_config): State<Arc<Config>>,
    Json(body): Json<PrivateFileReadRequest>,
) -> Result<Json<JsonValue>, ApiError> {
    spawn_blocking_handler(body, handle_private_file_open_read).await
}
async fn v1_private_read(
    State(_config): State<Arc<Config>>,
    Json(body): Json<PrivateFileReadRequest>,
) -> Result<Json<JsonValue>, ApiError> {
    spawn_blocking_handler(body, handle_private_file_read).await
}
async fn v1_private_delete(
    State(_config): State<Arc<Config>>,
    Json(body): Json<PrivateFileDeleteRequest>,
) -> Result<Json<JsonValue>, ApiError> {
    spawn_blocking_handler(body, handle_private_file_delete).await
}
async fn v1_private_stat(
    State(_config): State<Arc<Config>>,
    Json(body): Json<PrivateFileStatRequest>,
) -> Result<Json<JsonValue>, ApiError> {
    spawn_blocking_handler(body, handle_private_file_stat).await
}
async fn v1_http_fetch(
    State(_config): State<Arc<Config>>,
    Json(body): Json<CoreHttpFetchRequest>,
) -> Result<Json<JsonValue>, ApiError> {
    spawn_blocking_handler(body, handle_http_fetch).await
}
async fn v1_http_fetch_open(
    State(_config): State<Arc<Config>>,
    Json(body): Json<CoreHttpFetchOpenRequest>,
) -> Result<Json<JsonValue>, ApiError> {
    spawn_blocking_handler(body, handle_http_fetch_open).await
}
async fn v1_sql_query(
    State(_config): State<Arc<Config>>,
    Json(body): Json<SqlRequest>,
) -> Result<Json<JsonValue>, ApiError> {
    spawn_blocking_handler(body, handle_sql_query).await
}
async fn v1_sql_exec(
    State(_config): State<Arc<Config>>,
    Json(body): Json<SqlRequest>,
) -> Result<Json<JsonValue>, ApiError> {
    spawn_blocking_handler(body, handle_sql_exec).await
}
async fn v1_sql_batch(
    State(_config): State<Arc<Config>>,
    Json(body): Json<SqlBatchRequest>,
) -> Result<Json<JsonValue>, ApiError> {
    spawn_blocking_handler(body, handle_sql_batch).await
}
async fn v1_sql_transaction(
    State(_config): State<Arc<Config>>,
    Json(body): Json<SqlBatchRequest>,
) -> Result<Json<JsonValue>, ApiError> {
    spawn_blocking_handler(body, handle_sql_transaction).await
}
async fn v1_sql_migrate(
    State(_config): State<Arc<Config>>,
    Json(body): Json<SqlMigrateRequest>,
) -> Result<Json<JsonValue>, ApiError> {
    spawn_blocking_handler(body, handle_sql_migrate).await
}
async fn v1_sql_stat(
    State(_config): State<Arc<Config>>,
    Json(body): Json<SqlStatRequest>,
) -> Result<Json<JsonValue>, ApiError> {
    spawn_blocking_handler(body, handle_sql_stat).await
}
async fn v1_trivium_insert(
    State(_config): State<Arc<Config>>,
    Json(body): Json<TriviumInsertRequest>,
) -> Result<Json<JsonValue>, ApiError> {
    spawn_blocking_handler(body, handle_trivium_insert).await
}
async fn v1_trivium_insert_with_id(
    State(_config): State<Arc<Config>>,
    Json(body): Json<TriviumInsertWithIdRequest>,
) -> Result<Json<JsonValue>, ApiError> {
    spawn_blocking_handler(body, handle_trivium_insert_with_id).await
}
async fn v1_trivium_bulk_upsert(
    State(_config): State<Arc<Config>>,
    Json(body): Json<TriviumBulkUpsertRequest>,
) -> Result<Json<JsonValue>, ApiError> {
    spawn_blocking_handler(body, handle_trivium_bulk_upsert).await
}
async fn v1_trivium_get(
    State(_config): State<Arc<Config>>,
    Json(body): Json<TriviumGetRequest>,
) -> Result<Json<JsonValue>, ApiError> {
    spawn_blocking_handler(body, handle_trivium_get).await
}
async fn v1_trivium_update_payload(
    State(_config): State<Arc<Config>>,
    Json(body): Json<TriviumUpdatePayloadRequest>,
) -> Result<Json<JsonValue>, ApiError> {
    spawn_blocking_handler(body, handle_trivium_update_payload).await
}
async fn v1_trivium_update_vector(
    State(_config): State<Arc<Config>>,
    Json(body): Json<TriviumUpdateVectorRequest>,
) -> Result<Json<JsonValue>, ApiError> {
    spawn_blocking_handler(body, handle_trivium_update_vector).await
}
async fn v1_trivium_delete(
    State(_config): State<Arc<Config>>,
    Json(body): Json<TriviumDeleteRequest>,
) -> Result<Json<JsonValue>, ApiError> {
    spawn_blocking_handler(body, handle_trivium_delete).await
}
async fn v1_trivium_bulk_delete(
    State(_config): State<Arc<Config>>,
    Json(body): Json<TriviumBulkDeleteRequest>,
) -> Result<Json<JsonValue>, ApiError> {
    spawn_blocking_handler(body, handle_trivium_bulk_delete).await
}
async fn v1_trivium_link(
    State(_config): State<Arc<Config>>,
    Json(body): Json<TriviumLinkRequest>,
) -> Result<Json<JsonValue>, ApiError> {
    spawn_blocking_handler(body, handle_trivium_link).await
}
async fn v1_trivium_bulk_link(
    State(_config): State<Arc<Config>>,
    Json(body): Json<TriviumBulkLinkRequest>,
) -> Result<Json<JsonValue>, ApiError> {
    spawn_blocking_handler(body, handle_trivium_bulk_link).await
}
async fn v1_trivium_unlink(
    State(_config): State<Arc<Config>>,
    Json(body): Json<TriviumUnlinkRequest>,
) -> Result<Json<JsonValue>, ApiError> {
    spawn_blocking_handler(body, handle_trivium_unlink).await
}
async fn v1_trivium_bulk_unlink(
    State(_config): State<Arc<Config>>,
    Json(body): Json<TriviumBulkUnlinkRequest>,
) -> Result<Json<JsonValue>, ApiError> {
    spawn_blocking_handler(body, handle_trivium_bulk_unlink).await
}
async fn v1_trivium_neighbors(
    State(_config): State<Arc<Config>>,
    Json(body): Json<TriviumNeighborsRequest>,
) -> Result<Json<JsonValue>, ApiError> {
    spawn_blocking_handler(body, handle_trivium_neighbors).await
}
async fn v1_trivium_search(
    State(_config): State<Arc<Config>>,
    Json(body): Json<TriviumSearchRequest>,
) -> Result<Json<JsonValue>, ApiError> {
    spawn_blocking_handler(body, handle_trivium_search).await
}
async fn v1_trivium_search_advanced(
    State(_config): State<Arc<Config>>,
    Json(body): Json<TriviumSearchAdvancedRequest>,
) -> Result<Json<JsonValue>, ApiError> {
    spawn_blocking_handler(body, handle_trivium_search_advanced).await
}
async fn v1_trivium_search_hybrid(
    State(_config): State<Arc<Config>>,
    Json(body): Json<TriviumSearchHybridRequest>,
) -> Result<Json<JsonValue>, ApiError> {
    spawn_blocking_handler(body, handle_trivium_search_hybrid).await
}
async fn v1_trivium_search_hybrid_with_context(
    State(_config): State<Arc<Config>>,
    Json(body): Json<TriviumSearchHybridRequest>,
) -> Result<Json<JsonValue>, ApiError> {
    spawn_blocking_handler(body, handle_trivium_search_hybrid_with_context).await
}
async fn v1_trivium_tql(
    State(_config): State<Arc<Config>>,
    Json(body): Json<TriviumTqlRequest>,
) -> Result<Json<JsonValue>, ApiError> {
    spawn_blocking_handler(body, handle_trivium_tql).await
}
async fn v1_trivium_tql_mut(
    State(_config): State<Arc<Config>>,
    Json(body): Json<TriviumTqlMutRequest>,
) -> Result<Json<JsonValue>, ApiError> {
    spawn_blocking_handler(body, handle_trivium_tql_mut).await
}
async fn v1_trivium_create_index(
    State(_config): State<Arc<Config>>,
    Json(body): Json<TriviumCreateIndexRequest>,
) -> Result<Json<JsonValue>, ApiError> {
    spawn_blocking_handler(body, handle_trivium_create_index).await
}
async fn v1_trivium_drop_index(
    State(_config): State<Arc<Config>>,
    Json(body): Json<TriviumDropIndexRequest>,
) -> Result<Json<JsonValue>, ApiError> {
    spawn_blocking_handler(body, handle_trivium_drop_index).await
}
async fn v1_trivium_index_text(
    State(_config): State<Arc<Config>>,
    Json(body): Json<TriviumIndexTextRequest>,
) -> Result<Json<JsonValue>, ApiError> {
    spawn_blocking_handler(body, handle_trivium_index_text).await
}
async fn v1_trivium_index_keyword(
    State(_config): State<Arc<Config>>,
    Json(body): Json<TriviumIndexKeywordRequest>,
) -> Result<Json<JsonValue>, ApiError> {
    spawn_blocking_handler(body, handle_trivium_index_keyword).await
}
async fn v1_trivium_build_text_index(
    State(_config): State<Arc<Config>>,
    Json(body): Json<TriviumBuildTextIndexRequest>,
) -> Result<Json<JsonValue>, ApiError> {
    spawn_blocking_handler(body, handle_trivium_build_text_index).await
}
async fn v1_trivium_compact(
    State(_config): State<Arc<Config>>,
    Json(body): Json<TriviumCompactRequest>,
) -> Result<Json<JsonValue>, ApiError> {
    spawn_blocking_handler(body, handle_trivium_compact).await
}
async fn v1_trivium_flush(
    State(_config): State<Arc<Config>>,
    Json(body): Json<TriviumFlushRequest>,
) -> Result<Json<JsonValue>, ApiError> {
    spawn_blocking_handler(body, handle_trivium_flush).await
}
async fn v1_trivium_stat(
    State(_config): State<Arc<Config>>,
    Json(body): Json<TriviumStatRequest>,
) -> Result<Json<JsonValue>, ApiError> {
    spawn_blocking_handler(body, handle_trivium_stat).await
}
async fn v1_control_session_init(
    State(config): State<Arc<Config>>,
    Json(body): Json<ControlSessionInitRequest>,
) -> Result<Json<JsonValue>, ApiError> {
    let runtime = config.runtime.clone();
    let result = tokio::task::spawn_blocking(move || handle_control_session_init(body, &runtime))
        .await
        .map_err(|_| ApiError {
            status_code: 500,
            message: String::from("task_join_error"),
        })?;
    result.map(Json)
}
async fn v1_control_session_get(
    State(_config): State<Arc<Config>>,
    Json(body): Json<ControlSessionGetRequest>,
) -> Result<Json<JsonValue>, ApiError> {
    spawn_blocking_handler(body, handle_control_session_get).await
}
async fn v1_control_extensions_list(
    State(_config): State<Arc<Config>>,
    Json(body): Json<ControlExtensionsListRequest>,
) -> Result<Json<JsonValue>, ApiError> {
    spawn_blocking_handler(body, handle_control_extensions_list).await
}
async fn v1_control_extension_get(
    State(_config): State<Arc<Config>>,
    Json(body): Json<ControlExtensionGetRequest>,
) -> Result<Json<JsonValue>, ApiError> {
    spawn_blocking_handler(body, handle_control_extension_get).await
}
async fn v1_control_audit_log(
    State(_config): State<Arc<Config>>,
    Json(body): Json<ControlAuditLogRequest>,
) -> Result<Json<JsonValue>, ApiError> {
    spawn_blocking_handler(body, handle_control_audit_log).await
}
async fn v1_control_audit_recent(
    State(_config): State<Arc<Config>>,
    Json(body): Json<ControlAuditRecentRequest>,
) -> Result<Json<JsonValue>, ApiError> {
    spawn_blocking_handler(body, handle_control_audit_recent).await
}
async fn v1_control_grants_list(
    State(_config): State<Arc<Config>>,
    Json(body): Json<ControlGrantListRequest>,
) -> Result<Json<JsonValue>, ApiError> {
    spawn_blocking_handler(body, handle_control_grants_list).await
}
async fn v1_control_grant_get(
    State(_config): State<Arc<Config>>,
    Json(body): Json<ControlGrantGetRequest>,
) -> Result<Json<JsonValue>, ApiError> {
    spawn_blocking_handler(body, handle_control_grant_get).await
}
async fn v1_control_grant_upsert(
    State(_config): State<Arc<Config>>,
    Json(body): Json<ControlGrantUpsertRequest>,
) -> Result<Json<JsonValue>, ApiError> {
    spawn_blocking_handler(body, handle_control_grant_upsert).await
}
async fn v1_control_grants_reset(
    State(_config): State<Arc<Config>>,
    Json(body): Json<ControlGrantResetRequest>,
) -> Result<Json<JsonValue>, ApiError> {
    spawn_blocking_handler(body, handle_control_grants_reset).await
}
async fn v1_control_policies_get(
    State(_config): State<Arc<Config>>,
    Json(body): Json<ControlPoliciesRequest>,
) -> Result<Json<JsonValue>, ApiError> {
    spawn_blocking_handler(body, handle_control_policies_get).await
}
async fn v1_control_policies_save(
    State(_config): State<Arc<Config>>,
    Json(body): Json<ControlPoliciesSaveRequest>,
) -> Result<Json<JsonValue>, ApiError> {
    spawn_blocking_handler(body, handle_control_policies_save).await
}
async fn v1_control_jobs_list(
    State(config): State<Arc<Config>>,
    Json(body): Json<ControlJobsListRequest>,
) -> Result<Json<JsonValue>, ApiError> {
    let runtime = config.runtime.clone();
    let result = tokio::task::spawn_blocking(move || handle_control_jobs_list(body, &runtime))
        .await
        .map_err(|_| ApiError {
            status_code: 500,
            message: String::from("task_join_error"),
        })?;
    result.map(Json)
}
async fn v1_control_job_get(
    State(config): State<Arc<Config>>,
    Json(body): Json<ControlJobGetRequest>,
) -> Result<Json<JsonValue>, ApiError> {
    let runtime = config.runtime.clone();
    let result = tokio::task::spawn_blocking(move || handle_control_job_get(body, &runtime))
        .await
        .map_err(|_| ApiError {
            status_code: 500,
            message: String::from("task_join_error"),
        })?;
    result.map(Json)
}
async fn v1_control_job_upsert(
    State(_config): State<Arc<Config>>,
    Json(body): Json<ControlJobUpsertRequest>,
) -> Result<Json<JsonValue>, ApiError> {
    spawn_blocking_handler(body, handle_control_job_upsert).await
}
async fn v1_control_events_poll(
    State(_config): State<Arc<Config>>,
    Json(body): Json<ControlEventsPollRequest>,
) -> Result<Json<JsonValue>, ApiError> {
    spawn_blocking_handler(body, handle_control_events_poll).await
}

async fn v1_control_job_create(
    State(config): State<Arc<Config>>,
    Json(body): Json<ControlJobCreateRequest>,
) -> Result<Json<JsonValue>, ApiError> {
    let runtime = config.runtime.clone();
    let result = tokio::task::spawn_blocking(move || handle_control_job_create(body, &runtime))
        .await
        .map_err(|_| ApiError {
            status_code: 500,
            message: String::from("task_join_error"),
        })?;
    result.map(Json)
}
async fn v1_control_job_cancel(
    State(config): State<Arc<Config>>,
    Json(body): Json<ControlJobCancelRequest>,
) -> Result<Json<JsonValue>, ApiError> {
    let runtime = config.runtime.clone();
    let result = tokio::task::spawn_blocking(move || handle_control_job_cancel(body, &runtime))
        .await
        .map_err(|_| ApiError {
            status_code: 500,
            message: String::from("task_join_error"),
        })?;
    result.map(Json)
}
async fn v1_control_job_requeue(
    State(config): State<Arc<Config>>,
    Json(body): Json<ControlJobRequeueRequest>,
) -> Result<Json<JsonValue>, ApiError> {
    let runtime = config.runtime.clone();
    let result = tokio::task::spawn_blocking(move || handle_control_job_requeue(body, &runtime))
        .await
        .map_err(|_| ApiError {
            status_code: 500,
            message: String::from("task_join_error"),
        })?;
    result.map(Json)
}

async fn spawn_blocking_handler<T, F>(body: T, handler: F) -> Result<Json<JsonValue>, ApiError>
where
    T: Send + 'static,
    F: FnOnce(T) -> Result<JsonValue, ApiError> + Send + 'static,
{
    tokio::task::spawn_blocking(move || handler(body))
        .await
        .map_err(|_| ApiError {
            status_code: 500,
            message: String::from("task_join_error"),
        })?
        .map(Json)
}

fn handle_sql_query(request: SqlRequest) -> Result<JsonValue, ApiError> {
    let started = Instant::now();
    validate_paged_sql_query(&request.statement, request.page.as_ref())?;
    let connection = open_connection(&request.db_path)?;
    let mut result = run_query(&connection, &request.statement, &request.params)?;
    let (rows, page) = slice_vec_page(result.rows, request.page.as_ref(), 100, 1000)?;
    result.rows = rows;
    result.page = page;
    let _ = record_slow_sql_if_needed(&connection, started.elapsed(), &request.statement);
    emit_if_slow(
        "sql_query_slow",
        started.elapsed(),
        SLOW_SQL_LOG_MS,
        json!({
            "statement": request.statement,
        }),
    );
    Ok(serde_json::to_value(result).expect("sql query result should serialize"))
}

fn handle_sql_exec(request: SqlRequest) -> Result<JsonValue, ApiError> {
    let started = Instant::now();
    let connection = open_connection(&request.db_path)?;
    let result = run_exec(&connection, &request.statement, &request.params)?;
    let _ = record_slow_sql_if_needed(&connection, started.elapsed(), &request.statement);
    emit_if_slow(
        "sql_exec_slow",
        started.elapsed(),
        SLOW_SQL_LOG_MS,
        json!({
            "statement": request.statement,
        }),
    );
    Ok(serde_json::to_value(result).expect("sql exec result should serialize"))
}

fn handle_sql_batch(request: SqlBatchRequest) -> Result<JsonValue, ApiError> {
    let started = Instant::now();
    let results = execute_transactional_statements(&request.db_path, &request.statements)?;
    let elapsed = started.elapsed();
    let statement_preview = preview_sql_batch_statements(&request.statements);
    let connection = open_connection(&request.db_path)?;
    let _ = record_slow_sql_if_needed(&connection, elapsed, &statement_preview);
    emit_if_slow(
        "sql_batch_slow",
        elapsed,
        SLOW_SQL_LOG_MS,
        json!({
            "statement": statement_preview,
            "statementCount": request.statements.len(),
        }),
    );
    Ok(json!({ "results": results }))
}

fn handle_sql_transaction(request: SqlBatchRequest) -> Result<JsonValue, ApiError> {
    let started = Instant::now();
    let results = execute_transactional_statements(&request.db_path, &request.statements)?;
    let elapsed = started.elapsed();
    let statement_preview = preview_sql_batch_statements(&request.statements);
    let connection = open_connection(&request.db_path)?;
    let _ = record_slow_sql_if_needed(&connection, elapsed, &statement_preview);
    emit_if_slow(
        "sql_transaction_slow",
        elapsed,
        SLOW_SQL_LOG_MS,
        json!({
            "statement": statement_preview,
            "statementCount": request.statements.len(),
        }),
    );
    let response = SqlTransactionResponse {
        committed: true,
        results,
    };
    Ok(serde_json::to_value(response).expect("sql transaction response should serialize"))
}

fn handle_sql_migrate(request: SqlMigrateRequest) -> Result<JsonValue, ApiError> {
    let table_name = validate_sql_identifier(
        request
            .table_name
            .as_deref()
            .unwrap_or("_authority_migrations"),
    )?;
    let mut connection = open_connection(&request.db_path)?;
    let transaction = connection.transaction().map_err(to_sql_error)?;
    ensure_migration_table(&transaction, &table_name)?;
    let mut applied_ids = fetch_applied_migration_ids(&transaction, &table_name)?;
    let mut applied = Vec::new();
    let mut skipped = Vec::new();

    for migration in &request.migrations {
        let migration_id = migration.id.trim();
        if migration_id.is_empty() {
            return Err(ApiError {
                status_code: 400,
                message: String::from("sql migration id must not be empty"),
            });
        }
        if migration.statement.trim().is_empty() {
            return Err(ApiError {
                status_code: 400,
                message: format!(
                    "sql migration statement must not be empty for {}",
                    migration_id
                ),
            });
        }

        if applied_ids.contains(migration_id) {
            skipped.push(migration_id.to_string());
            continue;
        }

        transaction
            .execute_batch(&migration.statement)
            .map_err(|error| to_sql_migration_error(migration_id, &migration.statement, error))?;
        let insert_statement = format!(
            "INSERT INTO {} (id, applied_at) VALUES (?1, ?2)",
            table_name
        );
        transaction
            .execute(
                &insert_statement,
                (migration_id, current_timestamp_millis()),
            )
            .map_err(|error| to_sql_migration_error(migration_id, &insert_statement, error))?;
        applied_ids.insert(migration_id.to_string());
        applied.push(migration_id.to_string());
    }

    transaction.commit().map_err(to_sql_error)?;
    let latest_id = request.migrations.iter().rev().find_map(|migration| {
        let migration_id = migration.id.trim();
        applied_ids
            .contains(migration_id)
            .then(|| migration_id.to_string())
    });
    let response = SqlMigrateResponse {
        table_name,
        applied,
        skipped,
        latest_id,
    };
    Ok(serde_json::to_value(response).expect("sql migrate response should serialize"))
}

fn handle_sql_stat(request: SqlStatRequest) -> Result<JsonValue, ApiError> {
    validate_non_empty("dbPath", &request.db_path)?;

    let db_path = Path::new(&request.db_path);
    let file_name = db_path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or(&request.db_path)
        .to_string();
    let database = db_path
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("default")
        .to_string();
    let exists = db_path.exists();

    if !exists {
        let response = SqlStatResponse {
            database: database.clone(),
            name: database,
            file_name,
            file_path: request.db_path,
            exists: false,
            size_bytes: 0,
            updated_at: None,
            runtime_config: default_sql_runtime_config(),
            slow_query: default_sql_slow_query_diagnostics(),
        };
        return Ok(serde_json::to_value(response).expect("sql stat response should serialize"));
    }

    let metadata = fs::metadata(db_path).map_err(to_internal_error)?;
    let connection = open_connection(&request.db_path)?;
    let response = SqlStatResponse {
        database: database.clone(),
        name: database,
        file_name,
        file_path: request.db_path,
        exists: true,
        size_bytes: metadata.len(),
        updated_at: metadata.modified().ok().and_then(system_time_to_iso),
        runtime_config: read_sql_runtime_config(&connection)?,
        slow_query: read_sql_slow_query_diagnostics(&connection)?,
    };
    Ok(serde_json::to_value(response).expect("sql stat response should serialize"))
}

fn handle_trivium_insert(request: TriviumInsertRequest) -> Result<JsonValue, ApiError> {
    let TriviumInsertRequest {
        mut open,
        vector,
        payload,
    } = request;
    infer_trivium_open_dimension(&mut open, Some(vector.len()));
    let id = match parse_trivium_dtype(open.dtype.as_deref())? {
        TriviumDTypeTag::F32 => {
            let mut db = open_trivium_f32(&open)?;
            db.insert(
                &vector.iter().map(|&value| value as f32).collect::<Vec<_>>(),
                payload,
            )
            .map_err(to_trivium_error)?
        }
        TriviumDTypeTag::F16 => {
            let mut db = open_trivium_f16(&open)?;
            db.insert(
                &vector
                    .iter()
                    .map(|&value| f16::from_f64(value))
                    .collect::<Vec<_>>(),
                payload,
            )
            .map_err(to_trivium_error)?
        }
        TriviumDTypeTag::U64 => {
            let mut db = open_trivium_u64(&open)?;
            db.insert(
                &vector.iter().map(|&value| value as u64).collect::<Vec<_>>(),
                payload,
            )
            .map_err(to_trivium_error)?
        }
    };

    Ok(serde_json::to_value(TriviumInsertResponse { id })
        .expect("trivium insert response should serialize"))
}

fn handle_trivium_insert_with_id(
    request: TriviumInsertWithIdRequest,
) -> Result<JsonValue, ApiError> {
    let TriviumInsertWithIdRequest {
        mut open,
        id,
        vector,
        payload,
    } = request;
    infer_trivium_open_dimension(&mut open, Some(vector.len()));
    match parse_trivium_dtype(open.dtype.as_deref())? {
        TriviumDTypeTag::F32 => {
            let mut db = open_trivium_f32(&open)?;
            db.insert_with_id(
                id,
                &vector.iter().map(|&value| value as f32).collect::<Vec<_>>(),
                payload,
            )
            .map_err(to_trivium_error)?;
        }
        TriviumDTypeTag::F16 => {
            let mut db = open_trivium_f16(&open)?;
            db.insert_with_id(
                id,
                &vector
                    .iter()
                    .map(|&value| f16::from_f64(value))
                    .collect::<Vec<_>>(),
                payload,
            )
            .map_err(to_trivium_error)?;
        }
        TriviumDTypeTag::U64 => {
            let mut db = open_trivium_u64(&open)?;
            db.insert_with_id(
                id,
                &vector.iter().map(|&value| value as u64).collect::<Vec<_>>(),
                payload,
            )
            .map_err(to_trivium_error)?;
        }
    }

    Ok(json!({ "ok": true }))
}

fn handle_trivium_bulk_upsert(request: TriviumBulkUpsertRequest) -> Result<JsonValue, ApiError> {
    validate_trivium_bulk_item_count(request.items.len())?;
    let TriviumBulkUpsertRequest {
        mut open,
        items: input_items,
    } = request;
    let total_count = input_items.len();
    if total_count == 0 {
        return Ok(serde_json::to_value(TriviumBulkUpsertResponse {
            total_count,
            success_count: 0,
            failure_count: 0,
            failures: Vec::new(),
            items: Vec::new(),
        })
        .expect("trivium bulk upsert response should serialize"));
    }
    infer_trivium_open_dimension(
        &mut open,
        input_items
            .iter()
            .find(|item| !item.vector.is_empty())
            .map(|item| item.vector.len()),
    );

    let mut failures = Vec::new();
    let mut items = Vec::new();
    match parse_trivium_dtype(open.dtype.as_deref())? {
        TriviumDTypeTag::F32 => {
            let mut db = open_trivium_f32(&open)?;
            for (index, item) in input_items.into_iter().enumerate() {
                let existing_node = db.get(item.id);
                let exists = existing_node.is_some();
                let vector = item
                    .vector
                    .iter()
                    .map(|&value| value as f32)
                    .collect::<Vec<_>>();
                let result = if let Some(existing_node) = existing_node {
                    let previous_vector = existing_node.vector;
                    match db.update_vector(item.id, &vector) {
                        Ok(()) => match db.update_payload(item.id, item.payload) {
                            Ok(()) => Ok(()),
                            Err(error) => {
                                let _ = db.update_vector(item.id, &previous_vector);
                                Err(error)
                            }
                        },
                        Err(error) => Err(error),
                    }
                } else {
                    db.insert_with_id(item.id, &vector, item.payload)
                        .map(|_| ())
                };
                match result {
                    Ok(()) => items.push(TriviumBulkUpsertResponseItem {
                        index,
                        id: item.id,
                        action: String::from(if exists { "updated" } else { "inserted" }),
                    }),
                    Err(error) => failures.push(TriviumBulkFailure {
                        index,
                        message: to_trivium_error(error).message,
                    }),
                }
            }
        }
        TriviumDTypeTag::F16 => {
            let mut db = open_trivium_f16(&open)?;
            for (index, item) in input_items.into_iter().enumerate() {
                let existing_node = db.get(item.id);
                let exists = existing_node.is_some();
                let vector = item
                    .vector
                    .iter()
                    .map(|&value| f16::from_f64(value))
                    .collect::<Vec<_>>();
                let result = if let Some(existing_node) = existing_node {
                    let previous_vector = existing_node.vector;
                    match db.update_vector(item.id, &vector) {
                        Ok(()) => match db.update_payload(item.id, item.payload) {
                            Ok(()) => Ok(()),
                            Err(error) => {
                                let _ = db.update_vector(item.id, &previous_vector);
                                Err(error)
                            }
                        },
                        Err(error) => Err(error),
                    }
                } else {
                    db.insert_with_id(item.id, &vector, item.payload)
                        .map(|_| ())
                };
                match result {
                    Ok(()) => items.push(TriviumBulkUpsertResponseItem {
                        index,
                        id: item.id,
                        action: String::from(if exists { "updated" } else { "inserted" }),
                    }),
                    Err(error) => failures.push(TriviumBulkFailure {
                        index,
                        message: to_trivium_error(error).message,
                    }),
                }
            }
        }
        TriviumDTypeTag::U64 => {
            let mut db = open_trivium_u64(&open)?;
            for (index, item) in input_items.into_iter().enumerate() {
                let existing_node = db.get(item.id);
                let exists = existing_node.is_some();
                let vector = item
                    .vector
                    .iter()
                    .map(|&value| value as u64)
                    .collect::<Vec<_>>();
                let result = if let Some(existing_node) = existing_node {
                    let previous_vector = existing_node.vector;
                    match db.update_vector(item.id, &vector) {
                        Ok(()) => match db.update_payload(item.id, item.payload) {
                            Ok(()) => Ok(()),
                            Err(error) => {
                                let _ = db.update_vector(item.id, &previous_vector);
                                Err(error)
                            }
                        },
                        Err(error) => Err(error),
                    }
                } else {
                    db.insert_with_id(item.id, &vector, item.payload)
                        .map(|_| ())
                };
                match result {
                    Ok(()) => items.push(TriviumBulkUpsertResponseItem {
                        index,
                        id: item.id,
                        action: String::from(if exists { "updated" } else { "inserted" }),
                    }),
                    Err(error) => failures.push(TriviumBulkFailure {
                        index,
                        message: to_trivium_error(error).message,
                    }),
                }
            }
        }
    }

    Ok(serde_json::to_value(TriviumBulkUpsertResponse {
        total_count,
        success_count: items.len(),
        failure_count: failures.len(),
        failures,
        items,
    })
    .expect("trivium bulk upsert response should serialize"))
}

fn handle_trivium_get(request: TriviumGetRequest) -> Result<JsonValue, ApiError> {
    let TriviumGetRequest { open, id } = request;
    let node = match parse_trivium_dtype(open.dtype.as_deref())? {
        TriviumDTypeTag::F32 => open_trivium_f32(&open)?
            .get(id)
            .map(|node| map_trivium_node(node, |value| value as f64)),
        TriviumDTypeTag::F16 => open_trivium_f16(&open)?
            .get(id)
            .map(|node| map_trivium_node(node, |value| value.to_f64())),
        TriviumDTypeTag::U64 => open_trivium_u64(&open)?
            .get(id)
            .map(|node| map_trivium_node(node, |value| value as f64)),
    };
    Ok(json!({ "node": node }))
}

fn handle_trivium_update_payload(
    request: TriviumUpdatePayloadRequest,
) -> Result<JsonValue, ApiError> {
    let TriviumUpdatePayloadRequest { open, id, payload } = request;
    match parse_trivium_dtype(open.dtype.as_deref())? {
        TriviumDTypeTag::F32 => open_trivium_f32(&open)?
            .update_payload(id, payload)
            .map_err(to_trivium_error)?,
        TriviumDTypeTag::F16 => open_trivium_f16(&open)?
            .update_payload(id, payload)
            .map_err(to_trivium_error)?,
        TriviumDTypeTag::U64 => open_trivium_u64(&open)?
            .update_payload(id, payload)
            .map_err(to_trivium_error)?,
    }
    Ok(json!({ "ok": true }))
}

fn handle_trivium_bulk_unlink(request: TriviumBulkUnlinkRequest) -> Result<JsonValue, ApiError> {
    validate_trivium_bulk_item_count(request.items.len())?;
    let total_count = request.items.len();
    let mut failures = Vec::new();
    match parse_trivium_dtype(request.open.dtype.as_deref())? {
        TriviumDTypeTag::F32 => {
            let mut db = open_trivium_f32(&request.open)?;
            for (index, item) in request.items.into_iter().enumerate() {
                if let Err(error) = db.unlink(item.src, item.dst) {
                    failures.push(TriviumBulkFailure {
                        index,
                        message: to_trivium_error(error).message,
                    });
                }
            }
        }
        TriviumDTypeTag::F16 => {
            let mut db = open_trivium_f16(&request.open)?;
            for (index, item) in request.items.into_iter().enumerate() {
                if let Err(error) = db.unlink(item.src, item.dst) {
                    failures.push(TriviumBulkFailure {
                        index,
                        message: to_trivium_error(error).message,
                    });
                }
            }
        }
        TriviumDTypeTag::U64 => {
            let mut db = open_trivium_u64(&request.open)?;
            for (index, item) in request.items.into_iter().enumerate() {
                if let Err(error) = db.unlink(item.src, item.dst) {
                    failures.push(TriviumBulkFailure {
                        index,
                        message: to_trivium_error(error).message,
                    });
                }
            }
        }
    }

    Ok(serde_json::to_value(TriviumBulkMutationResponse {
        total_count,
        success_count: total_count.saturating_sub(failures.len()),
        failure_count: failures.len(),
        failures,
    })
    .expect("trivium bulk unlink response should serialize"))
}

fn handle_trivium_update_vector(
    request: TriviumUpdateVectorRequest,
) -> Result<JsonValue, ApiError> {
    let TriviumUpdateVectorRequest { open, id, vector } = request;
    match parse_trivium_dtype(open.dtype.as_deref())? {
        TriviumDTypeTag::F32 => {
            open_trivium_f32(&open)?
                .update_vector(
                    id,
                    &vector.iter().map(|&value| value as f32).collect::<Vec<_>>(),
                )
                .map_err(to_trivium_error)?;
        }
        TriviumDTypeTag::F16 => {
            open_trivium_f16(&open)?
                .update_vector(
                    id,
                    &vector
                        .iter()
                        .map(|&value| f16::from_f64(value))
                        .collect::<Vec<_>>(),
                )
                .map_err(to_trivium_error)?;
        }
        TriviumDTypeTag::U64 => {
            open_trivium_u64(&open)?
                .update_vector(
                    id,
                    &vector.iter().map(|&value| value as u64).collect::<Vec<_>>(),
                )
                .map_err(to_trivium_error)?;
        }
    }
    Ok(json!({ "ok": true }))
}

fn handle_trivium_delete(request: TriviumDeleteRequest) -> Result<JsonValue, ApiError> {
    let TriviumDeleteRequest { open, id } = request;
    match parse_trivium_dtype(open.dtype.as_deref())? {
        TriviumDTypeTag::F32 => open_trivium_f32(&open)?
            .delete(id)
            .map_err(to_trivium_error)?,
        TriviumDTypeTag::F16 => open_trivium_f16(&open)?
            .delete(id)
            .map_err(to_trivium_error)?,
        TriviumDTypeTag::U64 => open_trivium_u64(&open)?
            .delete(id)
            .map_err(to_trivium_error)?,
    }
    Ok(json!({ "ok": true }))
}

fn handle_trivium_bulk_delete(request: TriviumBulkDeleteRequest) -> Result<JsonValue, ApiError> {
    validate_trivium_bulk_item_count(request.items.len())?;
    let total_count = request.items.len();
    let mut failures = Vec::new();
    match parse_trivium_dtype(request.open.dtype.as_deref())? {
        TriviumDTypeTag::F32 => {
            let mut db = open_trivium_f32(&request.open)?;
            for (index, item) in request.items.into_iter().enumerate() {
                if let Err(error) = db.delete(item.id) {
                    failures.push(TriviumBulkFailure {
                        index,
                        message: to_trivium_error(error).message,
                    });
                }
            }
        }
        TriviumDTypeTag::F16 => {
            let mut db = open_trivium_f16(&request.open)?;
            for (index, item) in request.items.into_iter().enumerate() {
                if let Err(error) = db.delete(item.id) {
                    failures.push(TriviumBulkFailure {
                        index,
                        message: to_trivium_error(error).message,
                    });
                }
            }
        }
        TriviumDTypeTag::U64 => {
            let mut db = open_trivium_u64(&request.open)?;
            for (index, item) in request.items.into_iter().enumerate() {
                if let Err(error) = db.delete(item.id) {
                    failures.push(TriviumBulkFailure {
                        index,
                        message: to_trivium_error(error).message,
                    });
                }
            }
        }
    }

    Ok(serde_json::to_value(TriviumBulkMutationResponse {
        total_count,
        success_count: total_count.saturating_sub(failures.len()),
        failure_count: failures.len(),
        failures,
    })
    .expect("trivium bulk delete response should serialize"))
}

fn handle_trivium_link(request: TriviumLinkRequest) -> Result<JsonValue, ApiError> {
    let TriviumLinkRequest {
        open,
        src,
        dst,
        label,
        weight,
    } = request;
    let label = label.unwrap_or_else(|| String::from("related"));
    let weight = weight.unwrap_or(1.0) as f32;
    match parse_trivium_dtype(open.dtype.as_deref())? {
        TriviumDTypeTag::F32 => open_trivium_f32(&open)?
            .link(src, dst, &label, weight)
            .map_err(to_trivium_error)?,
        TriviumDTypeTag::F16 => open_trivium_f16(&open)?
            .link(src, dst, &label, weight)
            .map_err(to_trivium_error)?,
        TriviumDTypeTag::U64 => open_trivium_u64(&open)?
            .link(src, dst, &label, weight)
            .map_err(to_trivium_error)?,
    }
    Ok(json!({ "ok": true }))
}

fn handle_trivium_bulk_link(request: TriviumBulkLinkRequest) -> Result<JsonValue, ApiError> {
    validate_trivium_bulk_item_count(request.items.len())?;
    let total_count = request.items.len();
    let mut failures = Vec::new();
    match parse_trivium_dtype(request.open.dtype.as_deref())? {
        TriviumDTypeTag::F32 => {
            let mut db = open_trivium_f32(&request.open)?;
            for (index, item) in request.items.into_iter().enumerate() {
                let label = item.label.unwrap_or_else(|| String::from("related"));
                let weight = item.weight.unwrap_or(1.0) as f32;
                if let Err(error) = db.link(item.src, item.dst, &label, weight) {
                    failures.push(TriviumBulkFailure {
                        index,
                        message: to_trivium_error(error).message,
                    });
                }
            }
        }
        TriviumDTypeTag::F16 => {
            let mut db = open_trivium_f16(&request.open)?;
            for (index, item) in request.items.into_iter().enumerate() {
                let label = item.label.unwrap_or_else(|| String::from("related"));
                let weight = item.weight.unwrap_or(1.0) as f32;
                if let Err(error) = db.link(item.src, item.dst, &label, weight) {
                    failures.push(TriviumBulkFailure {
                        index,
                        message: to_trivium_error(error).message,
                    });
                }
            }
        }
        TriviumDTypeTag::U64 => {
            let mut db = open_trivium_u64(&request.open)?;
            for (index, item) in request.items.into_iter().enumerate() {
                let label = item.label.unwrap_or_else(|| String::from("related"));
                let weight = item.weight.unwrap_or(1.0) as f32;
                if let Err(error) = db.link(item.src, item.dst, &label, weight) {
                    failures.push(TriviumBulkFailure {
                        index,
                        message: to_trivium_error(error).message,
                    });
                }
            }
        }
    }

    Ok(serde_json::to_value(TriviumBulkMutationResponse {
        total_count,
        success_count: total_count.saturating_sub(failures.len()),
        failure_count: failures.len(),
        failures,
    })
    .expect("trivium bulk link response should serialize"))
}

fn handle_trivium_unlink(request: TriviumUnlinkRequest) -> Result<JsonValue, ApiError> {
    let TriviumUnlinkRequest { open, src, dst } = request;
    match parse_trivium_dtype(open.dtype.as_deref())? {
        TriviumDTypeTag::F32 => open_trivium_f32(&open)?
            .unlink(src, dst)
            .map_err(to_trivium_error)?,
        TriviumDTypeTag::F16 => open_trivium_f16(&open)?
            .unlink(src, dst)
            .map_err(to_trivium_error)?,
        TriviumDTypeTag::U64 => open_trivium_u64(&open)?
            .unlink(src, dst)
            .map_err(to_trivium_error)?,
    }
    Ok(json!({ "ok": true }))
}

fn handle_trivium_neighbors(request: TriviumNeighborsRequest) -> Result<JsonValue, ApiError> {
    let TriviumNeighborsRequest { open, id, depth } = request;
    let depth = depth.unwrap_or(1);
    let ids = match parse_trivium_dtype(open.dtype.as_deref())? {
        TriviumDTypeTag::F32 => open_trivium_f32(&open)?.neighbors(id, depth),
        TriviumDTypeTag::F16 => open_trivium_f16(&open)?.neighbors(id, depth),
        TriviumDTypeTag::U64 => open_trivium_u64(&open)?.neighbors(id, depth),
    };
    Ok(serde_json::to_value(TriviumNeighborsResponse { ids })
        .expect("trivium neighbors response should serialize"))
}

fn handle_trivium_search(request: TriviumSearchRequest) -> Result<JsonValue, ApiError> {
    let started = Instant::now();
    let TriviumSearchRequest {
        open,
        vector,
        top_k,
        expand_depth,
        min_score,
    } = request;
    let top_k = top_k.unwrap_or(5);
    let expand_depth = expand_depth.unwrap_or(0);
    let min_score = min_score.unwrap_or(0.5);
    let hits = match parse_trivium_dtype(open.dtype.as_deref())? {
        TriviumDTypeTag::F32 => open_trivium_f32(&open)?
            .search(
                &vector.iter().map(|&value| value as f32).collect::<Vec<_>>(),
                top_k,
                expand_depth,
                min_score,
            )
            .map_err(to_trivium_error)?,
        TriviumDTypeTag::F16 => open_trivium_f16(&open)?
            .search(
                &vector
                    .iter()
                    .map(|&value| f16::from_f64(value))
                    .collect::<Vec<_>>(),
                top_k,
                expand_depth,
                min_score,
            )
            .map_err(to_trivium_error)?,
        TriviumDTypeTag::U64 => open_trivium_u64(&open)?
            .search(
                &vector.iter().map(|&value| value as u64).collect::<Vec<_>>(),
                top_k,
                expand_depth,
                min_score,
            )
            .map_err(to_trivium_error)?,
    };
    let hits: Vec<TriviumSearchHit> = hits.into_iter().map(map_trivium_search_hit).collect();
    emit_if_slow(
        "trivium_slow_search",
        started.elapsed(),
        SLOW_TRIVIUM_LOG_MS,
        json!({
            "dbPath": open.db_path,
            "mode": "vector",
            "topK": top_k,
            "hitCount": hits.len(),
        }),
    );
    Ok(json!({ "hits": hits }))
}

fn handle_trivium_search_advanced(
    request: TriviumSearchAdvancedRequest,
) -> Result<JsonValue, ApiError> {
    let started = Instant::now();
    if let Some(value) = request.query_text.as_deref() {
        validate_non_empty("queryText", value)?;
    }

    let config = build_trivium_advanced_search_config(&request)?;
    let query_text = request.query_text.as_deref();
    let hits = match parse_trivium_dtype(request.open.dtype.as_deref())? {
        TriviumDTypeTag::F32 => open_trivium_f32(&request.open)?
            .search_hybrid(
                query_text,
                Some(
                    &request
                        .vector
                        .iter()
                        .map(|&value| value as f32)
                        .collect::<Vec<_>>(),
                ),
                &config,
            )
            .map_err(to_trivium_error)?,
        TriviumDTypeTag::F16 => open_trivium_f16(&request.open)?
            .search_hybrid(
                query_text,
                Some(
                    &request
                        .vector
                        .iter()
                        .map(|&value| f16::from_f64(value))
                        .collect::<Vec<_>>(),
                ),
                &config,
            )
            .map_err(to_trivium_error)?,
        TriviumDTypeTag::U64 => open_trivium_u64(&request.open)?
            .search_hybrid(
                query_text,
                Some(
                    &request
                        .vector
                        .iter()
                        .map(|&value| value as u64)
                        .collect::<Vec<_>>(),
                ),
                &config,
            )
            .map_err(to_trivium_error)?,
    };
    let hits: Vec<TriviumSearchHit> = hits.into_iter().map(map_trivium_search_hit).collect();
    emit_if_slow(
        "trivium_slow_search",
        started.elapsed(),
        SLOW_TRIVIUM_LOG_MS,
        json!({
            "dbPath": request.open.db_path,
            "mode": "advanced",
            "topK": request.top_k.unwrap_or(5),
            "hitCount": hits.len(),
        }),
    );
    Ok(json!({ "hits": hits }))
}

fn handle_trivium_search_hybrid(
    request: TriviumSearchHybridRequest,
) -> Result<JsonValue, ApiError> {
    let started = Instant::now();
    validate_non_empty("queryText", &request.query_text)?;

    let config = build_trivium_hybrid_search_config(&request)?;
    let hits = match parse_trivium_dtype(request.open.dtype.as_deref())? {
        TriviumDTypeTag::F32 => open_trivium_f32(&request.open)?
            .search_hybrid(
                Some(&request.query_text),
                Some(
                    &request
                        .vector
                        .iter()
                        .map(|&value| value as f32)
                        .collect::<Vec<_>>(),
                ),
                &config,
            )
            .map_err(to_trivium_error)?,
        TriviumDTypeTag::F16 => open_trivium_f16(&request.open)?
            .search_hybrid(
                Some(&request.query_text),
                Some(
                    &request
                        .vector
                        .iter()
                        .map(|&value| f16::from_f64(value))
                        .collect::<Vec<_>>(),
                ),
                &config,
            )
            .map_err(to_trivium_error)?,
        TriviumDTypeTag::U64 => open_trivium_u64(&request.open)?
            .search_hybrid(
                Some(&request.query_text),
                Some(
                    &request
                        .vector
                        .iter()
                        .map(|&value| value as u64)
                        .collect::<Vec<_>>(),
                ),
                &config,
            )
            .map_err(to_trivium_error)?,
    };
    let hits: Vec<TriviumSearchHit> = hits.into_iter().map(map_trivium_search_hit).collect();
    emit_if_slow(
        "trivium_slow_search",
        started.elapsed(),
        SLOW_TRIVIUM_LOG_MS,
        json!({
            "dbPath": request.open.db_path,
            "mode": "hybrid",
            "topK": request.top_k.unwrap_or(5),
            "hitCount": hits.len(),
        }),
    );
    Ok(json!({ "hits": hits }))
}

fn handle_trivium_search_hybrid_with_context(
    request: TriviumSearchHybridRequest,
) -> Result<JsonValue, ApiError> {
    let started = Instant::now();
    validate_non_empty("queryText", &request.query_text)?;

    let config = build_trivium_hybrid_search_config(&request)?;
    let (hits, context) = match parse_trivium_dtype(request.open.dtype.as_deref())? {
        TriviumDTypeTag::F32 => open_trivium_f32(&request.open)?
            .search_hybrid_with_context(
                Some(&request.query_text),
                Some(
                    &request
                        .vector
                        .iter()
                        .map(|&value| value as f32)
                        .collect::<Vec<_>>(),
                ),
                &config,
            )
            .map_err(to_trivium_error)?,
        TriviumDTypeTag::F16 => open_trivium_f16(&request.open)?
            .search_hybrid_with_context(
                Some(&request.query_text),
                Some(
                    &request
                        .vector
                        .iter()
                        .map(|&value| f16::from_f64(value))
                        .collect::<Vec<_>>(),
                ),
                &config,
            )
            .map_err(to_trivium_error)?,
        TriviumDTypeTag::U64 => open_trivium_u64(&request.open)?
            .search_hybrid_with_context(
                Some(&request.query_text),
                Some(
                    &request
                        .vector
                        .iter()
                        .map(|&value| value as u64)
                        .collect::<Vec<_>>(),
                ),
                &config,
            )
            .map_err(to_trivium_error)?,
    };
    let hits: Vec<TriviumSearchHit> = hits.into_iter().map(map_trivium_search_hit).collect();
    emit_if_slow(
        "trivium_slow_search",
        started.elapsed(),
        SLOW_TRIVIUM_LOG_MS,
        json!({
            "dbPath": request.open.db_path,
            "mode": "hybrid-context",
            "topK": request.top_k.unwrap_or(5),
            "hitCount": hits.len(),
        }),
    );
    Ok(
        serde_json::to_value(TriviumSearchHybridWithContextResponse {
            hits,
            context: map_trivium_hook_context(context),
        })
        .expect("trivium hybrid search with context response should serialize"),
    )
}

fn handle_trivium_tql(request: TriviumTqlRequest) -> Result<JsonValue, ApiError> {
    validate_non_empty("query", &request.query)?;

    let mut rows = match parse_trivium_dtype(request.open.dtype.as_deref())? {
        TriviumDTypeTag::F32 => map_trivium_query_rows(
            open_trivium_f32(&request.open)?
                .tql(&request.query)
                .map_err(to_trivium_error)?,
            |value| value as f64,
        ),
        TriviumDTypeTag::F16 => map_trivium_query_rows(
            open_trivium_f16(&request.open)?
                .tql(&request.query)
                .map_err(to_trivium_error)?,
            |value| value.to_f64(),
        ),
        TriviumDTypeTag::U64 => map_trivium_query_rows(
            open_trivium_u64(&request.open)?
                .tql(&request.query)
                .map_err(to_trivium_error)?,
            |value| value as f64,
        ),
    };
    if request.page.is_some() {
        sort_trivium_query_rows(&mut rows);
    }
    let (rows, page) = slice_vec_page(rows, request.page.as_ref(), 100, 1000)?;

    Ok(
        serde_json::to_value(TriviumTqlResponse { rows, page })
            .expect("trivium tql response should serialize"),
    )
}

fn handle_trivium_tql_mut(request: TriviumTqlMutRequest) -> Result<JsonValue, ApiError> {
    validate_non_empty("query", &request.query)?;

    let result = match parse_trivium_dtype(request.open.dtype.as_deref())? {
        TriviumDTypeTag::F32 => open_trivium_f32(&request.open)?
            .tql_mut(&request.query)
            .map_err(to_trivium_error)?,
        TriviumDTypeTag::F16 => open_trivium_f16(&request.open)?
            .tql_mut(&request.query)
            .map_err(to_trivium_error)?,
        TriviumDTypeTag::U64 => open_trivium_u64(&request.open)?
            .tql_mut(&request.query)
            .map_err(to_trivium_error)?,
    };

    Ok(
        serde_json::to_value(TriviumTqlMutResponse {
            affected: result.affected,
            created_ids: result.created_ids,
        })
        .expect("trivium tql mutation response should serialize"),
    )
}

fn handle_trivium_create_index(request: TriviumCreateIndexRequest) -> Result<JsonValue, ApiError> {
    validate_non_empty("field", &request.field)?;

    match parse_trivium_dtype(request.open.dtype.as_deref())? {
        TriviumDTypeTag::F32 => open_trivium_f32(&request.open)?.create_index(&request.field),
        TriviumDTypeTag::F16 => open_trivium_f16(&request.open)?.create_index(&request.field),
        TriviumDTypeTag::U64 => open_trivium_u64(&request.open)?.create_index(&request.field),
    }

    Ok(json!({ "ok": true }))
}

fn handle_trivium_drop_index(request: TriviumDropIndexRequest) -> Result<JsonValue, ApiError> {
    validate_non_empty("field", &request.field)?;

    match parse_trivium_dtype(request.open.dtype.as_deref())? {
        TriviumDTypeTag::F32 => open_trivium_f32(&request.open)?.drop_index(&request.field),
        TriviumDTypeTag::F16 => open_trivium_f16(&request.open)?.drop_index(&request.field),
        TriviumDTypeTag::U64 => open_trivium_u64(&request.open)?.drop_index(&request.field),
    }

    Ok(json!({ "ok": true }))
}

fn handle_trivium_index_text(request: TriviumIndexTextRequest) -> Result<JsonValue, ApiError> {
    validate_non_empty("text", &request.text)?;

    match parse_trivium_dtype(request.open.dtype.as_deref())? {
        TriviumDTypeTag::F32 => {
            let mut db = open_trivium_f32(&request.open)?;
            db.index_text(request.id, &request.text)
                .map_err(to_trivium_error)?;
        }
        TriviumDTypeTag::F16 => {
            let mut db = open_trivium_f16(&request.open)?;
            db.index_text(request.id, &request.text)
                .map_err(to_trivium_error)?;
        }
        TriviumDTypeTag::U64 => {
            let mut db = open_trivium_u64(&request.open)?;
            db.index_text(request.id, &request.text)
                .map_err(to_trivium_error)?;
        }
    }

    Ok(json!({ "ok": true }))
}

fn handle_trivium_index_keyword(
    request: TriviumIndexKeywordRequest,
) -> Result<JsonValue, ApiError> {
    validate_non_empty("keyword", &request.keyword)?;

    match parse_trivium_dtype(request.open.dtype.as_deref())? {
        TriviumDTypeTag::F32 => {
            let mut db = open_trivium_f32(&request.open)?;
            db.index_keyword(request.id, &request.keyword)
                .map_err(to_trivium_error)?;
        }
        TriviumDTypeTag::F16 => {
            let mut db = open_trivium_f16(&request.open)?;
            db.index_keyword(request.id, &request.keyword)
                .map_err(to_trivium_error)?;
        }
        TriviumDTypeTag::U64 => {
            let mut db = open_trivium_u64(&request.open)?;
            db.index_keyword(request.id, &request.keyword)
                .map_err(to_trivium_error)?;
        }
    }

    Ok(json!({ "ok": true }))
}

fn handle_trivium_build_text_index(
    request: TriviumBuildTextIndexRequest,
) -> Result<JsonValue, ApiError> {
    match parse_trivium_dtype(request.open.dtype.as_deref())? {
        TriviumDTypeTag::F32 => {
            let mut db = open_trivium_f32(&request.open)?;
            db.build_text_index().map_err(to_trivium_error)?;
        }
        TriviumDTypeTag::F16 => {
            let mut db = open_trivium_f16(&request.open)?;
            db.build_text_index().map_err(to_trivium_error)?;
        }
        TriviumDTypeTag::U64 => {
            let mut db = open_trivium_u64(&request.open)?;
            db.build_text_index().map_err(to_trivium_error)?;
        }
    }

    Ok(json!({ "ok": true }))
}

fn handle_trivium_compact(request: TriviumCompactRequest) -> Result<JsonValue, ApiError> {
    let TriviumCompactRequest { open } = request;
    match parse_trivium_dtype(open.dtype.as_deref())? {
        TriviumDTypeTag::F32 => open_trivium_f32(&open)?.compact().map_err(to_trivium_error)?,
        TriviumDTypeTag::F16 => open_trivium_f16(&open)?.compact().map_err(to_trivium_error)?,
        TriviumDTypeTag::U64 => open_trivium_u64(&open)?.compact().map_err(to_trivium_error)?,
    }

    Ok(json!({ "ok": true }))
}

fn handle_trivium_flush(request: TriviumFlushRequest) -> Result<JsonValue, ApiError> {
    let TriviumFlushRequest { open } = request;
    match parse_trivium_dtype(open.dtype.as_deref())? {
        TriviumDTypeTag::F32 => open_trivium_f32(&open)?.flush().map_err(to_trivium_error)?,
        TriviumDTypeTag::F16 => open_trivium_f16(&open)?.flush().map_err(to_trivium_error)?,
        TriviumDTypeTag::U64 => open_trivium_u64(&open)?.flush().map_err(to_trivium_error)?,
    }
    Ok(json!({ "ok": true }))
}

fn handle_trivium_stat(request: TriviumStatRequest) -> Result<JsonValue, ApiError> {
    let TriviumStatRequest { open } = request;
    validate_non_empty("dbPath", &open.db_path)?;
    validate_trivium_dim(open.dim)?;

    let dtype = parse_trivium_dtype(open.dtype.as_deref())?;
    let sync_mode = parse_trivium_sync_mode(open.sync_mode.as_deref())?;
    let storage_mode = parse_trivium_storage_mode(open.storage_mode.as_deref())?;
    let db_path = Path::new(&open.db_path);
    let file_name = db_path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or(&open.db_path)
        .to_string();
    let database = db_path
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("default")
        .to_string();
    let exists = db_path.exists();
    let detected_dim = if exists {
        read_trivium_dimension_from_file(db_path)
    } else {
        None
    };

    let mut record = build_trivium_database_record(
        &open.db_path,
        database.clone(),
        file_name,
        detected_dim.or(open.dim),
        Some(dtype.as_str().to_string()),
        Some(trivium_sync_mode_to_string(sync_mode).to_string()),
        Some(trivium_storage_mode_to_string(storage_mode).to_string()),
    );

    if !exists {
        let response = TriviumStatResponse {
            database,
            file_path: open.db_path,
            exists: false,
            node_count: 0,
            edge_count: 0,
            text_index_count: None,
            last_flush_at: None,
            vector_dim: record.dim,
            database_size: record.size_bytes,
            wal_size: record.wal_size_bytes,
            vec_size: record.vec_size_bytes,
            estimated_memory_bytes: 0,
            record,
        };
        return Ok(serde_json::to_value(response).expect("trivium stat response should serialize"));
    }

    let (node_count, edge_count, estimated_memory_bytes) = match dtype {
        TriviumDTypeTag::F32 => {
            let db = open_trivium_f32(&open)?;
            let edge_count = db
                .all_node_ids()
                .into_iter()
                .map(|id| db.get_edges(id).len())
                .sum();
            (db.node_count(), edge_count, db.estimated_memory())
        }
        TriviumDTypeTag::F16 => {
            let db = open_trivium_f16(&open)?;
            let edge_count = db
                .all_node_ids()
                .into_iter()
                .map(|id| db.get_edges(id).len())
                .sum();
            (db.node_count(), edge_count, db.estimated_memory())
        }
        TriviumDTypeTag::U64 => {
            let db = open_trivium_u64(&open)?;
            let edge_count = db
                .all_node_ids()
                .into_iter()
                .map(|id| db.get_edges(id).len())
                .sum();
            (db.node_count(), edge_count, db.estimated_memory())
        }
    };
    record.dim = detected_dim.or(record.dim);

    let response = TriviumStatResponse {
        database,
        file_path: open.db_path,
        exists: true,
        node_count,
        edge_count,
        text_index_count: None,
        last_flush_at: None,
        vector_dim: record.dim,
        database_size: record.size_bytes,
        wal_size: record.wal_size_bytes,
        vec_size: record.vec_size_bytes,
        estimated_memory_bytes,
        record,
    };
    Ok(serde_json::to_value(response).expect("trivium stat response should serialize"))
}

fn handle_control_session_init(
    request: ControlSessionInitRequest,
    runtime: &Arc<RuntimeState>,
) -> Result<JsonValue, ApiError> {
    validate_non_empty("sessionToken", &request.session_token)?;
    validate_non_empty("timestamp", &request.timestamp)?;
    validate_non_empty("user.handle", &request.user.handle)?;
    validate_non_empty("config.extensionId", &request.config.extension_id)?;

    let connection = open_connection(&request.db_path)?;
    ensure_control_schema(&connection)?;
    recover_stale_jobs(&connection, &request.user.handle, runtime)?;
    let current_extension = fetch_control_extension(
        &connection,
        &request.user.handle,
        &request.config.extension_id,
    )?;
    let first_seen_at = current_extension
        .as_ref()
        .map(|extension| extension.first_seen_at.clone())
        .unwrap_or_else(|| request.timestamp.clone());
    let declared_permissions =
        serde_json::to_string(&request.config.declared_permissions).map_err(to_json_error)?;

    connection.execute(
        "INSERT INTO authority_extensions (
            user_handle, extension_id, install_type, display_name, version, first_seen_at, last_seen_at, declared_permissions, ui_label
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
        ON CONFLICT(user_handle, extension_id) DO UPDATE SET
            install_type = excluded.install_type,
            display_name = excluded.display_name,
            version = excluded.version,
            last_seen_at = excluded.last_seen_at,
            declared_permissions = excluded.declared_permissions,
            ui_label = excluded.ui_label",
        params![
            &request.user.handle,
            &request.config.extension_id,
            &request.config.install_type,
            &request.config.display_name,
            &request.config.version,
            &first_seen_at,
            &request.timestamp,
            &declared_permissions,
            &request.config.ui_label,
        ],
    ).map_err(to_sql_error)?;

    let extension = fetch_control_extension(
        &connection,
        &request.user.handle,
        &request.config.extension_id,
    )?
    .ok_or_else(|| ApiError {
        status_code: 500,
        message: String::from("control extension was not persisted"),
    })?;
    let session_declared_permissions =
        serde_json::to_string(&extension.declared_permissions).map_err(to_json_error)?;

    connection.execute(
        "INSERT INTO authority_sessions (
            token, user_handle, is_admin, extension_id, install_type, display_name, version, first_seen_at, created_at, declared_permissions
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
        ON CONFLICT(token) DO UPDATE SET
            user_handle = excluded.user_handle,
            is_admin = excluded.is_admin,
            extension_id = excluded.extension_id,
            install_type = excluded.install_type,
            display_name = excluded.display_name,
            version = excluded.version,
            first_seen_at = excluded.first_seen_at,
            created_at = excluded.created_at,
            declared_permissions = excluded.declared_permissions",
        params![
            &request.session_token,
            &request.user.handle,
            if request.user.is_admin { 1_i64 } else { 0_i64 },
            &extension.id,
            &extension.install_type,
            &extension.display_name,
            &extension.version,
            &extension.first_seen_at,
            &request.timestamp,
            &session_declared_permissions,
        ],
    ).map_err(to_sql_error)?;

    let session = fetch_control_session(&connection, &request.user.handle, &request.session_token)?
        .ok_or_else(|| ApiError {
            status_code: 500,
            message: String::from("control session was not persisted"),
        })?;
    Ok(serde_json::to_value(session).expect("control session response should serialize"))
}

fn handle_control_session_get(request: ControlSessionGetRequest) -> Result<JsonValue, ApiError> {
    validate_non_empty("userHandle", &request.user_handle)?;
    validate_non_empty("sessionToken", &request.session_token)?;

    let connection = open_connection(&request.db_path)?;
    ensure_control_schema(&connection)?;
    let session = fetch_control_session(&connection, &request.user_handle, &request.session_token)?;
    Ok(json!({ "session": session }))
}

fn handle_control_extensions_list(
    request: ControlExtensionsListRequest,
) -> Result<JsonValue, ApiError> {
    validate_non_empty("userHandle", &request.user_handle)?;

    let connection = open_connection(&request.db_path)?;
    ensure_control_schema(&connection)?;
    let mut statement = connection.prepare(
        "SELECT extension_id, install_type, display_name, version, first_seen_at, last_seen_at, declared_permissions, ui_label
         FROM authority_extensions
         WHERE user_handle = ?1
         ORDER BY display_name ASC",
    ).map_err(to_sql_error)?;
    let rows = statement
        .query_map(params![request.user_handle], control_extension_from_row)
        .map_err(to_sql_error)?;
    let mut extensions = Vec::new();
    for row in rows {
        extensions.push(row.map_err(to_sql_error)?);
    }
    Ok(json!({ "extensions": extensions }))
}

fn handle_control_extension_get(
    request: ControlExtensionGetRequest,
) -> Result<JsonValue, ApiError> {
    validate_non_empty("userHandle", &request.user_handle)?;
    validate_non_empty("extensionId", &request.extension_id)?;

    let connection = open_connection(&request.db_path)?;
    ensure_control_schema(&connection)?;
    let extension =
        fetch_control_extension(&connection, &request.user_handle, &request.extension_id)?;
    Ok(json!({ "extension": extension }))
}

fn handle_control_audit_log(request: ControlAuditLogRequest) -> Result<JsonValue, ApiError> {
    validate_non_empty("userHandle", &request.user_handle)?;
    validate_audit_record(&request.record)?;

    let connection = open_connection(&request.db_path)?;
    ensure_control_schema(&connection)?;
    insert_control_audit_record(&connection, &request.user_handle, &request.record)?;
    Ok(json!({ "ok": true }))
}

fn handle_control_audit_recent(request: ControlAuditRecentRequest) -> Result<JsonValue, ApiError> {
    validate_non_empty("userHandle", &request.user_handle)?;
    validate_non_empty("extensionId", &request.extension_id)?;

    let connection = open_connection(&request.db_path)?;
    ensure_control_schema(&connection)?;
    let (audit_offset, audit_limit) =
        normalize_offset_page_request(request.page.as_ref(), request.limit, 50, 500)?;
    let (permissions, permissions_page) = fetch_recent_audit_records_page(
        &connection,
        &request.user_handle,
        &request.extension_id,
        "permission",
        audit_offset,
        audit_limit,
    )?;
    let (usage, usage_page) = fetch_recent_audit_records_page(
        &connection,
        &request.user_handle,
        &request.extension_id,
        "usage",
        audit_offset,
        audit_limit,
    )?;
    let (errors, errors_page) = fetch_recent_audit_records_page(
        &connection,
        &request.user_handle,
        &request.extension_id,
        "error",
        audit_offset,
        audit_limit,
    )?;
    let (warnings, warnings_page) = fetch_recent_audit_records_page(
        &connection,
        &request.user_handle,
        &request.extension_id,
        "warning",
        audit_offset,
        audit_limit,
    )?;
    Ok(json!({
        "permissions": permissions,
        "usage": usage,
        "errors": errors,
        "warnings": warnings,
        "pages": {
            "permissions": permissions_page,
            "usage": usage_page,
            "errors": errors_page,
            "warnings": warnings_page,
        }
    }))
}

fn handle_control_grants_list(request: ControlGrantListRequest) -> Result<JsonValue, ApiError> {
    validate_non_empty("userHandle", &request.user_handle)?;
    validate_non_empty("extensionId", &request.extension_id)?;

    let connection = open_connection(&request.db_path)?;
    ensure_control_schema(&connection)?;
    let grants = fetch_control_grants(&connection, &request.user_handle, &request.extension_id)?;
    Ok(json!({ "grants": grants }))
}

fn handle_control_grant_get(request: ControlGrantGetRequest) -> Result<JsonValue, ApiError> {
    validate_non_empty("userHandle", &request.user_handle)?;
    validate_non_empty("extensionId", &request.extension_id)?;
    validate_non_empty("key", &request.key)?;

    let connection = open_connection(&request.db_path)?;
    ensure_control_schema(&connection)?;
    let grant = fetch_control_grant(
        &connection,
        &request.user_handle,
        &request.extension_id,
        &request.key,
    )?;
    Ok(json!({ "grant": grant }))
}

fn handle_control_grant_upsert(request: ControlGrantUpsertRequest) -> Result<JsonValue, ApiError> {
    validate_non_empty("userHandle", &request.user_handle)?;
    validate_non_empty("extensionId", &request.extension_id)?;
    validate_grant_record(&request.grant)?;

    let connection = open_connection(&request.db_path)?;
    ensure_control_schema(&connection)?;
    connection.execute(
        "INSERT INTO authority_grants (
            user_handle, extension_id, key, resource, target, status, scope, risk_level, updated_at, source, choice
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)
        ON CONFLICT(user_handle, extension_id, key) DO UPDATE SET
            resource = excluded.resource,
            target = excluded.target,
            status = excluded.status,
            scope = excluded.scope,
            risk_level = excluded.risk_level,
            updated_at = excluded.updated_at,
            source = excluded.source,
            choice = excluded.choice",
        params![
            &request.user_handle,
            &request.extension_id,
            &request.grant.key,
            &request.grant.resource,
            &request.grant.target,
            &request.grant.status,
            &request.grant.scope,
            &request.grant.risk_level,
            &request.grant.updated_at,
            &request.grant.source,
            &request.grant.choice,
        ],
    ).map_err(to_sql_error)?;
    Ok(json!({ "grant": request.grant }))
}

fn handle_control_grants_reset(request: ControlGrantResetRequest) -> Result<JsonValue, ApiError> {
    validate_non_empty("userHandle", &request.user_handle)?;
    validate_non_empty("extensionId", &request.extension_id)?;

    let connection = open_connection(&request.db_path)?;
    ensure_control_schema(&connection)?;
    match request.keys {
        Some(keys) if !keys.is_empty() => {
            for key in keys {
                validate_non_empty("key", &key)?;
                connection.execute(
                    "DELETE FROM authority_grants WHERE user_handle = ?1 AND extension_id = ?2 AND key = ?3",
                    params![&request.user_handle, &request.extension_id, &key],
                ).map_err(to_sql_error)?;
            }
        }
        _ => {
            connection
                .execute(
                    "DELETE FROM authority_grants WHERE user_handle = ?1 AND extension_id = ?2",
                    params![&request.user_handle, &request.extension_id],
                )
                .map_err(to_sql_error)?;
        }
    }
    Ok(json!({ "ok": true }))
}

fn handle_control_policies_get(request: ControlPoliciesRequest) -> Result<JsonValue, ApiError> {
    validate_non_empty("userHandle", &request.user_handle)?;

    let connection = open_connection(&request.db_path)?;
    ensure_control_schema(&connection)?;
    let document = fetch_control_policies_document(&connection)?;
    Ok(serde_json::to_value(document).expect("control policies document should serialize"))
}

fn handle_control_policies_save(
    request: ControlPoliciesSaveRequest,
) -> Result<JsonValue, ApiError> {
    if !request.actor.is_admin {
        return Err(ApiError {
            status_code: 403,
            message: String::from("Forbidden"),
        });
    }

    let connection = open_connection(&request.db_path)?;
    ensure_control_schema(&connection)?;
    let mut document = fetch_control_policies_document(&connection)?;

    if let Some(defaults) = request.partial.defaults {
        for (resource, status) in defaults {
            validate_policy_default(&resource, &status)?;
            document.defaults.insert(resource, status);
        }
    }

    if let Some(extensions) = request.partial.extensions {
        for (extension_id, entries) in extensions {
            validate_non_empty("extensionId", &extension_id)?;
            let extension_entries = document.extensions.entry(extension_id).or_default();
            for (key, entry) in entries {
                validate_policy_entry(&entry)?;
                extension_entries.insert(key, entry);
            }
        }
    }

    if let Some(limits) = request.partial.limits {
        for (extension_id, policy) in limits.extensions {
            validate_non_empty("extensionId", &extension_id)?;
            validate_extension_limits_policy(&policy)?;
            document.limits.extensions.insert(extension_id, policy);
        }
    }

    document.updated_at = current_timestamp_iso();
    save_control_policies_document(&connection, &document)?;
    Ok(serde_json::to_value(document).expect("control policies document should serialize"))
}

fn handle_control_jobs_list(
    request: ControlJobsListRequest,
    runtime: &Arc<RuntimeState>,
) -> Result<JsonValue, ApiError> {
    validate_non_empty("userHandle", &request.user_handle)?;

    let connection = open_connection(&request.db_path)?;
    ensure_control_schema(&connection)?;
    recover_stale_jobs(&connection, &request.user_handle, runtime)?;
    let (job_offset, job_limit) =
        normalize_offset_page_request(request.page.as_ref(), None, 50, 500)?;
    let (jobs, page) = fetch_control_jobs_page(
        &connection,
        &request.user_handle,
        request.extension_id.as_deref(),
        job_offset,
        job_limit,
    )?;
    Ok(json!({ "jobs": jobs, "page": page }))
}

fn handle_control_job_get(
    request: ControlJobGetRequest,
    runtime: &Arc<RuntimeState>,
) -> Result<JsonValue, ApiError> {
    validate_non_empty("userHandle", &request.user_handle)?;
    validate_non_empty("jobId", &request.job_id)?;

    let connection = open_connection(&request.db_path)?;
    ensure_control_schema(&connection)?;
    recover_stale_jobs(&connection, &request.user_handle, runtime)?;
    let job = fetch_control_job(&connection, &request.user_handle, &request.job_id)?;
    Ok(json!({ "job": job }))
}

fn handle_control_job_upsert(request: ControlJobUpsertRequest) -> Result<JsonValue, ApiError> {
    validate_non_empty("userHandle", &request.user_handle)?;
    validate_job_record(&request.job)?;

    let connection = open_connection(&request.db_path)?;
    ensure_control_schema(&connection)?;
    save_control_job_record(&connection, &request.user_handle, &request.job)?;
    Ok(json!({ "job": request.job }))
}

fn handle_storage_kv_get(request: StorageKvGetRequest) -> Result<JsonValue, ApiError> {
    validate_non_empty("key", &request.key)?;

    let connection = open_connection(&request.db_path)?;
    ensure_kv_schema(&connection)?;
    let value = fetch_kv_value(&connection, &request.key)?;
    Ok(match value {
        Some(value) => json!({ "value": value }),
        None => json!({}),
    })
}

fn handle_storage_kv_set(request: StorageKvSetRequest) -> Result<JsonValue, ApiError> {
    validate_non_empty("key", &request.key)?;
    let serialized = serde_json::to_string(&request.value).map_err(to_json_error)?;
    if serialized.len() > MAX_KV_VALUE_BYTES {
        return Err(ApiError {
            status_code: 400,
            message: format!("KV value exceeds {} bytes", MAX_KV_VALUE_BYTES),
        });
    }

    let connection = open_connection(&request.db_path)?;
    ensure_kv_schema(&connection)?;
    connection
        .execute(
            "INSERT INTO kv_entries (key, value, updated_at)
         VALUES (?1, ?2, ?3)
         ON CONFLICT(key) DO UPDATE SET
            value = excluded.value,
            updated_at = excluded.updated_at",
            params![&request.key, &serialized, current_timestamp_iso()],
        )
        .map_err(to_sql_error)?;
    Ok(json!({ "ok": true }))
}

fn handle_storage_kv_delete(request: StorageKvDeleteRequest) -> Result<JsonValue, ApiError> {
    validate_non_empty("key", &request.key)?;

    let connection = open_connection(&request.db_path)?;
    ensure_kv_schema(&connection)?;
    connection
        .execute(
            "DELETE FROM kv_entries WHERE key = ?1",
            params![&request.key],
        )
        .map_err(to_sql_error)?;
    Ok(json!({ "ok": true }))
}

fn handle_storage_kv_list(request: StorageKvListRequest) -> Result<JsonValue, ApiError> {
    let connection = open_connection(&request.db_path)?;
    ensure_kv_schema(&connection)?;
    let entries = fetch_kv_entries(&connection)?;
    Ok(json!({ "entries": entries }))
}

fn handle_storage_blob_put(request: StorageBlobPutRequest) -> Result<JsonValue, ApiError> {
    validate_non_empty("userHandle", &request.user_handle)?;
    validate_non_empty("extensionId", &request.extension_id)?;
    validate_non_empty("blobDir", &request.blob_dir)?;

    let name = if request.name.trim().is_empty() {
        String::from("blob")
    } else {
        request.name.clone()
    };
    let blob_id = sanitize_file_segment(&name);

    let connection = open_connection(&request.db_path)?;
    ensure_control_schema(&connection)?;
    let binary_path = blob_binary_path(&request.blob_dir, &request.extension_id, &blob_id);
    if let Some(parent) = binary_path.parent() {
        fs::create_dir_all(parent).map_err(to_internal_error)?;
    }
    let size_bytes = if let Some(source_path) = request
        .source_path
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        let source_size = validate_source_file_path(source_path)?;
        if source_size > MAX_BLOB_BYTES as u64 {
            return Err(ApiError {
                status_code: 400,
                message: format!("Blob exceeds {} bytes", MAX_BLOB_BYTES),
            });
        }
        fs::copy(source_path, &binary_path).map_err(to_internal_error)?;
        usize::try_from(source_size).unwrap_or(MAX_BLOB_BYTES)
    } else {
        let payload = decode_blob_content(request.encoding.as_deref(), &request.content)?;
        if payload.len() > MAX_BLOB_BYTES {
            return Err(ApiError {
                status_code: 400,
                message: format!("Blob exceeds {} bytes", MAX_BLOB_BYTES),
            });
        }
        fs::write(&binary_path, &payload).map_err(to_internal_error)?;
        payload.len()
    };

    let record = BlobRecord {
        id: blob_id,
        name,
        content_type: request
            .content_type
            .unwrap_or_else(|| String::from("application/octet-stream")),
        size: size_bytes as i64,
        updated_at: current_timestamp_iso(),
    };
    upsert_blob_record(
        &connection,
        &request.user_handle,
        &request.extension_id,
        &record,
    )?;
    Ok(serde_json::to_value(record).expect("blob record should serialize"))
}

fn handle_storage_blob_get(request: StorageBlobGetRequest) -> Result<JsonValue, ApiError> {
    validate_non_empty("userHandle", &request.user_handle)?;
    validate_non_empty("extensionId", &request.extension_id)?;
    validate_non_empty("blobDir", &request.blob_dir)?;
    validate_non_empty("id", &request.id)?;

    let connection = open_connection(&request.db_path)?;
    ensure_control_schema(&connection)?;
    let record = fetch_blob_record(
        &connection,
        &request.user_handle,
        &request.extension_id,
        &request.id,
    )?
    .ok_or_else(|| ApiError {
        status_code: 400,
        message: String::from("Blob not found"),
    })?;
    let binary_path = blob_binary_path(&request.blob_dir, &request.extension_id, &record.id);
    if !binary_path.exists() {
        return Err(ApiError {
            status_code: 400,
            message: String::from("Blob not found"),
        });
    }

    let content = BASE64_STANDARD.encode(fs::read(binary_path).map_err(to_internal_error)?);
    Ok(serde_json::to_value(BlobGetResponse {
        record,
        content,
        encoding: "base64",
    })
    .expect("blob get response should serialize"))
}

fn handle_storage_blob_open_read(request: StorageBlobGetRequest) -> Result<JsonValue, ApiError> {
    validate_non_empty("userHandle", &request.user_handle)?;
    validate_non_empty("extensionId", &request.extension_id)?;
    validate_non_empty("blobDir", &request.blob_dir)?;
    validate_non_empty("id", &request.id)?;

    let connection = open_connection(&request.db_path)?;
    ensure_control_schema(&connection)?;
    let record = fetch_blob_record(
        &connection,
        &request.user_handle,
        &request.extension_id,
        &request.id,
    )?
    .ok_or_else(|| ApiError {
        status_code: 400,
        message: String::from("Blob not found"),
    })?;
    let binary_path = blob_binary_path(&request.blob_dir, &request.extension_id, &record.id);
    let metadata = fs::symlink_metadata(&binary_path).map_err(|error| {
        if error.kind() == std::io::ErrorKind::NotFound {
            return ApiError {
                status_code: 400,
                message: String::from("Blob not found"),
            };
        }
        to_internal_error(error)
    })?;
    if metadata.file_type().is_symlink() {
        return Err(ApiError {
            status_code: 400,
            message: String::from("blob_path_symlink_not_allowed"),
        });
    }
    if !metadata.is_file() {
        return Err(ApiError {
            status_code: 400,
            message: String::from("blob_path_is_not_file"),
        });
    }

    Ok(serde_json::to_value(BlobOpenReadResponse {
        record,
        source_path: binary_path.to_string_lossy().into_owned(),
    })
    .expect("blob open read response should serialize"))
}

fn handle_storage_blob_delete(request: StorageBlobDeleteRequest) -> Result<JsonValue, ApiError> {
    validate_non_empty("userHandle", &request.user_handle)?;
    validate_non_empty("extensionId", &request.extension_id)?;
    validate_non_empty("blobDir", &request.blob_dir)?;
    validate_non_empty("id", &request.id)?;

    let connection = open_connection(&request.db_path)?;
    ensure_control_schema(&connection)?;
    delete_blob_record(
        &connection,
        &request.user_handle,
        &request.extension_id,
        &request.id,
    )?;
    let binary_path = blob_binary_path(&request.blob_dir, &request.extension_id, &request.id);
    if let Err(error) = fs::remove_file(binary_path) {
        if error.kind() != std::io::ErrorKind::NotFound {
            return Err(to_internal_error(error));
        }
    }

    Ok(json!({ "ok": true }))
}

fn handle_storage_blob_list(request: StorageBlobListRequest) -> Result<JsonValue, ApiError> {
    validate_non_empty("userHandle", &request.user_handle)?;
    validate_non_empty("extensionId", &request.extension_id)?;
    validate_non_empty("blobDir", &request.blob_dir)?;

    let connection = open_connection(&request.db_path)?;
    ensure_control_schema(&connection)?;
    let entries = fetch_blob_records(&connection, &request.user_handle, &request.extension_id)?;
    Ok(json!({ "entries": entries }))
}

fn handle_private_file_mkdir(request: PrivateFileMkdirRequest) -> Result<JsonValue, ApiError> {
    validate_non_empty("rootDir", &request.root_dir)?;
    let root_dir = PathBuf::from(&request.root_dir);
    let (target_path, virtual_path) = resolve_private_path(&root_dir, &request.path)?;
    ensure_private_path_components_safe(&root_dir, &virtual_path)?;

    fs::create_dir_all(&root_dir).map_err(to_internal_error)?;
    if target_path.exists() {
        let metadata = fs::metadata(&target_path).map_err(to_internal_error)?;
        if !metadata.is_dir() {
            return Err(ApiError {
                status_code: 400,
                message: String::from("private_path_is_not_directory"),
            });
        }
        let entry = build_private_file_entry(&root_dir, &target_path, &metadata)?;
        return Ok(serde_json::to_value(PrivateFileResponse { entry })
            .expect("private file response should serialize"));
    }

    if request.recursive.unwrap_or(false) {
        fs::create_dir_all(&target_path).map_err(to_internal_error)?;
    } else {
        let parent = target_path.parent().ok_or_else(|| ApiError {
            status_code: 400,
            message: String::from("private_path_missing_parent"),
        })?;
        if parent != root_dir.as_path() && !parent.exists() {
            return Err(ApiError {
                status_code: 400,
                message: String::from("private_parent_directory_missing"),
            });
        }
        fs::create_dir(&target_path).map_err(to_internal_error)?;
    }

    let metadata = fs::metadata(&target_path).map_err(to_internal_error)?;
    let entry = build_private_file_entry(&root_dir, &target_path, &metadata)?;
    Ok(serde_json::to_value(PrivateFileResponse { entry })
        .expect("private file response should serialize"))
}

fn handle_private_file_read_dir(request: PrivateFileReadDirRequest) -> Result<JsonValue, ApiError> {
    validate_non_empty("rootDir", &request.root_dir)?;
    let root_dir = PathBuf::from(&request.root_dir);
    let (target_path, virtual_path) = resolve_private_path(&root_dir, &request.path)?;
    ensure_private_path_components_safe(&root_dir, &virtual_path)?;

    if !target_path.exists() {
        if virtual_path == "/" {
            return Ok(serde_json::to_value(PrivateFileListResponse {
                entries: Vec::new(),
            })
            .expect("private file list should serialize"));
        }
        return Err(ApiError {
            status_code: 404,
            message: String::from("private_path_not_found"),
        });
    }

    let metadata = fs::metadata(&target_path).map_err(to_internal_error)?;
    if !metadata.is_dir() {
        return Err(ApiError {
            status_code: 400,
            message: String::from("private_path_is_not_directory"),
        });
    }

    let limit = request
        .limit
        .unwrap_or(MAX_PRIVATE_READ_DIR_LIMIT)
        .min(MAX_PRIVATE_READ_DIR_LIMIT);
    let mut entries = fs::read_dir(&target_path)
        .map_err(to_internal_error)?
        .take(limit)
        .map(|entry| {
            let entry = entry.map_err(to_internal_error)?;
            let child_path = entry.path();
            let child_metadata = entry.metadata().map_err(to_internal_error)?;
            build_private_file_entry(&root_dir, &child_path, &child_metadata)
        })
        .collect::<Result<Vec<_>, ApiError>>()?;
    entries.sort_by(|left, right| left.path.cmp(&right.path));
    Ok(serde_json::to_value(PrivateFileListResponse { entries })
        .expect("private file list should serialize"))
}

fn handle_private_file_write(request: PrivateFileWriteRequest) -> Result<JsonValue, ApiError> {
    validate_non_empty("rootDir", &request.root_dir)?;
    let root_dir = PathBuf::from(&request.root_dir);
    let (target_path, virtual_path) = resolve_private_path(&root_dir, &request.path)?;
    ensure_private_path_components_safe(&root_dir, &virtual_path)?;
    if virtual_path == "/" {
        return Err(ApiError {
            status_code: 400,
            message: String::from("private_path_must_target_file"),
        });
    }

    fs::create_dir_all(&root_dir).map_err(to_internal_error)?;
    let parent = target_path.parent().ok_or_else(|| ApiError {
        status_code: 400,
        message: String::from("private_path_missing_parent"),
    })?;
    if request.create_parents.unwrap_or(false) {
        fs::create_dir_all(parent).map_err(to_internal_error)?;
    } else if parent != root_dir.as_path() && !parent.exists() {
        return Err(ApiError {
            status_code: 400,
            message: String::from("private_parent_directory_missing"),
        });
    }

    if target_path.exists() {
        let metadata = fs::metadata(&target_path).map_err(to_internal_error)?;
        if metadata.is_dir() {
            return Err(ApiError {
                status_code: 400,
                message: String::from("private_path_is_directory"),
            });
        }
    }

    if let Some(source_path) = request
        .source_path
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        let source_size = validate_source_file_path(source_path)?;
        if source_size > MAX_BLOB_BYTES as u64 {
            return Err(ApiError {
                status_code: 400,
                message: format!("Private file exceeds {} bytes", MAX_BLOB_BYTES),
            });
        }
        fs::copy(source_path, &target_path).map_err(to_internal_error)?;
    } else {
        let payload = decode_blob_content(request.encoding.as_deref(), &request.content)?;
        if payload.len() > MAX_BLOB_BYTES {
            return Err(ApiError {
                status_code: 400,
                message: format!("Private file exceeds {} bytes", MAX_BLOB_BYTES),
            });
        }
        fs::write(&target_path, &payload).map_err(to_internal_error)?;
    }
    let metadata = fs::metadata(&target_path).map_err(to_internal_error)?;
    let entry = build_private_file_entry(&root_dir, &target_path, &metadata)?;
    Ok(serde_json::to_value(PrivateFileResponse { entry })
        .expect("private file response should serialize"))
}

fn handle_private_file_read(request: PrivateFileReadRequest) -> Result<JsonValue, ApiError> {
    validate_non_empty("rootDir", &request.root_dir)?;
    let root_dir = PathBuf::from(&request.root_dir);
    let (target_path, virtual_path) = resolve_private_path(&root_dir, &request.path)?;
    ensure_private_path_components_safe(&root_dir, &virtual_path)?;
    if !target_path.exists() {
        return Err(ApiError {
            status_code: 404,
            message: String::from("private_path_not_found"),
        });
    }

    let metadata = fs::metadata(&target_path).map_err(to_internal_error)?;
    if !metadata.is_file() {
        return Err(ApiError {
            status_code: 400,
            message: String::from("private_path_is_not_file"),
        });
    }
    if metadata.len() > MAX_BLOB_BYTES as u64 {
        return Err(ApiError {
            status_code: 400,
            message: format!("Private file exceeds {} bytes", MAX_BLOB_BYTES),
        });
    }

    let bytes = fs::read(&target_path).map_err(to_internal_error)?;
    let encoding = request.encoding.as_deref().unwrap_or("utf8");
    let content = encode_private_file_content(encoding, &bytes)?;
    let entry = build_private_file_entry(&root_dir, &target_path, &metadata)?;
    Ok(serde_json::to_value(PrivateFileReadResponse {
        entry,
        content,
        encoding: encoding.to_string(),
    })
    .expect("private file read response should serialize"))
}

fn handle_private_file_open_read(request: PrivateFileReadRequest) -> Result<JsonValue, ApiError> {
    validate_non_empty("rootDir", &request.root_dir)?;
    let root_dir = PathBuf::from(&request.root_dir);
    let (target_path, virtual_path) = resolve_private_path(&root_dir, &request.path)?;
    ensure_private_path_components_safe(&root_dir, &virtual_path)?;
    if !target_path.exists() {
        return Err(ApiError {
            status_code: 404,
            message: String::from("private_path_not_found"),
        });
    }

    let metadata = fs::metadata(&target_path).map_err(to_internal_error)?;
    if !metadata.is_file() {
        return Err(ApiError {
            status_code: 400,
            message: String::from("private_path_is_not_file"),
        });
    }
    let entry = build_private_file_entry(&root_dir, &target_path, &metadata)?;
    Ok(serde_json::to_value(PrivateFileOpenReadResponse {
        entry,
        source_path: target_path.to_string_lossy().into_owned(),
    })
    .expect("private file open read response should serialize"))
}

fn handle_private_file_delete(request: PrivateFileDeleteRequest) -> Result<JsonValue, ApiError> {
    validate_non_empty("rootDir", &request.root_dir)?;
    let root_dir = PathBuf::from(&request.root_dir);
    let (target_path, virtual_path) = resolve_private_path(&root_dir, &request.path)?;
    ensure_private_path_components_safe(&root_dir, &virtual_path)?;
    if virtual_path == "/" {
        return Err(ApiError {
            status_code: 400,
            message: String::from("private_root_delete_forbidden"),
        });
    }
    if !target_path.exists() {
        return Err(ApiError {
            status_code: 404,
            message: String::from("private_path_not_found"),
        });
    }

    let metadata = fs::metadata(&target_path).map_err(to_internal_error)?;
    if metadata.is_dir() {
        if request.recursive.unwrap_or(false) {
            fs::remove_dir_all(&target_path).map_err(to_internal_error)?;
        } else if let Err(error) = fs::remove_dir(&target_path) {
            if error.kind() == std::io::ErrorKind::DirectoryNotEmpty {
                return Err(ApiError {
                    status_code: 400,
                    message: String::from("private_directory_not_empty"),
                });
            }
            return Err(to_internal_error(error));
        }
    } else {
        fs::remove_file(&target_path).map_err(to_internal_error)?;
    }

    Ok(json!({ "ok": true }))
}

fn handle_private_file_stat(request: PrivateFileStatRequest) -> Result<JsonValue, ApiError> {
    validate_non_empty("rootDir", &request.root_dir)?;
    let root_dir = PathBuf::from(&request.root_dir);
    let (target_path, virtual_path) = resolve_private_path(&root_dir, &request.path)?;
    ensure_private_path_components_safe(&root_dir, &virtual_path)?;
    if !target_path.exists() {
        return Err(ApiError {
            status_code: 404,
            message: String::from("private_path_not_found"),
        });
    }

    let metadata = fs::metadata(&target_path).map_err(to_internal_error)?;
    let entry = build_private_file_entry(&root_dir, &target_path, &metadata)?;
    Ok(serde_json::to_value(PrivateFileResponse { entry })
        .expect("private file response should serialize"))
}

fn handle_http_fetch(request: CoreHttpFetchRequest) -> Result<JsonValue, ApiError> {
    validate_non_empty("url", &request.url)?;
    let request_body = request
        .body
        .as_ref()
        .map(|body| decode_http_fetch_body(request.body_encoding.as_deref(), body))
        .transpose()?;
    let body_size = request_body.as_ref().map(|value| value.len()).unwrap_or(0);
    if body_size > MAX_HTTP_INLINE_BODY_BYTES {
        return Err(ApiError {
            status_code: 400,
            message: format!(
                "HTTP request body exceeds {} bytes",
                MAX_HTTP_INLINE_BODY_BYTES
            ),
        });
    }

    let (response, hostname) = execute_http_fetch(
        &request.url,
        request.method.as_deref(),
        request.headers.as_ref(),
        request_body.as_deref(),
    )?;
    let fetched = read_http_fetch_response(response, MAX_HTTP_INLINE_RESPONSE_BYTES)?;
    let body = if fetched.body_encoding == "utf8" {
        String::from_utf8_lossy(&fetched.body_bytes).into_owned()
    } else {
        BASE64_STANDARD.encode(&fetched.body_bytes)
    };

    Ok(serde_json::to_value(HttpFetchResponse {
        url: request.url,
        hostname,
        status: fetched.status,
        ok: fetched.ok,
        headers: fetched.headers,
        body,
        body_encoding: fetched.body_encoding,
        content_type: fetched.content_type,
    })
    .expect("http fetch response should serialize"))
}

fn handle_http_fetch_open(request: CoreHttpFetchOpenRequest) -> Result<JsonValue, ApiError> {
    validate_non_empty("url", &request.url)?;
    validate_non_empty("responsePath", &request.response_path)?;
    if request.body.is_some() && request.body_source_path.is_some() {
        return Err(ApiError {
            status_code: 400,
            message: String::from("HTTP fetch body and bodySourcePath cannot both be provided"),
        });
    }

    let request_body = if let Some(source_path) = request
        .body_source_path
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        let source_size = validate_source_file_path(source_path)?;
        if source_size > MAX_HTTP_BODY_BYTES as u64 {
            return Err(ApiError {
                status_code: 400,
                message: format!("HTTP request body exceeds {} bytes", MAX_HTTP_BODY_BYTES),
            });
        }
        Some(fs::read(source_path).map_err(to_internal_error)?)
    } else {
        let body = request
            .body
            .as_ref()
            .map(|content| decode_http_fetch_body(request.body_encoding.as_deref(), content))
            .transpose()?;
        if body.as_ref().map(|value| value.len()).unwrap_or(0) > MAX_HTTP_BODY_BYTES {
            return Err(ApiError {
                status_code: 400,
                message: format!("HTTP request body exceeds {} bytes", MAX_HTTP_BODY_BYTES),
            });
        }
        body
    };

    validate_source_file_path(&request.response_path)?;
    let (response, hostname) = execute_http_fetch(
        &request.url,
        request.method.as_deref(),
        request.headers.as_ref(),
        request_body.as_deref(),
    )?;
    let fetched = read_http_fetch_response(response, MAX_HTTP_RESPONSE_BYTES)?;
    fs::write(&request.response_path, &fetched.body_bytes).map_err(to_internal_error)?;

    Ok(serde_json::to_value(HttpFetchOpenResponse {
        url: request.url,
        hostname,
        status: fetched.status,
        ok: fetched.ok,
        headers: fetched.headers,
        body_encoding: fetched.body_encoding,
        content_type: fetched.content_type,
        size_bytes: fetched.body_bytes.len(),
    })
    .expect("http fetch open response should serialize"))
}

fn handle_control_job_create(
    request: ControlJobCreateRequest,
    runtime: &Arc<RuntimeState>,
) -> Result<JsonValue, ApiError> {
    validate_non_empty("userHandle", &request.user_handle)?;
    validate_non_empty("extensionId", &request.extension_id)?;
    validate_non_empty("type", &request.job_type)?;
    validate_supported_job_type("type", &request.job_type)?;
    validate_job_runtime_options(request.timeout_ms, request.max_attempts)?;
    if let Some(payload) = &request.payload {
        if !payload.is_object() {
            return Err(ApiError {
                status_code: 400,
                message: String::from("job payload must be an object"),
            });
        }
    }
    if let Some(key) = &request.idempotency_key {
        if key.is_empty() {
            return Err(ApiError {
                status_code: 400,
                message: String::from("idempotencyKey must not be empty if provided"),
            });
        }
    }

    let connection = open_connection(&request.db_path)?;
    ensure_control_schema(&connection)?;
    recover_stale_jobs(&connection, &request.user_handle, runtime)?;

    if let Some(key) = &request.idempotency_key {
        let mut statement = connection.prepare(
            "SELECT id, extension_id, type, status, created_at, updated_at, progress, summary, error, payload, result, channel, started_at, finished_at, timeout_ms, idempotency_key, attempt, max_attempts, cancel_requested_at
             FROM authority_jobs
             WHERE user_handle = ?1 AND idempotency_key = ?2
             LIMIT 1",
        ).map_err(to_sql_error)?;
        let existing = statement
            .query_row(params![&request.user_handle, key], control_job_from_row)
            .optional()
            .map_err(to_sql_error)?;
        if let Some(job) = existing {
            let job = attach_job_attempt_history(&connection, &request.user_handle, job)?;
            return Ok(json!({ "job": job }));
        }
    }

    let timestamp = current_timestamp_iso();
    let job = ControlJobRecord {
        id: generate_job_id(),
        extension_id: request.extension_id.clone(),
        job_type: request.job_type.clone(),
        status: String::from("queued"),
        created_at: timestamp.clone(),
        updated_at: timestamp,
        progress: 0,
        summary: None,
        error: None,
        payload: request.payload.clone(),
        result: None,
        channel: format!("extension:{}", request.extension_id),
        started_at: None,
        finished_at: None,
        timeout_ms: request.timeout_ms,
        idempotency_key: request.idempotency_key.clone(),
        attempt: 0,
        max_attempts: request.max_attempts,
        cancel_requested_at: None,
        attempt_history: None,
    };

    save_control_job_record(&connection, &request.user_handle, &job)?;
    publish_control_event(
        &connection,
        &request.user_handle,
        Some(&request.extension_id),
        &job.channel,
        "authority.job",
        Some(&serde_json::to_value(&job).map_err(to_json_error)?),
    )?;

    if let Err(error) = enqueue_job_dispatch(
        runtime,
        JobDispatch {
            db_path: request.db_path.clone(),
            user_handle: request.user_handle.clone(),
            job: job.clone(),
        },
    ) {
        let rejected_finished_at = current_timestamp_iso();
        let mut rejected = ControlJobRecord {
            status: String::from("failed"),
            updated_at: rejected_finished_at.clone(),
            finished_at: Some(rejected_finished_at),
            summary: Some(String::from("Job rejected by worker queue")),
            error: Some(error.message.clone()),
            ..job.clone()
        };
        let rejected_attempt_record = JobAttemptRecord {
            attempt: rejected.attempt,
            event: JobAttemptEvent::Failed,
            timestamp: rejected.updated_at.clone(),
            summary: rejected.summary.clone(),
            error: rejected.error.clone(),
            backoff_ms: None,
        };
        append_attempt_history(&mut rejected, rejected_attempt_record);
        save_control_job_record(&connection, &request.user_handle, &rejected)?;
        publish_control_event(
            &connection,
            &request.user_handle,
            Some(&request.extension_id),
            &rejected.channel,
            "authority.job",
            Some(&serde_json::to_value(&rejected).map_err(to_json_error)?),
        )?;
        append_control_audit_record(
            &connection,
            &request.user_handle,
            &request.extension_id,
            "warning",
            "Job queue full",
            Some(json!({
                "jobId": rejected.id,
                "jobType": rejected.job_type,
                "message": error.message,
            })),
        )?;
        return Err(error);
    }

    Ok(json!({ "job": job }))
}

fn handle_control_job_cancel(
    request: ControlJobCancelRequest,
    runtime: &Arc<RuntimeState>,
) -> Result<JsonValue, ApiError> {
    validate_non_empty("userHandle", &request.user_handle)?;
    validate_non_empty("extensionId", &request.extension_id)?;
    validate_non_empty("jobId", &request.job_id)?;

    let connection = open_connection(&request.db_path)?;
    ensure_control_schema(&connection)?;
    recover_stale_jobs(&connection, &request.user_handle, runtime)?;
    let job = fetch_control_job(&connection, &request.user_handle, &request.job_id)?.ok_or_else(
        || ApiError {
            status_code: 400,
            message: String::from("Job not found"),
        },
    )?;
    if job.extension_id != request.extension_id {
        return Err(ApiError {
            status_code: 400,
            message: String::from("Job not found"),
        });
    }

    if let Some(control) = runtime
        .job_controls
        .lock()
        .map_err(|_| ApiError {
            status_code: 500,
            message: String::from("internal_error: job control lock poisoned"),
        })?
        .get(&job_control_key(&request.user_handle, &request.job_id))
        .cloned()
    {
        control.store(true, Ordering::SeqCst);
    }

    let cancelled_at = current_timestamp_iso();
    let mut next = ControlJobRecord {
        status: String::from("cancelled"),
        updated_at: cancelled_at.clone(),
        cancel_requested_at: Some(cancelled_at),
        summary: Some(String::from("Cancelled by user")),
        ..job
    };
    let cancelled_attempt_record = JobAttemptRecord {
        attempt: next.attempt,
        event: JobAttemptEvent::Cancelled,
        timestamp: next.updated_at.clone(),
        summary: next.summary.clone(),
        error: next.error.clone(),
        backoff_ms: None,
    };
    append_attempt_history(&mut next, cancelled_attempt_record);
    save_control_job_record(&connection, &request.user_handle, &next)?;
    publish_control_event(
        &connection,
        &request.user_handle,
        Some(&request.extension_id),
        &next.channel,
        "authority.job",
        Some(&serde_json::to_value(&next).map_err(to_json_error)?),
    )?;
    Ok(json!({ "job": next }))
}

fn handle_control_job_requeue(
    request: ControlJobRequeueRequest,
    runtime: &Arc<RuntimeState>,
) -> Result<JsonValue, ApiError> {
    validate_non_empty("userHandle", &request.user_handle)?;
    validate_non_empty("extensionId", &request.extension_id)?;
    validate_non_empty("jobId", &request.job_id)?;

    let connection = open_connection(&request.db_path)?;
    ensure_control_schema(&connection)?;
    recover_stale_jobs(&connection, &request.user_handle, runtime)?;
    let job = fetch_control_job(&connection, &request.user_handle, &request.job_id)?.ok_or_else(
        || ApiError {
            status_code: 400,
            message: String::from("Job not found"),
        },
    )?;
    if job.extension_id != request.extension_id {
        return Err(ApiError {
            status_code: 400,
            message: String::from("Job not found"),
        });
    }
    ensure_job_safe_to_requeue(&job)?;

    handle_control_job_create(
        ControlJobCreateRequest {
            db_path: request.db_path,
            user_handle: request.user_handle,
            extension_id: job.extension_id,
            job_type: job.job_type,
            payload: job.payload,
            timeout_ms: job.timeout_ms,
            idempotency_key: None,
            max_attempts: job.max_attempts,
        },
        runtime,
    )
}

fn handle_control_events_poll(request: ControlEventsPollRequest) -> Result<JsonValue, ApiError> {
    validate_non_empty("userHandle", &request.user_handle)?;
    validate_non_empty("channel", &request.channel)?;

    let connection = open_connection(&request.db_path)?;
    ensure_control_schema(&connection)?;
    let limit = request
        .page
        .as_ref()
        .and_then(|page| page.limit)
        .or(request.limit)
        .unwrap_or(50)
        .clamp(1, MAX_EVENT_POLL_LIMIT);
    let after_id = match request.after_id {
        Some(value) => Some(value),
        None => parse_event_cursor(
            request
                .page
                .as_ref()
                .and_then(|page| page.cursor.as_deref()),
        )?,
    };
    if let Some(after_id) = after_id {
        let total_count =
            count_control_events(&connection, &request.user_handle, &request.channel)?;
        let (events, has_more) = fetch_control_events_page(
            &connection,
            &request.user_handle,
            &request.channel,
            after_id,
            limit,
        )?;
        let cursor = events.last().map(|event| event.id).unwrap_or(after_id);
        let page = CursorPageInfo {
            next_cursor: if has_more {
                Some(cursor.to_string())
            } else {
                None
            },
            limit,
            has_more,
            total_count,
        };
        Ok(json!({ "events": events, "cursor": cursor, "page": page }))
    } else {
        let cursor =
            fetch_latest_control_event_id(&connection, &request.user_handle, &request.channel)?;
        let page = CursorPageInfo {
            next_cursor: None,
            limit,
            has_more: false,
            total_count: count_control_events(&connection, &request.user_handle, &request.channel)?,
        };
        Ok(json!({ "events": [], "cursor": cursor, "page": page }))
    }
}

fn normalize_offset_page_request(
    page: Option<&CursorPageRequest>,
    legacy_limit: Option<usize>,
    default_limit: usize,
    max_limit: usize,
) -> Result<(usize, usize), ApiError> {
    let limit = page
        .and_then(|value| value.limit)
        .or(legacy_limit)
        .unwrap_or(default_limit)
        .clamp(1, max_limit);
    let offset = parse_offset_cursor(page.and_then(|value| value.cursor.as_deref()))?;
    Ok((offset, limit))
}

fn parse_offset_cursor(cursor: Option<&str>) -> Result<usize, ApiError> {
    match cursor {
        Some(value) if !value.is_empty() => value.parse::<usize>().map_err(|_| ApiError {
            status_code: 400,
            message: String::from("invalid_page_cursor"),
        }),
        _ => Ok(0),
    }
}

fn parse_event_cursor(cursor: Option<&str>) -> Result<Option<i64>, ApiError> {
    match cursor {
        Some(value) if !value.is_empty() => value.parse::<i64>().map(Some).map_err(|_| ApiError {
            status_code: 400,
            message: String::from("invalid_event_cursor"),
        }),
        _ => Ok(None),
    }
}

fn build_offset_page_info(offset: usize, limit: usize, total_count: usize) -> CursorPageInfo {
    let next_offset = offset.saturating_add(limit);
    CursorPageInfo {
        next_cursor: if next_offset < total_count {
            Some(next_offset.to_string())
        } else {
            None
        },
        limit,
        has_more: next_offset < total_count,
        total_count,
    }
}

fn slice_vec_page<T>(
    items: Vec<T>,
    page: Option<&CursorPageRequest>,
    default_limit: usize,
    max_limit: usize,
) -> Result<(Vec<T>, Option<CursorPageInfo>), ApiError> {
    match page {
        Some(page_request) => {
            let total_count = items.len();
            let (offset, limit) =
                normalize_offset_page_request(Some(page_request), None, default_limit, max_limit)?;
            let paged = items.into_iter().skip(offset).take(limit).collect();
            Ok((
                paged,
                Some(build_offset_page_info(offset, limit, total_count)),
            ))
        }
        None => Ok((items, None)),
    }
}

fn execute_transactional_statements(
    db_path: &str,
    statements: &[SqlBatchStatement],
) -> Result<Vec<JsonValue>, ApiError> {
    if statements.is_empty() {
        return Err(ApiError {
            status_code: 400,
            message: String::from("sql batch requires at least one statement"),
        });
    }

    let mut connection = open_connection(db_path)?;
    let transaction = connection.transaction().map_err(to_sql_error)?;
    let mut results = Vec::with_capacity(statements.len());

    for (index, statement) in statements.iter().enumerate() {
        let result = match statement.mode {
            SqlStatementMode::Query => {
                let value = run_query(&transaction, &statement.statement, &statement.params)
                    .map_err(|error| with_sql_statement_error(index, &statement.statement, error))?;
                serde_json::to_value(value).expect("sql batch query result should serialize")
            }
            SqlStatementMode::Exec => {
                let value = run_exec(&transaction, &statement.statement, &statement.params)
                    .map_err(|error| with_sql_statement_error(index, &statement.statement, error))?;
                serde_json::to_value(value).expect("sql batch exec result should serialize")
            }
        };
        results.push(result);
    }

    transaction.commit().map_err(to_sql_error)?;
    Ok(results)
}

fn run_query(
    connection: &Connection,
    statement_text: &str,
    params: &[JsonValue],
) -> Result<SqlQueryResult, ApiError> {
    if statement_text.trim().is_empty() {
        return Err(ApiError {
            status_code: 400,
            message: String::from("sql query statement must not be empty"),
        });
    }

    let sql_params = build_sqlite_params(params)?;
    let mut statement = connection.prepare(statement_text).map_err(to_sql_error)?;
    let columns = statement
        .column_names()
        .iter()
        .map(|name| (*name).to_string())
        .collect::<Vec<_>>();
    let mut rows = statement
        .query(params_from_iter(sql_params.iter()))
        .map_err(to_sql_error)?;
    let mut result_rows = Vec::new();

    while let Some(row) = rows.next().map_err(to_sql_error)? {
        let mut record = JsonMap::new();
        for (index, column) in columns.iter().enumerate() {
            let value = row.get_ref(index).map_err(to_sql_error)?;
            record.insert(column.clone(), sqlite_value_to_json(value));
        }
        result_rows.push(record);
    }

    Ok(SqlQueryResult {
        kind: "query",
        columns,
        row_count: result_rows.len(),
        rows: result_rows,
        page: None,
    })
}

fn run_exec(
    connection: &Connection,
    statement_text: &str,
    params: &[JsonValue],
) -> Result<SqlExecResult, ApiError> {
    if statement_text.trim().is_empty() {
        return Err(ApiError {
            status_code: 400,
            message: String::from("sql exec statement must not be empty"),
        });
    }

    let sql_params = build_sqlite_params(params)?;
    let rows_affected = connection
        .execute(statement_text, params_from_iter(sql_params.iter()))
        .map_err(to_sql_error)?;
    let last_insert_rowid = connection.last_insert_rowid();

    Ok(SqlExecResult {
        kind: "exec",
        rows_affected,
        last_insert_rowid: (last_insert_rowid > 0).then_some(last_insert_rowid),
    })
}

fn validate_paged_sql_query(
    statement_text: &str,
    page: Option<&CursorPageRequest>,
) -> Result<(), ApiError> {
    if page.is_none() || !SQL_PAGED_QUERY_REQUIRES_ORDER_BY {
        return Ok(());
    }
    if sql_statement_has_order_by(statement_text) {
        return Ok(());
    }
    Err(ApiError {
        status_code: 400,
        message: format!(
            "sql_error: paged query requires ORDER BY for deterministic pagination [statement: {}]",
            preview_sql_statement(statement_text),
        ),
    })
}

fn sql_statement_has_order_by(statement_text: &str) -> bool {
    statement_text
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .to_ascii_lowercase()
        .contains("order by")
}

fn preview_sql_batch_statements(statements: &[SqlBatchStatement]) -> String {
    match statements.first() {
        Some(statement) if statements.len() == 1 => preview_sql_statement(&statement.statement),
        Some(statement) => format!(
            "{} [+{} more statements]",
            preview_sql_statement(&statement.statement),
            statements.len().saturating_sub(1),
        ),
        None => String::from("<empty sql batch>"),
    }
}

fn open_connection(db_path: &str) -> Result<Connection, ApiError> {
    if db_path.trim().is_empty() {
        return Err(ApiError {
            status_code: 400,
            message: String::from("dbPath must not be empty"),
        });
    }

    let path = Path::new(db_path);
    let parent = path.parent().ok_or_else(|| ApiError {
        status_code: 400,
        message: String::from("dbPath must include a parent directory"),
    })?;
    fs::create_dir_all(parent).map_err(to_internal_error)?;

    let connection = Connection::open(path).map_err(to_sql_error)?;
    connection
        .busy_timeout(Duration::from_millis(SQL_BUSY_TIMEOUT_MS))
        .map_err(to_sql_error)?;
    connection
        .execute_batch("PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA foreign_keys = ON;")
        .map_err(to_sql_error)?;
    Ok(connection)
}

fn default_sql_runtime_config() -> SqlRuntimeConfigDiagnostics {
    SqlRuntimeConfigDiagnostics {
        journal_mode: String::from("wal"),
        synchronous: String::from("normal"),
        foreign_keys: true,
        busy_timeout_ms: SQL_BUSY_TIMEOUT_MS,
        paged_query_requires_order_by: SQL_PAGED_QUERY_REQUIRES_ORDER_BY,
    }
}

fn default_sql_slow_query_diagnostics() -> SqlSlowQueryDiagnostics {
    SqlSlowQueryDiagnostics {
        count: 0,
        last_occurred_at: None,
        last_elapsed_ms: None,
        last_statement_preview: None,
    }
}

fn read_sql_runtime_config(connection: &Connection) -> Result<SqlRuntimeConfigDiagnostics, ApiError> {
    let journal_mode: String = connection
        .query_row("PRAGMA journal_mode", [], |row| row.get(0))
        .map_err(to_sql_error)?;
    let synchronous: i64 = connection
        .query_row("PRAGMA synchronous", [], |row| row.get(0))
        .map_err(to_sql_error)?;
    let foreign_keys: i64 = connection
        .query_row("PRAGMA foreign_keys", [], |row| row.get(0))
        .map_err(to_sql_error)?;
    let busy_timeout_ms: i64 = connection
        .query_row("PRAGMA busy_timeout", [], |row| row.get(0))
        .map_err(to_sql_error)?;

    Ok(SqlRuntimeConfigDiagnostics {
        journal_mode: journal_mode.to_ascii_lowercase(),
        synchronous: sql_synchronous_mode_to_string(synchronous),
        foreign_keys: foreign_keys != 0,
        busy_timeout_ms: u64::try_from(busy_timeout_ms.max(0)).unwrap_or(SQL_BUSY_TIMEOUT_MS),
        paged_query_requires_order_by: SQL_PAGED_QUERY_REQUIRES_ORDER_BY,
    })
}

fn sql_synchronous_mode_to_string(value: i64) -> String {
    match value {
        0 => String::from("off"),
        1 => String::from("normal"),
        2 => String::from("full"),
        3 => String::from("extra"),
        other => other.to_string(),
    }
}

fn sql_meta_table_exists(connection: &Connection) -> Result<bool, ApiError> {
    Ok(connection
        .query_row(
            "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?1 LIMIT 1",
            params![SQL_META_TABLE],
            |_| Ok(true),
        )
        .optional()
        .map_err(to_sql_error)?
        .unwrap_or(false))
}

fn ensure_sql_meta_table(connection: &Connection) -> Result<(), ApiError> {
    connection
        .execute_batch(
            "CREATE TABLE IF NOT EXISTS _authority_sql_meta (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )",
        )
        .map_err(to_sql_error)?;
    Ok(())
}

fn read_sql_meta_value(connection: &Connection, key: &str) -> Result<Option<String>, ApiError> {
    if !sql_meta_table_exists(connection)? {
        return Ok(None);
    }

    connection
        .query_row(
            "SELECT value FROM _authority_sql_meta WHERE key = ?1 LIMIT 1",
            params![key],
            |row| row.get(0),
        )
        .optional()
        .map_err(to_sql_error)
}

fn write_sql_meta_value(connection: &Connection, key: &str, value: &str) -> Result<(), ApiError> {
    ensure_sql_meta_table(connection)?;
    connection
        .execute(
            "INSERT INTO _authority_sql_meta (key, value, updated_at) VALUES (?1, ?2, ?3)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
            params![key, value, current_timestamp_iso()],
        )
        .map_err(to_sql_error)?;
    Ok(())
}

fn read_sql_slow_query_diagnostics(connection: &Connection) -> Result<SqlSlowQueryDiagnostics, ApiError> {
    Ok(SqlSlowQueryDiagnostics {
        count: read_sql_meta_value(connection, SQL_SLOW_QUERY_COUNT_META_KEY)?
            .and_then(|value| value.parse::<u64>().ok())
            .unwrap_or(0),
        last_occurred_at: read_sql_meta_value(connection, SQL_LAST_SLOW_QUERY_AT_META_KEY)?,
        last_elapsed_ms: read_sql_meta_value(connection, SQL_LAST_SLOW_QUERY_ELAPSED_MS_META_KEY)?
            .and_then(|value| value.parse::<u64>().ok()),
        last_statement_preview: read_sql_meta_value(connection, SQL_LAST_SLOW_QUERY_STATEMENT_PREVIEW_META_KEY)?,
    })
}

fn record_slow_sql_if_needed(
    connection: &Connection,
    elapsed: Duration,
    statement_text: &str,
) -> Result<(), ApiError> {
    if elapsed.as_millis() < SLOW_SQL_LOG_MS {
        return Ok(());
    }

    let preview = preview_sql_statement(statement_text);
    let diagnostics = read_sql_slow_query_diagnostics(connection)?;
    write_sql_meta_value(connection, SQL_LAST_SLOW_QUERY_AT_META_KEY, &current_timestamp_iso())?;
    write_sql_meta_value(
        connection,
        SQL_LAST_SLOW_QUERY_ELAPSED_MS_META_KEY,
        &u64::try_from(elapsed.as_millis()).unwrap_or(u64::MAX).to_string(),
    )?;
    write_sql_meta_value(
        connection,
        SQL_LAST_SLOW_QUERY_STATEMENT_PREVIEW_META_KEY,
        &preview,
    )?;
    write_sql_meta_value(
        connection,
        SQL_SLOW_QUERY_COUNT_META_KEY,
        &diagnostics.count.saturating_add(1).to_string(),
    )?;
    Ok(())
}

fn with_sql_statement_error(index: usize, statement: &str, error: ApiError) -> ApiError {
    let detail = error
        .message
        .strip_prefix("sql_error: ")
        .unwrap_or(&error.message)
        .to_string();
    ApiError {
        status_code: error.status_code,
        message: format!(
            "sql_error: statementIndex {index} failed: {detail} [statement: {}]",
            preview_sql_statement(statement),
        ),
    }
}

fn parse_trivium_dtype(value: Option<&str>) -> Result<TriviumDTypeTag, ApiError> {
    match value.unwrap_or("f32") {
        "f32" => Ok(TriviumDTypeTag::F32),
        "f16" => Ok(TriviumDTypeTag::F16),
        "u64" => Ok(TriviumDTypeTag::U64),
        other => Err(ApiError {
            status_code: 400,
            message: format!("trivium dtype must be one of f32/f16/u64, got {other}"),
        }),
    }
}

fn parse_trivium_sync_mode(value: Option<&str>) -> Result<TriviumSyncMode, ApiError> {
    match value.unwrap_or("normal") {
        "full" => Ok(TriviumSyncMode::Full),
        "normal" => Ok(TriviumSyncMode::Normal),
        "off" => Ok(TriviumSyncMode::Off),
        other => Err(ApiError {
            status_code: 400,
            message: format!("trivium syncMode must be one of full/normal/off, got {other}"),
        }),
    }
}

fn parse_trivium_storage_mode(value: Option<&str>) -> Result<TriviumStorageMode, ApiError> {
    match value.unwrap_or("mmap") {
        "mmap" => Ok(TriviumStorageMode::Mmap),
        "rom" => Ok(TriviumStorageMode::Rom),
        other => Err(ApiError {
            status_code: 400,
            message: format!("trivium storageMode must be one of mmap/rom, got {other}"),
        }),
    }
}

fn build_trivium_config(request: &TriviumOpenRequest) -> Result<TriviumConfig, ApiError> {
    validate_non_empty("dbPath", &request.db_path)?;
    let db_path = Path::new(&request.db_path);
    let stored_dim = if db_path.exists() {
        read_trivium_dimension_from_file(db_path)
    } else {
        None
    };
    if matches!(request.dim, Some(0)) {
        return Err(ApiError {
            status_code: 400,
            message: String::from("trivium dim must be positive"),
        });
    }
    if let (Some(request_dim), Some(stored_dim)) = (request.dim, stored_dim) {
        if request_dim != stored_dim {
            return Err(ApiError {
                status_code: 400,
                message: format!(
                    "trivium database is {stored_dim}-dimensional; request dim is {request_dim}"
                ),
            });
        }
    }
    Ok(TriviumConfig {
        dim: request.dim.or(stored_dim).unwrap_or(1536),
        sync_mode: parse_trivium_sync_mode(request.sync_mode.as_deref())?,
        storage_mode: parse_trivium_storage_mode(request.storage_mode.as_deref())?,
    })
}

fn validate_trivium_dim(dim: Option<usize>) -> Result<(), ApiError> {
    if matches!(dim, Some(0)) {
        return Err(ApiError {
            status_code: 400,
            message: String::from("trivium dim must be positive"),
        });
    }
    Ok(())
}

fn infer_trivium_open_dimension(request: &mut TriviumOpenRequest, vector_dim: Option<usize>) {
    if request.dim.is_some() {
        return;
    }
    request.dim = read_trivium_dimension_from_file(Path::new(&request.db_path)).or(vector_dim);
}

fn open_trivium_f32(request: &TriviumOpenRequest) -> Result<TriviumDatabase<f32>, ApiError> {
    TriviumDatabase::<f32>::open_with_config(&request.db_path, build_trivium_config(request)?)
        .map_err(to_trivium_error)
}

fn open_trivium_f16(request: &TriviumOpenRequest) -> Result<TriviumDatabase<f16>, ApiError> {
    TriviumDatabase::<f16>::open_with_config(&request.db_path, build_trivium_config(request)?)
        .map_err(to_trivium_error)
}

fn open_trivium_u64(request: &TriviumOpenRequest) -> Result<TriviumDatabase<u64>, ApiError> {
    TriviumDatabase::<u64>::open_with_config(&request.db_path, build_trivium_config(request)?)
        .map_err(to_trivium_error)
}

fn map_trivium_node<T, F>(node: TriviumRawNodeView<T>, map_value: F) -> TriviumNodeView
where
    T: Copy,
    F: Fn(T) -> f64,
{
    let edges: Vec<TriviumEdgeView> = node
        .edges
        .into_iter()
        .map(|edge| TriviumEdgeView {
            target_id: edge.target_id,
            label: edge.label,
            weight: edge.weight as f64,
        })
        .collect();
    let num_edges = edges.len();

    TriviumNodeView {
        id: node.id,
        vector: node.vector.into_iter().map(map_value).collect(),
        payload: node.payload,
        edges,
        num_edges,
    }
}

fn map_trivium_search_hit(hit: TriviumRawSearchHit) -> TriviumSearchHit {
    TriviumSearchHit {
        id: hit.id,
        score: hit.score as f64,
        payload: hit.payload,
    }
}

fn map_trivium_query_rows<T, F>(
    rows: Vec<HashMap<String, TriviumRawNodeView<T>>>,
    map_value: F,
) -> Vec<HashMap<String, TriviumNodeView>>
where
    T: Copy,
    F: Fn(T) -> f64 + Copy,
{
    rows.into_iter()
        .map(|row| {
            row.into_iter()
                .map(|(key, node)| (key, map_trivium_node(node, map_value)))
                .collect()
        })
        .collect()
}

fn sort_trivium_query_rows(rows: &mut [HashMap<String, TriviumNodeView>]) {
    rows.sort_by_cached_key(trivium_query_row_sort_key);
}

fn trivium_query_row_sort_key(row: &HashMap<String, TriviumNodeView>) -> Vec<(String, u64)> {
    let mut fields = row
        .iter()
        .map(|(key, node)| (key.clone(), node.id))
        .collect::<Vec<_>>();
    fields.sort();
    fields
}

fn map_trivium_hook_context(context: TriviumRawHookContext) -> TriviumSearchContext {
    TriviumSearchContext {
        custom_data: context.custom_data,
        stage_timings: context
            .stage_timings
            .into_iter()
            .map(|(stage, elapsed)| TriviumSearchStageTiming {
                stage,
                elapsed_ms: elapsed.as_secs_f64() * 1000.0,
            })
            .collect(),
        aborted: context.abort,
    }
}

fn build_trivium_advanced_search_config(
    request: &TriviumSearchAdvancedRequest,
) -> Result<TriviumSearchConfig, ApiError> {
    Ok(TriviumSearchConfig {
        top_k: request.top_k.unwrap_or(5),
        expand_depth: request.expand_depth.unwrap_or(2),
        min_score: request.min_score.unwrap_or(0.1),
        teleport_alpha: request.teleport_alpha.unwrap_or(0.0),
        enable_advanced_pipeline: request.enable_advanced_pipeline.unwrap_or(true),
        enable_sparse_residual: request.enable_sparse_residual.unwrap_or(false),
        fista_lambda: request.fista_lambda.unwrap_or(0.1),
        fista_threshold: request.fista_threshold.unwrap_or(0.3),
        enable_dpp: request.enable_dpp.unwrap_or(false),
        dpp_quality_weight: request.dpp_quality_weight.unwrap_or(1.0),
        enable_refractory_fatigue: request.enable_refractory_fatigue.unwrap_or(false),
        enable_inverse_inhibition: request.enable_inverse_inhibition.unwrap_or(false),
        lateral_inhibition_threshold: request.lateral_inhibition_threshold.unwrap_or(0),
        enable_bq_coarse_search: request.enable_bq_coarse_search.unwrap_or(false),
        bq_candidate_ratio: request.bq_candidate_ratio.unwrap_or(0.05),
        text_boost: request.text_boost.unwrap_or(1.5),
        enable_text_hybrid_search: request.enable_text_hybrid_search.unwrap_or(false),
        bm25_k1: request.bm25_k1.unwrap_or(1.2),
        bm25_b: request.bm25_b.unwrap_or(0.75),
        payload_filter: request
            .payload_filter
            .as_ref()
            .map(parse_trivium_filter_condition)
            .transpose()?,
    })
}

fn build_trivium_hybrid_search_config(
    request: &TriviumSearchHybridRequest,
) -> Result<TriviumSearchConfig, ApiError> {
    let hybrid_alpha = request.hybrid_alpha.unwrap_or(0.7);
    Ok(TriviumSearchConfig {
        top_k: request.top_k.unwrap_or(5),
        expand_depth: request.expand_depth.unwrap_or(2),
        min_score: request.min_score.unwrap_or(0.1),
        text_boost: (1.0 - hybrid_alpha).max(0.1) * 3.0,
        enable_text_hybrid_search: true,
        payload_filter: request
            .payload_filter
            .as_ref()
            .map(parse_trivium_filter_condition)
            .transpose()?,
        ..Default::default()
    })
}

fn parse_trivium_filter_condition(value: &JsonValue) -> Result<TriviumFilter, ApiError> {
    let object = value.as_object().ok_or_else(|| ApiError {
        status_code: 400,
        message: String::from("trivium filter condition must be a JSON object"),
    })?;
    parse_trivium_filter_object(object)
}

fn parse_trivium_filter_object(
    object: &JsonMap<String, JsonValue>,
) -> Result<TriviumFilter, ApiError> {
    let mut filters = Vec::new();

    for (key, value) in object {
        if key == "$and" {
            let values = value.as_array().ok_or_else(|| ApiError {
                status_code: 400,
                message: String::from("trivium filter $and must be an array"),
            })?;
            let filters_and = values
                .iter()
                .map(parse_trivium_filter_condition)
                .collect::<Result<Vec<_>, _>>()?;
            filters.push(TriviumFilter::And(filters_and));
            continue;
        }

        if key == "$or" {
            let values = value.as_array().ok_or_else(|| ApiError {
                status_code: 400,
                message: String::from("trivium filter $or must be an array"),
            })?;
            let filters_or = values
                .iter()
                .map(parse_trivium_filter_condition)
                .collect::<Result<Vec<_>, _>>()?;
            filters.push(TriviumFilter::Or(filters_or));
            continue;
        }

        if let Some(operator_map) = value.as_object() {
            for (operator, operand) in operator_map {
                let filter = match operator.as_str() {
                    "$eq" => TriviumFilter::Eq(key.clone(), operand.clone()),
                    "$ne" => TriviumFilter::Ne(key.clone(), operand.clone()),
                    "$gt" => TriviumFilter::Gt(
                        key.clone(),
                        operand.as_f64().ok_or_else(|| ApiError {
                            status_code: 400,
                            message: String::from("trivium filter $gt requires a number"),
                        })?,
                    ),
                    "$gte" => TriviumFilter::Gte(
                        key.clone(),
                        operand.as_f64().ok_or_else(|| ApiError {
                            status_code: 400,
                            message: String::from("trivium filter $gte requires a number"),
                        })?,
                    ),
                    "$lt" => TriviumFilter::Lt(
                        key.clone(),
                        operand.as_f64().ok_or_else(|| ApiError {
                            status_code: 400,
                            message: String::from("trivium filter $lt requires a number"),
                        })?,
                    ),
                    "$lte" => TriviumFilter::Lte(
                        key.clone(),
                        operand.as_f64().ok_or_else(|| ApiError {
                            status_code: 400,
                            message: String::from("trivium filter $lte requires a number"),
                        })?,
                    ),
                    "$in" => TriviumFilter::In(
                        key.clone(),
                        operand.as_array().cloned().ok_or_else(|| ApiError {
                            status_code: 400,
                            message: String::from("trivium filter $in requires an array"),
                        })?,
                    ),
                    "$exists" => TriviumFilter::Exists(
                        key.clone(),
                        operand.as_bool().ok_or_else(|| ApiError {
                            status_code: 400,
                            message: String::from("trivium filter $exists requires a boolean"),
                        })?,
                    ),
                    "$nin" => TriviumFilter::Nin(
                        key.clone(),
                        operand.as_array().cloned().ok_or_else(|| ApiError {
                            status_code: 400,
                            message: String::from("trivium filter $nin requires an array"),
                        })?,
                    ),
                    "$size" => TriviumFilter::Size(
                        key.clone(),
                        operand.as_u64().ok_or_else(|| ApiError {
                            status_code: 400,
                            message: String::from(
                                "trivium filter $size requires a non-negative integer",
                            ),
                        })? as usize,
                    ),
                    "$all" => TriviumFilter::All(
                        key.clone(),
                        operand.as_array().cloned().ok_or_else(|| ApiError {
                            status_code: 400,
                            message: String::from("trivium filter $all requires an array"),
                        })?,
                    ),
                    "$type" => TriviumFilter::TypeMatch(
                        key.clone(),
                        operand
                            .as_str()
                            .ok_or_else(|| ApiError {
                                status_code: 400,
                                message: String::from("trivium filter $type requires a string"),
                            })?
                            .to_string(),
                    ),
                    other => {
                        return Err(ApiError {
                            status_code: 400,
                            message: format!("unsupported trivium filter operator: {other}"),
                        });
                    }
                };
                filters.push(filter);
            }
        } else {
            filters.push(TriviumFilter::Eq(key.clone(), value.clone()));
        }
    }

    if filters.is_empty() {
        Ok(TriviumFilter::Eq(String::from("none"), JsonValue::Null))
    } else if filters.len() == 1 {
        Ok(filters
            .pop()
            .expect("trivium filter should contain one item"))
    } else {
        Ok(TriviumFilter::And(filters))
    }
}

fn read_trivium_dimension_from_file(path: &Path) -> Option<usize> {
    let mut file = fs::File::open(path).ok()?;
    let mut header = [0u8; 10];
    file.read_exact(&mut header).ok()?;
    if &header[0..4] != b"TVDB" {
        return None;
    }
    let dim = u32::from_le_bytes([header[6], header[7], header[8], header[9]]) as usize;
    (dim > 0).then_some(dim)
}

fn build_trivium_database_record(
    db_path: &str,
    database: String,
    file_name: String,
    dim: Option<usize>,
    dtype: Option<String>,
    sync_mode: Option<String>,
    storage_mode: Option<String>,
) -> TriviumDatabaseRecord {
    let path = Path::new(db_path);
    let wal_path = PathBuf::from(format!("{}.wal", db_path));
    let vec_path = PathBuf::from(format!("{}.vec", db_path));
    let main_metadata = fs::metadata(path).ok();
    let wal_metadata = fs::metadata(&wal_path).ok();
    let vec_metadata = fs::metadata(&vec_path).ok();
    let size_bytes = main_metadata
        .as_ref()
        .map(|metadata| metadata.len())
        .unwrap_or(0);
    let wal_size_bytes = wal_metadata
        .as_ref()
        .map(|metadata| metadata.len())
        .unwrap_or(0);
    let vec_size_bytes = vec_metadata
        .as_ref()
        .map(|metadata| metadata.len())
        .unwrap_or(0);
    let actual_storage_mode = if main_metadata.is_some() {
        Some(if vec_metadata.is_some() {
            String::from("mmap")
        } else {
            String::from("rom")
        })
    } else {
        storage_mode
    };
    let mut timestamps = Vec::new();
    if let Some(metadata) = &main_metadata {
        timestamps.push(metadata.modified().ok().and_then(system_time_to_iso));
    }
    if let Some(metadata) = &wal_metadata {
        timestamps.push(metadata.modified().ok().and_then(system_time_to_iso));
    }
    if let Some(metadata) = &vec_metadata {
        timestamps.push(metadata.modified().ok().and_then(system_time_to_iso));
    }
    timestamps.retain(|value| value.is_some());
    timestamps.sort();

    TriviumDatabaseRecord {
        name: database,
        file_name,
        dim,
        dtype,
        sync_mode,
        storage_mode: actual_storage_mode,
        size_bytes,
        wal_size_bytes,
        vec_size_bytes,
        total_size_bytes: size_bytes + wal_size_bytes + vec_size_bytes,
        updated_at: timestamps.into_iter().flatten().last(),
    }
}

fn trivium_sync_mode_to_string(mode: TriviumSyncMode) -> &'static str {
    match mode {
        TriviumSyncMode::Full => "full",
        TriviumSyncMode::Normal => "normal",
        TriviumSyncMode::Off => "off",
    }
}

fn trivium_storage_mode_to_string(mode: TriviumStorageMode) -> &'static str {
    match mode {
        TriviumStorageMode::Mmap => "mmap",
        TriviumStorageMode::Rom => "rom",
    }
}

fn ensure_migration_table(connection: &Connection, table_name: &str) -> Result<(), ApiError> {
    let statement = format!(
        "CREATE TABLE IF NOT EXISTS {} (id TEXT PRIMARY KEY, applied_at TEXT NOT NULL)",
        table_name,
    );
    connection.execute_batch(&statement).map_err(to_sql_error)
}

fn ensure_control_schema(connection: &Connection) -> Result<(), ApiError> {
    connection.execute_batch(
        "CREATE TABLE IF NOT EXISTS authority_extensions (
            user_handle TEXT NOT NULL,
            extension_id TEXT NOT NULL,
            install_type TEXT NOT NULL,
            display_name TEXT NOT NULL,
            version TEXT NOT NULL,
            first_seen_at TEXT NOT NULL,
            last_seen_at TEXT NOT NULL,
            declared_permissions TEXT NOT NULL,
            ui_label TEXT,
            PRIMARY KEY (user_handle, extension_id)
        );
        CREATE TABLE IF NOT EXISTS authority_sessions (
            token TEXT PRIMARY KEY,
            user_handle TEXT NOT NULL,
            is_admin INTEGER NOT NULL,
            extension_id TEXT NOT NULL,
            install_type TEXT NOT NULL,
            display_name TEXT NOT NULL,
            version TEXT NOT NULL,
            first_seen_at TEXT NOT NULL,
            created_at TEXT NOT NULL,
            declared_permissions TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_authority_sessions_user_handle ON authority_sessions(user_handle);
        CREATE INDEX IF NOT EXISTS idx_authority_sessions_extension ON authority_sessions(user_handle, extension_id);
        CREATE TABLE IF NOT EXISTS authority_audit (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_handle TEXT NOT NULL,
            timestamp TEXT NOT NULL,
            kind TEXT NOT NULL,
            extension_id TEXT NOT NULL,
            message TEXT NOT NULL,
            details TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_authority_audit_recent ON authority_audit(user_handle, extension_id, kind, timestamp DESC, id DESC);
        CREATE TABLE IF NOT EXISTS authority_grants (
            user_handle TEXT NOT NULL,
            extension_id TEXT NOT NULL,
            key TEXT NOT NULL,
            resource TEXT NOT NULL,
            target TEXT NOT NULL,
            status TEXT NOT NULL,
            scope TEXT NOT NULL,
            risk_level TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            source TEXT NOT NULL,
            choice TEXT,
            PRIMARY KEY (user_handle, extension_id, key)
        );
        CREATE INDEX IF NOT EXISTS idx_authority_grants_extension ON authority_grants(user_handle, extension_id);
        CREATE TABLE IF NOT EXISTS authority_policy_documents (
            name TEXT PRIMARY KEY,
            payload TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS authority_jobs (
            user_handle TEXT NOT NULL,
            id TEXT NOT NULL,
            extension_id TEXT NOT NULL,
            type TEXT NOT NULL,
            status TEXT NOT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            progress INTEGER NOT NULL,
            summary TEXT,
            error TEXT,
            payload TEXT,
            result TEXT,
            channel TEXT NOT NULL,
            started_at TEXT,
            finished_at TEXT,
            timeout_ms INTEGER,
            idempotency_key TEXT,
            attempt INTEGER NOT NULL DEFAULT 0,
            max_attempts INTEGER,
            cancel_requested_at TEXT,
            PRIMARY KEY (user_handle, id)
        );
        CREATE INDEX IF NOT EXISTS idx_authority_jobs_extension ON authority_jobs(user_handle, extension_id, updated_at DESC, id DESC);
        CREATE INDEX IF NOT EXISTS idx_authority_jobs_idempotency ON authority_jobs(user_handle, idempotency_key);
        CREATE TABLE IF NOT EXISTS authority_job_attempts (
            user_handle TEXT NOT NULL,
            job_id TEXT NOT NULL,
            sequence INTEGER NOT NULL,
            attempt INTEGER NOT NULL,
            event TEXT NOT NULL,
            timestamp TEXT NOT NULL,
            summary TEXT,
            error TEXT,
            backoff_ms INTEGER,
            PRIMARY KEY (user_handle, job_id, sequence)
        );
        CREATE INDEX IF NOT EXISTS idx_authority_job_attempts_job ON authority_job_attempts(user_handle, job_id, sequence ASC);
        CREATE TABLE IF NOT EXISTS authority_blob_records (
            user_handle TEXT NOT NULL,
            extension_id TEXT NOT NULL,
            id TEXT NOT NULL,
            name TEXT NOT NULL,
            content_type TEXT NOT NULL,
            size INTEGER NOT NULL,
            updated_at TEXT NOT NULL,
            PRIMARY KEY (user_handle, extension_id, id)
        );
        CREATE INDEX IF NOT EXISTS idx_authority_blob_records_extension ON authority_blob_records(user_handle, extension_id, updated_at DESC, id DESC);
        CREATE TABLE IF NOT EXISTS authority_events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_handle TEXT NOT NULL,
            extension_id TEXT,
            channel TEXT NOT NULL,
            name TEXT NOT NULL,
            payload TEXT,
            created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_authority_events_channel ON authority_events(user_handle, channel, id);",
    ).map_err(to_sql_error)
}

fn ensure_kv_schema(connection: &Connection) -> Result<(), ApiError> {
    connection
        .execute_batch(
            "CREATE TABLE IF NOT EXISTS kv_entries (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );",
        )
        .map_err(to_sql_error)
}

fn fetch_control_extension(
    connection: &Connection,
    user_handle: &str,
    extension_id: &str,
) -> Result<Option<ControlExtensionRecord>, ApiError> {
    let mut statement = connection.prepare(
        "SELECT extension_id, install_type, display_name, version, first_seen_at, last_seen_at, declared_permissions, ui_label
         FROM authority_extensions
         WHERE user_handle = ?1 AND extension_id = ?2",
    ).map_err(to_sql_error)?;
    statement
        .query_row(
            params![user_handle, extension_id],
            control_extension_from_row,
        )
        .optional()
        .map_err(to_sql_error)
}

fn fetch_control_session(
    connection: &Connection,
    user_handle: &str,
    session_token: &str,
) -> Result<Option<ControlSessionSnapshot>, ApiError> {
    let mut statement = connection.prepare(
        "SELECT token, user_handle, is_admin, extension_id, install_type, display_name, version, first_seen_at, created_at, declared_permissions
         FROM authority_sessions
         WHERE user_handle = ?1 AND token = ?2",
    ).map_err(to_sql_error)?;
    statement
        .query_row(
            params![user_handle, session_token],
            control_session_from_row,
        )
        .optional()
        .map_err(to_sql_error)
}

fn control_extension_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<ControlExtensionRecord> {
    let declared_permissions_text: String = row.get(6)?;
    let declared_permissions = serde_json::from_str(&declared_permissions_text).unwrap_or_default();
    Ok(ControlExtensionRecord {
        id: row.get(0)?,
        install_type: row.get(1)?,
        display_name: row.get(2)?,
        version: row.get(3)?,
        first_seen_at: row.get(4)?,
        last_seen_at: row.get(5)?,
        declared_permissions,
        ui_label: row.get(7)?,
    })
}

fn control_session_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<ControlSessionSnapshot> {
    let declared_permissions_text: String = row.get(9)?;
    let declared_permissions =
        serde_json::from_str(&declared_permissions_text).unwrap_or_else(|_| json!({}));
    let is_admin: i64 = row.get(2)?;
    Ok(ControlSessionSnapshot {
        session_token: row.get(0)?,
        created_at: row.get(8)?,
        user: ControlUserInfo {
            handle: row.get(1)?,
            is_admin: is_admin != 0,
        },
        extension: ControlSessionExtensionInfo {
            id: row.get(3)?,
            install_type: row.get(4)?,
            display_name: row.get(5)?,
            version: row.get(6)?,
            first_seen_at: row.get(7)?,
        },
        declared_permissions,
    })
}

fn control_audit_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<ControlAuditRecord> {
    let details_text: Option<String> = row.get(4)?;
    let details = details_text.and_then(|value| serde_json::from_str(&value).ok());
    Ok(ControlAuditRecord {
        timestamp: row.get(0)?,
        kind: row.get(1)?,
        extension_id: row.get(2)?,
        message: row.get(3)?,
        details,
    })
}

fn fetch_recent_audit_records_page(
    connection: &Connection,
    user_handle: &str,
    extension_id: &str,
    kind: &str,
    offset: usize,
    limit: usize,
) -> Result<(Vec<ControlAuditRecord>, CursorPageInfo), ApiError> {
    let total_count = count_recent_audit_records(connection, user_handle, extension_id, kind)?;
    let mut statement = connection
        .prepare(
            "SELECT timestamp, kind, extension_id, message, details
         FROM authority_audit
         WHERE user_handle = ?1 AND extension_id = ?2 AND kind = ?3
         ORDER BY timestamp DESC, id DESC
         LIMIT ?4 OFFSET ?5",
        )
        .map_err(to_sql_error)?;
    let rows = statement
        .query_map(
            params![user_handle, extension_id, kind, limit as i64, offset as i64],
            control_audit_from_row,
        )
        .map_err(to_sql_error)?;
    let mut records = Vec::new();
    for row in rows {
        records.push(row.map_err(to_sql_error)?);
    }
    Ok((records, build_offset_page_info(offset, limit, total_count)))
}

fn count_recent_audit_records(
    connection: &Connection,
    user_handle: &str,
    extension_id: &str,
    kind: &str,
) -> Result<usize, ApiError> {
    let total = connection
        .query_row(
            "SELECT COUNT(*)
             FROM authority_audit
             WHERE user_handle = ?1 AND extension_id = ?2 AND kind = ?3",
            params![user_handle, extension_id, kind],
            |row| row.get::<_, i64>(0),
        )
        .map_err(to_sql_error)?;
    Ok(total.max(0) as usize)
}

fn fetch_control_grants(
    connection: &Connection,
    user_handle: &str,
    extension_id: &str,
) -> Result<Vec<ControlGrantRecord>, ApiError> {
    let mut statement = connection
        .prepare(
            "SELECT key, resource, target, status, scope, risk_level, updated_at, source, choice
         FROM authority_grants
         WHERE user_handle = ?1 AND extension_id = ?2
         ORDER BY updated_at DESC, key ASC",
        )
        .map_err(to_sql_error)?;
    let rows = statement
        .query_map(params![user_handle, extension_id], control_grant_from_row)
        .map_err(to_sql_error)?;
    let mut grants = Vec::new();
    for row in rows {
        grants.push(row.map_err(to_sql_error)?);
    }
    Ok(grants)
}

fn fetch_control_grant(
    connection: &Connection,
    user_handle: &str,
    extension_id: &str,
    key: &str,
) -> Result<Option<ControlGrantRecord>, ApiError> {
    let mut statement = connection
        .prepare(
            "SELECT key, resource, target, status, scope, risk_level, updated_at, source, choice
         FROM authority_grants
         WHERE user_handle = ?1 AND extension_id = ?2 AND key = ?3",
        )
        .map_err(to_sql_error)?;
    statement
        .query_row(
            params![user_handle, extension_id, key],
            control_grant_from_row,
        )
        .optional()
        .map_err(to_sql_error)
}

fn control_grant_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<ControlGrantRecord> {
    Ok(ControlGrantRecord {
        key: row.get(0)?,
        resource: row.get(1)?,
        target: row.get(2)?,
        status: row.get(3)?,
        scope: row.get(4)?,
        risk_level: row.get(5)?,
        updated_at: row.get(6)?,
        source: row.get(7)?,
        choice: row.get(8)?,
    })
}

fn fetch_control_policies_document(
    connection: &Connection,
) -> Result<ControlPoliciesDocument, ApiError> {
    let mut statement = connection
        .prepare("SELECT payload FROM authority_policy_documents WHERE name = 'global'")
        .map_err(to_sql_error)?;
    let payload = statement
        .query_row([], |row| row.get::<_, String>(0))
        .optional()
        .map_err(to_sql_error)?;

    match payload {
        Some(text) => serde_json::from_str(&text).map_err(to_json_error),
        None => Ok(default_control_policies_document()),
    }
}

fn save_control_policies_document(
    connection: &Connection,
    document: &ControlPoliciesDocument,
) -> Result<(), ApiError> {
    let payload = serde_json::to_string(document).map_err(to_json_error)?;
    connection.execute(
        "INSERT INTO authority_policy_documents (name, payload, updated_at) VALUES ('global', ?1, ?2)
         ON CONFLICT(name) DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at",
        params![payload, &document.updated_at],
    ).map_err(to_sql_error)?;
    Ok(())
}

fn default_control_policies_document() -> ControlPoliciesDocument {
    ControlPoliciesDocument {
        defaults: HashMap::new(),
        extensions: HashMap::new(),
        limits: ControlLimitsPoliciesDocument::default(),
        updated_at: current_timestamp_iso(),
    }
}

fn insert_control_audit_record(
    connection: &Connection,
    user_handle: &str,
    record: &ControlAuditRecordInput,
) -> Result<(), ApiError> {
    let details = match &record.details {
        Some(value) => Some(serde_json::to_string(value).map_err(to_json_error)?),
        None => None,
    };
    connection.execute(
        "INSERT INTO authority_audit (user_handle, timestamp, kind, extension_id, message, details)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![
            user_handle,
            &record.timestamp,
            &record.kind,
            &record.extension_id,
            &record.message,
            &details,
        ],
    ).map_err(to_sql_error)?;
    Ok(())
}

fn append_control_audit_record(
    connection: &Connection,
    user_handle: &str,
    extension_id: &str,
    kind: &str,
    message: &str,
    details: Option<JsonValue>,
) -> Result<(), ApiError> {
    let record = ControlAuditRecordInput {
        timestamp: current_timestamp_iso(),
        kind: kind.to_string(),
        extension_id: extension_id.to_string(),
        message: message.to_string(),
        details,
    };
    validate_audit_record(&record)?;
    insert_control_audit_record(connection, user_handle, &record)
}

fn fetch_control_jobs_page(
    connection: &Connection,
    user_handle: &str,
    extension_id: Option<&str>,
    offset: usize,
    limit: usize,
) -> Result<(Vec<ControlJobRecord>, CursorPageInfo), ApiError> {
    let total_count = count_control_jobs(connection, user_handle, extension_id)?;
    let mut jobs = Vec::new();
    if let Some(extension_id) = extension_id {
        let mut statement = connection.prepare(
            "SELECT id, extension_id, type, status, created_at, updated_at, progress, summary, error, payload, result, channel, started_at, finished_at, timeout_ms, idempotency_key, attempt, max_attempts, cancel_requested_at
             FROM authority_jobs
             WHERE user_handle = ?1 AND extension_id = ?2
             ORDER BY updated_at DESC, id DESC
             LIMIT ?3 OFFSET ?4",
        ).map_err(to_sql_error)?;
        let rows = statement
            .query_map(
                params![user_handle, extension_id, limit as i64, offset as i64],
                control_job_from_row,
            )
            .map_err(to_sql_error)?;
        for row in rows {
            let job = row.map_err(to_sql_error)?;
            jobs.push(attach_job_attempt_history(connection, user_handle, job)?);
        }
    } else {
        let mut statement = connection.prepare(
            "SELECT id, extension_id, type, status, created_at, updated_at, progress, summary, error, payload, result, channel, started_at, finished_at, timeout_ms, idempotency_key, attempt, max_attempts, cancel_requested_at
             FROM authority_jobs
             WHERE user_handle = ?1
             ORDER BY updated_at DESC, id DESC
             LIMIT ?2 OFFSET ?3",
        ).map_err(to_sql_error)?;
        let rows = statement
            .query_map(
                params![user_handle, limit as i64, offset as i64],
                control_job_from_row,
            )
            .map_err(to_sql_error)?;
        for row in rows {
            let job = row.map_err(to_sql_error)?;
            jobs.push(attach_job_attempt_history(connection, user_handle, job)?);
        }
    }
    Ok((jobs, build_offset_page_info(offset, limit, total_count)))
}

fn count_control_jobs(
    connection: &Connection,
    user_handle: &str,
    extension_id: Option<&str>,
) -> Result<usize, ApiError> {
    let total = if let Some(extension_id) = extension_id {
        connection
            .query_row(
                "SELECT COUNT(*) FROM authority_jobs WHERE user_handle = ?1 AND extension_id = ?2",
                params![user_handle, extension_id],
                |row| row.get::<_, i64>(0),
            )
            .map_err(to_sql_error)?
    } else {
        connection
            .query_row(
                "SELECT COUNT(*) FROM authority_jobs WHERE user_handle = ?1",
                params![user_handle],
                |row| row.get::<_, i64>(0),
            )
            .map_err(to_sql_error)?
    };
    Ok(total.max(0) as usize)
}

fn fetch_control_job(
    connection: &Connection,
    user_handle: &str,
    job_id: &str,
) -> Result<Option<ControlJobRecord>, ApiError> {
    let mut statement = connection.prepare(
        "SELECT id, extension_id, type, status, created_at, updated_at, progress, summary, error, payload, result, channel, started_at, finished_at, timeout_ms, idempotency_key, attempt, max_attempts, cancel_requested_at
         FROM authority_jobs
         WHERE user_handle = ?1 AND id = ?2",
    ).map_err(to_sql_error)?;
    let job = statement
        .query_row(params![user_handle, job_id], control_job_from_row)
        .optional()
        .map_err(to_sql_error)?;
    match job {
        Some(job) => Ok(Some(attach_job_attempt_history(
            connection,
            user_handle,
            job,
        )?)),
        None => Ok(None),
    }
}

fn control_job_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<ControlJobRecord> {
    let payload_text: Option<String> = row.get(9)?;
    let result_text: Option<String> = row.get(10)?;
    Ok(ControlJobRecord {
        id: row.get(0)?,
        extension_id: row.get(1)?,
        job_type: row.get(2)?,
        status: row.get(3)?,
        created_at: row.get(4)?,
        updated_at: row.get(5)?,
        progress: row.get(6)?,
        summary: row.get(7)?,
        error: row.get(8)?,
        payload: payload_text.and_then(|value| serde_json::from_str(&value).ok()),
        result: result_text.and_then(|value| serde_json::from_str(&value).ok()),
        channel: row.get(11)?,
        started_at: row.get(12)?,
        finished_at: row.get(13)?,
        timeout_ms: row.get(14)?,
        idempotency_key: row.get(15)?,
        attempt: row.get::<_, Option<i64>>(16)?.unwrap_or(0),
        max_attempts: row.get(17)?,
        cancel_requested_at: row.get(18)?,
        attempt_history: None,
    })
}

fn job_attempt_event_name(event: &JobAttemptEvent) -> &'static str {
    match event {
        JobAttemptEvent::Started => "started",
        JobAttemptEvent::RetryScheduled => "retryScheduled",
        JobAttemptEvent::Completed => "completed",
        JobAttemptEvent::Failed => "failed",
        JobAttemptEvent::Cancelled => "cancelled",
        JobAttemptEvent::Recovered => "recovered",
    }
}

fn parse_job_attempt_event(value: &str) -> Result<JobAttemptEvent, ApiError> {
    match value {
        "started" => Ok(JobAttemptEvent::Started),
        "retryScheduled" => Ok(JobAttemptEvent::RetryScheduled),
        "completed" => Ok(JobAttemptEvent::Completed),
        "failed" => Ok(JobAttemptEvent::Failed),
        "cancelled" => Ok(JobAttemptEvent::Cancelled),
        "recovered" => Ok(JobAttemptEvent::Recovered),
        other => Err(ApiError {
            status_code: 500,
            message: format!("internal_error: unsupported_job_attempt_event: {other}"),
        }),
    }
}

fn fetch_job_attempt_history(
    connection: &Connection,
    user_handle: &str,
    job_id: &str,
) -> Result<Vec<JobAttemptRecord>, ApiError> {
    let mut statement = connection
        .prepare(
            "SELECT attempt, event, timestamp, summary, error, backoff_ms
         FROM authority_job_attempts
         WHERE user_handle = ?1 AND job_id = ?2
         ORDER BY sequence ASC",
        )
        .map_err(to_sql_error)?;
    let mut rows = statement
        .query(params![user_handle, job_id])
        .map_err(to_sql_error)?;
    let mut records = Vec::new();
    while let Some(row) = rows.next().map_err(to_sql_error)? {
        let event_name = row.get::<_, String>(1).map_err(to_sql_error)?;
        records.push(JobAttemptRecord {
            attempt: row.get(0).map_err(to_sql_error)?,
            event: parse_job_attempt_event(&event_name)?,
            timestamp: row.get(2).map_err(to_sql_error)?,
            summary: row.get(3).map_err(to_sql_error)?,
            error: row.get(4).map_err(to_sql_error)?,
            backoff_ms: row.get(5).map_err(to_sql_error)?,
        });
    }
    Ok(records)
}

fn attach_job_attempt_history(
    connection: &Connection,
    user_handle: &str,
    mut job: ControlJobRecord,
) -> Result<ControlJobRecord, ApiError> {
    let history = fetch_job_attempt_history(connection, user_handle, &job.id)?;
    job.attempt_history = if history.is_empty() {
        None
    } else {
        Some(history)
    };
    Ok(job)
}

fn insert_job_attempt_record(
    connection: &Connection,
    user_handle: &str,
    job_id: &str,
    record: &JobAttemptRecord,
) -> Result<(), ApiError> {
    let sequence = connection
        .query_row(
            "SELECT COALESCE(MAX(sequence), 0) + 1 FROM authority_job_attempts WHERE user_handle = ?1 AND job_id = ?2",
            params![user_handle, job_id],
            |row| row.get::<_, i64>(0),
        )
        .map_err(to_sql_error)?;
    connection.execute(
        "INSERT INTO authority_job_attempts (user_handle, job_id, sequence, attempt, event, timestamp, summary, error, backoff_ms)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
        params![
            user_handle,
            job_id,
            sequence,
            record.attempt,
            job_attempt_event_name(&record.event),
            &record.timestamp,
            &record.summary,
            &record.error,
            &record.backoff_ms,
        ],
    ).map_err(to_sql_error)?;
    Ok(())
}

fn replace_job_attempt_history(
    connection: &Connection,
    user_handle: &str,
    job_id: &str,
    records: Option<&Vec<JobAttemptRecord>>,
) -> Result<(), ApiError> {
    let Some(records) = records else {
        return Ok(());
    };
    connection
        .execute(
            "DELETE FROM authority_job_attempts WHERE user_handle = ?1 AND job_id = ?2",
            params![user_handle, job_id],
        )
        .map_err(to_sql_error)?;
    for record in records {
        insert_job_attempt_record(connection, user_handle, job_id, record)?;
    }
    Ok(())
}

fn append_attempt_history(job: &mut ControlJobRecord, record: JobAttemptRecord) {
    job.attempt_history
        .get_or_insert_with(Vec::new)
        .push(record);
}

fn fetch_kv_value(connection: &Connection, key: &str) -> Result<Option<JsonValue>, ApiError> {
    let mut statement = connection
        .prepare("SELECT value FROM kv_entries WHERE key = ?1")
        .map_err(to_sql_error)?;
    let payload = statement
        .query_row(params![key], |row| row.get::<_, String>(0))
        .optional()
        .map_err(to_sql_error)?;
    match payload {
        Some(payload) => Ok(Some(serde_json::from_str(&payload).map_err(to_json_error)?)),
        None => Ok(None),
    }
}

fn fetch_kv_entries(connection: &Connection) -> Result<JsonMap<String, JsonValue>, ApiError> {
    let mut statement = connection
        .prepare("SELECT key, value FROM kv_entries ORDER BY key ASC")
        .map_err(to_sql_error)?;
    let mut rows = statement.query([]).map_err(to_sql_error)?;
    let mut entries = JsonMap::new();
    while let Some(row) = rows.next().map_err(to_sql_error)? {
        let key = row.get::<_, String>(0).map_err(to_sql_error)?;
        let payload = row.get::<_, String>(1).map_err(to_sql_error)?;
        let value = serde_json::from_str(&payload).map_err(to_json_error)?;
        entries.insert(key, value);
    }
    Ok(entries)
}

fn upsert_blob_record(
    connection: &Connection,
    user_handle: &str,
    extension_id: &str,
    record: &BlobRecord,
) -> Result<(), ApiError> {
    connection.execute(
        "INSERT INTO authority_blob_records (user_handle, extension_id, id, name, content_type, size, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
         ON CONFLICT(user_handle, extension_id, id) DO UPDATE SET
            name = excluded.name,
            content_type = excluded.content_type,
            size = excluded.size,
            updated_at = excluded.updated_at",
        params![
            user_handle,
            extension_id,
            &record.id,
            &record.name,
            &record.content_type,
            record.size,
            &record.updated_at,
        ],
    ).map_err(to_sql_error)?;
    Ok(())
}

fn fetch_blob_record(
    connection: &Connection,
    user_handle: &str,
    extension_id: &str,
    blob_id: &str,
) -> Result<Option<BlobRecord>, ApiError> {
    let mut statement = connection
        .prepare(
            "SELECT id, name, content_type, size, updated_at
         FROM authority_blob_records
         WHERE user_handle = ?1 AND extension_id = ?2 AND id = ?3",
        )
        .map_err(to_sql_error)?;
    statement
        .query_row(
            params![user_handle, extension_id, blob_id],
            blob_record_from_row,
        )
        .optional()
        .map_err(to_sql_error)
}

fn fetch_blob_records(
    connection: &Connection,
    user_handle: &str,
    extension_id: &str,
) -> Result<Vec<BlobRecord>, ApiError> {
    let mut statement = connection
        .prepare(
            "SELECT id, name, content_type, size, updated_at
         FROM authority_blob_records
         WHERE user_handle = ?1 AND extension_id = ?2
         ORDER BY updated_at DESC, id DESC",
        )
        .map_err(to_sql_error)?;
    let rows = statement
        .query_map(params![user_handle, extension_id], blob_record_from_row)
        .map_err(to_sql_error)?;
    let mut records = Vec::new();
    for row in rows {
        records.push(row.map_err(to_sql_error)?);
    }
    Ok(records)
}

fn delete_blob_record(
    connection: &Connection,
    user_handle: &str,
    extension_id: &str,
    blob_id: &str,
) -> Result<(), ApiError> {
    connection.execute(
        "DELETE FROM authority_blob_records WHERE user_handle = ?1 AND extension_id = ?2 AND id = ?3",
        params![user_handle, extension_id, blob_id],
    ).map_err(to_sql_error)?;
    Ok(())
}

fn blob_record_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<BlobRecord> {
    Ok(BlobRecord {
        id: row.get(0)?,
        name: row.get(1)?,
        content_type: row.get(2)?,
        size: row.get(3)?,
        updated_at: row.get(4)?,
    })
}

fn publish_control_event(
    connection: &Connection,
    user_handle: &str,
    extension_id: Option<&str>,
    channel: &str,
    name: &str,
    payload: Option<&JsonValue>,
) -> Result<(), ApiError> {
    let payload_text = match payload {
        Some(value) => Some(serde_json::to_string(value).map_err(to_json_error)?),
        None => None,
    };
    connection.execute(
        "INSERT INTO authority_events (user_handle, extension_id, channel, name, payload, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![user_handle, extension_id, channel, name, payload_text, current_timestamp_iso()],
    ).map_err(to_sql_error)?;
    Ok(())
}

fn fetch_control_events_page(
    connection: &Connection,
    user_handle: &str,
    channel: &str,
    after_id: i64,
    limit: usize,
) -> Result<(Vec<ControlEventRecord>, bool), ApiError> {
    let mut statement = connection
        .prepare(
            "SELECT id, created_at, extension_id, channel, name, payload
         FROM authority_events
         WHERE user_handle = ?1 AND channel = ?2 AND id > ?3
         ORDER BY id ASC
         LIMIT ?4",
        )
        .map_err(to_sql_error)?;
    let rows = statement
        .query_map(
            params![
                user_handle,
                channel,
                after_id,
                (limit.saturating_add(1)) as i64
            ],
            control_event_from_row,
        )
        .map_err(to_sql_error)?;
    let mut records = Vec::new();
    for row in rows {
        records.push(row.map_err(to_sql_error)?);
    }
    let has_more = records.len() > limit;
    if has_more {
        records.truncate(limit);
    }
    Ok((records, has_more))
}

fn count_control_events(
    connection: &Connection,
    user_handle: &str,
    channel: &str,
) -> Result<usize, ApiError> {
    let total = connection
        .query_row(
            "SELECT COUNT(*) FROM authority_events WHERE user_handle = ?1 AND channel = ?2",
            params![user_handle, channel],
            |row| row.get::<_, i64>(0),
        )
        .map_err(to_sql_error)?;
    Ok(total.max(0) as usize)
}

fn fetch_latest_control_event_id(
    connection: &Connection,
    user_handle: &str,
    channel: &str,
) -> Result<i64, ApiError> {
    let mut statement = connection
        .prepare("SELECT MAX(id) FROM authority_events WHERE user_handle = ?1 AND channel = ?2")
        .map_err(to_sql_error)?;
    let latest = statement
        .query_row(params![user_handle, channel], |row| {
            row.get::<_, Option<i64>>(0)
        })
        .map_err(to_sql_error)?;
    Ok(latest.unwrap_or(0))
}

fn control_event_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<ControlEventRecord> {
    let payload_text: Option<String> = row.get(5)?;
    Ok(ControlEventRecord {
        id: row.get(0)?,
        timestamp: row.get(1)?,
        extension_id: row.get(2)?,
        channel: row.get(3)?,
        name: row.get(4)?,
        payload: payload_text.and_then(|value| serde_json::from_str(&value).ok()),
    })
}

fn save_control_job_record(
    connection: &Connection,
    user_handle: &str,
    job: &ControlJobRecord,
) -> Result<(), ApiError> {
    let payload = match &job.payload {
        Some(value) => Some(serde_json::to_string(value).map_err(to_json_error)?),
        None => None,
    };
    let result = match &job.result {
        Some(value) => Some(serde_json::to_string(value).map_err(to_json_error)?),
        None => None,
    };
    connection.execute(
        "INSERT INTO authority_jobs (
            user_handle, id, extension_id, type, status, created_at, updated_at, progress, summary, error, payload, result, channel,
            started_at, finished_at, timeout_ms, idempotency_key, attempt, max_attempts, cancel_requested_at
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20)
        ON CONFLICT(user_handle, id) DO UPDATE SET
            extension_id = excluded.extension_id,
            type = excluded.type,
            status = excluded.status,
            created_at = excluded.created_at,
            updated_at = excluded.updated_at,
            progress = excluded.progress,
            summary = excluded.summary,
            error = excluded.error,
            payload = excluded.payload,
            result = excluded.result,
            channel = excluded.channel,
            started_at = excluded.started_at,
            finished_at = excluded.finished_at,
            timeout_ms = excluded.timeout_ms,
            idempotency_key = excluded.idempotency_key,
            attempt = excluded.attempt,
            max_attempts = excluded.max_attempts,
            cancel_requested_at = excluded.cancel_requested_at",
        params![
            user_handle,
            &job.id,
            &job.extension_id,
            &job.job_type,
            &job.status,
            &job.created_at,
            &job.updated_at,
            job.progress,
            &job.summary,
            &job.error,
            &payload,
            &result,
            &job.channel,
            &job.started_at,
            &job.finished_at,
            &job.timeout_ms,
            &job.idempotency_key,
            job.attempt,
            &job.max_attempts,
            &job.cancel_requested_at,
        ],
    ).map_err(to_sql_error)?;
    replace_job_attempt_history(
        connection,
        user_handle,
        &job.id,
        job.attempt_history.as_ref(),
    )?;
    Ok(())
}

fn run_delay_job(
    db_path: &str,
    user_handle: &str,
    job: &ControlJobRecord,
    control: Arc<AtomicBool>,
    timeout_ms: Option<u64>,
    attempt: i64,
) -> Result<(), ApiError> {
    let connection = open_connection(db_path)?;
    ensure_control_schema(&connection)?;
    let duration_ms = job_duration_ms(job);
    let started = Instant::now();
    let running = mark_job_running(
        &connection,
        user_handle,
        job,
        attempt,
        format!(
            "Running delay job for {}ms (attempt {})",
            duration_ms, attempt
        ),
    )?;
    if running.status == "cancelled" {
        return Ok(());
    }

    if job_should_fail_attempt(&running, attempt) {
        return Err(ApiError {
            status_code: 500,
            message: format!("simulated_job_failure_attempt_{attempt}"),
        });
    }

    loop {
        thread::sleep(Duration::from_millis(JOB_PROGRESS_INTERVAL_MS));
        let current = match fetch_control_job(&connection, user_handle, &job.id)? {
            Some(current) => current,
            None => return Ok(()),
        };
        if current.status == "cancelled" || control.load(Ordering::SeqCst) {
            return Ok(());
        }

        let elapsed_ms = started.elapsed().as_millis() as u64;
        ensure_job_within_timeout(&started, timeout_ms)?;
        let progress = if duration_ms == 0 {
            100_i64
        } else {
            ((elapsed_ms.saturating_mul(100)) / duration_ms).min(100) as i64
        };

        if progress >= 100 {
            let message = job_message(job);
            mark_job_completed(
                &connection,
                user_handle,
                current,
                message.clone(),
                json!({
                    "elapsedMs": duration_ms,
                    "message": message,
                }),
            )?;
            return Ok(());
        }

        let update = ControlJobRecord {
            progress,
            updated_at: current_timestamp_iso(),
            ..current
        };
        save_control_job_record(&connection, user_handle, &update)?;
        let payload = serde_json::to_value(&update).map_err(to_json_error)?;
        publish_control_event(
            &connection,
            user_handle,
            Some(&update.extension_id),
            &update.channel,
            "authority.job",
            Some(&payload),
        )?;
    }
}

fn run_sql_backup_job(
    db_path: &str,
    user_handle: &str,
    job: &ControlJobRecord,
    control: Arc<AtomicBool>,
    timeout_ms: Option<u64>,
    attempt: i64,
) -> Result<(), ApiError> {
    let connection = open_connection(db_path)?;
    ensure_control_schema(&connection)?;
    let database = job_database_name(job);
    let running = mark_job_running(
        &connection,
        user_handle,
        job,
        attempt,
        format!("Backing up SQL database {} (attempt {})", database, attempt),
    )?;
    if running.status == "cancelled" || control.load(Ordering::SeqCst) {
        return Ok(());
    }

    let started = Instant::now();
    let source_path =
        private_sql_database_path_from_control_db(db_path, &running.extension_id, &database)?;
    if !source_path.exists() {
        return Err(ApiError {
            status_code: 400,
            message: format!("sql_backup_source_missing: {database}"),
        });
    }
    let backup_dir = source_path
        .parent()
        .unwrap_or_else(|| Path::new(db_path))
        .join("__backup__");
    fs::create_dir_all(&backup_dir).map_err(to_internal_error)?;
    let target_name = job_payload_string(job, "targetName").unwrap_or_else(|| {
        format!(
            "{}-backup-{}",
            database,
            sanitize_file_segment(&current_timestamp_iso())
        )
    });
    let target_file_name = if target_name.ends_with(".sqlite") {
        sanitize_file_segment(&target_name)
    } else {
        format!("{}.sqlite", sanitize_file_segment(&target_name))
    };
    let target_path = backup_dir.join(target_file_name);
    fs::copy(&source_path, &target_path).map_err(to_internal_error)?;
    ensure_job_within_timeout(&started, timeout_ms)?;
    if control.load(Ordering::SeqCst) {
        return Ok(());
    }
    let current = match fetch_control_job(&connection, user_handle, &job.id)? {
        Some(current) if current.status != "cancelled" => current,
        _ => return Ok(()),
    };
    let metadata = fs::metadata(&target_path).map_err(to_internal_error)?;
    mark_job_completed(
        &connection,
        user_handle,
        current,
        String::from("SQL backup completed"),
        json!({
            "database": database,
            "backupPath": target_path.to_string_lossy(),
            "sizeBytes": metadata.len(),
        }),
    )
}

fn run_trivium_flush_job(
    db_path: &str,
    user_handle: &str,
    job: &ControlJobRecord,
    control: Arc<AtomicBool>,
    timeout_ms: Option<u64>,
    attempt: i64,
) -> Result<(), ApiError> {
    let connection = open_connection(db_path)?;
    ensure_control_schema(&connection)?;
    let database = job_database_name(job);
    let running = mark_job_running(
        &connection,
        user_handle,
        job,
        attempt,
        format!(
            "Flushing Trivium database {} (attempt {})",
            database, attempt
        ),
    )?;
    if running.status == "cancelled" || control.load(Ordering::SeqCst) {
        return Ok(());
    }

    let started = Instant::now();
    let request = TriviumFlushRequest {
        open: TriviumOpenRequest {
            db_path: private_trivium_database_path_from_control_db(
                db_path,
                &running.extension_id,
                &database,
            )?
            .to_string_lossy()
            .into_owned(),
            dim: None,
            dtype: job_payload_string(job, "dtype"),
            sync_mode: job_payload_string(job, "syncMode"),
            storage_mode: job_payload_string(job, "storageMode"),
        },
    };
    handle_trivium_flush(request)?;
    ensure_job_within_timeout(&started, timeout_ms)?;
    if control.load(Ordering::SeqCst) {
        return Ok(());
    }
    let current = match fetch_control_job(&connection, user_handle, &job.id)? {
        Some(current) if current.status != "cancelled" => current,
        _ => return Ok(()),
    };
    mark_job_completed(
        &connection,
        user_handle,
        current,
        String::from("Trivium flush completed"),
        json!({
            "database": database,
        }),
    )
}

fn run_fs_import_jsonl_job(
    db_path: &str,
    user_handle: &str,
    job: &ControlJobRecord,
    control: Arc<AtomicBool>,
    timeout_ms: Option<u64>,
    attempt: i64,
) -> Result<(), ApiError> {
    let connection = open_connection(db_path)?;
    ensure_control_schema(&connection)?;
    let blob_id = require_job_payload_string(job, "blobId")?;
    let target_path_value = require_job_payload_string(job, "targetPath")?;
    let running = mark_job_running(
        &connection,
        user_handle,
        job,
        attempt,
        format!(
            "Importing JSONL into {} (attempt {})",
            target_path_value, attempt
        ),
    )?;
    if running.status == "cancelled" || control.load(Ordering::SeqCst) {
        return Ok(());
    }

    let started = Instant::now();
    let blob_dir = authority_blob_dir_from_control_db(db_path)?;
    let source_path =
        blob_binary_path(&blob_dir.to_string_lossy(), &running.extension_id, &blob_id);
    if !source_path.exists() {
        return Err(ApiError {
            status_code: 400,
            message: format!("fs_import_jsonl_blob_missing: {blob_id}"),
        });
    }
    let bytes = fs::read(&source_path).map_err(to_internal_error)?;
    let content = String::from_utf8(bytes).map_err(|_| ApiError {
        status_code: 400,
        message: String::from("fs_import_jsonl_requires_utf8"),
    })?;
    let mut line_count = 0usize;
    for (index, line) in content.lines().enumerate() {
        if line.trim().is_empty() {
            continue;
        }
        serde_json::from_str::<JsonValue>(line).map_err(|error| ApiError {
            status_code: 400,
            message: format!("invalid_jsonl_line_{}: {}", index + 1, error),
        })?;
        line_count += 1;
    }

    let files_root = private_files_root_dir_from_control_db(db_path, &running.extension_id)?;
    fs::create_dir_all(&files_root).map_err(to_internal_error)?;
    let (target_path, virtual_path) = resolve_private_path(&files_root, &target_path_value)?;
    ensure_private_path_components_safe(&files_root, &virtual_path)?;
    if virtual_path == "/" {
        return Err(ApiError {
            status_code: 400,
            message: String::from("targetPath must not resolve to root"),
        });
    }
    if let Some(parent) = target_path.parent() {
        fs::create_dir_all(parent).map_err(to_internal_error)?;
    }
    fs::write(&target_path, content.as_bytes()).map_err(to_internal_error)?;
    ensure_job_within_timeout(&started, timeout_ms)?;
    if control.load(Ordering::SeqCst) {
        return Ok(());
    }
    let current = match fetch_control_job(&connection, user_handle, &job.id)? {
        Some(current) if current.status != "cancelled" => current,
        _ => return Ok(()),
    };
    let metadata = fs::metadata(&target_path).map_err(to_internal_error)?;
    let entry = build_private_file_entry(&files_root, &target_path, &metadata)?;
    mark_job_completed(
        &connection,
        user_handle,
        current,
        String::from("JSONL import completed"),
        json!({
            "blobId": blob_id,
            "targetPath": virtual_path,
            "lineCount": line_count,
            "entry": entry,
        }),
    )
}

fn mark_job_running(
    connection: &Connection,
    user_handle: &str,
    job: &ControlJobRecord,
    attempt: i64,
    summary: String,
) -> Result<ControlJobRecord, ApiError> {
    let mut running =
        fetch_control_job(connection, user_handle, &job.id)?.unwrap_or_else(|| job.clone());
    if running.status == "cancelled" {
        return Ok(running);
    }
    let running_timestamp = current_timestamp_iso();
    running.status = String::from("running");
    running.updated_at = running_timestamp.clone();
    if running.started_at.is_none() {
        running.started_at = Some(running_timestamp);
    }
    running.finished_at = None;
    running.attempt = attempt;
    running.error = None;
    running.summary = Some(summary);
    let started_attempt_record = JobAttemptRecord {
        attempt,
        event: JobAttemptEvent::Started,
        timestamp: running.updated_at.clone(),
        summary: running.summary.clone(),
        error: None,
        backoff_ms: None,
    };
    append_attempt_history(&mut running, started_attempt_record);
    save_control_job_record(connection, user_handle, &running)?;
    publish_job_record(connection, user_handle, &running)?;
    Ok(running)
}

fn mark_job_completed(
    connection: &Connection,
    user_handle: &str,
    current: ControlJobRecord,
    summary: String,
    result: JsonValue,
) -> Result<(), ApiError> {
    let completed_at = current_timestamp_iso();
    let mut completed = ControlJobRecord {
        status: String::from("completed"),
        progress: 100,
        updated_at: completed_at.clone(),
        finished_at: Some(completed_at),
        summary: Some(summary),
        result: Some(result),
        ..current
    };
    let completed_attempt_record = JobAttemptRecord {
        attempt: completed.attempt,
        event: JobAttemptEvent::Completed,
        timestamp: completed.updated_at.clone(),
        summary: completed.summary.clone(),
        error: None,
        backoff_ms: None,
    };
    append_attempt_history(&mut completed, completed_attempt_record);
    save_control_job_record(connection, user_handle, &completed)?;
    publish_job_record(connection, user_handle, &completed)
}

fn publish_job_record(
    connection: &Connection,
    user_handle: &str,
    job: &ControlJobRecord,
) -> Result<(), ApiError> {
    let payload = serde_json::to_value(job).map_err(to_json_error)?;
    publish_control_event(
        connection,
        user_handle,
        Some(&job.extension_id),
        &job.channel,
        "authority.job",
        Some(&payload),
    )
}

fn ensure_job_within_timeout(started: &Instant, timeout_ms: Option<u64>) -> Result<(), ApiError> {
    if let Some(timeout_ms) = timeout_ms {
        if started.elapsed().as_millis() as u64 >= timeout_ms {
            return Err(ApiError {
                status_code: 408,
                message: String::from("job_timeout"),
            });
        }
    }
    Ok(())
}

fn mark_job_failed(
    db_path: &str,
    user_handle: &str,
    job: &ControlJobRecord,
    message: &str,
) -> Result<(), ApiError> {
    let connection = open_connection(db_path)?;
    ensure_control_schema(&connection)?;
    let current = match fetch_control_job(&connection, user_handle, &job.id)? {
        Some(current) if current.status != "cancelled" && current.status != "completed" => current,
        _ => return Ok(()),
    };
    let failed_at = current_timestamp_iso();
    let mut failed = ControlJobRecord {
        status: String::from("failed"),
        updated_at: failed_at.clone(),
        finished_at: Some(failed_at),
        error: Some(message.to_string()),
        ..current
    };
    let failed_attempt_record = JobAttemptRecord {
        attempt: failed.attempt,
        event: JobAttemptEvent::Failed,
        timestamp: failed.updated_at.clone(),
        summary: failed.summary.clone(),
        error: failed.error.clone(),
        backoff_ms: None,
    };
    append_attempt_history(&mut failed, failed_attempt_record);
    save_control_job_record(&connection, user_handle, &failed)?;
    let payload = serde_json::to_value(&failed).map_err(to_json_error)?;
    publish_control_event(
        &connection,
        user_handle,
        Some(&failed.extension_id),
        &failed.channel,
        "authority.job",
        Some(&payload),
    )?;
    let (audit_kind, audit_message) = if message == "job_timeout" {
        ("error", "Job timed out")
    } else {
        ("error", "Job failed")
    };
    append_control_audit_record(
        &connection,
        user_handle,
        &failed.extension_id,
        audit_kind,
        audit_message,
        Some(json!({
            "jobId": failed.id,
            "jobType": failed.job_type,
            "message": message,
            "attempt": failed.attempt,
            "maxAttempts": failed.max_attempts,
        })),
    )?;
    Ok(())
}

fn mark_job_retry_scheduled(
    db_path: &str,
    user_handle: &str,
    job: &ControlJobRecord,
    message: &str,
    backoff_ms: u64,
    attempt: i64,
) -> Result<(), ApiError> {
    let connection = open_connection(db_path)?;
    ensure_control_schema(&connection)?;
    let current = match fetch_control_job(&connection, user_handle, &job.id)? {
        Some(current) if current.status != "cancelled" && current.status != "completed" => current,
        _ => return Ok(()),
    };
    let retry_scheduled_at = current_timestamp_iso();
    let mut queued = ControlJobRecord {
        status: String::from("queued"),
        updated_at: retry_scheduled_at.clone(),
        progress: 0,
        summary: Some(format!(
            "Retrying in {}ms after attempt {}",
            backoff_ms, attempt
        )),
        error: Some(message.to_string()),
        result: None,
        finished_at: None,
        attempt,
        ..current
    };
    let retry_attempt_record = JobAttemptRecord {
        attempt,
        event: JobAttemptEvent::RetryScheduled,
        timestamp: queued.updated_at.clone(),
        summary: queued.summary.clone(),
        error: queued.error.clone(),
        backoff_ms: Some(backoff_ms as i64),
    };
    append_attempt_history(&mut queued, retry_attempt_record);
    save_control_job_record(&connection, user_handle, &queued)?;
    let payload = serde_json::to_value(&queued).map_err(to_json_error)?;
    publish_control_event(
        &connection,
        user_handle,
        Some(&queued.extension_id),
        &queued.channel,
        "authority.job",
        Some(&payload),
    )?;
    append_control_audit_record(
        &connection,
        user_handle,
        &queued.extension_id,
        "warning",
        "Job retry scheduled",
        Some(json!({
            "jobId": queued.id,
            "jobType": queued.job_type,
            "attempt": attempt,
            "backoffMs": backoff_ms,
            "message": message,
        })),
    )?;
    Ok(())
}

fn decode_binary_content(
    kind: &str,
    encoding: Option<&str>,
    content: &str,
) -> Result<Vec<u8>, ApiError> {
    match encoding.unwrap_or("utf8") {
        "utf8" => Ok(content.as_bytes().to_vec()),
        "base64" => BASE64_STANDARD.decode(content).map_err(|error| ApiError {
            status_code: 400,
            message: format!("invalid_base64_{kind}: {error}"),
        }),
        value => Err(ApiError {
            status_code: 400,
            message: format!("{kind} encoding has unsupported value: {value}"),
        }),
    }
}

fn decode_blob_content(encoding: Option<&str>, content: &str) -> Result<Vec<u8>, ApiError> {
    decode_binary_content("blob", encoding, content)
}

fn decode_http_fetch_body(encoding: Option<&str>, content: &str) -> Result<Vec<u8>, ApiError> {
    decode_binary_content("http_fetch_body", encoding, content)
}

fn execute_http_fetch(
    url: &str,
    method: Option<&str>,
    headers: Option<&HashMap<String, String>>,
    body: Option<&[u8]>,
) -> Result<(ureq::Response, String), ApiError> {
    let mut current_url = url.to_string();
    let mut current_method = method.unwrap_or("GET").to_string();
    let mut current_body = body.map(|value| value.to_vec());

    for redirect_index in 0..=MAX_HTTP_REDIRECTS {
        let parsed_url = validate_http_fetch_url(&current_url)?;
        let hostname = normalize_hostname(parsed_url.as_str())?;
        let agent = ureq::AgentBuilder::new()
            .timeout(Duration::from_secs(30))
            .redirects(0)
            .build();
        let mut operation = agent.request(&current_method, parsed_url.as_str());
        if let Some(headers) = headers {
            for (name, value) in headers {
                operation = operation.set(name, value);
            }
        }

        let response = match current_body.as_deref() {
            Some(payload) => operation.send_bytes(payload),
            None => operation.call(),
        };

        let response = match response {
            Ok(response) => response,
            Err(ureq::Error::Status(_, response)) => response,
            Err(error) => {
                return Err(ApiError {
                    status_code: 400,
                    message: format!("http_fetch_failed: {error}"),
                });
            }
        };

        if is_http_redirect_status(response.status()) {
            if redirect_index >= MAX_HTTP_REDIRECTS {
                return Err(ApiError {
                    status_code: 400,
                    message: String::from("http_fetch_too_many_redirects"),
                });
            }
            let location = response.header("location").ok_or_else(|| ApiError {
                status_code: 400,
                message: String::from("http_fetch_redirect_missing_location"),
            })?;
            let next_url = resolve_http_fetch_redirect_url(&parsed_url, location)?;
            let next_method = redirect_http_method(response.status(), &current_method);
            if next_method == "GET"
                && !current_method.eq_ignore_ascii_case("GET")
                && !current_method.eq_ignore_ascii_case("HEAD")
            {
                current_body = None;
            }
            current_method = next_method;
            current_url = next_url.to_string();
            continue;
        }

        return Ok((response, hostname));
    }

    Err(ApiError {
        status_code: 400,
        message: String::from("http_fetch_too_many_redirects"),
    })
}

fn read_http_fetch_response(
    response: ureq::Response,
    max_bytes: usize,
) -> Result<FetchedHttpResponse, ApiError> {
    let status = response.status();
    let ok = (200..300).contains(&status);
    let mut headers = HashMap::new();
    for name in response.headers_names() {
        if let Some(value) = response.header(&name) {
            headers.insert(name.to_lowercase(), value.to_string());
        }
    }
    let content_type = headers
        .get("content-type")
        .cloned()
        .unwrap_or_else(|| String::from("application/octet-stream"));
    let mut reader = response.into_reader().take((max_bytes + 1) as u64);
    let mut body_bytes = Vec::new();
    reader
        .read_to_end(&mut body_bytes)
        .map_err(to_internal_error)?;
    if body_bytes.len() > max_bytes {
        return Err(ApiError {
            status_code: 400,
            message: format!("HTTP response exceeds {} bytes", max_bytes),
        });
    }

    Ok(FetchedHttpResponse {
        status,
        ok,
        headers,
        content_type: content_type.clone(),
        body_encoding: if is_textual_content_type(&content_type) {
            String::from("utf8")
        } else {
            String::from("base64")
        },
        body_bytes,
    })
}

fn blob_binary_path(blob_dir: &str, extension_id: &str, blob_id: &str) -> PathBuf {
    Path::new(blob_dir)
        .join(sanitize_file_segment(extension_id))
        .join(format!("{}.bin", sanitize_file_segment(blob_id)))
}

fn authority_base_dir_from_control_db(db_path: &str) -> Result<PathBuf, ApiError> {
    let control_path = Path::new(db_path);
    control_path
        .parent()
        .and_then(|state_dir| state_dir.parent())
        .map(Path::to_path_buf)
        .ok_or_else(|| ApiError {
            status_code: 400,
            message: String::from("invalid_control_db_path"),
        })
}

fn authority_blob_dir_from_control_db(db_path: &str) -> Result<PathBuf, ApiError> {
    Ok(authority_base_dir_from_control_db(db_path)?
        .join("storage")
        .join("blobs"))
}

fn private_sql_database_path_from_control_db(
    db_path: &str,
    extension_id: &str,
    database: &str,
) -> Result<PathBuf, ApiError> {
    Ok(authority_base_dir_from_control_db(db_path)?
        .join("sql")
        .join("private")
        .join(sanitize_file_segment(extension_id))
        .join(format!("{}.sqlite", sanitize_file_segment(database))))
}

fn private_trivium_database_path_from_control_db(
    db_path: &str,
    extension_id: &str,
    database: &str,
) -> Result<PathBuf, ApiError> {
    Ok(authority_base_dir_from_control_db(db_path)?
        .join("storage")
        .join("trivium")
        .join("private")
        .join(sanitize_file_segment(extension_id))
        .join(format!("{}.tdb", sanitize_file_segment(database))))
}

fn private_files_root_dir_from_control_db(
    db_path: &str,
    extension_id: &str,
) -> Result<PathBuf, ApiError> {
    Ok(authority_base_dir_from_control_db(db_path)?
        .join("storage")
        .join("files")
        .join(sanitize_file_segment(extension_id)))
}

fn validate_source_file_path(source_path: &str) -> Result<u64, ApiError> {
    let metadata = fs::symlink_metadata(source_path).map_err(|error| {
        if error.kind() == std::io::ErrorKind::NotFound {
            return ApiError {
                status_code: 400,
                message: String::from("sourcePath not found"),
            };
        }
        to_internal_error(error)
    })?;
    if metadata.file_type().is_symlink() {
        return Err(ApiError {
            status_code: 400,
            message: String::from("sourcePath symlink is not allowed"),
        });
    }
    if !metadata.is_file() {
        return Err(ApiError {
            status_code: 400,
            message: String::from("sourcePath must reference a file"),
        });
    }
    Ok(metadata.len())
}

fn resolve_private_path(root_dir: &Path, value: &str) -> Result<(PathBuf, String), ApiError> {
    let normalized = normalize_private_virtual_path(value)?;
    if normalized == "/" {
        return Ok((root_dir.to_path_buf(), normalized));
    }

    let target = normalized
        .trim_start_matches('/')
        .split('/')
        .fold(root_dir.to_path_buf(), |current, segment| {
            current.join(segment)
        });
    Ok((target, normalized))
}

fn normalize_private_virtual_path(value: &str) -> Result<String, ApiError> {
    let normalized = value.trim().replace('\\', "/");
    if normalized.is_empty() || normalized == "/" || normalized == "." {
        return Ok(String::from("/"));
    }

    let mut segments = Vec::new();
    for segment in normalized.split('/') {
        let item = segment.trim();
        if item.is_empty() || item == "." {
            continue;
        }
        if item == ".." {
            return Err(ApiError {
                status_code: 400,
                message: String::from("private_path_escape_not_allowed"),
            });
        }
        if item.contains(':') {
            return Err(ApiError {
                status_code: 400,
                message: String::from("private_absolute_paths_not_allowed"),
            });
        }
        segments.push(item.to_string());
    }

    if segments.is_empty() {
        return Ok(String::from("/"));
    }
    Ok(format!("/{}", segments.join("/")))
}

fn ensure_private_path_components_safe(
    root_dir: &Path,
    virtual_path: &str,
) -> Result<(), ApiError> {
    if root_dir.exists() {
        let metadata = fs::symlink_metadata(root_dir).map_err(to_internal_error)?;
        if metadata.file_type().is_symlink() {
            return Err(ApiError {
                status_code: 400,
                message: String::from("private_root_symlink_not_allowed"),
            });
        }
    }

    let mut current = root_dir.to_path_buf();
    for segment in virtual_path.trim_start_matches('/').split('/') {
        if segment.is_empty() {
            continue;
        }
        current = current.join(segment);
        if current.exists() {
            let metadata = fs::symlink_metadata(&current).map_err(to_internal_error)?;
            if metadata.file_type().is_symlink() {
                return Err(ApiError {
                    status_code: 400,
                    message: String::from("private_symlink_not_allowed"),
                });
            }
        }
    }
    Ok(())
}

fn build_private_file_entry(
    root_dir: &Path,
    target_path: &Path,
    metadata: &fs::Metadata,
) -> Result<PrivateFileEntry, ApiError> {
    let relative = target_path.strip_prefix(root_dir).map_err(|_| ApiError {
        status_code: 400,
        message: String::from("private_path_outside_root"),
    })?;
    let path = if relative.as_os_str().is_empty() {
        String::from("/")
    } else {
        format!(
            "/{}",
            relative
                .components()
                .map(|component| component.as_os_str().to_string_lossy().into_owned())
                .collect::<Vec<_>>()
                .join("/")
        )
    };
    let updated_at = metadata
        .modified()
        .ok()
        .and_then(system_time_to_iso)
        .unwrap_or_else(current_timestamp_iso);

    Ok(PrivateFileEntry {
        name: if path == "/" {
            String::from("/")
        } else {
            target_path
                .file_name()
                .map(|value| value.to_string_lossy().into_owned())
                .unwrap_or_else(|| String::from("/"))
        },
        path,
        kind: if metadata.is_dir() {
            String::from("directory")
        } else {
            String::from("file")
        },
        size_bytes: if metadata.is_file() {
            i64::try_from(metadata.len()).unwrap_or(i64::MAX)
        } else {
            0
        },
        updated_at,
    })
}

fn encode_private_file_content(encoding: &str, bytes: &[u8]) -> Result<String, ApiError> {
    match encoding {
        "utf8" => String::from_utf8(bytes.to_vec()).map_err(|error| ApiError {
            status_code: 400,
            message: format!("invalid_utf8_private_file: {error}"),
        }),
        "base64" => Ok(BASE64_STANDARD.encode(bytes)),
        value => Err(ApiError {
            status_code: 400,
            message: format!("private file encoding has unsupported value: {value}"),
        }),
    }
}

fn sanitize_file_segment(input: &str) -> String {
    input
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric()
                || character == '.'
                || character == '_'
                || character == '-'
            {
                character
            } else {
                '_'
            }
        })
        .collect::<String>()
}

fn normalize_hostname(value: &str) -> Result<String, ApiError> {
    let url = Url::parse(value).map_err(|error| ApiError {
        status_code: 400,
        message: format!("invalid_url: {error}"),
    })?;
    let hostname = url.host_str().ok_or_else(|| ApiError {
        status_code: 400,
        message: String::from("missing_url_hostname"),
    })?;
    Ok(hostname.trim_end_matches('.').to_ascii_lowercase())
}

fn validate_http_fetch_url(value: &str) -> Result<Url, ApiError> {
    let url = Url::parse(value).map_err(|error| ApiError {
        status_code: 400,
        message: format!("invalid_url: {error}"),
    })?;
    match url.scheme() {
        "http" | "https" => {}
        scheme => {
            return Err(ApiError {
                status_code: 400,
                message: format!("http_fetch_invalid_scheme: {scheme}"),
            });
        }
    }
    let hostname = url.host_str().ok_or_else(|| ApiError {
        status_code: 400,
        message: String::from("missing_url_hostname"),
    })?;
    let port = url.port_or_known_default().ok_or_else(|| ApiError {
        status_code: 400,
        message: String::from("http_fetch_invalid_port"),
    })?;
    validate_http_fetch_host(hostname, port)?;
    Ok(url)
}

fn validate_http_fetch_host(hostname: &str, port: u16) -> Result<(), ApiError> {
    let normalized = hostname.trim().trim_end_matches('.').to_ascii_lowercase();
    if normalized.is_empty() {
        return Err(ApiError {
            status_code: 400,
            message: String::from("missing_url_hostname"),
        });
    }
    if normalized == "localhost" || normalized.ends_with(".localhost") {
        emit_runtime_event(
            "warning",
            "ssrf_denied",
            json!({
                "host": normalized,
                "reason": "localhost",
            }),
        );
        return Err(ApiError {
            status_code: 403,
            message: format!("http_fetch_ssrf_denied: localhost: {normalized}"),
        });
    }
    if let Ok(ip) = normalized.parse::<IpAddr>() {
        return validate_http_fetch_ip(ip, &normalized);
    }

    let mut resolved_any = false;
    let mut seen = HashSet::new();
    for address in (normalized.as_str(), port)
        .to_socket_addrs()
        .map_err(|error| ApiError {
            status_code: 400,
            message: format!("http_fetch_dns_resolution_failed: {error}"),
        })?
    {
        resolved_any = true;
        let ip = address.ip();
        if seen.insert(ip) {
            validate_http_fetch_ip(ip, &normalized)?;
        }
    }

    if !resolved_any {
        return Err(ApiError {
            status_code: 400,
            message: format!("http_fetch_dns_resolution_failed: no_addresses_for_{normalized}"),
        });
    }
    Ok(())
}

fn validate_http_fetch_ip(ip: IpAddr, hostname: &str) -> Result<(), ApiError> {
    if local_http_fetch_targets_allowed() {
        return Ok(());
    }
    let denied_reason = match ip {
        IpAddr::V4(value) if value.is_loopback() => Some("loopback"),
        IpAddr::V4(value) if value.is_private() => Some("private"),
        IpAddr::V4(value) if value.is_link_local() => Some("link_local"),
        IpAddr::V4(value) if value.is_unspecified() => Some("unspecified"),
        IpAddr::V4(value) if value.is_multicast() => Some("multicast"),
        IpAddr::V6(value) if value.is_loopback() => Some("loopback"),
        IpAddr::V6(value) if value.is_unspecified() => Some("unspecified"),
        IpAddr::V6(value) if value.is_multicast() => Some("multicast"),
        IpAddr::V6(value) if (value.segments()[0] & 0xffc0) == 0xfe80 => Some("link_local"),
        IpAddr::V6(value) if (value.segments()[0] & 0xfe00) == 0xfc00 => Some("private"),
        _ => None,
    };
    if let Some(reason) = denied_reason {
        emit_runtime_event(
            "warning",
            "ssrf_denied",
            json!({
                "host": hostname,
                "ip": ip.to_string(),
                "reason": reason,
            }),
        );
        return Err(ApiError {
            status_code: 403,
            message: format!("http_fetch_ssrf_denied: {reason}: {ip}"),
        });
    }
    Ok(())
}

fn resolve_http_fetch_redirect_url(current: &Url, location: &str) -> Result<Url, ApiError> {
    let next = current.join(location).map_err(|error| ApiError {
        status_code: 400,
        message: format!("http_fetch_redirect_invalid_location: {error}"),
    })?;
    validate_http_fetch_url(next.as_str())?;
    Ok(next)
}

fn is_http_redirect_status(status: u16) -> bool {
    matches!(status, 301 | 302 | 303 | 307 | 308)
}

fn redirect_http_method(status: u16, current_method: &str) -> String {
    match status {
        307 | 308 => current_method.to_string(),
        301 | 302 | 303 => {
            if current_method.eq_ignore_ascii_case("HEAD") {
                String::from("HEAD")
            } else {
                String::from("GET")
            }
        }
        _ => current_method.to_string(),
    }
}

fn local_http_fetch_targets_allowed() -> bool {
    #[cfg(test)]
    {
        return HTTP_FETCH_ALLOW_LOCAL_TARGETS.load(Ordering::SeqCst);
    }

    #[cfg(not(test))]
    {
        false
    }
}

fn is_textual_content_type(content_type: &str) -> bool {
    let normalized = content_type.to_ascii_lowercase();
    normalized.contains("json")
        || normalized.contains("text")
        || normalized.contains("xml")
        || normalized.contains("javascript")
        || normalized.contains("html")
}

fn generate_job_id() -> String {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or(0);
    format!("job-{:x}-{}", nanos, process::id())
}

fn job_control_key(user_handle: &str, job_id: &str) -> String {
    format!("{}:{}", user_handle, job_id)
}

fn job_duration_ms(job: &ControlJobRecord) -> u64 {
    job.payload
        .as_ref()
        .and_then(|payload| payload.get("durationMs"))
        .and_then(|value| {
            value
                .as_u64()
                .or_else(|| value.as_i64().and_then(|signed| u64::try_from(signed).ok()))
        })
        .unwrap_or(3000)
}

fn job_database_name(job: &ControlJobRecord) -> String {
    job_payload_string(job, "database").unwrap_or_else(|| String::from("default"))
}

fn job_payload_string(job: &ControlJobRecord, key: &str) -> Option<String> {
    job.payload
        .as_ref()
        .and_then(|payload| payload.get(key))
        .and_then(JsonValue::as_str)
        .map(ToString::to_string)
}

fn require_job_payload_string(job: &ControlJobRecord, key: &str) -> Result<String, ApiError> {
    job_payload_string(job, key).ok_or_else(|| ApiError {
        status_code: 400,
        message: format!("job payload missing string field: {key}"),
    })
}

fn ensure_job_safe_to_requeue(job: &ControlJobRecord) -> Result<(), ApiError> {
    if matches!(job.status.as_str(), "queued" | "running") {
        return Err(ApiError {
            status_code: 400,
            message: String::from("job_requeue_requires_terminal_status"),
        });
    }
    if job.status == "completed" {
        return Err(ApiError {
            status_code: 400,
            message: String::from("job_requeue_completed_is_not_safe"),
        });
    }

    match job.job_type.as_str() {
        "delay" | "trivium.flush" => Ok(()),
        "sql.backup" => {
            if job_payload_string(job, "targetName").is_some() {
                return Err(ApiError {
                    status_code: 400,
                    message: String::from("job_requeue_sql_backup_with_target_name_is_not_safe"),
                });
            }
            Ok(())
        }
        "fs.import-jsonl" => Err(ApiError {
            status_code: 400,
            message: String::from("job_requeue_fs_import_jsonl_is_not_safe"),
        }),
        other => Err(ApiError {
            status_code: 400,
            message: format!("job_requeue_unsupported_type: {other}"),
        }),
    }
}

fn job_should_fail_attempt(job: &ControlJobRecord, attempt: i64) -> bool {
    job.payload
        .as_ref()
        .and_then(|payload| payload.get("failAttempts"))
        .and_then(|value| {
            value.as_i64().or_else(|| {
                value
                    .as_u64()
                    .and_then(|unsigned| i64::try_from(unsigned).ok())
            })
        })
        .map(|max_failed_attempt| attempt <= max_failed_attempt)
        .unwrap_or(false)
}

fn normalize_job_timeout_ms(timeout_ms: Option<i64>) -> Result<Option<u64>, ApiError> {
    validate_job_runtime_options(timeout_ms, None)?;
    Ok(timeout_ms.and_then(|value| u64::try_from(value).ok()))
}

fn normalize_job_max_attempts(max_attempts: Option<i64>) -> i64 {
    max_attempts.unwrap_or(1).clamp(1, MAX_JOB_ATTEMPTS)
}

fn job_retry_backoff_ms(attempt: i64) -> u64 {
    let exponent = u32::try_from(attempt.saturating_sub(1))
        .unwrap_or(u32::MAX)
        .min(6);
    let multiplier = 2_u64.saturating_pow(exponent);
    JOB_RETRY_BACKOFF_BASE_MS
        .saturating_mul(multiplier)
        .min(JOB_RETRY_BACKOFF_MAX_MS)
}

fn job_message(job: &ControlJobRecord) -> String {
    job.payload
        .as_ref()
        .and_then(|payload| payload.get("message"))
        .and_then(JsonValue::as_str)
        .unwrap_or("Delay completed")
        .to_string()
}

fn fetch_applied_migration_ids(
    connection: &Connection,
    table_name: &str,
) -> Result<HashSet<String>, ApiError> {
    let statement = format!("SELECT id FROM {}", table_name);
    let mut query = connection.prepare(&statement).map_err(to_sql_error)?;
    let mut rows = query.query([]).map_err(to_sql_error)?;
    let mut ids = HashSet::new();
    while let Some(row) = rows.next().map_err(to_sql_error)? {
        let id = row.get::<_, String>(0).map_err(to_sql_error)?;
        ids.insert(id);
    }
    Ok(ids)
}

fn build_sqlite_params(params: &[JsonValue]) -> Result<Vec<SqliteValue>, ApiError> {
    params
        .iter()
        .map(json_parameter_to_sqlite_value)
        .collect::<Result<Vec<_>, _>>()
}

fn json_parameter_to_sqlite_value(value: &JsonValue) -> Result<SqliteValue, ApiError> {
    match value {
        JsonValue::Null => Ok(SqliteValue::Null),
        JsonValue::Bool(boolean) => Ok(SqliteValue::Integer(i64::from(*boolean))),
        JsonValue::Number(number) => {
            if let Some(integer) = number.as_i64() {
                return Ok(SqliteValue::Integer(integer));
            }
            if let Some(unsigned) = number.as_u64() {
                let integer = i64::try_from(unsigned).map_err(|_| ApiError {
                    status_code: 400,
                    message: format!("unsupported sql parameter integer: {unsigned}"),
                })?;
                return Ok(SqliteValue::Integer(integer));
            }
            if let Some(float) = number.as_f64() {
                return Ok(SqliteValue::Real(float));
            }
            Err(ApiError {
                status_code: 400,
                message: String::from("unsupported sql parameter number"),
            })
        }
        JsonValue::String(text) => Ok(SqliteValue::Text(text.clone())),
        JsonValue::Array(_) | JsonValue::Object(_) => Err(ApiError {
            status_code: 400,
            message: String::from("sql parameters only support string, number, boolean, or null"),
        }),
    }
}

fn sqlite_value_to_json(value: ValueRef<'_>) -> JsonValue {
    match value {
        ValueRef::Null => JsonValue::Null,
        ValueRef::Integer(integer) => JsonValue::Number(JsonNumber::from(integer)),
        ValueRef::Real(float) => JsonNumber::from_f64(float)
            .map(JsonValue::Number)
            .unwrap_or(JsonValue::Null),
        ValueRef::Text(text) => JsonValue::String(String::from_utf8_lossy(text).into_owned()),
        ValueRef::Blob(blob) => {
            JsonValue::String(format!("base64:{}", BASE64_STANDARD.encode(blob)))
        }
    }
}

fn to_sql_error(error: rusqlite::Error) -> ApiError {
    ApiError {
        status_code: 400,
        message: format!("sql_error: {error}"),
    }
}

fn to_sql_migration_error(migration_id: &str, statement: &str, error: rusqlite::Error) -> ApiError {
    ApiError {
        status_code: 400,
        message: format!(
            "sql_error: migration {migration_id} failed: {error} [statement: {}]",
            preview_sql_statement(statement),
        ),
    }
}

fn preview_sql_statement(statement: &str) -> String {
    let collapsed = statement.split_whitespace().collect::<Vec<_>>().join(" ");
    let mut preview = String::new();
    let mut chars = collapsed.chars();
    for _ in 0..120 {
        match chars.next() {
            Some(ch) => preview.push(ch),
            None => return collapsed,
        }
    }
    if chars.next().is_some() {
        preview.push_str("...");
    }
    preview
}

fn to_trivium_error(error: impl std::fmt::Display) -> ApiError {
    ApiError {
        status_code: 400,
        message: format!("trivium_error: {error}"),
    }
}

fn to_internal_error(error: std::io::Error) -> ApiError {
    ApiError {
        status_code: 500,
        message: format!("internal_error: {error}"),
    }
}

fn to_json_error(error: serde_json::Error) -> ApiError {
    ApiError {
        status_code: 400,
        message: format!("json_error: {error}"),
    }
}

fn validate_non_empty(field_name: &str, value: &str) -> Result<(), ApiError> {
    if value.trim().is_empty() {
        return Err(ApiError {
            status_code: 400,
            message: format!("{field_name} must not be empty"),
        });
    }
    Ok(())
}

fn validate_trivium_bulk_item_count(count: usize) -> Result<(), ApiError> {
    if count <= MAX_TRIVIUM_BULK_ITEMS {
        return Ok(());
    }
    Err(ApiError {
        status_code: 400,
        message: format!("trivium bulk item count exceeds {}", MAX_TRIVIUM_BULK_ITEMS),
    })
}

fn validate_supported_job_type(field_name: &str, value: &str) -> Result<(), ApiError> {
    if resolve_job_runner(value).is_some() {
        return Ok(());
    }
    Err(ApiError {
        status_code: 400,
        message: format!("{field_name} must be a supported job type, got {value}"),
    })
}

fn validate_job_runtime_options(
    timeout_ms: Option<i64>,
    max_attempts: Option<i64>,
) -> Result<(), ApiError> {
    if let Some(timeout_ms) = timeout_ms {
        if timeout_ms <= 0 {
            return Err(ApiError {
                status_code: 400,
                message: String::from("timeoutMs must be greater than zero"),
            });
        }
        if timeout_ms > MAX_JOB_TIMEOUT_MS {
            return Err(ApiError {
                status_code: 400,
                message: format!("timeoutMs exceeds maximum of {}", MAX_JOB_TIMEOUT_MS),
            });
        }
    }
    if let Some(max_attempts) = max_attempts {
        if !(1..=MAX_JOB_ATTEMPTS).contains(&max_attempts) {
            return Err(ApiError {
                status_code: 400,
                message: format!("maxAttempts must be between 1 and {}", MAX_JOB_ATTEMPTS),
            });
        }
    }
    Ok(())
}

fn validate_audit_record(record: &ControlAuditRecordInput) -> Result<(), ApiError> {
    validate_non_empty("record.timestamp", &record.timestamp)?;
    validate_non_empty("record.kind", &record.kind)?;
    validate_non_empty("record.extensionId", &record.extension_id)?;
    validate_non_empty("record.message", &record.message)?;
    match record.kind.as_str() {
        "permission" | "usage" | "error" | "warning" => Ok(()),
        value => Err(ApiError {
            status_code: 400,
            message: format!("unsupported audit kind: {value}"),
        }),
    }
}

fn validate_grant_record(grant: &ControlGrantRecord) -> Result<(), ApiError> {
    validate_non_empty("grant.key", &grant.key)?;
    validate_non_empty("grant.resource", &grant.resource)?;
    validate_non_empty("grant.target", &grant.target)?;
    validate_non_empty("grant.status", &grant.status)?;
    validate_non_empty("grant.scope", &grant.scope)?;
    validate_non_empty("grant.riskLevel", &grant.risk_level)?;
    validate_non_empty("grant.updatedAt", &grant.updated_at)?;
    validate_non_empty("grant.source", &grant.source)?;
    validate_one_of(
        "grant.status",
        &grant.status,
        &["granted", "denied", "prompt", "blocked"],
    )?;
    validate_one_of(
        "grant.scope",
        &grant.scope,
        &["session", "persistent", "policy"],
    )?;
    validate_one_of(
        "grant.riskLevel",
        &grant.risk_level,
        &["low", "medium", "high"],
    )?;
    validate_one_of("grant.source", &grant.source, &["user", "admin", "system"])?;
    if let Some(choice) = &grant.choice {
        validate_one_of(
            "grant.choice",
            choice,
            &["allow-once", "allow-session", "allow-always", "deny"],
        )?;
    }
    Ok(())
}

fn validate_policy_default(resource: &str, status: &str) -> Result<(), ApiError> {
    validate_supported_resource("policy.default.resource", resource)?;
    validate_one_of(
        "policy.default.status",
        status,
        &["granted", "denied", "prompt", "blocked"],
    )
}

fn validate_policy_entry(entry: &ControlPolicyEntry) -> Result<(), ApiError> {
    validate_non_empty("policy.key", &entry.key)?;
    validate_supported_resource("policy.resource", &entry.resource)?;
    validate_non_empty("policy.target", &entry.target)?;
    validate_one_of(
        "policy.status",
        &entry.status,
        &["granted", "denied", "prompt", "blocked"],
    )?;
    validate_one_of(
        "policy.riskLevel",
        &entry.risk_level,
        &["low", "medium", "high"],
    )?;
    validate_non_empty("policy.updatedAt", &entry.updated_at)?;
    validate_one_of("policy.source", &entry.source, &["admin", "system"])?;
    Ok(())
}

fn validate_extension_limits_policy(policy: &ControlExtensionLimitsPolicy) -> Result<(), ApiError> {
    validate_extension_limits_entries("limits.inlineThresholdBytes", &policy.inline_threshold_bytes)?;
    validate_extension_limits_entries("limits.transferMaxBytes", &policy.transfer_max_bytes)?;
    Ok(())
}

fn validate_extension_limits_entries(
    field_name: &str,
    entries: &HashMap<String, u64>,
) -> Result<(), ApiError> {
    for (key, value) in entries {
        validate_one_of(
            &format!("{}.key", field_name),
            key,
            &[
                "storageBlobWrite",
                "storageBlobRead",
                "privateFileWrite",
                "privateFileRead",
                "httpFetchRequest",
                "httpFetchResponse",
            ],
        )?;
        if *value == 0 {
            return Err(ApiError {
                status_code: 400,
                message: format!("{}.{} must be greater than 0", field_name, key),
            });
        }
    }

    Ok(())
}

fn validate_job_record(job: &ControlJobRecord) -> Result<(), ApiError> {
    validate_non_empty("job.id", &job.id)?;
    validate_non_empty("job.extensionId", &job.extension_id)?;
    validate_non_empty("job.type", &job.job_type)?;
    validate_supported_job_type("job.type", &job.job_type)?;
    validate_one_of(
        "job.status",
        &job.status,
        &["queued", "running", "completed", "failed", "cancelled"],
    )?;
    validate_non_empty("job.createdAt", &job.created_at)?;
    validate_non_empty("job.updatedAt", &job.updated_at)?;
    validate_non_empty("job.channel", &job.channel)?;
    validate_job_runtime_options(job.timeout_ms, job.max_attempts)?;
    if !(0..=100).contains(&job.progress) {
        return Err(ApiError {
            status_code: 400,
            message: format!("job.progress out of range: {}", job.progress),
        });
    }
    Ok(())
}

fn validate_supported_resource(field_name: &str, value: &str) -> Result<(), ApiError> {
    validate_one_of(
        field_name,
        value,
        &[
            "storage.kv",
            "storage.blob",
            "fs.private",
            "sql.private",
            "trivium.private",
            "http.fetch",
            "jobs.background",
            "events.stream",
        ],
    )
}

fn validate_one_of(field_name: &str, value: &str, allowed: &[&str]) -> Result<(), ApiError> {
    if allowed.contains(&value) {
        return Ok(());
    }
    Err(ApiError {
        status_code: 400,
        message: format!("{field_name} has unsupported value: {value}"),
    })
}

fn validate_sql_identifier(value: &str) -> Result<String, ApiError> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Err(ApiError {
            status_code: 400,
            message: String::from("sql identifier must not be empty"),
        });
    }
    if !trimmed
        .chars()
        .all(|character| character.is_ascii_alphanumeric() || character == '_')
    {
        return Err(ApiError {
            status_code: 400,
            message: format!(
                "sql identifier contains unsupported characters: {}",
                trimmed
            ),
        });
    }
    Ok(trimmed.to_string())
}

fn current_timestamp_millis() -> String {
    current_unix_millis().to_string()
}

fn current_unix_millis() -> u64 {
    let millis = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    u64::try_from(millis).unwrap_or(u64::MAX)
}

fn runtime_uptime_ms(started_at: &str) -> u64 {
    let started_at = started_at
        .parse::<u64>()
        .unwrap_or_else(|_| current_unix_millis());
    current_unix_millis().saturating_sub(started_at)
}

fn active_job_count(runtime: &RuntimeState) -> usize {
    runtime
        .job_controls
        .lock()
        .map(|controls| controls.len())
        .unwrap_or(0)
}

fn runtime_last_error(runtime: &RuntimeState) -> Option<String> {
    runtime
        .last_error
        .lock()
        .ok()
        .and_then(|value| (*value).clone())
}

fn set_runtime_last_error(runtime: &RuntimeState, message: impl Into<String>) {
    if let Ok(mut value) = runtime.last_error.lock() {
        *value = Some(message.into());
    }
}

fn current_timestamp_iso() -> String {
    OffsetDateTime::now_utc()
        .format(&Rfc3339)
        .unwrap_or_else(|_| current_timestamp_millis())
}

fn emit_runtime_event(level: &str, event: &str, details: JsonValue) {
    let mut payload = JsonMap::new();
    payload.insert(
        String::from("timestamp"),
        JsonValue::String(current_timestamp_iso()),
    );
    payload.insert(String::from("level"), JsonValue::String(level.to_string()));
    payload.insert(String::from("event"), JsonValue::String(event.to_string()));
    if let JsonValue::Object(fields) = details {
        for (key, value) in fields {
            payload.insert(key, value);
        }
    }
    eprintln!("{}", JsonValue::Object(payload));
}

fn emit_if_slow(event: &str, elapsed: Duration, threshold_ms: u128, details: JsonValue) {
    if elapsed.as_millis() < threshold_ms {
        return;
    }
    let mut payload = match details {
        JsonValue::Object(map) => map,
        _ => JsonMap::new(),
    };
    payload.insert(
        String::from("elapsedMs"),
        JsonValue::Number(serde_json::Number::from(
            u64::try_from(elapsed.as_millis()).unwrap_or(u64::MAX),
        )),
    );
    emit_runtime_event("warning", event, JsonValue::Object(payload));
}

fn job_registry_summary_json() -> JsonValue {
    json!({
        "registered": 4,
        "jobTypes": ["delay", "sql.backup", "trivium.flush", "fs.import-jsonl"],
        "entries": [
            {
                "type": "delay",
                "description": "Waits for a duration and emits progress updates until completion.",
                "defaultTimeoutMs": null,
                "defaultMaxAttempts": 1,
                "cancellable": true,
                "payloadFields": [
                    { "name": "durationMs", "type": "number", "required": false, "description": "Delay duration in milliseconds. Defaults to 3000." },
                    { "name": "message", "type": "string", "required": false, "description": "Completion message. Defaults to \"Delay completed\"." },
                    { "name": "failAttempts", "type": "number", "required": false, "description": "Testing hook that forces the first N attempts to fail." }
                ],
                "progressFields": [
                    { "name": "progress", "type": "number", "required": true, "description": "Percent complete from 0 to 100." },
                    { "name": "summary", "type": "string", "required": false, "description": "Human-readable progress summary." },
                    { "name": "result.elapsedMs", "type": "number", "required": false, "description": "Elapsed duration reported on completion." },
                    { "name": "result.message", "type": "string", "required": false, "description": "Completion message reported on success." }
                ]
            },
            {
                "type": "sql.backup",
                "description": "Copies a private SQL database into the managed __backup__ folder.",
                "defaultTimeoutMs": null,
                "defaultMaxAttempts": 1,
                "cancellable": true,
                "payloadFields": [
                    { "name": "database", "type": "string", "required": false, "description": "Private SQL database name. Defaults to \"default\"." },
                    { "name": "targetName", "type": "string", "required": false, "description": "Optional backup filename. Defaults to a timestamped sqlite filename." }
                ],
                "progressFields": [
                    { "name": "summary", "type": "string", "required": false, "description": "Current backup stage." },
                    { "name": "result.database", "type": "string", "required": false, "description": "Database name that was backed up." },
                    { "name": "result.backupPath", "type": "string", "required": false, "description": "Filesystem path to the generated backup file." },
                    { "name": "result.sizeBytes", "type": "number", "required": false, "description": "Backup file size in bytes." }
                ]
            },
            {
                "type": "trivium.flush",
                "description": "Flushes a private Trivium database to durable storage.",
                "defaultTimeoutMs": null,
                "defaultMaxAttempts": 1,
                "cancellable": true,
                "payloadFields": [
                    { "name": "database", "type": "string", "required": false, "description": "Private Trivium database name. Defaults to \"default\"." }
                ],
                "progressFields": [
                    { "name": "summary", "type": "string", "required": false, "description": "Current flush stage." },
                    { "name": "result.database", "type": "string", "required": false, "description": "Database name that was flushed." }
                ]
            },
            {
                "type": "fs.import-jsonl",
                "description": "Imports a JSONL blob into the private filesystem after validating each line.",
                "defaultTimeoutMs": null,
                "defaultMaxAttempts": 1,
                "cancellable": true,
                "payloadFields": [
                    { "name": "blobId", "type": "string", "required": true, "description": "Source blob containing UTF-8 JSONL content." },
                    { "name": "targetPath", "type": "string", "required": true, "description": "Destination private file path for the imported JSONL file." }
                ],
                "progressFields": [
                    { "name": "summary", "type": "string", "required": false, "description": "Current import stage." },
                    { "name": "result.blobId", "type": "string", "required": false, "description": "Imported source blob id." },
                    { "name": "result.targetPath", "type": "string", "required": false, "description": "Written private file path." },
                    { "name": "result.lineCount", "type": "number", "required": false, "description": "Number of JSONL records imported." },
                    { "name": "result.entry", "type": "object", "required": false, "description": "Private file entry metadata for the imported file." }
                ]
            }
        ]
    })
}

fn system_time_to_iso(value: SystemTime) -> Option<String> {
    let timestamp: OffsetDateTime = value.into();
    timestamp.format(&Rfc3339).ok()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write as _;
    use std::net::TcpListener;

    static TEST_PATH_COUNTER: AtomicU64 = AtomicU64::new(0);

    struct LocalHttpFetchGuard {
        _guard: std::sync::MutexGuard<'static, ()>,
    }

    impl Drop for LocalHttpFetchGuard {
        fn drop(&mut self) {
            HTTP_FETCH_ALLOW_LOCAL_TARGETS.store(false, Ordering::SeqCst);
        }
    }

    fn configure_local_http_fetch_targets(allow_local: bool) -> LocalHttpFetchGuard {
        let guard = HTTP_FETCH_TEST_MUTEX
            .get_or_init(|| Mutex::new(()))
            .lock()
            .expect("http fetch test mutex should lock");
        HTTP_FETCH_ALLOW_LOCAL_TARGETS.store(allow_local, Ordering::SeqCst);
        LocalHttpFetchGuard { _guard: guard }
    }

    fn allow_local_http_fetch_targets() -> LocalHttpFetchGuard {
        configure_local_http_fetch_targets(true)
    }

    fn deny_local_http_fetch_targets() -> LocalHttpFetchGuard {
        configure_local_http_fetch_targets(false)
    }

    #[test]
    fn sql_transaction_rolls_back_on_error() {
        let db_path = test_db_path("sql-rollback");
        let create = SqlBatchStatement {
            mode: SqlStatementMode::Exec,
            statement: String::from(
                "CREATE TABLE items (id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE)",
            ),
            params: Vec::new(),
        };
        let insert_first = SqlBatchStatement {
            mode: SqlStatementMode::Exec,
            statement: String::from("INSERT INTO items (name) VALUES (?)"),
            params: vec![json!("alpha")],
        };
        execute_transactional_statements(&db_path, &[create, insert_first])
            .expect("initial transaction should commit");

        let insert_second = SqlBatchStatement {
            mode: SqlStatementMode::Exec,
            statement: String::from("INSERT INTO items (name) VALUES (?)"),
            params: vec![json!("beta")],
        };
        let duplicate_first = SqlBatchStatement {
            mode: SqlStatementMode::Exec,
            statement: String::from("INSERT INTO items (name) VALUES (?)"),
            params: vec![json!("alpha")],
        };
        let failed = execute_transactional_statements(&db_path, &[insert_second, duplicate_first]);
        assert!(failed.is_err());

        let connection = open_connection(&db_path).expect("database should open");
        let result = run_query(&connection, "SELECT name FROM items ORDER BY name", &[])
            .expect("query should succeed");
        assert_eq!(result.row_count, 1);
        assert_eq!(result.rows[0].get("name"), Some(&json!("alpha")));
    }

    #[test]
    fn sql_migrations_are_idempotent() {
        let db_path = test_db_path("sql-migrations");
        let migrations = vec![
            SqlMigrationInput {
                id: String::from("001_create"),
                statement: String::from(
                    "CREATE TABLE records (id INTEGER PRIMARY KEY, value TEXT NOT NULL)",
                ),
            },
            SqlMigrationInput {
                id: String::from("002_insert"),
                statement: String::from("INSERT INTO records (value) VALUES ('stable')"),
            },
        ];

        let first = handle_sql_migrate(SqlMigrateRequest {
            db_path: db_path.clone(),
            migrations: migrations.clone(),
            table_name: None,
        })
        .expect("first migration should succeed");
        assert_eq!(
            first["applied"]
                .as_array()
                .expect("applied should be an array")
                .len(),
            2
        );

        let second = handle_sql_migrate(SqlMigrateRequest {
            db_path,
            migrations,
            table_name: None,
        })
        .expect("second migration should succeed");
        assert_eq!(
            second["applied"]
                .as_array()
                .expect("applied should be an array")
                .len(),
            0
        );
        assert_eq!(
            second["skipped"]
                .as_array()
                .expect("skipped should be an array")
                .len(),
            2
        );
    }

    #[test]
    fn sql_migration_errors_include_id_and_statement_preview() {
        let db_path = test_db_path("sql-migration-error-preview");
        let error = handle_sql_migrate(SqlMigrateRequest {
            db_path,
            migrations: vec![SqlMigrationInput {
                id: String::from("002_broken"),
                statement: String::from(
                    "CREATE TABL broken_records (id INTEGER PRIMARY KEY, value TEXT NOT NULL)",
                ),
            }],
            table_name: None,
        })
        .expect_err("broken migration should fail");

        assert!(error.message.contains("migration 002_broken failed"));
        assert!(error.message.contains("CREATE TABL broken_records"));
    }

    #[test]
    fn sql_paged_query_requires_order_by() {
        let db_path = test_db_path("sql-paged-query-order-by");
        handle_sql_exec(SqlRequest {
            db_path: db_path.clone(),
            statement: String::from("CREATE TABLE records (id INTEGER PRIMARY KEY, value TEXT NOT NULL)"),
            params: vec![],
            page: None,
        })
        .expect("create table should succeed");
        handle_sql_exec(SqlRequest {
            db_path: db_path.clone(),
            statement: String::from("INSERT INTO records (value) VALUES ('alpha'), ('beta')"),
            params: vec![],
            page: None,
        })
        .expect("insert should succeed");

        let error = handle_sql_query(SqlRequest {
            db_path,
            statement: String::from("SELECT id, value FROM records"),
            params: vec![],
            page: Some(CursorPageRequest {
                cursor: None,
                limit: Some(1),
            }),
        })
        .expect_err("paged query without order by should fail");

        assert!(error.message.contains("requires ORDER BY"));
    }

    #[test]
    fn sql_batch_errors_include_statement_index() {
        let db_path = test_db_path("sql-batch-statement-index");
        let error = handle_sql_batch(SqlBatchRequest {
            db_path,
            statements: vec![
                SqlBatchStatement {
                    mode: SqlStatementMode::Exec,
                    statement: String::from("CREATE TABLE records (id INTEGER PRIMARY KEY, value TEXT NOT NULL)"),
                    params: vec![],
                },
                SqlBatchStatement {
                    mode: SqlStatementMode::Exec,
                    statement: String::from("INSRT INTO records (value) VALUES ('broken')"),
                    params: vec![],
                },
            ],
        })
        .expect_err("broken batch should fail");

        assert!(error.message.contains("statementIndex 1"));
        assert!(error.message.contains("INSRT INTO records"));
    }

    #[test]
    fn sql_stat_reports_runtime_defaults() {
        let db_path = test_db_path("sql-stat-runtime-defaults");
        handle_sql_exec(SqlRequest {
            db_path: db_path.clone(),
            statement: String::from("CREATE TABLE records (id INTEGER PRIMARY KEY, value TEXT NOT NULL)"),
            params: vec![],
            page: None,
        })
        .expect("create table should succeed");

        let stat = handle_sql_stat(SqlStatRequest {
            db_path,
        })
        .expect("sql stat should succeed");

        assert_eq!(stat["exists"], json!(true));
        assert_eq!(stat["runtimeConfig"]["journalMode"], json!("wal"));
        assert_eq!(stat["runtimeConfig"]["synchronous"], json!("normal"));
        assert_eq!(stat["runtimeConfig"]["foreignKeys"], json!(true));
        assert_eq!(stat["runtimeConfig"]["busyTimeoutMs"], json!(SQL_BUSY_TIMEOUT_MS));
        assert_eq!(stat["runtimeConfig"]["pagedQueryRequiresOrderBy"], json!(true));
        assert_eq!(stat["slowQuery"]["count"], json!(0));
    }

    #[test]
    fn sql_stat_reads_persisted_slow_query_diagnostics() {
        let db_path = test_db_path("sql-stat-slow-query-diagnostics");
        handle_sql_exec(SqlRequest {
            db_path: db_path.clone(),
            statement: String::from("CREATE TABLE records (id INTEGER PRIMARY KEY, value TEXT NOT NULL)"),
            params: vec![],
            page: None,
        })
        .expect("create table should succeed");

        let connection = open_connection(&db_path).expect("database should open");
        record_slow_sql_if_needed(&connection, Duration::from_millis(300), "SELECT id FROM records ORDER BY id")
            .expect("slow sql diagnostics should persist");

        let stat = handle_sql_stat(SqlStatRequest {
            db_path,
        })
        .expect("sql stat should succeed");

        assert_eq!(stat["slowQuery"]["count"], json!(1));
        assert_eq!(stat["slowQuery"]["lastElapsedMs"], json!(300));
        assert!(stat["slowQuery"]["lastStatementPreview"]
            .as_str()
            .expect("statement preview should exist")
            .contains("SELECT id FROM records ORDER BY id"));
    }

    #[test]
    fn jobs_and_events_remain_consistent() {
        let db_path = test_db_path("jobs-events");
        let runtime = create_runtime_state();
        let created = handle_control_job_create(
            ControlJobCreateRequest {
                db_path: db_path.clone(),
                user_handle: String::from("alice"),
                extension_id: String::from("third-party/example"),
                job_type: String::from("delay"),
                payload: Some(json!({
                    "durationMs": 0,
                    "message": "done",
                })),
                timeout_ms: None,
                idempotency_key: None,
                max_attempts: None,
            },
            &runtime,
        )
        .expect("job create should succeed");
        let job_id = created["job"]["id"]
            .as_str()
            .expect("job id should exist")
            .to_string();

        let completed = wait_for_job_status(&db_path, &job_id, "completed");
        assert_eq!(completed.progress, 100);
        assert_eq!(
            completed
                .result
                .as_ref()
                .and_then(|value| value.get("message")),
            Some(&json!("done"))
        );

        wait_for_job_event_status(&db_path, "completed");
        wait_for_active_job_count(&runtime, 0);
    }

    #[test]
    fn event_poll_limit_is_capped() {
        let db_path = test_db_path("event-limit");
        let connection = open_connection(&db_path).expect("database should open");
        ensure_control_schema(&connection).expect("schema should initialize");
        for index in 0..250 {
            publish_control_event(
                &connection,
                "alice",
                Some("third-party/example"),
                "extension:third-party/example",
                "authority.test",
                Some(&json!({ "index": index })),
            )
            .expect("event should publish");
        }

        let response = handle_control_events_poll(ControlEventsPollRequest {
            db_path,
            user_handle: String::from("alice"),
            channel: String::from("extension:third-party/example"),
            after_id: Some(0),
            limit: Some(1000),
            page: None,
        })
        .expect("events poll should succeed");
        assert_eq!(
            response["events"]
                .as_array()
                .expect("events should be an array")
                .len(),
            MAX_EVENT_POLL_LIMIT
        );
    }

    #[test]
    fn private_files_support_round_trip_operations() {
        let root_dir = test_private_root("round-trip");

        let created = handle_private_file_mkdir(PrivateFileMkdirRequest {
            root_dir: root_dir.clone(),
            path: String::from("notes"),
            recursive: Some(true),
        })
        .expect("mkdir should succeed");
        assert_eq!(created["entry"]["kind"], json!("directory"));

        let written = handle_private_file_write(PrivateFileWriteRequest {
            root_dir: root_dir.clone(),
            path: String::from("notes/hello.txt"),
            content: String::from("hello authority"),
            encoding: Some(String::from("utf8")),
            create_parents: Some(true),
            source_path: None,
        })
        .expect("write should succeed");
        assert_eq!(written["entry"]["path"], json!("/notes/hello.txt"));

        let listed = handle_private_file_read_dir(PrivateFileReadDirRequest {
            root_dir: root_dir.clone(),
            path: String::from("notes"),
            limit: Some(10),
        })
        .expect("list should succeed");
        assert_eq!(
            listed["entries"]
                .as_array()
                .expect("entries should be an array")
                .len(),
            1
        );

        let read = handle_private_file_read(PrivateFileReadRequest {
            root_dir: root_dir.clone(),
            path: String::from("notes/hello.txt"),
            encoding: Some(String::from("utf8")),
        })
        .expect("read should succeed");
        assert_eq!(read["content"], json!("hello authority"));

        let stat = handle_private_file_stat(PrivateFileStatRequest {
            root_dir: root_dir.clone(),
            path: String::from("notes/hello.txt"),
        })
        .expect("stat should succeed");
        assert_eq!(stat["entry"]["kind"], json!("file"));

        handle_private_file_delete(PrivateFileDeleteRequest {
            root_dir: root_dir.clone(),
            path: String::from("notes/hello.txt"),
            recursive: Some(false),
        })
        .expect("file delete should succeed");
        handle_private_file_delete(PrivateFileDeleteRequest {
            root_dir,
            path: String::from("notes"),
            recursive: Some(false),
        })
        .expect("directory delete should succeed");
    }

    #[test]
    fn private_files_reject_escape_paths() {
        let root_dir = test_private_root("escape");
        let error = handle_private_file_write(PrivateFileWriteRequest {
            root_dir,
            path: String::from("../escape.txt"),
            content: String::from("bad"),
            encoding: Some(String::from("utf8")),
            create_parents: Some(true),
            source_path: None,
        })
        .expect_err("escape path should fail");
        assert!(error.message.contains("escape"));
    }

    #[test]
    fn storage_blob_put_supports_source_path_import() {
        let db_path = test_db_path("blob-source-import");
        let blob_dir = test_private_root("blob-source-dir");
        let source_root = test_private_root("blob-source-input");
        fs::create_dir_all(&source_root).expect("source root should exist");
        let source_path = Path::new(&source_root).join("payload.bin");
        fs::write(&source_path, b"hello staged blob").expect("source blob should write");

        let created = handle_storage_blob_put(StorageBlobPutRequest {
            db_path: db_path.clone(),
            user_handle: String::from("alice"),
            extension_id: String::from("third-party/example"),
            blob_dir: blob_dir.clone(),
            name: String::from("hello.bin"),
            content: String::new(),
            encoding: None,
            content_type: Some(String::from("application/octet-stream")),
            source_path: Some(source_path.to_string_lossy().into_owned()),
        })
        .expect("blob import should succeed");
        assert_eq!(created["size"], json!(17));

        let fetched = handle_storage_blob_get(StorageBlobGetRequest {
            db_path,
            user_handle: String::from("alice"),
            extension_id: String::from("third-party/example"),
            blob_dir,
            id: String::from("hello.bin"),
        })
        .expect("blob get should succeed");
        let content = fetched["content"].as_str().expect("content should exist");
        assert_eq!(
            BASE64_STANDARD
                .decode(content)
                .expect("blob content should decode"),
            b"hello staged blob"
        );
    }

    #[test]
    fn private_file_write_supports_source_path_import() {
        let root_dir = test_private_root("private-source-import");
        let source_root = test_private_root("private-source-input");
        fs::create_dir_all(&source_root).expect("source root should exist");
        let source_path = Path::new(&source_root).join("payload.txt");
        fs::write(&source_path, b"hello staged file").expect("source file should write");

        let written = handle_private_file_write(PrivateFileWriteRequest {
            root_dir: root_dir.clone(),
            path: String::from("notes/imported.txt"),
            content: String::new(),
            encoding: None,
            create_parents: Some(true),
            source_path: Some(source_path.to_string_lossy().into_owned()),
        })
        .expect("private file import should succeed");
        assert_eq!(written["entry"]["path"], json!("/notes/imported.txt"));

        let read = handle_private_file_read(PrivateFileReadRequest {
            root_dir,
            path: String::from("notes/imported.txt"),
            encoding: Some(String::from("utf8")),
        })
        .expect("private file read should succeed");
        assert_eq!(read["content"], json!("hello staged file"));
    }

    #[test]
    fn storage_blob_open_read_returns_source_path() {
        let db_path = test_db_path("blob-open-read");
        let blob_dir = test_private_root("blob-open-read-dir");
        let source_root = test_private_root("blob-open-read-input");
        fs::create_dir_all(&source_root).expect("source root should exist");
        let source_path = Path::new(&source_root).join("payload.bin");
        fs::write(&source_path, b"hello staged blob").expect("source blob should write");

        handle_storage_blob_put(StorageBlobPutRequest {
            db_path: db_path.clone(),
            user_handle: String::from("alice"),
            extension_id: String::from("third-party/example"),
            blob_dir: blob_dir.clone(),
            name: String::from("hello.bin"),
            content: String::new(),
            encoding: None,
            content_type: Some(String::from("application/octet-stream")),
            source_path: Some(source_path.to_string_lossy().into_owned()),
        })
        .expect("blob import should succeed");

        let opened = handle_storage_blob_open_read(StorageBlobGetRequest {
            db_path,
            user_handle: String::from("alice"),
            extension_id: String::from("third-party/example"),
            blob_dir,
            id: String::from("hello.bin"),
        })
        .expect("blob open read should succeed");
        let opened_path = opened["sourcePath"]
            .as_str()
            .expect("source path should exist");
        assert!(opened_path.ends_with("hello.bin.bin"));
    }

    #[test]
    fn private_file_open_read_returns_source_path() {
        let root_dir = test_private_root("private-open-read");
        let source_root = test_private_root("private-open-read-input");
        fs::create_dir_all(&source_root).expect("source root should exist");
        let source_path = Path::new(&source_root).join("payload.txt");
        fs::write(&source_path, b"hello staged file").expect("source file should write");

        handle_private_file_write(PrivateFileWriteRequest {
            root_dir: root_dir.clone(),
            path: String::from("notes/imported.txt"),
            content: String::new(),
            encoding: None,
            create_parents: Some(true),
            source_path: Some(source_path.to_string_lossy().into_owned()),
        })
        .expect("private file import should succeed");

        let opened = handle_private_file_open_read(PrivateFileReadRequest {
            root_dir,
            path: String::from("notes/imported.txt"),
            encoding: None,
        })
        .expect("private file open read should succeed");
        let opened_path = opened["sourcePath"]
            .as_str()
            .expect("source path should exist");
        assert!(
            opened_path.ends_with("notes\\imported.txt")
                || opened_path.ends_with("notes/imported.txt")
        );
    }

    #[test]
    fn trivium_bulk_upsert_reports_partial_failures() {
        let db_path = test_trivium_path("bulk-upsert-failures");
        let response = handle_trivium_bulk_upsert(TriviumBulkUpsertRequest {
            open: test_trivium_open_request(db_path, 2),
            items: vec![
                TriviumBulkUpsertItem {
                    id: 1,
                    vector: vec![1.0, 0.0],
                    payload: json!({ "name": "alpha" }),
                },
                TriviumBulkUpsertItem {
                    id: 2,
                    vector: vec![1.0],
                    payload: json!({ "name": "bad-dim" }),
                },
            ],
        })
        .expect("bulk upsert should return partial result");

        assert_eq!(response["totalCount"], json!(2));
        assert_eq!(response["successCount"], json!(1));
        assert_eq!(response["failureCount"], json!(1));
        assert_eq!(response["failures"][0]["index"], json!(1));
    }

    #[test]
    fn trivium_insert_infers_dimension_from_vector_when_dim_is_omitted() {
        let db_path = test_trivium_path("insert-infers-vector-dim");
        let inserted = handle_trivium_insert(TriviumInsertRequest {
            open: TriviumOpenRequest {
                db_path: db_path.clone(),
                dim: None,
                dtype: Some(String::from("f32")),
                sync_mode: None,
                storage_mode: None,
            },
            vector: vec![1.0, 0.0, 0.0, 0.0, 0.0],
            payload: json!({ "name": "alpha" }),
        })
        .expect("insert without dim should infer from vector");
        assert_eq!(inserted["id"], json!(1));
        handle_trivium_flush(TriviumFlushRequest {
            open: test_trivium_open_request(db_path.clone(), 5),
        })
        .expect("flush should persist inferred database header");

        let stat = handle_trivium_stat(TriviumStatRequest {
            open: TriviumOpenRequest {
                db_path,
                dim: None,
                dtype: Some(String::from("f32")),
                sync_mode: None,
                storage_mode: None,
            },
        })
        .expect("stat without dim should read inferred database");
        assert_eq!(stat["vectorDim"], json!(5));
    }

    #[test]
    fn trivium_open_rejects_zero_dimension() {
        let error = handle_trivium_stat(TriviumStatRequest {
            open: test_trivium_open_request(test_trivium_path("zero-dim"), 0),
        })
        .expect_err("zero dim should fail validation");

        assert_eq!(error.status_code, 400);
        assert_eq!(error.message, "trivium dim must be positive");
    }

    #[test]
    fn trivium_bulk_upsert_reopens_existing_database_without_explicit_dim() {
        let db_path = test_trivium_path("bulk-upsert-existing-dim");
        handle_trivium_bulk_upsert(TriviumBulkUpsertRequest {
            open: test_trivium_open_request(db_path.clone(), 4),
            items: vec![TriviumBulkUpsertItem {
                id: 1,
                vector: vec![1.0, 0.0, 0.0, 0.0],
                payload: json!({ "name": "alpha" }),
            }],
        })
        .expect("initial 4-dim upsert should succeed");
        handle_trivium_flush(TriviumFlushRequest {
            open: test_trivium_open_request(db_path.clone(), 4),
        })
        .expect("flush should persist trivium header");

        let response = handle_trivium_bulk_upsert(TriviumBulkUpsertRequest {
            open: TriviumOpenRequest {
                db_path,
                dim: None,
                dtype: Some(String::from("f32")),
                sync_mode: None,
                storage_mode: None,
            },
            items: vec![TriviumBulkUpsertItem {
                id: 2,
                vector: vec![0.0, 1.0, 0.0, 0.0],
                payload: json!({ "name": "beta" }),
            }],
        })
        .expect("existing database dim should be read from header");

        assert_eq!(response["successCount"], json!(1));
        assert_eq!(response["failureCount"], json!(0));
    }

    #[test]
    fn trivium_bulk_upsert_rejects_explicit_dim_conflicting_with_existing_header() {
        let db_path = test_trivium_path("bulk-upsert-header-dim-conflict");
        handle_trivium_bulk_upsert(TriviumBulkUpsertRequest {
            open: test_trivium_open_request(db_path.clone(), 4),
            items: vec![TriviumBulkUpsertItem {
                id: 1,
                vector: vec![1.0, 0.0, 0.0, 0.0],
                payload: json!({ "name": "alpha" }),
            }],
        })
        .expect("initial 4-dim upsert should succeed");
        handle_trivium_flush(TriviumFlushRequest {
            open: test_trivium_open_request(db_path.clone(), 4),
        })
        .expect("flush should persist trivium header");

        let error = handle_trivium_bulk_upsert(TriviumBulkUpsertRequest {
            open: test_trivium_open_request(db_path, 1536),
            items: vec![TriviumBulkUpsertItem {
                id: 2,
                vector: vec![0.0; 1536],
                payload: json!({ "name": "beta" }),
            }],
        })
        .expect_err("explicit conflicting dim should fail before opening");

        assert_eq!(error.status_code, 400);
        assert_eq!(
            error.message,
            "trivium database is 4-dimensional; request dim is 1536"
        );
    }

    #[test]
    fn trivium_bulk_stat_tracks_edge_count() {
        let db_path = test_trivium_path("bulk-stat-edge-count");
        handle_trivium_bulk_upsert(TriviumBulkUpsertRequest {
            open: test_trivium_open_request(db_path.clone(), 2),
            items: vec![
                TriviumBulkUpsertItem {
                    id: 1,
                    vector: vec![1.0, 0.0],
                    payload: json!({ "name": "alpha" }),
                },
                TriviumBulkUpsertItem {
                    id: 2,
                    vector: vec![0.0, 1.0],
                    payload: json!({ "name": "beta" }),
                },
            ],
        })
        .expect("bulk upsert should succeed");

        handle_trivium_bulk_link(TriviumBulkLinkRequest {
            open: test_trivium_open_request(db_path.clone(), 2),
            items: vec![TriviumBulkLinkItem {
                src: 1,
                dst: 2,
                label: Some(String::from("related")),
                weight: Some(1.0),
            }],
        })
        .expect("bulk link should succeed");

        handle_trivium_flush(TriviumFlushRequest {
            open: test_trivium_open_request(db_path.clone(), 2),
        })
        .expect("flush should succeed");

        let stat = handle_trivium_stat(TriviumStatRequest {
            open: test_trivium_open_request(db_path.clone(), 2),
        })
        .expect("stat should succeed");
        assert_eq!(stat["nodeCount"], json!(2));
        assert_eq!(stat["edgeCount"], json!(1));
        assert_eq!(stat["vectorDim"], json!(2));

        handle_trivium_bulk_delete(TriviumBulkDeleteRequest {
            open: test_trivium_open_request(db_path.clone(), 2),
            items: vec![TriviumBulkDeleteItem { id: 1 }],
        })
        .expect("bulk delete should succeed");

        let fetched = handle_trivium_get(TriviumGetRequest {
            open: test_trivium_open_request(db_path.clone(), 2),
            id: 1,
        })
        .expect("get should succeed");
        assert!(fetched["node"].is_null());

        let stat_after_delete = handle_trivium_stat(TriviumStatRequest {
            open: test_trivium_open_request(db_path, 2),
        })
        .expect("stat after delete should succeed");
        assert_eq!(stat_after_delete["nodeCount"], json!(1));
        assert_eq!(stat_after_delete["edgeCount"], json!(0));
    }

    #[test]
    fn trivium_compact_preserves_nodes_and_edges() {
        let db_path = test_trivium_path("compact-preserves-data");
        handle_trivium_bulk_upsert(TriviumBulkUpsertRequest {
            open: test_trivium_open_request(db_path.clone(), 2),
            items: vec![
                TriviumBulkUpsertItem {
                    id: 1,
                    vector: vec![1.0, 0.0],
                    payload: json!({ "name": "alpha" }),
                },
                TriviumBulkUpsertItem {
                    id: 2,
                    vector: vec![0.0, 1.0],
                    payload: json!({ "name": "beta" }),
                },
            ],
        })
        .expect("bulk upsert should succeed");

        handle_trivium_bulk_link(TriviumBulkLinkRequest {
            open: test_trivium_open_request(db_path.clone(), 2),
            items: vec![TriviumBulkLinkItem {
                src: 1,
                dst: 2,
                label: Some(String::from("related")),
                weight: Some(1.0),
            }],
        })
        .expect("bulk link should succeed");

        handle_trivium_compact(TriviumCompactRequest {
            open: test_trivium_open_request(db_path.clone(), 2),
        })
        .expect("compact should succeed");

        let stat = handle_trivium_stat(TriviumStatRequest {
            open: test_trivium_open_request(db_path.clone(), 2),
        })
        .expect("stat should succeed after compact");
        assert_eq!(stat["nodeCount"], json!(2));
        assert_eq!(stat["edgeCount"], json!(1));

        let fetched = handle_trivium_get(TriviumGetRequest {
            open: test_trivium_open_request(db_path, 2),
            id: 1,
        })
        .expect("get should succeed after compact");
        assert_eq!(fetched["node"]["payload"]["name"], json!("alpha"));
    }

    #[test]
    fn trivium_tql_route_supports_paging() {
        let db_path = test_trivium_path("tql-route-paging");
        handle_trivium_bulk_upsert(TriviumBulkUpsertRequest {
            open: test_trivium_open_request(db_path.clone(), 2),
            items: vec![
                TriviumBulkUpsertItem {
                    id: 1,
                    vector: vec![1.0, 0.0],
                    payload: json!({ "name": "alpha" }),
                },
                TriviumBulkUpsertItem {
                    id: 2,
                    vector: vec![0.0, 1.0],
                    payload: json!({ "name": "beta" }),
                },
            ],
        })
        .expect("bulk upsert should succeed");

        let first_page = handle_trivium_tql(TriviumTqlRequest {
            open: test_trivium_open_request(db_path.clone(), 2),
            query: String::from("MATCH (n) RETURN n"),
            page: Some(CursorPageRequest {
                cursor: None,
                limit: Some(1),
            }),
        })
        .expect("first tql page should succeed");

        assert_eq!(first_page["rows"].as_array().map(|rows| rows.len()), Some(1));
        assert_eq!(first_page["page"]["totalCount"], json!(2));
        assert_eq!(first_page["page"]["hasMore"], json!(true));

        let next_cursor = first_page["page"]["nextCursor"]
            .as_str()
            .expect("next cursor should exist")
            .to_string();
        let second_page = handle_trivium_tql(TriviumTqlRequest {
            open: test_trivium_open_request(db_path.clone(), 2),
            query: String::from("MATCH (n) RETURN n"),
            page: Some(CursorPageRequest {
                cursor: Some(next_cursor),
                limit: Some(1),
            }),
        })
        .expect("second tql page should succeed");

        assert_eq!(second_page["rows"].as_array().map(|rows| rows.len()), Some(1));
        assert_eq!(second_page["page"]["totalCount"], json!(2));
        assert_eq!(second_page["page"]["hasMore"], json!(false));

        let mut names = vec![
            first_page["rows"][0]["n"]["payload"]["name"]
                .as_str()
                .expect("first page name should exist")
                .to_string(),
            second_page["rows"][0]["n"]["payload"]["name"]
                .as_str()
                .expect("second page name should exist")
                .to_string(),
        ];
        names.sort();
        assert_eq!(names, vec![String::from("alpha"), String::from("beta")]);
    }

    #[test]
    fn trivium_tql_mut_route_creates_and_updates_nodes() {
        let db_path = test_trivium_path("tql-mut-route");
        let created = handle_trivium_tql_mut(TriviumTqlMutRequest {
            open: test_trivium_open_request(db_path.clone(), 2),
            query: String::from(r#"CREATE (a {name: "Alice", status: "active"})"#),
        })
        .expect("tql mutation create should succeed");

        assert_eq!(created["affected"], json!(1));
        assert_eq!(created["createdIds"].as_array().map(|rows| rows.len()), Some(1));

        let created_id = created["createdIds"][0]
            .as_u64()
            .expect("created id should be present");
        let read = handle_trivium_tql(TriviumTqlRequest {
            open: test_trivium_open_request(db_path.clone(), 2),
            query: String::from(r#"MATCH (a {name: "Alice"}) RETURN a"#),
            page: None,
        })
        .expect("tql read should succeed");
        assert_eq!(read["rows"][0]["a"]["payload"]["status"], json!("active"));

        let updated = handle_trivium_tql_mut(TriviumTqlMutRequest {
            open: test_trivium_open_request(db_path.clone(), 2),
            query: String::from(r#"MATCH (a {name: "Alice"}) SET a.status == "archived""#),
        })
        .expect("tql mutation update should succeed");
        assert_eq!(updated["affected"], json!(1));

        let fetched = handle_trivium_get(TriviumGetRequest {
            open: test_trivium_open_request(db_path, 2),
            id: created_id,
        })
        .expect("get should succeed after tql mutation update");
        assert_eq!(fetched["node"]["payload"]["status"], json!("archived"));
    }

    #[test]
    fn trivium_property_index_lifecycle_routes_work() {
        let db_path = test_trivium_path("property-index-lifecycle");
        handle_trivium_bulk_upsert(TriviumBulkUpsertRequest {
            open: test_trivium_open_request(db_path.clone(), 2),
            items: vec![TriviumBulkUpsertItem {
                id: 1,
                vector: vec![1.0, 0.0],
                payload: json!({ "name": "alpha", "status": "active" }),
            }],
        })
        .expect("bulk upsert should succeed");

        let created = handle_trivium_create_index(TriviumCreateIndexRequest {
            open: test_trivium_open_request(db_path.clone(), 2),
            field: String::from("status"),
        })
        .expect("create index should succeed");
        assert_eq!(created["ok"], json!(true));

        let indexed_query = handle_trivium_tql(TriviumTqlRequest {
            open: test_trivium_open_request(db_path.clone(), 2),
            query: String::from(r#"MATCH (a {status: "active"}) RETURN a"#),
            page: None,
        })
        .expect("indexed match query should succeed");
        assert_eq!(indexed_query["rows"][0]["a"]["payload"]["name"], json!("alpha"));

        let dropped = handle_trivium_drop_index(TriviumDropIndexRequest {
            open: test_trivium_open_request(db_path.clone(), 2),
            field: String::from("status"),
        })
        .expect("drop index should succeed");
        assert_eq!(dropped["ok"], json!(true));

        let after_drop = handle_trivium_tql(TriviumTqlRequest {
            open: test_trivium_open_request(db_path, 2),
            query: String::from(r#"MATCH (a {status: "active"}) RETURN a"#),
            page: None,
        })
        .expect("match query should still succeed after drop index");
        assert_eq!(after_drop["rows"].as_array().map(|rows| rows.len()), Some(1));
    }

    #[test]
    fn trivium_search_hybrid_with_context_route_returns_context() {
        let db_path = test_trivium_path("search-hybrid-context-route");
        handle_trivium_bulk_upsert(TriviumBulkUpsertRequest {
            open: test_trivium_open_request(db_path.clone(), 2),
            items: vec![
                TriviumBulkUpsertItem {
                    id: 1,
                    vector: vec![1.0, 0.0],
                    payload: json!({ "name": "alpha" }),
                },
                TriviumBulkUpsertItem {
                    id: 2,
                    vector: vec![0.0, 1.0],
                    payload: json!({ "name": "beta" }),
                },
            ],
        })
        .expect("bulk upsert should succeed");

        handle_trivium_index_text(TriviumIndexTextRequest {
            open: test_trivium_open_request(db_path.clone(), 2),
            id: 1,
            text: String::from("alpha hybrid context"),
        })
        .expect("first text index should succeed");
        handle_trivium_index_text(TriviumIndexTextRequest {
            open: test_trivium_open_request(db_path.clone(), 2),
            id: 2,
            text: String::from("beta unrelated"),
        })
        .expect("second text index should succeed");

        let response = handle_trivium_search_hybrid_with_context(TriviumSearchHybridRequest {
            open: test_trivium_open_request(db_path, 2),
            vector: vec![1.0, 0.0],
            query_text: String::from("alpha"),
            top_k: Some(2),
            expand_depth: Some(1),
            min_score: Some(0.0),
            hybrid_alpha: Some(0.5),
            payload_filter: None,
        })
        .expect("hybrid search with context should succeed");

        assert!(response["hits"].as_array().is_some_and(|hits| !hits.is_empty()));
        assert_eq!(response["hits"][0]["payload"]["name"], json!("alpha"));
        assert!(response["context"]["stageTimings"].is_array());
        assert_eq!(response["context"]["aborted"], json!(false));
    }

    #[test]
    fn http_fetch_open_writes_response_to_staged_file() {
        let _local_guard = allow_local_http_fetch_targets();
        let response_body = vec![0x41; 300 * 1024];
        let (url, handle) =
            spawn_test_http_server(response_body.clone(), "application/octet-stream", None);
        let root_dir = test_private_root("http-fetch-open-response");
        fs::create_dir_all(&root_dir).expect("response root should exist");
        let response_path = Path::new(&root_dir).join("response.bin");
        fs::write(&response_path, b"").expect("response file should exist");

        let opened = handle_http_fetch_open(CoreHttpFetchOpenRequest {
            url,
            method: Some(String::from("GET")),
            headers: None,
            body: None,
            body_encoding: None,
            body_source_path: None,
            response_path: response_path.to_string_lossy().into_owned(),
        })
        .expect("http fetch open should succeed");

        assert_eq!(opened["bodyEncoding"], json!("base64"));
        assert_eq!(opened["sizeBytes"], json!(response_body.len()));
        assert_eq!(
            fs::read(&response_path).expect("response file should read"),
            response_body
        );
        handle.join().expect("http server should stop");
    }

    #[test]
    fn http_fetch_open_supports_body_source_path() {
        let _local_guard = allow_local_http_fetch_targets();
        let captured_request = Arc::new(Mutex::new(Vec::new()));
        let (url, handle) = spawn_test_http_server(
            b"ok".to_vec(),
            "text/plain; charset=utf-8",
            Some(captured_request.clone()),
        );
        let root_dir = test_private_root("http-fetch-open-request");
        fs::create_dir_all(&root_dir).expect("request root should exist");
        let body_source_path = Path::new(&root_dir).join("request.bin");
        fs::write(&body_source_path, b"payload via source path")
            .expect("request body should write");
        let response_path = Path::new(&root_dir).join("response.txt");
        fs::write(&response_path, b"").expect("response file should exist");

        let opened = handle_http_fetch_open(CoreHttpFetchOpenRequest {
            url,
            method: Some(String::from("POST")),
            headers: Some(HashMap::from([(
                String::from("content-type"),
                String::from("application/octet-stream"),
            )])),
            body: None,
            body_encoding: None,
            body_source_path: Some(body_source_path.to_string_lossy().into_owned()),
            response_path: response_path.to_string_lossy().into_owned(),
        })
        .expect("http fetch open with source path should succeed");

        assert_eq!(opened["bodyEncoding"], json!("utf8"));
        assert_eq!(
            fs::read(&response_path).expect("response file should read"),
            b"ok"
        );
        handle.join().expect("http server should stop");

        let request = captured_request
            .lock()
            .expect("request capture should lock");
        assert!(String::from_utf8_lossy(&request).contains("payload via source path"));
    }

    #[test]
    fn http_fetch_rejects_localhost_by_default() {
        let _local_guard = deny_local_http_fetch_targets();
        let response = handle_http_fetch(CoreHttpFetchRequest {
            url: String::from("http://127.0.0.1:8173/health"),
            method: Some(String::from("GET")),
            headers: None,
            body: None,
            body_encoding: None,
        })
        .expect_err("localhost fetch should be denied");
        assert_eq!(response.status_code, 403);
        assert!(response.message.contains("http_fetch_ssrf_denied"));
    }

    #[test]
    fn http_fetch_redirect_validation_rejects_private_targets() {
        let _local_guard = deny_local_http_fetch_targets();
        let current = Url::parse("https://api.example.com/data").expect("url should parse");
        let error = resolve_http_fetch_redirect_url(&current, "http://127.0.0.1/internal")
            .expect_err("redirect to localhost should be denied");
        assert_eq!(error.status_code, 403);
        assert!(error.message.contains("http_fetch_ssrf_denied"));
    }

    #[test]
    fn runtime_diagnostics_are_monotonic() {
        let started_at = current_unix_millis().saturating_sub(50).to_string();
        assert!(runtime_uptime_ms(&started_at) >= 50);
        let runtime = create_runtime_state();
        runtime.request_count.store(7, Ordering::SeqCst);
        runtime.error_count.store(2, Ordering::SeqCst);
        assert_eq!(active_job_count(&runtime), 0);
        assert_eq!(runtime.request_count.load(Ordering::SeqCst), 7);
        assert_eq!(runtime.error_count.load(Ordering::SeqCst), 2);
    }

    fn wait_for_job_status(db_path: &str, job_id: &str, expected_status: &str) -> ControlJobRecord {
        let started = Instant::now();
        loop {
            let connection = open_connection(db_path).expect("database should open");
            ensure_control_schema(&connection).expect("schema should initialize");
            if let Some(job) =
                fetch_control_job(&connection, "alice", job_id).expect("job lookup should succeed")
            {
                if job.status == expected_status {
                    return job;
                }
            }
            assert!(
                started.elapsed() < Duration::from_secs(5),
                "job did not reach expected status"
            );
            thread::sleep(Duration::from_millis(25));
        }
    }

    fn wait_for_job_event_status(db_path: &str, expected_status: &str) {
        let started = Instant::now();
        loop {
            let events = handle_control_events_poll(ControlEventsPollRequest {
                db_path: db_path.to_string(),
                user_handle: String::from("alice"),
                channel: String::from("extension:third-party/example"),
                after_id: Some(0),
                limit: Some(50),
                page: None,
            })
            .expect("events poll should succeed");
            if events["events"]
                .as_array()
                .expect("events should be an array")
                .iter()
                .any(|event| event["payload"]["status"] == json!(expected_status))
            {
                return;
            }
            assert!(
                started.elapsed() < Duration::from_secs(5),
                "job event did not reach expected status"
            );
            thread::sleep(Duration::from_millis(25));
        }
    }

    fn wait_for_active_job_count(runtime: &RuntimeState, expected_count: usize) {
        let started = Instant::now();
        loop {
            if active_job_count(runtime) == expected_count {
                return;
            }
            assert!(
                started.elapsed() < Duration::from_secs(5),
                "active job count did not reach expected value"
            );
            thread::sleep(Duration::from_millis(25));
        }
    }

    #[test]
    fn job_idempotency_key_deduplicates() {
        let db_path = test_db_path("job-idempotency");
        let runtime = create_runtime_state();
        let first = handle_control_job_create(
            ControlJobCreateRequest {
                db_path: db_path.clone(),
                user_handle: String::from("alice"),
                extension_id: String::from("third-party/example"),
                job_type: String::from("delay"),
                payload: Some(json!({ "durationMs": 0, "message": "first" })),
                timeout_ms: None,
                idempotency_key: Some(String::from("unique-key-1")),
                max_attempts: None,
            },
            &runtime,
        )
        .expect("first job create should succeed");
        let first_id = first["job"]["id"].as_str().unwrap().to_string();

        let second = handle_control_job_create(
            ControlJobCreateRequest {
                db_path: db_path.clone(),
                user_handle: String::from("alice"),
                extension_id: String::from("third-party/example"),
                job_type: String::from("delay"),
                payload: Some(json!({ "durationMs": 0, "message": "second" })),
                timeout_ms: None,
                idempotency_key: Some(String::from("unique-key-1")),
                max_attempts: None,
            },
            &runtime,
        )
        .expect("second job create should succeed");
        let second_id = second["job"]["id"].as_str().unwrap().to_string();

        assert_eq!(
            first_id, second_id,
            "idempotency key should return existing job"
        );
    }

    #[test]
    fn job_timeout_marks_failed() {
        let db_path = test_db_path("job-timeout");
        let runtime = create_runtime_state();
        let created = handle_control_job_create(
            ControlJobCreateRequest {
                db_path: db_path.clone(),
                user_handle: String::from("alice"),
                extension_id: String::from("third-party/example"),
                job_type: String::from("delay"),
                payload: Some(json!({
                    "durationMs": 200,
                    "message": "timeout",
                })),
                timeout_ms: Some(50),
                idempotency_key: None,
                max_attempts: Some(1),
            },
            &runtime,
        )
        .expect("timed job create should succeed");
        let job_id = created["job"]["id"]
            .as_str()
            .expect("job id should exist")
            .to_string();

        let failed = wait_for_job_status(&db_path, &job_id, "failed");
        assert_eq!(failed.error.as_deref(), Some("job_timeout"));
        assert!(failed.finished_at.is_some());
        let history = failed
            .attempt_history
            .expect("failed job should include attempt history");
        assert_eq!(history.len(), 2);
        assert_eq!(history[0].attempt, 1);
        assert!(matches!(history[0].event, JobAttemptEvent::Started));
        assert_eq!(history[1].attempt, 1);
        assert!(matches!(history[1].event, JobAttemptEvent::Failed));
        assert_eq!(history[1].error.as_deref(), Some("job_timeout"));
        wait_for_active_job_count(&runtime, 0);
    }

    #[test]
    fn job_retries_then_completes() {
        let db_path = test_db_path("job-retry");
        let runtime = create_runtime_state();
        let created = handle_control_job_create(
            ControlJobCreateRequest {
                db_path: db_path.clone(),
                user_handle: String::from("alice"),
                extension_id: String::from("third-party/example"),
                job_type: String::from("delay"),
                payload: Some(json!({
                    "durationMs": 0,
                    "message": "retry-ok",
                    "failAttempts": 1,
                })),
                timeout_ms: None,
                idempotency_key: None,
                max_attempts: Some(2),
            },
            &runtime,
        )
        .expect("retry job create should succeed");
        let job_id = created["job"]["id"]
            .as_str()
            .expect("job id should exist")
            .to_string();

        let completed = wait_for_job_status(&db_path, &job_id, "completed");
        assert_eq!(completed.attempt, 2);
        assert_eq!(
            completed
                .result
                .as_ref()
                .and_then(|value| value.get("message")),
            Some(&json!("retry-ok"))
        );
        let history = completed
            .attempt_history
            .expect("completed retry job should include attempt history");
        assert_eq!(history.len(), 4);
        assert_eq!(history[0].attempt, 1);
        assert!(matches!(history[0].event, JobAttemptEvent::Started));
        assert_eq!(history[1].attempt, 1);
        assert!(matches!(history[1].event, JobAttemptEvent::RetryScheduled));
        assert_eq!(history[1].backoff_ms, Some(job_retry_backoff_ms(1) as i64));
        assert_eq!(history[2].attempt, 2);
        assert!(matches!(history[2].event, JobAttemptEvent::Started));
        assert_eq!(history[3].attempt, 2);
        assert!(matches!(history[3].event, JobAttemptEvent::Completed));
        wait_for_active_job_count(&runtime, 0);
    }

    #[test]
    fn stale_jobs_are_recovered_when_listing_jobs_after_restart() {
        let db_path = test_db_path("job-recovery");
        let connection = open_connection(&db_path).expect("database should open");
        ensure_control_schema(&connection).expect("control schema should exist");
        let stale_timestamp = String::from("2000-01-01T00:00:00Z");
        handle_control_job_upsert(ControlJobUpsertRequest {
            db_path: db_path.clone(),
            user_handle: String::from("alice"),
            job: ControlJobRecord {
                id: String::from("job-stale-1"),
                extension_id: String::from("third-party/example"),
                job_type: String::from("delay"),
                status: String::from("running"),
                created_at: stale_timestamp.clone(),
                updated_at: stale_timestamp.clone(),
                progress: 42,
                summary: Some(String::from("Running before restart")),
                error: None,
                payload: Some(json!({ "durationMs": 1000 })),
                result: None,
                channel: String::from("extension:third-party/example"),
                started_at: Some(stale_timestamp.clone()),
                finished_at: None,
                timeout_ms: None,
                idempotency_key: None,
                attempt: 1,
                max_attempts: Some(2),
                cancel_requested_at: None,
                attempt_history: None,
            },
        })
        .expect("stale job upsert should succeed");

        let runtime = create_runtime_state();
        let listed = handle_control_jobs_list(
            ControlJobsListRequest {
                db_path: db_path.clone(),
                user_handle: String::from("alice"),
                extension_id: None,
                page: None,
            },
            &runtime,
        )
        .expect("listing jobs should succeed");

        let jobs = listed["jobs"].as_array().expect("jobs should be an array");
        assert_eq!(jobs.len(), 1);
        assert_eq!(jobs[0]["status"], json!("failed"));
        assert_eq!(jobs[0]["error"], json!("job_recovery_required"));
        assert_eq!(
            jobs[0]["summary"],
            json!("Recovered stale job after runtime restart")
        );
        assert_eq!(jobs[0]["attemptHistory"][0]["event"], json!("recovered"));
        assert_eq!(jobs[0]["attemptHistory"][0]["attempt"], json!(1));

        let recovered = wait_for_job_status(&db_path, "job-stale-1", "failed");
        let history = recovered
            .attempt_history
            .expect("recovered job should include attempt history");
        assert_eq!(history.len(), 1);
        assert!(matches!(history[0].event, JobAttemptEvent::Recovered));
        assert_eq!(history[0].error.as_deref(), Some("job_recovery_required"));
    }

    #[test]
    fn stale_jobs_are_recovered_during_session_init() {
        let db_path = test_db_path("job-stale-session-init");
        let stale_timestamp = current_timestamp_iso();
        handle_control_job_upsert(ControlJobUpsertRequest {
            db_path: db_path.clone(),
            user_handle: String::from("alice"),
            job: ControlJobRecord {
                id: String::from("job-stale-session-1"),
                extension_id: String::from("third-party/example"),
                job_type: String::from("delay"),
                status: String::from("queued"),
                created_at: stale_timestamp.clone(),
                updated_at: stale_timestamp,
                progress: 0,
                summary: Some(String::from("Queued before restart")),
                error: None,
                payload: Some(json!({ "durationMs": 1000 })),
                result: None,
                channel: String::from("extension:third-party/example"),
                started_at: None,
                finished_at: None,
                timeout_ms: None,
                idempotency_key: None,
                attempt: 1,
                max_attempts: Some(2),
                cancel_requested_at: None,
                attempt_history: None,
            },
        })
        .expect("stale job upsert should succeed");

        let runtime = create_runtime_state();
        handle_control_session_init(
            ControlSessionInitRequest {
                db_path: db_path.clone(),
                session_token: String::from("session-1"),
                timestamp: current_timestamp_iso(),
                user: ControlUserInfo {
                    handle: String::from("alice"),
                    is_admin: false,
                },
                config: ControlInitConfig {
                    extension_id: String::from("third-party/example"),
                    display_name: String::from("Example"),
                    version: String::from(env!("CARGO_PKG_VERSION")),
                    install_type: String::from("local"),
                    declared_permissions: json!({}),
                    ui_label: None,
                },
            },
            &runtime,
        )
        .expect("session init should succeed");

        let recovered = wait_for_job_status(&db_path, "job-stale-session-1", "failed");
        assert_eq!(recovered.error.as_deref(), Some("job_recovery_required"));
    }

    #[test]
    fn safe_job_requeue_boundaries_are_conservative() {
        let base = ControlJobRecord {
            id: String::from("job-1"),
            extension_id: String::from("third-party/example"),
            job_type: String::from("delay"),
            status: String::from("failed"),
            created_at: current_timestamp_iso(),
            updated_at: current_timestamp_iso(),
            progress: 0,
            summary: Some(String::from("failed")),
            error: Some(String::from("job_recovery_required")),
            payload: Some(json!({ "durationMs": 1000 })),
            result: None,
            channel: String::from("extension:third-party/example"),
            started_at: Some(current_timestamp_iso()),
            finished_at: Some(current_timestamp_iso()),
            timeout_ms: None,
            idempotency_key: None,
            attempt: 1,
            max_attempts: Some(2),
            cancel_requested_at: None,
            attempt_history: None,
        };

        ensure_job_safe_to_requeue(&base).expect("delay jobs should be safe to requeue");
        ensure_job_safe_to_requeue(&ControlJobRecord {
            job_type: String::from("trivium.flush"),
            payload: Some(json!({ "database": "graph" })),
            ..base.clone()
        })
        .expect("trivium.flush should be safe to requeue");
        ensure_job_safe_to_requeue(&ControlJobRecord {
            job_type: String::from("sql.backup"),
            payload: Some(json!({ "database": "graph" })),
            ..base.clone()
        })
        .expect("sql.backup without targetName should be safe to requeue");

        let sql_backup_error = ensure_job_safe_to_requeue(&ControlJobRecord {
            job_type: String::from("sql.backup"),
            payload: Some(json!({ "database": "graph", "targetName": "fixed.sqlite" })),
            ..base.clone()
        })
        .expect_err("sql.backup with fixed targetName should be rejected");
        assert_eq!(
            sql_backup_error.message,
            "job_requeue_sql_backup_with_target_name_is_not_safe"
        );

        let import_error = ensure_job_safe_to_requeue(&ControlJobRecord {
            job_type: String::from("fs.import-jsonl"),
            payload: Some(json!({ "blobId": "blob-1", "targetPath": "/data/items.jsonl" })),
            ..base.clone()
        })
        .expect_err("fs.import-jsonl should be rejected for safe requeue");
        assert_eq!(import_error.message, "job_requeue_fs_import_jsonl_is_not_safe");
    }

    #[test]
    fn safe_job_requeue_creates_a_new_delay_job() {
        let db_path = test_db_path("job-safe-requeue-delay");
        let original_id = String::from("job-failed-delay-1");
        handle_control_job_upsert(ControlJobUpsertRequest {
            db_path: db_path.clone(),
            user_handle: String::from("alice"),
            job: ControlJobRecord {
                id: original_id.clone(),
                extension_id: String::from("third-party/example"),
                job_type: String::from("delay"),
                status: String::from("failed"),
                created_at: current_timestamp_iso(),
                updated_at: current_timestamp_iso(),
                progress: 0,
                summary: Some(String::from("Recovered stale job after runtime restart")),
                error: Some(String::from("job_recovery_required")),
                payload: Some(json!({ "durationMs": 1000, "message": "done" })),
                result: None,
                channel: String::from("extension:third-party/example"),
                started_at: Some(current_timestamp_iso()),
                finished_at: Some(current_timestamp_iso()),
                timeout_ms: Some(5000),
                idempotency_key: Some(String::from("dedupe-1")),
                attempt: 1,
                max_attempts: Some(2),
                cancel_requested_at: None,
                attempt_history: None,
            },
        })
        .expect("failed delay job upsert should succeed");

        let runtime = create_runtime_state();
        let requeued = handle_control_job_requeue(
            ControlJobRequeueRequest {
                db_path: db_path.clone(),
                user_handle: String::from("alice"),
                extension_id: String::from("third-party/example"),
                job_id: original_id,
            },
            &runtime,
        )
        .expect("requeue should succeed");

        assert_eq!(requeued["job"]["status"], json!("queued"));
        assert_eq!(requeued["job"]["type"], json!("delay"));
        assert_eq!(requeued["job"]["payload"]["message"], json!("done"));
        assert_eq!(requeued["job"]["idempotencyKey"], JsonValue::Null);
        assert_ne!(requeued["job"]["id"], json!("job-failed-delay-1"));
    }

    #[test]
    fn control_policies_round_trip_extension_limits() {
        let db_path = test_db_path("control-policies-limits");
        let saved = handle_control_policies_save(ControlPoliciesSaveRequest {
            db_path: db_path.clone(),
            actor: ControlUserInfo {
                handle: String::from("admin"),
                is_admin: true,
            },
            partial: ControlPoliciesPartial {
                defaults: None,
                extensions: None,
                limits: Some(ControlLimitsPoliciesDocument {
                    extensions: HashMap::from([(
                        String::from("third-party/ext-a"),
                        ControlExtensionLimitsPolicy {
                            inline_threshold_bytes: HashMap::from([(
                                String::from("storageBlobWrite"),
                                1024,
                            )]),
                            transfer_max_bytes: HashMap::from([(
                                String::from("httpFetchResponse"),
                                2048,
                            )]),
                        },
                    )]),
                }),
            },
        })
        .expect("control policies save should succeed");

        assert_eq!(saved["limits"]["extensions"]["third-party/ext-a"]["inlineThresholdBytes"]["storageBlobWrite"], json!(1024));
        assert_eq!(saved["limits"]["extensions"]["third-party/ext-a"]["transferMaxBytes"]["httpFetchResponse"], json!(2048));

        let loaded = handle_control_policies_get(ControlPoliciesRequest {
            db_path,
            user_handle: String::from("alice"),
        })
        .expect("control policies get should succeed");

        assert_eq!(loaded["limits"]["extensions"]["third-party/ext-a"]["inlineThresholdBytes"]["storageBlobWrite"], json!(1024));
        assert_eq!(loaded["limits"]["extensions"]["third-party/ext-a"]["transferMaxBytes"]["httpFetchResponse"], json!(2048));
    }

    fn test_db_path(name: &str) -> String {
        let sequence = TEST_PATH_COUNTER.fetch_add(1, Ordering::SeqCst);
        let path = env::temp_dir().join(format!(
            "authority-core-test-{}-{}-{}-{}.sqlite",
            name,
            process::id(),
            current_unix_millis(),
            sequence
        ));
        path.to_string_lossy().into_owned()
    }

    fn test_trivium_path(name: &str) -> String {
        let sequence = TEST_PATH_COUNTER.fetch_add(1, Ordering::SeqCst);
        let path = env::temp_dir().join(format!(
            "authority-core-trivium-{}-{}-{}-{}.tdb",
            name,
            process::id(),
            current_unix_millis(),
            sequence
        ));
        path.to_string_lossy().into_owned()
    }

    fn test_trivium_open_request(db_path: String, dim: usize) -> TriviumOpenRequest {
        TriviumOpenRequest {
            db_path,
            dim: Some(dim),
            dtype: Some(String::from("f32")),
            sync_mode: None,
            storage_mode: None,
        }
    }

    fn test_private_root(name: &str) -> String {
        let sequence = TEST_PATH_COUNTER.fetch_add(1, Ordering::SeqCst);
        let path = env::temp_dir().join(format!(
            "authority-core-private-{}-{}-{}-{}",
            name,
            process::id(),
            current_unix_millis(),
            sequence
        ));
        path.to_string_lossy().into_owned()
    }

    fn spawn_test_http_server(
        response_body: Vec<u8>,
        content_type: &str,
        captured_request: Option<Arc<Mutex<Vec<u8>>>>,
    ) -> (String, thread::JoinHandle<()>) {
        let listener = TcpListener::bind("127.0.0.1:0").expect("listener should bind");
        let address = listener
            .local_addr()
            .expect("listener should expose address");
        let content_type = content_type.to_string();
        let handle = thread::spawn(move || {
            let (mut stream, _) = listener.accept().expect("server should accept connection");
            stream
                .set_read_timeout(Some(Duration::from_millis(200)))
                .expect("read timeout should apply");

            let mut request = Vec::new();
            let mut buffer = [0_u8; 4096];
            loop {
                match stream.read(&mut buffer) {
                    Ok(0) => break,
                    Ok(size) => request.extend_from_slice(&buffer[..size]),
                    Err(error)
                        if error.kind() == std::io::ErrorKind::WouldBlock
                            || error.kind() == std::io::ErrorKind::TimedOut =>
                    {
                        break;
                    }
                    Err(error) => panic!("failed to read test request: {error}"),
                }
            }

            if let Some(captured_request) = captured_request {
                let mut target = captured_request
                    .lock()
                    .expect("captured request should lock");
                *target = request;
            }

            let response_head = format!(
                "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nContent-Type: {}\r\nConnection: close\r\n\r\n",
                response_body.len(),
                content_type,
            );
            stream
                .write_all(response_head.as_bytes())
                .expect("response head should write");
            stream
                .write_all(&response_body)
                .expect("response body should write");
        });
        (format!("http://{address}/"), handle)
    }
}
