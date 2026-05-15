use serde::{Deserialize, Serialize};
use serde_json::{Map as JsonMap, Value as JsonValue};

use crate::pagination::{CursorPageInfo, CursorPageRequest};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SqlRequest {
    pub(crate) db_path: String,
    pub(crate) statement: String,
    #[serde(default)]
    pub(crate) params: Vec<JsonValue>,
    pub(crate) page: Option<CursorPageRequest>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SqlStatRequest {
    pub(crate) db_path: String,
}

#[derive(Default, Deserialize)]
#[serde(rename_all = "lowercase")]
pub(crate) enum SqlStatementMode {
    Query,
    #[default]
    Exec,
}

#[derive(Deserialize)]
pub(crate) struct SqlBatchStatement {
    #[serde(default)]
    pub(crate) mode: SqlStatementMode,
    pub(crate) statement: String,
    #[serde(default)]
    pub(crate) params: Vec<JsonValue>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SqlBatchRequest {
    pub(crate) db_path: String,
    pub(crate) statements: Vec<SqlBatchStatement>,
}

#[derive(Clone, Deserialize)]
pub(crate) struct SqlMigrationInput {
    pub(crate) id: String,
    pub(crate) statement: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SqlMigrateRequest {
    pub(crate) db_path: String,
    pub(crate) migrations: Vec<SqlMigrationInput>,
    pub(crate) table_name: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SqlQueryResult {
    pub(crate) kind: &'static str,
    pub(crate) columns: Vec<String>,
    pub(crate) rows: Vec<JsonMap<String, JsonValue>>,
    pub(crate) row_count: usize,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) page: Option<CursorPageInfo>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SqlExecResult {
    pub(crate) kind: &'static str,
    pub(crate) rows_affected: usize,
    pub(crate) last_insert_rowid: Option<i64>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SqlRuntimeConfigDiagnostics {
    pub(crate) journal_mode: String,
    pub(crate) synchronous: String,
    pub(crate) foreign_keys: bool,
    pub(crate) busy_timeout_ms: u64,
    pub(crate) paged_query_requires_order_by: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SqlSlowQueryDiagnostics {
    pub(crate) count: u64,
    pub(crate) last_occurred_at: Option<String>,
    pub(crate) last_elapsed_ms: Option<u64>,
    pub(crate) last_statement_preview: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SqlStatResponse {
    pub(crate) database: String,
    pub(crate) name: String,
    pub(crate) file_name: String,
    pub(crate) file_path: String,
    pub(crate) exists: bool,
    pub(crate) size_bytes: u64,
    pub(crate) updated_at: Option<String>,
    pub(crate) runtime_config: SqlRuntimeConfigDiagnostics,
    pub(crate) slow_query: SqlSlowQueryDiagnostics,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SqlTransactionResponse {
    pub(crate) committed: bool,
    pub(crate) results: Vec<JsonValue>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SqlMigrateResponse {
    pub(crate) table_name: String,
    pub(crate) applied: Vec<String>,
    pub(crate) skipped: Vec<String>,
    pub(crate) latest_id: Option<String>,
}

