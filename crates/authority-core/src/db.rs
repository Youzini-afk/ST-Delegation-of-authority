use std::fs;
use std::path::Path;
use std::time::Duration;

use rusqlite::Connection;

use crate::constants::SQL_BUSY_TIMEOUT_MS;
use crate::error::ApiError;
use crate::to_internal_error;

pub(crate) fn open_connection(db_path: &str) -> Result<Connection, ApiError> {
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

pub(crate) fn to_sql_error(error: rusqlite::Error) -> ApiError {
    ApiError {
        status_code: 400,
        message: format!("sql_error: {error}"),
    }
}
