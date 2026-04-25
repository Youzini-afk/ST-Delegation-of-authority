use base64::Engine;
use base64::engine::general_purpose::STANDARD as BASE64_STANDARD;
use rusqlite::{Connection, OptionalExtension, params, params_from_iter};
use rusqlite::types::{Value as SqliteValue, ValueRef};
use serde::Deserialize;
use serde::Serialize;
use serde_json::{Map as JsonMap, Number as JsonNumber, Value as JsonValue, json};
use std::collections::{HashMap, HashSet};
use std::env;
use std::error::Error;
use std::fs;
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::Path;
use std::process;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use time::OffsetDateTime;
use time::format_description::well_known::Rfc3339;

const HEADER_END: &[u8] = b"\r\n\r\n";
const MAX_REQUEST_SIZE: usize = 1024 * 1024;

struct Config {
    token: String,
    version: String,
    api_version: String,
    started_at: String,
}

struct HttpRequest {
    method: String,
    path: String,
    headers: Vec<(String, String)>,
    body: Vec<u8>,
}

struct ApiError {
    status_code: u16,
    message: String,
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

#[derive(Deserialize)]
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

#[derive(Deserialize, Serialize)]
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

fn main() -> Result<(), Box<dyn Error>> {
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
    let config = Config {
        token,
        version,
        api_version,
        started_at,
    };

    let listener = TcpListener::bind(format!("{host}:{port}"))?;
    println!("AUTHORITY_CORE_READY {}", listener.local_addr()?);

    for stream in listener.incoming() {
        match stream {
            Ok(mut stream) => {
                if let Err(error) = handle_connection(&mut stream, &config) {
                    eprintln!("authority-core connection error: {error}");
                }
            }
            Err(error) => {
                eprintln!("authority-core accept error: {error}");
            }
        }
    }

    Ok(())
}

fn handle_connection(stream: &mut TcpStream, config: &Config) -> std::io::Result<()> {
    let request = match read_http_request(stream) {
        Ok(Some(request)) => request,
        Ok(None) => return Ok(()),
        Err(error) => {
            let body = json!({ "error": format!("invalid_http_request: {error}") }).to_string();
            return write_json(stream, 400, &body);
        }
    };

    if !is_authorized(&request.headers, &config.token) {
        return write_json(stream, 401, r#"{"error":"unauthorized"}"#);
    }

    let response = match (request.method.as_str(), request.path.as_str()) {
        ("GET", "/health") => Ok(json!({
            "name": "authority-core",
            "apiVersion": config.api_version,
            "version": config.version,
            "pid": process::id(),
            "startedAt": config.started_at,
        })),
        ("POST", "/v1/sql/query") => parse_json_body::<SqlRequest>(&request).and_then(handle_sql_query),
        ("POST", "/v1/sql/exec") => parse_json_body::<SqlRequest>(&request).and_then(handle_sql_exec),
        ("POST", "/v1/sql/batch") => parse_json_body::<SqlBatchRequest>(&request).and_then(handle_sql_batch),
        ("POST", "/v1/sql/transaction") => parse_json_body::<SqlBatchRequest>(&request).and_then(handle_sql_transaction),
        ("POST", "/v1/sql/migrate") => parse_json_body::<SqlMigrateRequest>(&request).and_then(handle_sql_migrate),
        ("POST", "/v1/control/session/init") => parse_json_body::<ControlSessionInitRequest>(&request).and_then(handle_control_session_init),
        ("POST", "/v1/control/session/get") => parse_json_body::<ControlSessionGetRequest>(&request).and_then(handle_control_session_get),
        ("POST", "/v1/control/extensions/list") => parse_json_body::<ControlExtensionsListRequest>(&request).and_then(handle_control_extensions_list),
        ("POST", "/v1/control/extensions/get") => parse_json_body::<ControlExtensionGetRequest>(&request).and_then(handle_control_extension_get),
        ("POST", "/v1/control/audit/log") => parse_json_body::<ControlAuditLogRequest>(&request).and_then(handle_control_audit_log),
        ("POST", "/v1/control/audit/recent") => parse_json_body::<ControlAuditRecentRequest>(&request).and_then(handle_control_audit_recent),
        ("POST", "/v1/control/grants/list") => parse_json_body::<ControlGrantListRequest>(&request).and_then(handle_control_grants_list),
        ("POST", "/v1/control/grants/get") => parse_json_body::<ControlGrantGetRequest>(&request).and_then(handle_control_grant_get),
        ("POST", "/v1/control/grants/upsert") => parse_json_body::<ControlGrantUpsertRequest>(&request).and_then(handle_control_grant_upsert),
        ("POST", "/v1/control/grants/reset") => parse_json_body::<ControlGrantResetRequest>(&request).and_then(handle_control_grants_reset),
        ("POST", "/v1/control/policies/get") => parse_json_body::<ControlPoliciesRequest>(&request).and_then(handle_control_policies_get),
        ("POST", "/v1/control/policies/save") => parse_json_body::<ControlPoliciesSaveRequest>(&request).and_then(handle_control_policies_save),
        ("POST", "/v1/control/jobs/list") => parse_json_body::<ControlJobsListRequest>(&request).and_then(handle_control_jobs_list),
        ("POST", "/v1/control/jobs/get") => parse_json_body::<ControlJobGetRequest>(&request).and_then(handle_control_job_get),
        ("POST", "/v1/control/jobs/upsert") => parse_json_body::<ControlJobUpsertRequest>(&request).and_then(handle_control_job_upsert),
        _ => Err(ApiError {
            status_code: 404,
            message: String::from("not_found"),
        }),
    };

    match response {
        Ok(body) => write_json(stream, 200, &body.to_string()),
        Err(error) => {
            let body = json!({ "error": error.message }).to_string();
            write_json(stream, error.status_code, &body)
        }
    }
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
            user_handle, id, extension_id, type, status, created_at, updated_at, progress, summary, error, payload, result, channel
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)
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
            channel = excluded.channel",
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
        ],
    ).map_err(to_sql_error)?;
    Ok(json!({ "job": request.job }))
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
            PRIMARY KEY (user_handle, id)
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
    defaults.insert(String::from("sql.private"), String::from("prompt"));
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
            "SELECT id, extension_id, type, status, created_at, updated_at, progress, summary, error, payload, result, channel
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
            "SELECT id, extension_id, type, status, created_at, updated_at, progress, summary, error, payload, result, channel
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
        "SELECT id, extension_id, type, status, created_at, updated_at, progress, summary, error, payload, result, channel
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
    })
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

fn parse_json_body<T>(request: &HttpRequest) -> Result<T, ApiError>
where
    T: for<'de> Deserialize<'de>,
{
    serde_json::from_slice::<T>(&request.body).map_err(|error| ApiError {
        status_code: 400,
        message: format!("invalid_json_body: {error}"),
    })
}

fn read_http_request(stream: &mut TcpStream) -> std::io::Result<Option<HttpRequest>> {
    let mut buffer = Vec::new();
    let mut chunk = [0_u8; 4096];
    let header_end = loop {
        let size = stream.read(&mut chunk)?;
        if size == 0 {
            if buffer.is_empty() {
                return Ok(None);
            }
            return Err(std::io::Error::new(
                std::io::ErrorKind::UnexpectedEof,
                "request ended before headers completed",
            ));
        }

        buffer.extend_from_slice(&chunk[..size]);
        if buffer.len() > MAX_REQUEST_SIZE {
            return Err(std::io::Error::new(
                std::io::ErrorKind::InvalidData,
                "request exceeded maximum size",
            ));
        }

        if let Some(position) = find_header_end(&buffer) {
            break position;
        }
    };

    let header_text = String::from_utf8_lossy(&buffer[..header_end]);
    let mut lines = header_text.split("\r\n");
    let request_line = lines.next().unwrap_or("");
    let mut request_parts = request_line.split_whitespace();
    let method = request_parts.next().unwrap_or("").to_string();
    let path = request_parts.next().unwrap_or("").to_string();
    let mut headers = Vec::new();
    let mut content_length = 0_usize;

    for line in lines {
        if line.is_empty() {
            continue;
        }

        if let Some((name, value)) = line.split_once(':') {
            let header_name = name.trim().to_ascii_lowercase();
            let header_value = value.trim().to_string();
            if header_name == "content-length" {
                content_length = header_value.parse::<usize>().unwrap_or(0);
            }
            headers.push((header_name, header_value));
        }
    }

    let body_start = header_end + HEADER_END.len();
    let mut body = buffer[body_start..].to_vec();
    while body.len() < content_length {
        let size = stream.read(&mut chunk)?;
        if size == 0 {
            break;
        }
        body.extend_from_slice(&chunk[..size]);
        if header_end + HEADER_END.len() + body.len() > MAX_REQUEST_SIZE {
            return Err(std::io::Error::new(
                std::io::ErrorKind::InvalidData,
                "request exceeded maximum size",
            ));
        }
    }
    body.truncate(content_length);

    Ok(Some(HttpRequest {
        method,
        path,
        headers,
        body,
    }))
}

fn find_header_end(buffer: &[u8]) -> Option<usize> {
    buffer
        .windows(HEADER_END.len())
        .position(|window| window == HEADER_END)
}

fn is_authorized(headers: &[(String, String)], token: &str) -> bool {
    if token.is_empty() {
        return true;
    }

    headers.iter().any(|(name, value)| name == "x-authority-core-token" && value == token)
}

fn to_sql_error(error: rusqlite::Error) -> ApiError {
    ApiError {
        status_code: 400,
        message: format!("sql_error: {error}"),
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
    validate_one_of("job.status", &job.status, &["queued", "running", "completed", "failed", "cancelled"])?;
    validate_non_empty("job.createdAt", &job.created_at)?;
    validate_non_empty("job.updatedAt", &job.updated_at)?;
    validate_non_empty("job.channel", &job.channel)?;
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
            "sql.private",
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
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .to_string()
}

fn current_timestamp_iso() -> String {
    OffsetDateTime::now_utc()
        .format(&Rfc3339)
        .unwrap_or_else(|_| current_timestamp_millis())
}

fn write_json(stream: &mut TcpStream, status_code: u16, body: &str) -> std::io::Result<()> {
    let status_text = match status_code {
        200 => "OK",
        400 => "Bad Request",
        401 => "Unauthorized",
        404 => "Not Found",
        500 => "Internal Server Error",
        _ => "Error",
    };
    let response = format!(
        "HTTP/1.1 {} {}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
        status_code,
        status_text,
        body.len(),
        body,
    );
    stream.write_all(response.as_bytes())?;
    stream.flush()
}
