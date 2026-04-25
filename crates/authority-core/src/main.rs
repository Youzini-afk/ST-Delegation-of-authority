use base64::Engine;
use base64::engine::general_purpose::STANDARD as BASE64_STANDARD;
use rusqlite::Connection;
use rusqlite::params_from_iter;
use rusqlite::types::{Value as SqliteValue, ValueRef};
use serde::Deserialize;
use serde::Serialize;
use serde_json::{Map as JsonMap, Number as JsonNumber, Value as JsonValue, json};
use std::env;
use std::error::Error;
use std::fs;
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::Path;
use std::process;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

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
    if request.statements.is_empty() {
        return Err(ApiError {
            status_code: 400,
            message: String::from("sql batch requires at least one statement"),
        });
    }

    let mut connection = open_connection(&request.db_path)?;
    let transaction = connection.transaction().map_err(to_sql_error)?;
    let mut results = Vec::with_capacity(request.statements.len());

    for statement in &request.statements {
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
    Ok(json!({ "results": results }))
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
