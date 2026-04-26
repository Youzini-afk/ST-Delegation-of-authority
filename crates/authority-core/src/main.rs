use axum::extract::State;
use axum::http::StatusCode;
use axum::middleware::{self, Next};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::Json;
use axum::extract::Request;
use axum::Router;
use base64::Engine;
use base64::engine::general_purpose::STANDARD as BASE64_STANDARD;
use half::f16;
use rusqlite::{Connection, OptionalExtension, params, params_from_iter};
use rusqlite::types::{Value as SqliteValue, ValueRef};
use serde::Deserialize;
use serde::Serialize;
use serde_json::{Map as JsonMap, Number as JsonNumber, Value as JsonValue, json};
use std::collections::{HashMap, HashSet, VecDeque};
use std::env;
use std::error::Error;
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Condvar, Mutex};
use std::thread;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use time::OffsetDateTime;
use time::format_description::well_known::Rfc3339;
use tokio::net::TcpListener;
use tokio::sync::Semaphore;
use tower_http::timeout::TimeoutLayer;
use tower_http::limit::RequestBodyLimitLayer;
use triviumdb::database::{Config as TriviumConfig, Database as TriviumDatabase, SearchConfig as TriviumSearchConfig, StorageMode as TriviumStorageMode};
use triviumdb::filter::Filter as TriviumFilter;
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
const JOB_PROGRESS_INTERVAL_MS: u64 = 250;
const JOB_WORKER_CONCURRENCY: usize = 4;
const MAX_JOB_QUEUE_SIZE: usize = 256;
const MAX_JOB_ATTEMPTS: i64 = 5;
const MAX_JOB_TIMEOUT_MS: i64 = 5 * 60 * 1000;
const JOB_RETRY_BACKOFF_BASE_MS: u64 = 250;
const JOB_RETRY_BACKOFF_MAX_MS: u64 = 5_000;

struct RuntimeState {
    job_controls: Mutex<HashMap<String, Arc<AtomicBool>>>,
    job_queue: JobQueue,
    queued_job_count: AtomicU64,
    request_count: AtomicU64,
    error_count: AtomicU64,
    current_concurrency: AtomicU64,
    concurrency_semaphore: Semaphore,
}

struct Config {
    token: String,
    version: String,
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
        let status = StatusCode::from_u16(self.status_code).unwrap_or(StatusCode::INTERNAL_SERVER_ERROR);
        let body = json!({ "error": self.message });
        (status, Json(body)).into_response()
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SqlRequest {
    db_path: String,
    statement: String,
    #[serde(default)]
    params: Vec<JsonValue>,
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
struct TriviumUnlinkRequest {
    #[serde(flatten)]
    open: TriviumOpenRequest,
    src: u64,
    dst: u64,
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
struct TriviumFilterWhereRequest {
    #[serde(flatten)]
    open: TriviumOpenRequest,
    condition: JsonValue,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct TriviumQueryRequest {
    #[serde(flatten)]
    open: TriviumOpenRequest,
    cypher: String,
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
struct TriviumFilterWhereResponse {
    nodes: Vec<TriviumNodeView>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct TriviumQueryResponse {
    rows: Vec<HashMap<String, TriviumNodeView>>,
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

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct ControlPoliciesDocument {
    defaults: HashMap<String, String>,
    extensions: HashMap<String, HashMap<String, ControlPolicyEntry>>,
    updated_at: String,
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
    let api_version = env::var("AUTHORITY_CORE_API_VERSION").unwrap_or_else(|_| String::from("authority-core/v1"));
    let started_at = SystemTime::now()
        .duration_since(UNIX_EPOCH)?
        .as_millis()
        .to_string();
    let runtime = create_runtime_state();
    let config = Arc::new(Config {
        token,
        version,
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
        .route("/trivium/insert", post(v1_trivium_insert))
        .route("/trivium/insert-with-id", post(v1_trivium_insert_with_id))
        .route("/trivium/get", post(v1_trivium_get))
        .route("/trivium/update-payload", post(v1_trivium_update_payload))
        .route("/trivium/update-vector", post(v1_trivium_update_vector))
        .route("/trivium/delete", post(v1_trivium_delete))
        .route("/trivium/link", post(v1_trivium_link))
        .route("/trivium/unlink", post(v1_trivium_unlink))
        .route("/trivium/neighbors", post(v1_trivium_neighbors))
        .route("/trivium/search", post(v1_trivium_search))
        .route("/trivium/search-advanced", post(v1_trivium_search_advanced))
        .route("/trivium/search-hybrid", post(v1_trivium_search_hybrid))
        .route("/trivium/filter-where", post(v1_trivium_filter_where))
        .route("/trivium/query", post(v1_trivium_query))
        .route("/trivium/index-text", post(v1_trivium_index_text))
        .route("/trivium/index-keyword", post(v1_trivium_index_keyword))
        .route("/trivium/build-text-index", post(v1_trivium_build_text_index))
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
        .route("/control/jobs/upsert", post(v1_control_job_upsert))
        .route("/control/events/poll", post(v1_control_events_poll))
        .layer(TimeoutLayer::new(Duration::from_secs(REQUEST_TIMEOUT_SECS)))
        .layer(RequestBodyLimitLayer::new(MAX_REQUEST_SIZE))
        .layer(middleware::from_fn_with_state(config.clone(), concurrency_guard))
        .layer(middleware::from_fn_with_state(config.clone(), auth_middleware));

    let app = Router::new()
        .route("/health", get(health_handler))
        .nest("/v1", v1_routes)
        .with_state(config);

    let listener = TcpListener::bind(format!("{host}:{port}")).await?;
    println!("AUTHORITY_CORE_READY {}", listener.local_addr()?);

    axum::serve(listener, app).await?;
    Ok(())
}

type JobRunner = fn(&str, &str, &ControlJobRecord, Arc<AtomicBool>, Option<u64>, i64) -> Result<(), ApiError>;

fn create_runtime_state() -> Arc<RuntimeState> {
    let runtime = Arc::new(RuntimeState {
        job_controls: Mutex::new(HashMap::new()),
        job_queue: JobQueue {
            state: Mutex::new(JobQueueState {
                items: VecDeque::new(),
            }),
            available: Condvar::new(),
        },
        queued_job_count: AtomicU64::new(0),
        request_count: AtomicU64::new(0),
        error_count: AtomicU64::new(0),
        current_concurrency: AtomicU64::new(0),
        concurrency_semaphore: Semaphore::new(MAX_CONCURRENCY),
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

fn enqueue_job_dispatch(runtime: &Arc<RuntimeState>, dispatch: JobDispatch) -> Result<(), ApiError> {
    let mut state = runtime.job_queue.state.lock().map_err(|_| ApiError {
        status_code: 500,
        message: String::from("internal_error: job queue lock poisoned"),
    })?;
    if state.items.len() >= MAX_JOB_QUEUE_SIZE {
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
            let _ = mark_job_failed(&dispatch.db_path, &dispatch.user_handle, &dispatch.job, &error.message);
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

    let run_result = run_job_dispatch(&dispatch, Arc::clone(&control));
    if let Err(error) = run_result {
        let _ = mark_job_failed(&dispatch.db_path, &dispatch.user_handle, &dispatch.job, &error.message);
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
        if matches!(current.status.as_str(), "cancelled" | "completed") || control.load(Ordering::SeqCst) {
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
    Ok(fetch_control_job(&connection, &dispatch.user_handle, &dispatch.job.id)?
        .unwrap_or_else(|| dispatch.job.clone()))
}

fn resolve_job_runner(job_type: &str) -> Option<JobRunner> {
    match job_type {
        "delay" => Some(run_delay_job),
        _ => None,
    }
}

async fn health_handler(State(config): State<Arc<Config>>) -> Json<JsonValue> {
    Json(json!({
        "name": "authority-core",
        "apiVersion": config.api_version,
        "version": config.version,
        "pid": process::id(),
        "startedAt": config.started_at,
        "uptimeMs": runtime_uptime_ms(&config.started_at),
        "requestCount": config.runtime.request_count.load(Ordering::SeqCst),
        "errorCount": config.runtime.error_count.load(Ordering::SeqCst),
        "activeJobCount": active_job_count(&config.runtime),
        "queuedJobCount": config.runtime.queued_job_count.load(Ordering::SeqCst),
        "runtimeMode": "async",
        "maxConcurrency": MAX_CONCURRENCY,
        "currentConcurrency": config.runtime.current_concurrency.load(Ordering::SeqCst),
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
        let token_header = request.headers()
            .get("x-authority-core-token")
            .and_then(|value| value.to_str().ok());
        if token_header != Some(config.token.as_str()) {
            config.runtime.error_count.fetch_add(1, Ordering::SeqCst);
            return Err(ApiError { status_code: 401, message: String::from("unauthorized") });
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
    let permit = config.runtime.concurrency_semaphore.try_acquire();
    if permit.is_err() {
        config.runtime.error_count.fetch_add(1, Ordering::SeqCst);
        return Err(ApiError { status_code: 503, message: String::from("concurrency_limit_exceeded") });
    }
    config.runtime.current_concurrency.fetch_add(1, Ordering::SeqCst);
    let response = next.run(request).await;
    config.runtime.current_concurrency.fetch_sub(1, Ordering::SeqCst);
    drop(permit);
    Ok(response)
}

async fn v1_storage_kv_get(State(_config): State<Arc<Config>>, Json(body): Json<StorageKvGetRequest>) -> Result<Json<JsonValue>, ApiError> { spawn_blocking_handler(body, handle_storage_kv_get).await }
async fn v1_storage_kv_set(State(_config): State<Arc<Config>>, Json(body): Json<StorageKvSetRequest>) -> Result<Json<JsonValue>, ApiError> { spawn_blocking_handler(body, handle_storage_kv_set).await }
async fn v1_storage_kv_delete(State(_config): State<Arc<Config>>, Json(body): Json<StorageKvDeleteRequest>) -> Result<Json<JsonValue>, ApiError> { spawn_blocking_handler(body, handle_storage_kv_delete).await }
async fn v1_storage_kv_list(State(_config): State<Arc<Config>>, Json(body): Json<StorageKvListRequest>) -> Result<Json<JsonValue>, ApiError> { spawn_blocking_handler(body, handle_storage_kv_list).await }
async fn v1_storage_blob_put(State(_config): State<Arc<Config>>, Json(body): Json<StorageBlobPutRequest>) -> Result<Json<JsonValue>, ApiError> { spawn_blocking_handler(body, handle_storage_blob_put).await }
async fn v1_storage_blob_open_read(State(_config): State<Arc<Config>>, Json(body): Json<StorageBlobGetRequest>) -> Result<Json<JsonValue>, ApiError> { spawn_blocking_handler(body, handle_storage_blob_open_read).await }
async fn v1_storage_blob_get(State(_config): State<Arc<Config>>, Json(body): Json<StorageBlobGetRequest>) -> Result<Json<JsonValue>, ApiError> { spawn_blocking_handler(body, handle_storage_blob_get).await }
async fn v1_storage_blob_delete(State(_config): State<Arc<Config>>, Json(body): Json<StorageBlobDeleteRequest>) -> Result<Json<JsonValue>, ApiError> { spawn_blocking_handler(body, handle_storage_blob_delete).await }
async fn v1_storage_blob_list(State(_config): State<Arc<Config>>, Json(body): Json<StorageBlobListRequest>) -> Result<Json<JsonValue>, ApiError> { spawn_blocking_handler(body, handle_storage_blob_list).await }
async fn v1_private_mkdir(State(_config): State<Arc<Config>>, Json(body): Json<PrivateFileMkdirRequest>) -> Result<Json<JsonValue>, ApiError> { spawn_blocking_handler(body, handle_private_file_mkdir).await }
async fn v1_private_read_dir(State(_config): State<Arc<Config>>, Json(body): Json<PrivateFileReadDirRequest>) -> Result<Json<JsonValue>, ApiError> { spawn_blocking_handler(body, handle_private_file_read_dir).await }
async fn v1_private_write(State(_config): State<Arc<Config>>, Json(body): Json<PrivateFileWriteRequest>) -> Result<Json<JsonValue>, ApiError> { spawn_blocking_handler(body, handle_private_file_write).await }
async fn v1_private_open_read(State(_config): State<Arc<Config>>, Json(body): Json<PrivateFileReadRequest>) -> Result<Json<JsonValue>, ApiError> { spawn_blocking_handler(body, handle_private_file_open_read).await }
async fn v1_private_read(State(_config): State<Arc<Config>>, Json(body): Json<PrivateFileReadRequest>) -> Result<Json<JsonValue>, ApiError> { spawn_blocking_handler(body, handle_private_file_read).await }
async fn v1_private_delete(State(_config): State<Arc<Config>>, Json(body): Json<PrivateFileDeleteRequest>) -> Result<Json<JsonValue>, ApiError> { spawn_blocking_handler(body, handle_private_file_delete).await }
async fn v1_private_stat(State(_config): State<Arc<Config>>, Json(body): Json<PrivateFileStatRequest>) -> Result<Json<JsonValue>, ApiError> { spawn_blocking_handler(body, handle_private_file_stat).await }
async fn v1_http_fetch(State(_config): State<Arc<Config>>, Json(body): Json<CoreHttpFetchRequest>) -> Result<Json<JsonValue>, ApiError> { spawn_blocking_handler(body, handle_http_fetch).await }
async fn v1_http_fetch_open(State(_config): State<Arc<Config>>, Json(body): Json<CoreHttpFetchOpenRequest>) -> Result<Json<JsonValue>, ApiError> { spawn_blocking_handler(body, handle_http_fetch_open).await }
async fn v1_sql_query(State(_config): State<Arc<Config>>, Json(body): Json<SqlRequest>) -> Result<Json<JsonValue>, ApiError> { spawn_blocking_handler(body, handle_sql_query).await }
async fn v1_sql_exec(State(_config): State<Arc<Config>>, Json(body): Json<SqlRequest>) -> Result<Json<JsonValue>, ApiError> { spawn_blocking_handler(body, handle_sql_exec).await }
async fn v1_sql_batch(State(_config): State<Arc<Config>>, Json(body): Json<SqlBatchRequest>) -> Result<Json<JsonValue>, ApiError> { spawn_blocking_handler(body, handle_sql_batch).await }
async fn v1_sql_transaction(State(_config): State<Arc<Config>>, Json(body): Json<SqlBatchRequest>) -> Result<Json<JsonValue>, ApiError> { spawn_blocking_handler(body, handle_sql_transaction).await }
async fn v1_sql_migrate(State(_config): State<Arc<Config>>, Json(body): Json<SqlMigrateRequest>) -> Result<Json<JsonValue>, ApiError> { spawn_blocking_handler(body, handle_sql_migrate).await }
async fn v1_trivium_insert(State(_config): State<Arc<Config>>, Json(body): Json<TriviumInsertRequest>) -> Result<Json<JsonValue>, ApiError> { spawn_blocking_handler(body, handle_trivium_insert).await }
async fn v1_trivium_insert_with_id(State(_config): State<Arc<Config>>, Json(body): Json<TriviumInsertWithIdRequest>) -> Result<Json<JsonValue>, ApiError> { spawn_blocking_handler(body, handle_trivium_insert_with_id).await }
async fn v1_trivium_get(State(_config): State<Arc<Config>>, Json(body): Json<TriviumGetRequest>) -> Result<Json<JsonValue>, ApiError> { spawn_blocking_handler(body, handle_trivium_get).await }
async fn v1_trivium_update_payload(State(_config): State<Arc<Config>>, Json(body): Json<TriviumUpdatePayloadRequest>) -> Result<Json<JsonValue>, ApiError> { spawn_blocking_handler(body, handle_trivium_update_payload).await }
async fn v1_trivium_update_vector(State(_config): State<Arc<Config>>, Json(body): Json<TriviumUpdateVectorRequest>) -> Result<Json<JsonValue>, ApiError> { spawn_blocking_handler(body, handle_trivium_update_vector).await }
async fn v1_trivium_delete(State(_config): State<Arc<Config>>, Json(body): Json<TriviumDeleteRequest>) -> Result<Json<JsonValue>, ApiError> { spawn_blocking_handler(body, handle_trivium_delete).await }
async fn v1_trivium_link(State(_config): State<Arc<Config>>, Json(body): Json<TriviumLinkRequest>) -> Result<Json<JsonValue>, ApiError> { spawn_blocking_handler(body, handle_trivium_link).await }
async fn v1_trivium_unlink(State(_config): State<Arc<Config>>, Json(body): Json<TriviumUnlinkRequest>) -> Result<Json<JsonValue>, ApiError> { spawn_blocking_handler(body, handle_trivium_unlink).await }
async fn v1_trivium_neighbors(State(_config): State<Arc<Config>>, Json(body): Json<TriviumNeighborsRequest>) -> Result<Json<JsonValue>, ApiError> { spawn_blocking_handler(body, handle_trivium_neighbors).await }
async fn v1_trivium_search(State(_config): State<Arc<Config>>, Json(body): Json<TriviumSearchRequest>) -> Result<Json<JsonValue>, ApiError> { spawn_blocking_handler(body, handle_trivium_search).await }
async fn v1_trivium_search_advanced(State(_config): State<Arc<Config>>, Json(body): Json<TriviumSearchAdvancedRequest>) -> Result<Json<JsonValue>, ApiError> { spawn_blocking_handler(body, handle_trivium_search_advanced).await }
async fn v1_trivium_search_hybrid(State(_config): State<Arc<Config>>, Json(body): Json<TriviumSearchHybridRequest>) -> Result<Json<JsonValue>, ApiError> { spawn_blocking_handler(body, handle_trivium_search_hybrid).await }
async fn v1_trivium_filter_where(State(_config): State<Arc<Config>>, Json(body): Json<TriviumFilterWhereRequest>) -> Result<Json<JsonValue>, ApiError> { spawn_blocking_handler(body, handle_trivium_filter_where).await }
async fn v1_trivium_query(State(_config): State<Arc<Config>>, Json(body): Json<TriviumQueryRequest>) -> Result<Json<JsonValue>, ApiError> { spawn_blocking_handler(body, handle_trivium_query).await }
async fn v1_trivium_index_text(State(_config): State<Arc<Config>>, Json(body): Json<TriviumIndexTextRequest>) -> Result<Json<JsonValue>, ApiError> { spawn_blocking_handler(body, handle_trivium_index_text).await }
async fn v1_trivium_index_keyword(State(_config): State<Arc<Config>>, Json(body): Json<TriviumIndexKeywordRequest>) -> Result<Json<JsonValue>, ApiError> { spawn_blocking_handler(body, handle_trivium_index_keyword).await }
async fn v1_trivium_build_text_index(State(_config): State<Arc<Config>>, Json(body): Json<TriviumBuildTextIndexRequest>) -> Result<Json<JsonValue>, ApiError> { spawn_blocking_handler(body, handle_trivium_build_text_index).await }
async fn v1_trivium_flush(State(_config): State<Arc<Config>>, Json(body): Json<TriviumFlushRequest>) -> Result<Json<JsonValue>, ApiError> { spawn_blocking_handler(body, handle_trivium_flush).await }
async fn v1_trivium_stat(State(_config): State<Arc<Config>>, Json(body): Json<TriviumStatRequest>) -> Result<Json<JsonValue>, ApiError> { spawn_blocking_handler(body, handle_trivium_stat).await }
async fn v1_control_session_init(State(_config): State<Arc<Config>>, Json(body): Json<ControlSessionInitRequest>) -> Result<Json<JsonValue>, ApiError> { spawn_blocking_handler(body, handle_control_session_init).await }
async fn v1_control_session_get(State(_config): State<Arc<Config>>, Json(body): Json<ControlSessionGetRequest>) -> Result<Json<JsonValue>, ApiError> { spawn_blocking_handler(body, handle_control_session_get).await }
async fn v1_control_extensions_list(State(_config): State<Arc<Config>>, Json(body): Json<ControlExtensionsListRequest>) -> Result<Json<JsonValue>, ApiError> { spawn_blocking_handler(body, handle_control_extensions_list).await }
async fn v1_control_extension_get(State(_config): State<Arc<Config>>, Json(body): Json<ControlExtensionGetRequest>) -> Result<Json<JsonValue>, ApiError> { spawn_blocking_handler(body, handle_control_extension_get).await }
async fn v1_control_audit_log(State(_config): State<Arc<Config>>, Json(body): Json<ControlAuditLogRequest>) -> Result<Json<JsonValue>, ApiError> { spawn_blocking_handler(body, handle_control_audit_log).await }
async fn v1_control_audit_recent(State(_config): State<Arc<Config>>, Json(body): Json<ControlAuditRecentRequest>) -> Result<Json<JsonValue>, ApiError> { spawn_blocking_handler(body, handle_control_audit_recent).await }
async fn v1_control_grants_list(State(_config): State<Arc<Config>>, Json(body): Json<ControlGrantListRequest>) -> Result<Json<JsonValue>, ApiError> { spawn_blocking_handler(body, handle_control_grants_list).await }
async fn v1_control_grant_get(State(_config): State<Arc<Config>>, Json(body): Json<ControlGrantGetRequest>) -> Result<Json<JsonValue>, ApiError> { spawn_blocking_handler(body, handle_control_grant_get).await }
async fn v1_control_grant_upsert(State(_config): State<Arc<Config>>, Json(body): Json<ControlGrantUpsertRequest>) -> Result<Json<JsonValue>, ApiError> { spawn_blocking_handler(body, handle_control_grant_upsert).await }
async fn v1_control_grants_reset(State(_config): State<Arc<Config>>, Json(body): Json<ControlGrantResetRequest>) -> Result<Json<JsonValue>, ApiError> { spawn_blocking_handler(body, handle_control_grants_reset).await }
async fn v1_control_policies_get(State(_config): State<Arc<Config>>, Json(body): Json<ControlPoliciesRequest>) -> Result<Json<JsonValue>, ApiError> { spawn_blocking_handler(body, handle_control_policies_get).await }
async fn v1_control_policies_save(State(_config): State<Arc<Config>>, Json(body): Json<ControlPoliciesSaveRequest>) -> Result<Json<JsonValue>, ApiError> { spawn_blocking_handler(body, handle_control_policies_save).await }
async fn v1_control_jobs_list(State(_config): State<Arc<Config>>, Json(body): Json<ControlJobsListRequest>) -> Result<Json<JsonValue>, ApiError> { spawn_blocking_handler(body, handle_control_jobs_list).await }
async fn v1_control_job_get(State(_config): State<Arc<Config>>, Json(body): Json<ControlJobGetRequest>) -> Result<Json<JsonValue>, ApiError> { spawn_blocking_handler(body, handle_control_job_get).await }
async fn v1_control_job_upsert(State(_config): State<Arc<Config>>, Json(body): Json<ControlJobUpsertRequest>) -> Result<Json<JsonValue>, ApiError> { spawn_blocking_handler(body, handle_control_job_upsert).await }
async fn v1_control_events_poll(State(_config): State<Arc<Config>>, Json(body): Json<ControlEventsPollRequest>) -> Result<Json<JsonValue>, ApiError> { spawn_blocking_handler(body, handle_control_events_poll).await }

async fn v1_control_job_create(State(config): State<Arc<Config>>, Json(body): Json<ControlJobCreateRequest>) -> Result<Json<JsonValue>, ApiError> {
    let runtime = config.runtime.clone();
    let result = tokio::task::spawn_blocking(move || handle_control_job_create(body, &runtime)).await
        .map_err(|_| ApiError { status_code: 500, message: String::from("task_join_error") })?;
    result.map(Json)
}
async fn v1_control_job_cancel(State(config): State<Arc<Config>>, Json(body): Json<ControlJobCancelRequest>) -> Result<Json<JsonValue>, ApiError> {
    let runtime = config.runtime.clone();
    let result = tokio::task::spawn_blocking(move || handle_control_job_cancel(body, &runtime)).await
        .map_err(|_| ApiError { status_code: 500, message: String::from("task_join_error") })?;
    result.map(Json)
}

async fn spawn_blocking_handler<T, F>(body: T, handler: F) -> Result<Json<JsonValue>, ApiError>
where
    T: Send + 'static,
    F: FnOnce(T) -> Result<JsonValue, ApiError> + Send + 'static,
{
    tokio::task::spawn_blocking(move || handler(body))
        .await
        .map_err(|_| ApiError { status_code: 500, message: String::from("task_join_error") })?
        .map(Json)
}

fn handle_sql_query(request: SqlRequest) -> Result<JsonValue, ApiError> {
    let connection = open_connection(&request.db_path)?;
    let result = run_query(&connection, &request.statement, &request.params)?;
    Ok(serde_json::to_value(result).expect("sql query result should serialize"))
}

fn handle_sql_exec(request: SqlRequest) -> Result<JsonValue, ApiError> {
    let connection = open_connection(&request.db_path)?;
    let result = run_exec(&connection, &request.statement, &request.params)?;
    Ok(serde_json::to_value(result).expect("sql exec result should serialize"))
}

fn handle_sql_batch(request: SqlBatchRequest) -> Result<JsonValue, ApiError> {
    let results = execute_transactional_statements(&request.db_path, &request.statements)?;
    Ok(json!({ "results": results }))
}

fn handle_sql_transaction(request: SqlBatchRequest) -> Result<JsonValue, ApiError> {
    let results = execute_transactional_statements(&request.db_path, &request.statements)?;
    let response = SqlTransactionResponse {
        committed: true,
        results,
    };
    Ok(serde_json::to_value(response).expect("sql transaction response should serialize"))
}

fn handle_sql_migrate(request: SqlMigrateRequest) -> Result<JsonValue, ApiError> {
    let table_name = validate_sql_identifier(request.table_name.as_deref().unwrap_or("_authority_migrations"))?;
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
                message: format!("sql migration statement must not be empty for {}", migration_id),
            });
        }

        if applied_ids.contains(migration_id) {
            skipped.push(migration_id.to_string());
            continue;
        }

        transaction.execute_batch(&migration.statement).map_err(to_sql_error)?;
        let insert_statement = format!("INSERT INTO {} (id, applied_at) VALUES (?1, ?2)", table_name);
        transaction
            .execute(&insert_statement, (migration_id, current_timestamp_millis()))
            .map_err(to_sql_error)?;
        applied_ids.insert(migration_id.to_string());
        applied.push(migration_id.to_string());
    }

    transaction.commit().map_err(to_sql_error)?;
    let latest_id = request
        .migrations
        .iter()
        .rev()
        .find_map(|migration| {
            let migration_id = migration.id.trim();
            applied_ids.contains(migration_id).then(|| migration_id.to_string())
        });
    let response = SqlMigrateResponse {
        table_name,
        applied,
        skipped,
        latest_id,
    };
    Ok(serde_json::to_value(response).expect("sql migrate response should serialize"))
}

fn handle_trivium_insert(request: TriviumInsertRequest) -> Result<JsonValue, ApiError> {
    let TriviumInsertRequest { open, vector, payload } = request;
    let id = match parse_trivium_dtype(open.dtype.as_deref())? {
        TriviumDTypeTag::F32 => {
            let mut db = open_trivium_f32(&open)?;
            db.insert(&vector.iter().map(|&value| value as f32).collect::<Vec<_>>(), payload).map_err(to_trivium_error)?
        }
        TriviumDTypeTag::F16 => {
            let mut db = open_trivium_f16(&open)?;
            db.insert(&vector.iter().map(|&value| f16::from_f64(value)).collect::<Vec<_>>(), payload).map_err(to_trivium_error)?
        }
        TriviumDTypeTag::U64 => {
            let mut db = open_trivium_u64(&open)?;
            db.insert(&vector.iter().map(|&value| value as u64).collect::<Vec<_>>(), payload).map_err(to_trivium_error)?
        }
    };

    Ok(serde_json::to_value(TriviumInsertResponse { id }).expect("trivium insert response should serialize"))
}

fn handle_trivium_insert_with_id(request: TriviumInsertWithIdRequest) -> Result<JsonValue, ApiError> {
    let TriviumInsertWithIdRequest { open, id, vector, payload } = request;
    match parse_trivium_dtype(open.dtype.as_deref())? {
        TriviumDTypeTag::F32 => {
            let mut db = open_trivium_f32(&open)?;
            db.insert_with_id(id, &vector.iter().map(|&value| value as f32).collect::<Vec<_>>(), payload).map_err(to_trivium_error)?;
        }
        TriviumDTypeTag::F16 => {
            let mut db = open_trivium_f16(&open)?;
            db.insert_with_id(id, &vector.iter().map(|&value| f16::from_f64(value)).collect::<Vec<_>>(), payload).map_err(to_trivium_error)?;
        }
        TriviumDTypeTag::U64 => {
            let mut db = open_trivium_u64(&open)?;
            db.insert_with_id(id, &vector.iter().map(|&value| value as u64).collect::<Vec<_>>(), payload).map_err(to_trivium_error)?;
        }
    }

    Ok(json!({ "ok": true }))
}

fn handle_trivium_get(request: TriviumGetRequest) -> Result<JsonValue, ApiError> {
    let TriviumGetRequest { open, id } = request;
    let node = match parse_trivium_dtype(open.dtype.as_deref())? {
        TriviumDTypeTag::F32 => open_trivium_f32(&open)?.get(id).map(|node| map_trivium_node(node, |value| value as f64)),
        TriviumDTypeTag::F16 => open_trivium_f16(&open)?.get(id).map(|node| map_trivium_node(node, |value| value.to_f64())),
        TriviumDTypeTag::U64 => open_trivium_u64(&open)?.get(id).map(|node| map_trivium_node(node, |value| value as f64)),
    };
    Ok(json!({ "node": node }))
}

fn handle_trivium_update_payload(request: TriviumUpdatePayloadRequest) -> Result<JsonValue, ApiError> {
    let TriviumUpdatePayloadRequest { open, id, payload } = request;
    match parse_trivium_dtype(open.dtype.as_deref())? {
        TriviumDTypeTag::F32 => open_trivium_f32(&open)?.update_payload(id, payload).map_err(to_trivium_error)?,
        TriviumDTypeTag::F16 => open_trivium_f16(&open)?.update_payload(id, payload).map_err(to_trivium_error)?,
        TriviumDTypeTag::U64 => open_trivium_u64(&open)?.update_payload(id, payload).map_err(to_trivium_error)?,
    }
    Ok(json!({ "ok": true }))
}

fn handle_trivium_update_vector(request: TriviumUpdateVectorRequest) -> Result<JsonValue, ApiError> {
    let TriviumUpdateVectorRequest { open, id, vector } = request;
    match parse_trivium_dtype(open.dtype.as_deref())? {
        TriviumDTypeTag::F32 => {
            open_trivium_f32(&open)?.update_vector(id, &vector.iter().map(|&value| value as f32).collect::<Vec<_>>()).map_err(to_trivium_error)?;
        }
        TriviumDTypeTag::F16 => {
            open_trivium_f16(&open)?.update_vector(id, &vector.iter().map(|&value| f16::from_f64(value)).collect::<Vec<_>>()).map_err(to_trivium_error)?;
        }
        TriviumDTypeTag::U64 => {
            open_trivium_u64(&open)?.update_vector(id, &vector.iter().map(|&value| value as u64).collect::<Vec<_>>()).map_err(to_trivium_error)?;
        }
    }
    Ok(json!({ "ok": true }))
}

fn handle_trivium_delete(request: TriviumDeleteRequest) -> Result<JsonValue, ApiError> {
    let TriviumDeleteRequest { open, id } = request;
    match parse_trivium_dtype(open.dtype.as_deref())? {
        TriviumDTypeTag::F32 => open_trivium_f32(&open)?.delete(id).map_err(to_trivium_error)?,
        TriviumDTypeTag::F16 => open_trivium_f16(&open)?.delete(id).map_err(to_trivium_error)?,
        TriviumDTypeTag::U64 => open_trivium_u64(&open)?.delete(id).map_err(to_trivium_error)?,
    }
    Ok(json!({ "ok": true }))
}

fn handle_trivium_link(request: TriviumLinkRequest) -> Result<JsonValue, ApiError> {
    let TriviumLinkRequest { open, src, dst, label, weight } = request;
    let label = label.unwrap_or_else(|| String::from("related"));
    let weight = weight.unwrap_or(1.0) as f32;
    match parse_trivium_dtype(open.dtype.as_deref())? {
        TriviumDTypeTag::F32 => open_trivium_f32(&open)?.link(src, dst, &label, weight).map_err(to_trivium_error)?,
        TriviumDTypeTag::F16 => open_trivium_f16(&open)?.link(src, dst, &label, weight).map_err(to_trivium_error)?,
        TriviumDTypeTag::U64 => open_trivium_u64(&open)?.link(src, dst, &label, weight).map_err(to_trivium_error)?,
    }
    Ok(json!({ "ok": true }))
}

fn handle_trivium_unlink(request: TriviumUnlinkRequest) -> Result<JsonValue, ApiError> {
    let TriviumUnlinkRequest { open, src, dst } = request;
    match parse_trivium_dtype(open.dtype.as_deref())? {
        TriviumDTypeTag::F32 => open_trivium_f32(&open)?.unlink(src, dst).map_err(to_trivium_error)?,
        TriviumDTypeTag::F16 => open_trivium_f16(&open)?.unlink(src, dst).map_err(to_trivium_error)?,
        TriviumDTypeTag::U64 => open_trivium_u64(&open)?.unlink(src, dst).map_err(to_trivium_error)?,
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
    Ok(serde_json::to_value(TriviumNeighborsResponse { ids }).expect("trivium neighbors response should serialize"))
}

fn handle_trivium_search(request: TriviumSearchRequest) -> Result<JsonValue, ApiError> {
    let TriviumSearchRequest { open, vector, top_k, expand_depth, min_score } = request;
    let top_k = top_k.unwrap_or(5);
    let expand_depth = expand_depth.unwrap_or(0);
    let min_score = min_score.unwrap_or(0.5);
    let hits = match parse_trivium_dtype(open.dtype.as_deref())? {
        TriviumDTypeTag::F32 => open_trivium_f32(&open)?.search(&vector.iter().map(|&value| value as f32).collect::<Vec<_>>(), top_k, expand_depth, min_score).map_err(to_trivium_error)?,
        TriviumDTypeTag::F16 => open_trivium_f16(&open)?.search(&vector.iter().map(|&value| f16::from_f64(value)).collect::<Vec<_>>(), top_k, expand_depth, min_score).map_err(to_trivium_error)?,
        TriviumDTypeTag::U64 => open_trivium_u64(&open)?.search(&vector.iter().map(|&value| value as u64).collect::<Vec<_>>(), top_k, expand_depth, min_score).map_err(to_trivium_error)?,
    };
    let hits: Vec<TriviumSearchHit> = hits.into_iter().map(map_trivium_search_hit).collect();
    Ok(json!({ "hits": hits }))
}

fn handle_trivium_search_advanced(request: TriviumSearchAdvancedRequest) -> Result<JsonValue, ApiError> {
    if let Some(value) = request.query_text.as_deref() {
        validate_non_empty("queryText", value)?;
    }

    let config = build_trivium_advanced_search_config(&request)?;
    let query_text = request.query_text.as_deref();
    let hits = match parse_trivium_dtype(request.open.dtype.as_deref())? {
        TriviumDTypeTag::F32 => open_trivium_f32(&request.open)?
            .search_hybrid(query_text, Some(&request.vector.iter().map(|&value| value as f32).collect::<Vec<_>>()), &config)
            .map_err(to_trivium_error)?,
        TriviumDTypeTag::F16 => open_trivium_f16(&request.open)?
            .search_hybrid(query_text, Some(&request.vector.iter().map(|&value| f16::from_f64(value)).collect::<Vec<_>>()), &config)
            .map_err(to_trivium_error)?,
        TriviumDTypeTag::U64 => open_trivium_u64(&request.open)?
            .search_hybrid(query_text, Some(&request.vector.iter().map(|&value| value as u64).collect::<Vec<_>>()), &config)
            .map_err(to_trivium_error)?,
    };
    let hits: Vec<TriviumSearchHit> = hits.into_iter().map(map_trivium_search_hit).collect();
    Ok(json!({ "hits": hits }))
}

fn handle_trivium_search_hybrid(request: TriviumSearchHybridRequest) -> Result<JsonValue, ApiError> {
    validate_non_empty("queryText", &request.query_text)?;

    let config = build_trivium_hybrid_search_config(&request)?;
    let hits = match parse_trivium_dtype(request.open.dtype.as_deref())? {
        TriviumDTypeTag::F32 => open_trivium_f32(&request.open)?
            .search_hybrid(Some(&request.query_text), Some(&request.vector.iter().map(|&value| value as f32).collect::<Vec<_>>()), &config)
            .map_err(to_trivium_error)?,
        TriviumDTypeTag::F16 => open_trivium_f16(&request.open)?
            .search_hybrid(Some(&request.query_text), Some(&request.vector.iter().map(|&value| f16::from_f64(value)).collect::<Vec<_>>()), &config)
            .map_err(to_trivium_error)?,
        TriviumDTypeTag::U64 => open_trivium_u64(&request.open)?
            .search_hybrid(Some(&request.query_text), Some(&request.vector.iter().map(|&value| value as u64).collect::<Vec<_>>()), &config)
            .map_err(to_trivium_error)?,
    };
    let hits: Vec<TriviumSearchHit> = hits.into_iter().map(map_trivium_search_hit).collect();
    Ok(json!({ "hits": hits }))
}

fn handle_trivium_filter_where(request: TriviumFilterWhereRequest) -> Result<JsonValue, ApiError> {
    let filter = parse_trivium_filter_condition(&request.condition)?;
    let nodes = match parse_trivium_dtype(request.open.dtype.as_deref())? {
        TriviumDTypeTag::F32 => open_trivium_f32(&request.open)?
            .filter_where(&filter)
            .into_iter()
            .map(|node| map_trivium_node(node, |value| value as f64))
            .collect(),
        TriviumDTypeTag::F16 => open_trivium_f16(&request.open)?
            .filter_where(&filter)
            .into_iter()
            .map(|node| map_trivium_node(node, |value| value.to_f64()))
            .collect(),
        TriviumDTypeTag::U64 => open_trivium_u64(&request.open)?
            .filter_where(&filter)
            .into_iter()
            .map(|node| map_trivium_node(node, |value| value as f64))
            .collect(),
    };

    Ok(serde_json::to_value(TriviumFilterWhereResponse { nodes }).expect("trivium filter where response should serialize"))
}

fn handle_trivium_query(request: TriviumQueryRequest) -> Result<JsonValue, ApiError> {
    validate_non_empty("cypher", &request.cypher)?;

    let rows = match parse_trivium_dtype(request.open.dtype.as_deref())? {
        TriviumDTypeTag::F32 => map_trivium_query_rows(
            open_trivium_f32(&request.open)?.query(&request.cypher).map_err(to_trivium_error)?,
            |value| value as f64,
        ),
        TriviumDTypeTag::F16 => map_trivium_query_rows(
            open_trivium_f16(&request.open)?.query(&request.cypher).map_err(to_trivium_error)?,
            |value| value.to_f64(),
        ),
        TriviumDTypeTag::U64 => map_trivium_query_rows(
            open_trivium_u64(&request.open)?.query(&request.cypher).map_err(to_trivium_error)?,
            |value| value as f64,
        ),
    };

    Ok(serde_json::to_value(TriviumQueryResponse { rows }).expect("trivium query response should serialize"))
}

fn handle_trivium_index_text(request: TriviumIndexTextRequest) -> Result<JsonValue, ApiError> {
    validate_non_empty("text", &request.text)?;

    match parse_trivium_dtype(request.open.dtype.as_deref())? {
        TriviumDTypeTag::F32 => {
            let mut db = open_trivium_f32(&request.open)?;
            db.index_text(request.id, &request.text).map_err(to_trivium_error)?;
        }
        TriviumDTypeTag::F16 => {
            let mut db = open_trivium_f16(&request.open)?;
            db.index_text(request.id, &request.text).map_err(to_trivium_error)?;
        }
        TriviumDTypeTag::U64 => {
            let mut db = open_trivium_u64(&request.open)?;
            db.index_text(request.id, &request.text).map_err(to_trivium_error)?;
        }
    }

    Ok(json!({ "ok": true }))
}

fn handle_trivium_index_keyword(request: TriviumIndexKeywordRequest) -> Result<JsonValue, ApiError> {
    validate_non_empty("keyword", &request.keyword)?;

    match parse_trivium_dtype(request.open.dtype.as_deref())? {
        TriviumDTypeTag::F32 => {
            let mut db = open_trivium_f32(&request.open)?;
            db.index_keyword(request.id, &request.keyword).map_err(to_trivium_error)?;
        }
        TriviumDTypeTag::F16 => {
            let mut db = open_trivium_f16(&request.open)?;
            db.index_keyword(request.id, &request.keyword).map_err(to_trivium_error)?;
        }
        TriviumDTypeTag::U64 => {
            let mut db = open_trivium_u64(&request.open)?;
            db.index_keyword(request.id, &request.keyword).map_err(to_trivium_error)?;
        }
    }

    Ok(json!({ "ok": true }))
}

fn handle_trivium_build_text_index(request: TriviumBuildTextIndexRequest) -> Result<JsonValue, ApiError> {
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
            estimated_memory_bytes: 0,
            record,
        };
        return Ok(serde_json::to_value(response).expect("trivium stat response should serialize"));
    }

    let (node_count, estimated_memory_bytes) = match dtype {
        TriviumDTypeTag::F32 => {
            let db = open_trivium_f32(&open)?;
            (db.node_count(), db.estimated_memory())
        }
        TriviumDTypeTag::F16 => {
            let db = open_trivium_f16(&open)?;
            (db.node_count(), db.estimated_memory())
        }
        TriviumDTypeTag::U64 => {
            let db = open_trivium_u64(&open)?;
            (db.node_count(), db.estimated_memory())
        }
    };
    record.dim = detected_dim.or(record.dim);

    let response = TriviumStatResponse {
        database,
        file_path: open.db_path,
        exists: true,
        node_count,
        estimated_memory_bytes,
        record,
    };
    Ok(serde_json::to_value(response).expect("trivium stat response should serialize"))
}

fn handle_control_session_init(request: ControlSessionInitRequest) -> Result<JsonValue, ApiError> {
    validate_non_empty("sessionToken", &request.session_token)?;
    validate_non_empty("timestamp", &request.timestamp)?;
    validate_non_empty("user.handle", &request.user.handle)?;
    validate_non_empty("config.extensionId", &request.config.extension_id)?;

    let connection = open_connection(&request.db_path)?;
    ensure_control_schema(&connection)?;
    let current_extension = fetch_control_extension(&connection, &request.user.handle, &request.config.extension_id)?;
    let first_seen_at = current_extension
        .as_ref()
        .map(|extension| extension.first_seen_at.clone())
        .unwrap_or_else(|| request.timestamp.clone());
    let declared_permissions = serde_json::to_string(&request.config.declared_permissions).map_err(to_json_error)?;

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

    let extension = fetch_control_extension(&connection, &request.user.handle, &request.config.extension_id)?
        .ok_or_else(|| ApiError {
            status_code: 500,
            message: String::from("control extension was not persisted"),
        })?;
    let session_declared_permissions = serde_json::to_string(&extension.declared_permissions).map_err(to_json_error)?;

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

fn handle_control_extensions_list(request: ControlExtensionsListRequest) -> Result<JsonValue, ApiError> {
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

fn handle_control_extension_get(request: ControlExtensionGetRequest) -> Result<JsonValue, ApiError> {
    validate_non_empty("userHandle", &request.user_handle)?;
    validate_non_empty("extensionId", &request.extension_id)?;

    let connection = open_connection(&request.db_path)?;
    ensure_control_schema(&connection)?;
    let extension = fetch_control_extension(&connection, &request.user_handle, &request.extension_id)?;
    Ok(json!({ "extension": extension }))
}

fn handle_control_audit_log(request: ControlAuditLogRequest) -> Result<JsonValue, ApiError> {
    validate_non_empty("userHandle", &request.user_handle)?;
    validate_audit_record(&request.record)?;

    let connection = open_connection(&request.db_path)?;
    ensure_control_schema(&connection)?;
    let details = match &request.record.details {
        Some(value) => Some(serde_json::to_string(value).map_err(to_json_error)?),
        None => None,
    };
    connection.execute(
        "INSERT INTO authority_audit (user_handle, timestamp, kind, extension_id, message, details)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![
            &request.user_handle,
            &request.record.timestamp,
            &request.record.kind,
            &request.record.extension_id,
            &request.record.message,
            &details,
        ],
    ).map_err(to_sql_error)?;
    Ok(json!({ "ok": true }))
}

fn handle_control_audit_recent(request: ControlAuditRecentRequest) -> Result<JsonValue, ApiError> {
    validate_non_empty("userHandle", &request.user_handle)?;
    validate_non_empty("extensionId", &request.extension_id)?;

    let connection = open_connection(&request.db_path)?;
    ensure_control_schema(&connection)?;
    let limit = request.limit.unwrap_or(50).clamp(1, 500);
    let permissions = fetch_recent_audit_records(&connection, &request.user_handle, &request.extension_id, "permission", limit)?;
    let usage = fetch_recent_audit_records(&connection, &request.user_handle, &request.extension_id, "usage", limit)?;
    let errors = fetch_recent_audit_records(&connection, &request.user_handle, &request.extension_id, "error", limit)?;
    Ok(json!({
        "permissions": permissions,
        "usage": usage,
        "errors": errors,
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
    let grant = fetch_control_grant(&connection, &request.user_handle, &request.extension_id, &request.key)?;
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
            connection.execute(
                "DELETE FROM authority_grants WHERE user_handle = ?1 AND extension_id = ?2",
                params![&request.user_handle, &request.extension_id],
            ).map_err(to_sql_error)?;
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

fn handle_control_policies_save(request: ControlPoliciesSaveRequest) -> Result<JsonValue, ApiError> {
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

    document.updated_at = current_timestamp_iso();
    save_control_policies_document(&connection, &document)?;
    Ok(serde_json::to_value(document).expect("control policies document should serialize"))
}

fn handle_control_jobs_list(request: ControlJobsListRequest) -> Result<JsonValue, ApiError> {
    validate_non_empty("userHandle", &request.user_handle)?;

    let connection = open_connection(&request.db_path)?;
    ensure_control_schema(&connection)?;
    let jobs = fetch_control_jobs(&connection, &request.user_handle, request.extension_id.as_deref())?;
    Ok(json!({ "jobs": jobs }))
}

fn handle_control_job_get(request: ControlJobGetRequest) -> Result<JsonValue, ApiError> {
    validate_non_empty("userHandle", &request.user_handle)?;
    validate_non_empty("jobId", &request.job_id)?;

    let connection = open_connection(&request.db_path)?;
    ensure_control_schema(&connection)?;
    let job = fetch_control_job(&connection, &request.user_handle, &request.job_id)?;
    Ok(json!({ "job": job }))
}

fn handle_control_job_upsert(request: ControlJobUpsertRequest) -> Result<JsonValue, ApiError> {
    validate_non_empty("userHandle", &request.user_handle)?;
    validate_job_record(&request.job)?;

    let connection = open_connection(&request.db_path)?;
    ensure_control_schema(&connection)?;
    let payload = match &request.job.payload {
        Some(value) => Some(serde_json::to_string(value).map_err(to_json_error)?),
        None => None,
    };
    let result = match &request.job.result {
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
            &request.user_handle,
            &request.job.id,
            &request.job.extension_id,
            &request.job.job_type,
            &request.job.status,
            &request.job.created_at,
            &request.job.updated_at,
            request.job.progress,
            &request.job.summary,
            &request.job.error,
            &payload,
            &result,
            &request.job.channel,
            &request.job.started_at,
            &request.job.finished_at,
            &request.job.timeout_ms,
            &request.job.idempotency_key,
            request.job.attempt,
            &request.job.max_attempts,
            &request.job.cancel_requested_at,
        ],
    ).map_err(to_sql_error)?;
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
    connection.execute(
        "INSERT INTO kv_entries (key, value, updated_at)
         VALUES (?1, ?2, ?3)
         ON CONFLICT(key) DO UPDATE SET
            value = excluded.value,
            updated_at = excluded.updated_at",
        params![&request.key, &serialized, current_timestamp_iso()],
    ).map_err(to_sql_error)?;
    Ok(json!({ "ok": true }))
}

fn handle_storage_kv_delete(request: StorageKvDeleteRequest) -> Result<JsonValue, ApiError> {
    validate_non_empty("key", &request.key)?;

    let connection = open_connection(&request.db_path)?;
    ensure_kv_schema(&connection)?;
    connection
        .execute("DELETE FROM kv_entries WHERE key = ?1", params![&request.key])
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
        content_type: request.content_type.unwrap_or_else(|| String::from("application/octet-stream")),
        size: size_bytes as i64,
        updated_at: current_timestamp_iso(),
    };
    upsert_blob_record(&connection, &request.user_handle, &request.extension_id, &record)?;
    Ok(serde_json::to_value(record).expect("blob record should serialize"))
}

fn handle_storage_blob_get(request: StorageBlobGetRequest) -> Result<JsonValue, ApiError> {
    validate_non_empty("userHandle", &request.user_handle)?;
    validate_non_empty("extensionId", &request.extension_id)?;
    validate_non_empty("blobDir", &request.blob_dir)?;
    validate_non_empty("id", &request.id)?;

    let connection = open_connection(&request.db_path)?;
    ensure_control_schema(&connection)?;
    let record = fetch_blob_record(&connection, &request.user_handle, &request.extension_id, &request.id)?
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
    }).expect("blob get response should serialize"))
}

fn handle_storage_blob_open_read(request: StorageBlobGetRequest) -> Result<JsonValue, ApiError> {
    validate_non_empty("userHandle", &request.user_handle)?;
    validate_non_empty("extensionId", &request.extension_id)?;
    validate_non_empty("blobDir", &request.blob_dir)?;
    validate_non_empty("id", &request.id)?;

    let connection = open_connection(&request.db_path)?;
    ensure_control_schema(&connection)?;
    let record = fetch_blob_record(&connection, &request.user_handle, &request.extension_id, &request.id)?
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
    }).expect("blob open read response should serialize"))
}

fn handle_storage_blob_delete(request: StorageBlobDeleteRequest) -> Result<JsonValue, ApiError> {
    validate_non_empty("userHandle", &request.user_handle)?;
    validate_non_empty("extensionId", &request.extension_id)?;
    validate_non_empty("blobDir", &request.blob_dir)?;
    validate_non_empty("id", &request.id)?;

    let connection = open_connection(&request.db_path)?;
    ensure_control_schema(&connection)?;
    delete_blob_record(&connection, &request.user_handle, &request.extension_id, &request.id)?;
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
        return Ok(serde_json::to_value(PrivateFileResponse { entry }).expect("private file response should serialize"));
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
    Ok(serde_json::to_value(PrivateFileResponse { entry }).expect("private file response should serialize"))
}

fn handle_private_file_read_dir(request: PrivateFileReadDirRequest) -> Result<JsonValue, ApiError> {
    validate_non_empty("rootDir", &request.root_dir)?;
    let root_dir = PathBuf::from(&request.root_dir);
    let (target_path, virtual_path) = resolve_private_path(&root_dir, &request.path)?;
    ensure_private_path_components_safe(&root_dir, &virtual_path)?;

    if !target_path.exists() {
        if virtual_path == "/" {
            return Ok(serde_json::to_value(PrivateFileListResponse { entries: Vec::new() }).expect("private file list should serialize"));
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

    let limit = request.limit.unwrap_or(MAX_PRIVATE_READ_DIR_LIMIT).min(MAX_PRIVATE_READ_DIR_LIMIT);
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
    Ok(serde_json::to_value(PrivateFileListResponse { entries }).expect("private file list should serialize"))
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
    Ok(serde_json::to_value(PrivateFileResponse { entry }).expect("private file response should serialize"))
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
    }).expect("private file read response should serialize"))
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
    }).expect("private file open read response should serialize"))
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
    Ok(serde_json::to_value(PrivateFileResponse { entry }).expect("private file response should serialize"))
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
            message: format!("HTTP request body exceeds {} bytes", MAX_HTTP_INLINE_BODY_BYTES),
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
    }).expect("http fetch response should serialize"))
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
    }).expect("http fetch open response should serialize"))
}

fn handle_control_job_create(request: ControlJobCreateRequest, runtime: &Arc<RuntimeState>) -> Result<JsonValue, ApiError> {
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
        let rejected = ControlJobRecord {
            status: String::from("failed"),
            updated_at: current_timestamp_iso(),
            finished_at: Some(current_timestamp_iso()),
            summary: Some(String::from("Job rejected by worker queue")),
            error: Some(error.message.clone()),
            ..job.clone()
        };
        save_control_job_record(&connection, &request.user_handle, &rejected)?;
        publish_control_event(
            &connection,
            &request.user_handle,
            Some(&request.extension_id),
            &rejected.channel,
            "authority.job",
            Some(&serde_json::to_value(&rejected).map_err(to_json_error)?),
        )?;
        return Err(error);
    }

    Ok(json!({ "job": job }))
}

fn handle_control_job_cancel(request: ControlJobCancelRequest, runtime: &Arc<RuntimeState>) -> Result<JsonValue, ApiError> {
    validate_non_empty("userHandle", &request.user_handle)?;
    validate_non_empty("extensionId", &request.extension_id)?;
    validate_non_empty("jobId", &request.job_id)?;

    let connection = open_connection(&request.db_path)?;
    ensure_control_schema(&connection)?;
    let job = fetch_control_job(&connection, &request.user_handle, &request.job_id)?
        .ok_or_else(|| ApiError {
            status_code: 400,
            message: String::from("Job not found"),
        })?;
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

    let next = ControlJobRecord {
        status: String::from("cancelled"),
        updated_at: current_timestamp_iso(),
        cancel_requested_at: Some(current_timestamp_iso()),
        summary: Some(String::from("Cancelled by user")),
        ..job
    };
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

fn handle_control_events_poll(request: ControlEventsPollRequest) -> Result<JsonValue, ApiError> {
    validate_non_empty("userHandle", &request.user_handle)?;
    validate_non_empty("channel", &request.channel)?;

    let connection = open_connection(&request.db_path)?;
    ensure_control_schema(&connection)?;
    if let Some(after_id) = request.after_id {
        let limit = request.limit.unwrap_or(50).min(MAX_EVENT_POLL_LIMIT);
        let events = fetch_control_events(&connection, &request.user_handle, &request.channel, after_id, limit)?;
        let cursor = events.last().map(|event| event.id).unwrap_or(after_id);
        Ok(json!({ "events": events, "cursor": cursor }))
    } else {
        let cursor = fetch_latest_control_event_id(&connection, &request.user_handle, &request.channel)?;
        Ok(json!({ "events": [], "cursor": cursor }))
    }
}

fn execute_transactional_statements(db_path: &str, statements: &[SqlBatchStatement]) -> Result<Vec<JsonValue>, ApiError> {
    if statements.is_empty() {
        return Err(ApiError {
            status_code: 400,
            message: String::from("sql batch requires at least one statement"),
        });
    }

    let mut connection = open_connection(db_path)?;
    let transaction = connection.transaction().map_err(to_sql_error)?;
    let mut results = Vec::with_capacity(statements.len());

    for statement in statements {
        let result = match statement.mode {
            SqlStatementMode::Query => {
                let value = run_query(&transaction, &statement.statement, &statement.params)?;
                serde_json::to_value(value).expect("sql batch query result should serialize")
            }
            SqlStatementMode::Exec => {
                let value = run_exec(&transaction, &statement.statement, &statement.params)?;
                serde_json::to_value(value).expect("sql batch exec result should serialize")
            }
        };
        results.push(result);
    }

    transaction.commit().map_err(to_sql_error)?;
    Ok(results)
}

fn run_query(connection: &Connection, statement_text: &str, params: &[JsonValue]) -> Result<SqlQueryResult, ApiError> {
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
    })
}

fn run_exec(connection: &Connection, statement_text: &str, params: &[JsonValue]) -> Result<SqlExecResult, ApiError> {
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
        .busy_timeout(Duration::from_secs(5))
        .map_err(to_sql_error)?;
    connection
        .execute_batch("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;")
        .map_err(to_sql_error)?;
    Ok(connection)
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
    Ok(TriviumConfig {
        dim: request.dim.unwrap_or(1536),
        sync_mode: parse_trivium_sync_mode(request.sync_mode.as_deref())?,
        storage_mode: parse_trivium_storage_mode(request.storage_mode.as_deref())?,
    })
}

fn open_trivium_f32(request: &TriviumOpenRequest) -> Result<TriviumDatabase<f32>, ApiError> {
    TriviumDatabase::<f32>::open_with_config(&request.db_path, build_trivium_config(request)?).map_err(to_trivium_error)
}

fn open_trivium_f16(request: &TriviumOpenRequest) -> Result<TriviumDatabase<f16>, ApiError> {
    TriviumDatabase::<f16>::open_with_config(&request.db_path, build_trivium_config(request)?).map_err(to_trivium_error)
}

fn open_trivium_u64(request: &TriviumOpenRequest) -> Result<TriviumDatabase<u64>, ApiError> {
    TriviumDatabase::<u64>::open_with_config(&request.db_path, build_trivium_config(request)?).map_err(to_trivium_error)
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

fn build_trivium_advanced_search_config(request: &TriviumSearchAdvancedRequest) -> Result<TriviumSearchConfig, ApiError> {
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
        payload_filter: request.payload_filter.as_ref().map(parse_trivium_filter_condition).transpose()?,
    })
}

fn build_trivium_hybrid_search_config(request: &TriviumSearchHybridRequest) -> Result<TriviumSearchConfig, ApiError> {
    let hybrid_alpha = request.hybrid_alpha.unwrap_or(0.7);
    Ok(TriviumSearchConfig {
        top_k: request.top_k.unwrap_or(5),
        expand_depth: request.expand_depth.unwrap_or(2),
        min_score: request.min_score.unwrap_or(0.1),
        text_boost: (1.0 - hybrid_alpha).max(0.1) * 3.0,
        enable_text_hybrid_search: true,
        payload_filter: request.payload_filter.as_ref().map(parse_trivium_filter_condition).transpose()?,
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

fn parse_trivium_filter_object(object: &JsonMap<String, JsonValue>) -> Result<TriviumFilter, ApiError> {
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
                            message: String::from("trivium filter $size requires a non-negative integer"),
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
                        operand.as_str().ok_or_else(|| ApiError {
                            status_code: 400,
                            message: String::from("trivium filter $type requires a string"),
                        })?.to_string(),
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
        Ok(filters.pop().expect("trivium filter should contain one item"))
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
    Some(u32::from_le_bytes([header[6], header[7], header[8], header[9]]) as usize)
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
    let size_bytes = main_metadata.as_ref().map(|metadata| metadata.len()).unwrap_or(0);
    let wal_size_bytes = wal_metadata.as_ref().map(|metadata| metadata.len()).unwrap_or(0);
    let vec_size_bytes = vec_metadata.as_ref().map(|metadata| metadata.len()).unwrap_or(0);
    let actual_storage_mode = if main_metadata.is_some() {
        Some(if vec_metadata.is_some() { String::from("mmap") } else { String::from("rom") })
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
    connection.execute_batch(
        "CREATE TABLE IF NOT EXISTS kv_entries (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );",
    ).map_err(to_sql_error)
}

fn fetch_control_extension(connection: &Connection, user_handle: &str, extension_id: &str) -> Result<Option<ControlExtensionRecord>, ApiError> {
    let mut statement = connection.prepare(
        "SELECT extension_id, install_type, display_name, version, first_seen_at, last_seen_at, declared_permissions, ui_label
         FROM authority_extensions
         WHERE user_handle = ?1 AND extension_id = ?2",
    ).map_err(to_sql_error)?;
    statement
        .query_row(params![user_handle, extension_id], control_extension_from_row)
        .optional()
        .map_err(to_sql_error)
}

fn fetch_control_session(connection: &Connection, user_handle: &str, session_token: &str) -> Result<Option<ControlSessionSnapshot>, ApiError> {
    let mut statement = connection.prepare(
        "SELECT token, user_handle, is_admin, extension_id, install_type, display_name, version, first_seen_at, created_at, declared_permissions
         FROM authority_sessions
         WHERE user_handle = ?1 AND token = ?2",
    ).map_err(to_sql_error)?;
    statement
        .query_row(params![user_handle, session_token], control_session_from_row)
        .optional()
        .map_err(to_sql_error)
}

fn control_extension_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<ControlExtensionRecord> {
    let declared_permissions_text: String = row.get(6)?;
    let declared_permissions = serde_json::from_str(&declared_permissions_text).unwrap_or_else(|_| json!({}));
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
    let declared_permissions = serde_json::from_str(&declared_permissions_text).unwrap_or_else(|_| json!({}));
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

fn fetch_recent_audit_records(connection: &Connection, user_handle: &str, extension_id: &str, kind: &str, limit: usize) -> Result<Vec<ControlAuditRecord>, ApiError> {
    let mut statement = connection.prepare(
        "SELECT timestamp, kind, extension_id, message, details
         FROM authority_audit
         WHERE user_handle = ?1 AND extension_id = ?2 AND kind = ?3
         ORDER BY timestamp DESC, id DESC
         LIMIT ?4",
    ).map_err(to_sql_error)?;
    let rows = statement
        .query_map(params![user_handle, extension_id, kind, limit as i64], control_audit_from_row)
        .map_err(to_sql_error)?;
    let mut records = Vec::new();
    for row in rows {
        records.push(row.map_err(to_sql_error)?);
    }
    Ok(records)
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

fn fetch_control_grants(connection: &Connection, user_handle: &str, extension_id: &str) -> Result<Vec<ControlGrantRecord>, ApiError> {
    let mut statement = connection.prepare(
        "SELECT key, resource, target, status, scope, risk_level, updated_at, source, choice
         FROM authority_grants
         WHERE user_handle = ?1 AND extension_id = ?2
         ORDER BY updated_at DESC, key ASC",
    ).map_err(to_sql_error)?;
    let rows = statement
        .query_map(params![user_handle, extension_id], control_grant_from_row)
        .map_err(to_sql_error)?;
    let mut grants = Vec::new();
    for row in rows {
        grants.push(row.map_err(to_sql_error)?);
    }
    Ok(grants)
}

fn fetch_control_grant(connection: &Connection, user_handle: &str, extension_id: &str, key: &str) -> Result<Option<ControlGrantRecord>, ApiError> {
    let mut statement = connection.prepare(
        "SELECT key, resource, target, status, scope, risk_level, updated_at, source, choice
         FROM authority_grants
         WHERE user_handle = ?1 AND extension_id = ?2 AND key = ?3",
    ).map_err(to_sql_error)?;
    statement
        .query_row(params![user_handle, extension_id, key], control_grant_from_row)
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

fn fetch_control_policies_document(connection: &Connection) -> Result<ControlPoliciesDocument, ApiError> {
    let mut statement = connection.prepare(
        "SELECT payload FROM authority_policy_documents WHERE name = 'global'",
    ).map_err(to_sql_error)?;
    let payload = statement
        .query_row([], |row| row.get::<_, String>(0))
        .optional()
        .map_err(to_sql_error)?;

    match payload {
        Some(text) => serde_json::from_str(&text).map_err(to_json_error),
        None => Ok(default_control_policies_document()),
    }
}

fn save_control_policies_document(connection: &Connection, document: &ControlPoliciesDocument) -> Result<(), ApiError> {
    let payload = serde_json::to_string(document).map_err(to_json_error)?;
    connection.execute(
        "INSERT INTO authority_policy_documents (name, payload, updated_at) VALUES ('global', ?1, ?2)
         ON CONFLICT(name) DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at",
        params![payload, &document.updated_at],
    ).map_err(to_sql_error)?;
    Ok(())
}

fn default_control_policies_document() -> ControlPoliciesDocument {
    let mut defaults = HashMap::new();
    defaults.insert(String::from("storage.kv"), String::from("prompt"));
    defaults.insert(String::from("storage.blob"), String::from("prompt"));
    defaults.insert(String::from("fs.private"), String::from("prompt"));
    defaults.insert(String::from("sql.private"), String::from("prompt"));
    defaults.insert(String::from("trivium.private"), String::from("prompt"));
    defaults.insert(String::from("http.fetch"), String::from("prompt"));
    defaults.insert(String::from("jobs.background"), String::from("prompt"));
    defaults.insert(String::from("events.stream"), String::from("prompt"));
    ControlPoliciesDocument {
        defaults,
        extensions: HashMap::new(),
        updated_at: current_timestamp_iso(),
    }
}

fn fetch_control_jobs(connection: &Connection, user_handle: &str, extension_id: Option<&str>) -> Result<Vec<ControlJobRecord>, ApiError> {
    let mut jobs = Vec::new();
    if let Some(extension_id) = extension_id {
        let mut statement = connection.prepare(
            "SELECT id, extension_id, type, status, created_at, updated_at, progress, summary, error, payload, result, channel, started_at, finished_at, timeout_ms, idempotency_key, attempt, max_attempts, cancel_requested_at
             FROM authority_jobs
             WHERE user_handle = ?1 AND extension_id = ?2
             ORDER BY updated_at DESC, id DESC",
        ).map_err(to_sql_error)?;
        let rows = statement
            .query_map(params![user_handle, extension_id], control_job_from_row)
            .map_err(to_sql_error)?;
        for row in rows {
            jobs.push(row.map_err(to_sql_error)?);
        }
    } else {
        let mut statement = connection.prepare(
            "SELECT id, extension_id, type, status, created_at, updated_at, progress, summary, error, payload, result, channel, started_at, finished_at, timeout_ms, idempotency_key, attempt, max_attempts, cancel_requested_at
             FROM authority_jobs
             WHERE user_handle = ?1
             ORDER BY updated_at DESC, id DESC",
        ).map_err(to_sql_error)?;
        let rows = statement
            .query_map(params![user_handle], control_job_from_row)
            .map_err(to_sql_error)?;
        for row in rows {
            jobs.push(row.map_err(to_sql_error)?);
        }
    }
    Ok(jobs)
}

fn fetch_control_job(connection: &Connection, user_handle: &str, job_id: &str) -> Result<Option<ControlJobRecord>, ApiError> {
    let mut statement = connection.prepare(
        "SELECT id, extension_id, type, status, created_at, updated_at, progress, summary, error, payload, result, channel, started_at, finished_at, timeout_ms, idempotency_key, attempt, max_attempts, cancel_requested_at
         FROM authority_jobs
         WHERE user_handle = ?1 AND id = ?2",
    ).map_err(to_sql_error)?;
    statement
        .query_row(params![user_handle, job_id], control_job_from_row)
        .optional()
        .map_err(to_sql_error)
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
    })
}

fn fetch_kv_value(connection: &Connection, key: &str) -> Result<Option<JsonValue>, ApiError> {
    let mut statement = connection.prepare(
        "SELECT value FROM kv_entries WHERE key = ?1",
    ).map_err(to_sql_error)?;
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
    let mut statement = connection.prepare(
        "SELECT key, value FROM kv_entries ORDER BY key ASC",
    ).map_err(to_sql_error)?;
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

fn upsert_blob_record(connection: &Connection, user_handle: &str, extension_id: &str, record: &BlobRecord) -> Result<(), ApiError> {
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

fn fetch_blob_record(connection: &Connection, user_handle: &str, extension_id: &str, blob_id: &str) -> Result<Option<BlobRecord>, ApiError> {
    let mut statement = connection.prepare(
        "SELECT id, name, content_type, size, updated_at
         FROM authority_blob_records
         WHERE user_handle = ?1 AND extension_id = ?2 AND id = ?3",
    ).map_err(to_sql_error)?;
    statement
        .query_row(params![user_handle, extension_id, blob_id], blob_record_from_row)
        .optional()
        .map_err(to_sql_error)
}

fn fetch_blob_records(connection: &Connection, user_handle: &str, extension_id: &str) -> Result<Vec<BlobRecord>, ApiError> {
    let mut statement = connection.prepare(
        "SELECT id, name, content_type, size, updated_at
         FROM authority_blob_records
         WHERE user_handle = ?1 AND extension_id = ?2
         ORDER BY updated_at DESC, id DESC",
    ).map_err(to_sql_error)?;
    let rows = statement
        .query_map(params![user_handle, extension_id], blob_record_from_row)
        .map_err(to_sql_error)?;
    let mut records = Vec::new();
    for row in rows {
        records.push(row.map_err(to_sql_error)?);
    }
    Ok(records)
}

fn delete_blob_record(connection: &Connection, user_handle: &str, extension_id: &str, blob_id: &str) -> Result<(), ApiError> {
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

fn fetch_control_events(connection: &Connection, user_handle: &str, channel: &str, after_id: i64, limit: usize) -> Result<Vec<ControlEventRecord>, ApiError> {
    let mut statement = connection.prepare(
        "SELECT id, created_at, extension_id, channel, name, payload
         FROM authority_events
         WHERE user_handle = ?1 AND channel = ?2 AND id > ?3
         ORDER BY id ASC
         LIMIT ?4",
    ).map_err(to_sql_error)?;
    let rows = statement
        .query_map(params![user_handle, channel, after_id, limit as i64], control_event_from_row)
        .map_err(to_sql_error)?;
    let mut records = Vec::new();
    for row in rows {
        records.push(row.map_err(to_sql_error)?);
    }
    Ok(records)
}

fn fetch_latest_control_event_id(connection: &Connection, user_handle: &str, channel: &str) -> Result<i64, ApiError> {
    let mut statement = connection.prepare(
        "SELECT MAX(id) FROM authority_events WHERE user_handle = ?1 AND channel = ?2",
    ).map_err(to_sql_error)?;
    let latest = statement
        .query_row(params![user_handle, channel], |row| row.get::<_, Option<i64>>(0))
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

fn save_control_job_record(connection: &Connection, user_handle: &str, job: &ControlJobRecord) -> Result<(), ApiError> {
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
    let mut running = fetch_control_job(&connection, user_handle, &job.id)?
        .unwrap_or_else(|| job.clone());
    if running.status == "cancelled" {
        return Ok(());
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
    running.summary = Some(format!("Running delay job for {}ms (attempt {})", duration_ms, attempt));
    save_control_job_record(&connection, user_handle, &running)?;
    let running_payload = serde_json::to_value(&running).map_err(to_json_error)?;
    publish_control_event(
        &connection,
        user_handle,
        Some(&running.extension_id),
        &running.channel,
        "authority.job",
        Some(&running_payload),
    )?;

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
        if let Some(timeout_ms) = timeout_ms {
            if elapsed_ms >= timeout_ms {
                return Err(ApiError {
                    status_code: 408,
                    message: String::from("job_timeout"),
                });
            }
        }
        let progress = if duration_ms == 0 {
            100_i64
        } else {
            ((elapsed_ms.saturating_mul(100)) / duration_ms).min(100) as i64
        };

        if progress >= 100 {
            let message = job_message(job);
            let completed = ControlJobRecord {
                status: String::from("completed"),
                progress: 100,
                updated_at: current_timestamp_iso(),
                finished_at: Some(current_timestamp_iso()),
                summary: Some(message.clone()),
                result: Some(json!({
                    "elapsedMs": duration_ms,
                    "message": message,
                })),
                ..current
            };
            save_control_job_record(&connection, user_handle, &completed)?;
            let payload = serde_json::to_value(&completed).map_err(to_json_error)?;
            publish_control_event(
                &connection,
                user_handle,
                Some(&completed.extension_id),
                &completed.channel,
                "authority.job",
                Some(&payload),
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

fn mark_job_failed(db_path: &str, user_handle: &str, job: &ControlJobRecord, message: &str) -> Result<(), ApiError> {
    let connection = open_connection(db_path)?;
    ensure_control_schema(&connection)?;
    let current = match fetch_control_job(&connection, user_handle, &job.id)? {
        Some(current) if current.status != "cancelled" && current.status != "completed" => current,
        _ => return Ok(()),
    };
    let failed = ControlJobRecord {
        status: String::from("failed"),
        updated_at: current_timestamp_iso(),
        finished_at: Some(current_timestamp_iso()),
        error: Some(message.to_string()),
        ..current
    };
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
    let queued = ControlJobRecord {
        status: String::from("queued"),
        updated_at: current_timestamp_iso(),
        progress: 0,
        summary: Some(format!("Retrying in {}ms after attempt {}", backoff_ms, attempt)),
        error: Some(message.to_string()),
        result: None,
        finished_at: None,
        attempt,
        ..current
    };
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
    Ok(())
}

fn decode_binary_content(kind: &str, encoding: Option<&str>, content: &str) -> Result<Vec<u8>, ApiError> {
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
    let hostname = normalize_hostname(url)?;
    let agent = ureq::AgentBuilder::new()
        .timeout(Duration::from_secs(30))
        .build();
    let mut operation = agent.request(method.unwrap_or("GET"), url);
    if let Some(headers) = headers {
        for (name, value) in headers {
            operation = operation.set(name, value);
        }
    }

    let response = match body {
        Some(body) => operation.send_bytes(body),
        None => operation.call(),
    };
    match response {
        Ok(response) => Ok((response, hostname)),
        Err(ureq::Error::Status(_, response)) => Ok((response, hostname)),
        Err(error) => Err(ApiError {
            status_code: 400,
            message: format!("http_fetch_failed: {error}"),
        }),
    }
}

fn read_http_fetch_response(response: ureq::Response, max_bytes: usize) -> Result<FetchedHttpResponse, ApiError> {
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
    reader.read_to_end(&mut body_bytes).map_err(to_internal_error)?;
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
        .fold(root_dir.to_path_buf(), |current, segment| current.join(segment));
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

fn ensure_private_path_components_safe(root_dir: &Path, virtual_path: &str) -> Result<(), ApiError> {
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

fn build_private_file_entry(root_dir: &Path, target_path: &Path, metadata: &fs::Metadata) -> Result<PrivateFileEntry, ApiError> {
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
    let updated_at = metadata.modified().ok().and_then(system_time_to_iso).unwrap_or_else(current_timestamp_iso);

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
            if character.is_ascii_alphanumeric() || character == '.' || character == '_' || character == '-' {
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
    Ok(hostname.to_ascii_lowercase())
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
        .and_then(|value| value.as_u64().or_else(|| value.as_i64().and_then(|signed| u64::try_from(signed).ok())))
        .unwrap_or(3000)
}

fn job_should_fail_attempt(job: &ControlJobRecord, attempt: i64) -> bool {
    job.payload
        .as_ref()
        .and_then(|payload| payload.get("failAttempts"))
        .and_then(|value| value.as_i64().or_else(|| value.as_u64().and_then(|unsigned| i64::try_from(unsigned).ok())))
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
    let exponent = u32::try_from(attempt.saturating_sub(1)).unwrap_or(u32::MAX).min(6);
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

fn fetch_applied_migration_ids(connection: &Connection, table_name: &str) -> Result<HashSet<String>, ApiError> {
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
        ValueRef::Blob(blob) => JsonValue::String(format!("base64:{}", BASE64_STANDARD.encode(blob))),
    }
}


fn to_sql_error(error: rusqlite::Error) -> ApiError {
    ApiError {
        status_code: 400,
        message: format!("sql_error: {error}"),
    }
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

fn validate_supported_job_type(field_name: &str, value: &str) -> Result<(), ApiError> {
    if resolve_job_runner(value).is_some() {
        return Ok(());
    }
    Err(ApiError {
        status_code: 400,
        message: format!("{field_name} must be a supported job type, got {value}"),
    })
}

fn validate_job_runtime_options(timeout_ms: Option<i64>, max_attempts: Option<i64>) -> Result<(), ApiError> {
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
        "permission" | "usage" | "error" => Ok(()),
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
    validate_one_of("grant.status", &grant.status, &["granted", "denied", "prompt", "blocked"])?;
    validate_one_of("grant.scope", &grant.scope, &["session", "persistent", "policy"])?;
    validate_one_of("grant.riskLevel", &grant.risk_level, &["low", "medium", "high"])?;
    validate_one_of("grant.source", &grant.source, &["user", "admin", "system"])?;
    if let Some(choice) = &grant.choice {
        validate_one_of("grant.choice", choice, &["allow-once", "allow-session", "allow-always", "deny"])?;
    }
    Ok(())
}

fn validate_policy_default(resource: &str, status: &str) -> Result<(), ApiError> {
    validate_supported_resource("policy.default.resource", resource)?;
    validate_one_of("policy.default.status", status, &["granted", "denied", "prompt", "blocked"])
}

fn validate_policy_entry(entry: &ControlPolicyEntry) -> Result<(), ApiError> {
    validate_non_empty("policy.key", &entry.key)?;
    validate_supported_resource("policy.resource", &entry.resource)?;
    validate_non_empty("policy.target", &entry.target)?;
    validate_one_of("policy.status", &entry.status, &["granted", "denied", "prompt", "blocked"])?;
    validate_one_of("policy.riskLevel", &entry.risk_level, &["low", "medium", "high"])?;
    validate_non_empty("policy.updatedAt", &entry.updated_at)?;
    validate_one_of("policy.source", &entry.source, &["admin", "system"])?;
    Ok(())
}

fn validate_job_record(job: &ControlJobRecord) -> Result<(), ApiError> {
    validate_non_empty("job.id", &job.id)?;
    validate_non_empty("job.extensionId", &job.extension_id)?;
    validate_non_empty("job.type", &job.job_type)?;
    validate_supported_job_type("job.type", &job.job_type)?;
    validate_one_of("job.status", &job.status, &["queued", "running", "completed", "failed", "cancelled"])?;
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
    if !trimmed.chars().all(|character| character.is_ascii_alphanumeric() || character == '_') {
        return Err(ApiError {
            status_code: 400,
            message: format!("sql identifier contains unsupported characters: {}", trimmed),
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
    let started_at = started_at.parse::<u64>().unwrap_or_else(|_| current_unix_millis());
    current_unix_millis().saturating_sub(started_at)
}

fn active_job_count(runtime: &RuntimeState) -> usize {
    runtime
        .job_controls
        .lock()
        .map(|controls| controls.len())
        .unwrap_or(0)
}

fn current_timestamp_iso() -> String {
    OffsetDateTime::now_utc()
        .format(&Rfc3339)
        .unwrap_or_else(|_| current_timestamp_millis())
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

    #[test]
    fn sql_transaction_rolls_back_on_error() {
        let db_path = test_db_path("sql-rollback");
        let create = SqlBatchStatement {
            mode: SqlStatementMode::Exec,
            statement: String::from("CREATE TABLE items (id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE)"),
            params: Vec::new(),
        };
        let insert_first = SqlBatchStatement {
            mode: SqlStatementMode::Exec,
            statement: String::from("INSERT INTO items (name) VALUES (?)"),
            params: vec![json!("alpha")],
        };
        execute_transactional_statements(&db_path, &[create, insert_first]).expect("initial transaction should commit");

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
        let result = run_query(&connection, "SELECT name FROM items ORDER BY name", &[]).expect("query should succeed");
        assert_eq!(result.row_count, 1);
        assert_eq!(result.rows[0].get("name"), Some(&json!("alpha")));
    }

    #[test]
    fn sql_migrations_are_idempotent() {
        let db_path = test_db_path("sql-migrations");
        let migrations = vec![
            SqlMigrationInput {
                id: String::from("001_create"),
                statement: String::from("CREATE TABLE records (id INTEGER PRIMARY KEY, value TEXT NOT NULL)"),
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
        }).expect("first migration should succeed");
        assert_eq!(first["applied"].as_array().expect("applied should be an array").len(), 2);

        let second = handle_sql_migrate(SqlMigrateRequest {
            db_path,
            migrations,
            table_name: None,
        }).expect("second migration should succeed");
        assert_eq!(second["applied"].as_array().expect("applied should be an array").len(), 0);
        assert_eq!(second["skipped"].as_array().expect("skipped should be an array").len(), 2);
    }

    #[test]
    fn jobs_and_events_remain_consistent() {
        let db_path = test_db_path("jobs-events");
        let runtime = create_runtime_state();
        let created = handle_control_job_create(ControlJobCreateRequest {
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
        }, &runtime).expect("job create should succeed");
        let job_id = created["job"]["id"].as_str().expect("job id should exist").to_string();

        let completed = wait_for_job_status(&db_path, &job_id, "completed");
        assert_eq!(completed.progress, 100);
        assert_eq!(completed.result.as_ref().and_then(|value| value.get("message")), Some(&json!("done")));

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
            ).expect("event should publish");
        }

        let response = handle_control_events_poll(ControlEventsPollRequest {
            db_path,
            user_handle: String::from("alice"),
            channel: String::from("extension:third-party/example"),
            after_id: Some(0),
            limit: Some(1000),
        }).expect("events poll should succeed");
        assert_eq!(response["events"].as_array().expect("events should be an array").len(), MAX_EVENT_POLL_LIMIT);
    }

    #[test]
    fn private_files_support_round_trip_operations() {
        let root_dir = test_private_root("round-trip");

        let created = handle_private_file_mkdir(PrivateFileMkdirRequest {
            root_dir: root_dir.clone(),
            path: String::from("notes"),
            recursive: Some(true),
        }).expect("mkdir should succeed");
        assert_eq!(created["entry"]["kind"], json!("directory"));

        let written = handle_private_file_write(PrivateFileWriteRequest {
            root_dir: root_dir.clone(),
            path: String::from("notes/hello.txt"),
            content: String::from("hello authority"),
            encoding: Some(String::from("utf8")),
            create_parents: Some(true),
            source_path: None,
        }).expect("write should succeed");
        assert_eq!(written["entry"]["path"], json!("/notes/hello.txt"));

        let listed = handle_private_file_read_dir(PrivateFileReadDirRequest {
            root_dir: root_dir.clone(),
            path: String::from("notes"),
            limit: Some(10),
        }).expect("list should succeed");
        assert_eq!(listed["entries"].as_array().expect("entries should be an array").len(), 1);

        let read = handle_private_file_read(PrivateFileReadRequest {
            root_dir: root_dir.clone(),
            path: String::from("notes/hello.txt"),
            encoding: Some(String::from("utf8")),
        }).expect("read should succeed");
        assert_eq!(read["content"], json!("hello authority"));

        let stat = handle_private_file_stat(PrivateFileStatRequest {
            root_dir: root_dir.clone(),
            path: String::from("notes/hello.txt"),
        }).expect("stat should succeed");
        assert_eq!(stat["entry"]["kind"], json!("file"));

        handle_private_file_delete(PrivateFileDeleteRequest {
            root_dir: root_dir.clone(),
            path: String::from("notes/hello.txt"),
            recursive: Some(false),
        }).expect("file delete should succeed");
        handle_private_file_delete(PrivateFileDeleteRequest {
            root_dir,
            path: String::from("notes"),
            recursive: Some(false),
        }).expect("directory delete should succeed");
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
        }).expect_err("escape path should fail");
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
        }).expect("blob import should succeed");
        assert_eq!(created["size"], json!(17));

        let fetched = handle_storage_blob_get(StorageBlobGetRequest {
            db_path,
            user_handle: String::from("alice"),
            extension_id: String::from("third-party/example"),
            blob_dir,
            id: String::from("hello.bin"),
        }).expect("blob get should succeed");
        let content = fetched["content"].as_str().expect("content should exist");
        assert_eq!(BASE64_STANDARD.decode(content).expect("blob content should decode"), b"hello staged blob");
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
        }).expect("private file import should succeed");
        assert_eq!(written["entry"]["path"], json!("/notes/imported.txt"));

        let read = handle_private_file_read(PrivateFileReadRequest {
            root_dir,
            path: String::from("notes/imported.txt"),
            encoding: Some(String::from("utf8")),
        }).expect("private file read should succeed");
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
        }).expect("blob import should succeed");

        let opened = handle_storage_blob_open_read(StorageBlobGetRequest {
            db_path,
            user_handle: String::from("alice"),
            extension_id: String::from("third-party/example"),
            blob_dir,
            id: String::from("hello.bin"),
        }).expect("blob open read should succeed");
        let opened_path = opened["sourcePath"].as_str().expect("source path should exist");
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
        }).expect("private file import should succeed");

        let opened = handle_private_file_open_read(PrivateFileReadRequest {
            root_dir,
            path: String::from("notes/imported.txt"),
            encoding: None,
        }).expect("private file open read should succeed");
        let opened_path = opened["sourcePath"].as_str().expect("source path should exist");
        assert!(opened_path.ends_with("notes\\imported.txt") || opened_path.ends_with("notes/imported.txt"));
    }

    #[test]
    fn http_fetch_open_writes_response_to_staged_file() {
        let response_body = vec![0x41; 300 * 1024];
        let (url, handle) = spawn_test_http_server(response_body.clone(), "application/octet-stream", None);
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
        }).expect("http fetch open should succeed");

        assert_eq!(opened["bodyEncoding"], json!("base64"));
        assert_eq!(opened["sizeBytes"], json!(response_body.len()));
        assert_eq!(fs::read(&response_path).expect("response file should read"), response_body);
        handle.join().expect("http server should stop");
    }

    #[test]
    fn http_fetch_open_supports_body_source_path() {
        let captured_request = Arc::new(Mutex::new(Vec::new()));
        let (url, handle) = spawn_test_http_server(
            b"ok".to_vec(),
            "text/plain; charset=utf-8",
            Some(captured_request.clone()),
        );
        let root_dir = test_private_root("http-fetch-open-request");
        fs::create_dir_all(&root_dir).expect("request root should exist");
        let body_source_path = Path::new(&root_dir).join("request.bin");
        fs::write(&body_source_path, b"payload via source path").expect("request body should write");
        let response_path = Path::new(&root_dir).join("response.txt");
        fs::write(&response_path, b"").expect("response file should exist");

        let opened = handle_http_fetch_open(CoreHttpFetchOpenRequest {
            url,
            method: Some(String::from("POST")),
            headers: Some(HashMap::from([(String::from("content-type"), String::from("application/octet-stream"))])),
            body: None,
            body_encoding: None,
            body_source_path: Some(body_source_path.to_string_lossy().into_owned()),
            response_path: response_path.to_string_lossy().into_owned(),
        }).expect("http fetch open with source path should succeed");

        assert_eq!(opened["bodyEncoding"], json!("utf8"));
        assert_eq!(fs::read(&response_path).expect("response file should read"), b"ok");
        handle.join().expect("http server should stop");

        let request = captured_request.lock().expect("request capture should lock");
        assert!(String::from_utf8_lossy(&request).contains("payload via source path"));
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
            if let Some(job) = fetch_control_job(&connection, "alice", job_id).expect("job lookup should succeed") {
                if job.status == expected_status {
                    return job;
                }
            }
            assert!(started.elapsed() < Duration::from_secs(5), "job did not reach expected status");
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
            }).expect("events poll should succeed");
            if events["events"]
                .as_array()
                .expect("events should be an array")
                .iter()
                .any(|event| event["payload"]["status"] == json!(expected_status))
            {
                return;
            }
            assert!(started.elapsed() < Duration::from_secs(5), "job event did not reach expected status");
            thread::sleep(Duration::from_millis(25));
        }
    }

    fn wait_for_active_job_count(runtime: &RuntimeState, expected_count: usize) {
        let started = Instant::now();
        loop {
            if active_job_count(runtime) == expected_count {
                return;
            }
            assert!(started.elapsed() < Duration::from_secs(5), "active job count did not reach expected value");
            thread::sleep(Duration::from_millis(25));
        }
    }

    #[test]
    fn job_idempotency_key_deduplicates() {
        let db_path = test_db_path("job-idempotency");
        let runtime = create_runtime_state();
        let first = handle_control_job_create(ControlJobCreateRequest {
            db_path: db_path.clone(),
            user_handle: String::from("alice"),
            extension_id: String::from("third-party/example"),
            job_type: String::from("delay"),
            payload: Some(json!({ "durationMs": 0, "message": "first" })),
            timeout_ms: None,
            idempotency_key: Some(String::from("unique-key-1")),
            max_attempts: None,
        }, &runtime).expect("first job create should succeed");
        let first_id = first["job"]["id"].as_str().unwrap().to_string();

        let second = handle_control_job_create(ControlJobCreateRequest {
            db_path: db_path.clone(),
            user_handle: String::from("alice"),
            extension_id: String::from("third-party/example"),
            job_type: String::from("delay"),
            payload: Some(json!({ "durationMs": 0, "message": "second" })),
            timeout_ms: None,
            idempotency_key: Some(String::from("unique-key-1")),
            max_attempts: None,
        }, &runtime).expect("second job create should succeed");
        let second_id = second["job"]["id"].as_str().unwrap().to_string();

        assert_eq!(first_id, second_id, "idempotency key should return existing job");
    }

    #[test]
    fn job_timeout_marks_failed() {
        let db_path = test_db_path("job-timeout");
        let runtime = create_runtime_state();
        let created = handle_control_job_create(ControlJobCreateRequest {
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
        }, &runtime).expect("timed job create should succeed");
        let job_id = created["job"]["id"].as_str().expect("job id should exist").to_string();

        let failed = wait_for_job_status(&db_path, &job_id, "failed");
        assert_eq!(failed.error.as_deref(), Some("job_timeout"));
        assert!(failed.finished_at.is_some());
        wait_for_active_job_count(&runtime, 0);
    }

    #[test]
    fn job_retries_then_completes() {
        let db_path = test_db_path("job-retry");
        let runtime = create_runtime_state();
        let created = handle_control_job_create(ControlJobCreateRequest {
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
        }, &runtime).expect("retry job create should succeed");
        let job_id = created["job"]["id"].as_str().expect("job id should exist").to_string();

        let completed = wait_for_job_status(&db_path, &job_id, "completed");
        assert_eq!(completed.attempt, 2);
        assert_eq!(completed.result.as_ref().and_then(|value| value.get("message")), Some(&json!("retry-ok")));
        wait_for_active_job_count(&runtime, 0);
    }

    fn test_db_path(name: &str) -> String {
        let path = env::temp_dir()
            .join(format!("authority-core-test-{}-{}-{}.sqlite", name, process::id(), current_unix_millis()));
        path.to_string_lossy().into_owned()
    }

    fn test_private_root(name: &str) -> String {
        let path = env::temp_dir()
            .join(format!("authority-core-private-{}-{}-{}", name, process::id(), current_unix_millis()));
        path.to_string_lossy().into_owned()
    }

    fn spawn_test_http_server(
        response_body: Vec<u8>,
        content_type: &str,
        captured_request: Option<Arc<Mutex<Vec<u8>>>>,
    ) -> (String, thread::JoinHandle<()>) {
        let listener = TcpListener::bind("127.0.0.1:0").expect("listener should bind");
        let address = listener.local_addr().expect("listener should expose address");
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
                let mut target = captured_request.lock().expect("captured request should lock");
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
