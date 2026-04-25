use std::env;
use std::error::Error;
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::process;
use std::time::{SystemTime, UNIX_EPOCH};

struct Config {
    token: String,
    version: String,
    api_version: String,
    started_at: String,
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
    let mut buffer = [0_u8; 8192];
    let size = stream.read(&mut buffer)?;
    if size == 0 {
        return Ok(());
    }

    let request = String::from_utf8_lossy(&buffer[..size]);
    let mut lines = request.split("\r\n");
    let request_line = lines.next().unwrap_or("");
    let mut request_parts = request_line.split_whitespace();
    let method = request_parts.next().unwrap_or("");
    let path = request_parts.next().unwrap_or("");
    let authorized = is_authorized(lines, &config.token);

    if !authorized {
        return write_json(stream, 401, r#"{"error":"unauthorized"}"#);
    }

    if method == "GET" && path == "/health" {
        let body = format!(
            "{{\"name\":\"authority-core\",\"apiVersion\":\"{}\",\"version\":\"{}\",\"pid\":{},\"startedAt\":\"{}\"}}",
            escape_json(&config.api_version),
            escape_json(&config.version),
            process::id(),
            escape_json(&config.started_at),
        );
        return write_json(stream, 200, &body);
    }

    write_json(stream, 404, r#"{"error":"not_found"}"#)
}

fn is_authorized<'a>(lines: impl Iterator<Item = &'a str>, token: &str) -> bool {
    if token.is_empty() {
        return true;
    }

    for line in lines {
        if line.is_empty() {
            break;
        }

        if let Some((name, value)) = line.split_once(':') {
            if name.eq_ignore_ascii_case("x-authority-core-token") && value.trim() == token {
                return true;
            }
        }
    }

    false
}

fn write_json(stream: &mut TcpStream, status_code: u16, body: &str) -> std::io::Result<()> {
    let status_text = match status_code {
        200 => "OK",
        401 => "Unauthorized",
        404 => "Not Found",
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

fn escape_json(value: &str) -> String {
    let mut escaped = String::with_capacity(value.len());
    for character in value.chars() {
        match character {
            '\\' => escaped.push_str("\\\\"),
            '"' => escaped.push_str("\\\""),
            '\n' => escaped.push_str("\\n"),
            '\r' => escaped.push_str("\\r"),
            '\t' => escaped.push_str("\\t"),
            _ => escaped.push(character),
        }
    }
    escaped
}
