use std::collections::HashSet;
use std::fs;
use std::path::Path;
use std::time::{Duration, Instant};

use base64::Engine;
use base64::engine::general_purpose::STANDARD as BASE64_STANDARD;
use rusqlite::types::{Value as SqliteValue, ValueRef};
use rusqlite::{Connection, OptionalExtension, params, params_from_iter};
use serde_json::{Map as JsonMap, Number as JsonNumber, Value as JsonValue, json};

use crate::constants::{
    SLOW_SQL_LOG_MS, SQL_BUSY_TIMEOUT_MS, SQL_LAST_SLOW_QUERY_AT_META_KEY,
    SQL_LAST_SLOW_QUERY_ELAPSED_MS_META_KEY, SQL_LAST_SLOW_QUERY_STATEMENT_PREVIEW_META_KEY,
    SQL_META_TABLE, SQL_PAGED_QUERY_REQUIRES_ORDER_BY, SQL_SLOW_QUERY_COUNT_META_KEY,
};
use crate::db::{open_connection, to_sql_error};
use crate::error::ApiError;
use crate::pagination::{CursorPageRequest, slice_vec_page};
use crate::sql_types::*;
use crate::{
    current_timestamp_iso, current_timestamp_millis, emit_if_slow, system_time_to_iso,
    to_internal_error, validate_non_empty,
};

pub(crate) fn handle_sql_query(request: SqlRequest) -> Result<JsonValue, ApiError> {
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

pub(crate) fn handle_sql_exec(request: SqlRequest) -> Result<JsonValue, ApiError> {
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

pub(crate) fn handle_sql_batch(request: SqlBatchRequest) -> Result<JsonValue, ApiError> {
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

pub(crate) fn handle_sql_transaction(request: SqlBatchRequest) -> Result<JsonValue, ApiError> {
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

pub(crate) fn handle_sql_migrate(request: SqlMigrateRequest) -> Result<JsonValue, ApiError> {
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

pub(crate) fn handle_sql_stat(request: SqlStatRequest) -> Result<JsonValue, ApiError> {
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

pub(crate) fn execute_transactional_statements(
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

pub(crate) fn run_query(
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

pub(crate) fn run_exec(
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

pub(crate) fn record_slow_sql_if_needed(
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

fn ensure_migration_table(connection: &Connection, table_name: &str) -> Result<(), ApiError> {
    let statement = format!(
        "CREATE TABLE IF NOT EXISTS {} (id TEXT PRIMARY KEY, applied_at TEXT NOT NULL)",
        table_name,
    );
    connection.execute_batch(&statement).map_err(to_sql_error)
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

fn to_sql_migration_error(migration_id: &str, statement: &str, error: rusqlite::Error) -> ApiError {
    ApiError {
        status_code: 400,
        message: format!(
            "sql_error: migration {migration_id} failed: {error} [statement: {}]",
            preview_sql_statement(statement),
        ),
    }
}

pub(crate) fn preview_sql_statement(statement: &str) -> String {
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

pub(crate) fn validate_sql_identifier(value: &str) -> Result<String, ApiError> {
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
