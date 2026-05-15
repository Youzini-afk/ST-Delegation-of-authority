use std::collections::{HashMap, HashSet};
use std::fs;
use std::io::Read;
use std::net::{IpAddr, ToSocketAddrs};
use std::time::Duration;

use base64::Engine;
use base64::engine::general_purpose::STANDARD as BASE64_STANDARD;
use serde_json::{Value as JsonValue, json};
use url::Url;

use crate::constants::{
    MAX_HTTP_BODY_BYTES, MAX_HTTP_INLINE_BODY_BYTES, MAX_HTTP_INLINE_RESPONSE_BYTES,
    MAX_HTTP_REDIRECTS, MAX_HTTP_RESPONSE_BYTES,
};
use crate::core_types::{
    CoreHttpFetchOpenRequest, CoreHttpFetchRequest, FetchedHttpResponse, HttpFetchOpenResponse,
    HttpFetchResponse,
};
use crate::error::ApiError;
use crate::{
    emit_runtime_event, to_internal_error, validate_non_empty, validate_source_file_path,
};

pub(crate) fn handle_http_fetch(request: CoreHttpFetchRequest) -> Result<JsonValue, ApiError> {
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

pub(crate) fn handle_http_fetch_open(
    request: CoreHttpFetchOpenRequest,
) -> Result<JsonValue, ApiError> {
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

fn decode_http_fetch_body(encoding: Option<&str>, content: &str) -> Result<Vec<u8>, ApiError> {
    match encoding.unwrap_or("utf8") {
        "utf8" => Ok(content.as_bytes().to_vec()),
        "base64" => BASE64_STANDARD.decode(content).map_err(|error| ApiError {
            status_code: 400,
            message: format!("invalid_base64_http_fetch_body: {error}"),
        }),
        value => Err(ApiError {
            status_code: 400,
            message: format!("http_fetch_body encoding has unsupported value: {value}"),
        }),
    }
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
        return crate::HTTP_FETCH_ALLOW_LOCAL_TARGETS.load(std::sync::atomic::Ordering::SeqCst);
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{HTTP_FETCH_ALLOW_LOCAL_TARGETS, HTTP_FETCH_TEST_MUTEX};
    use std::sync::atomic::Ordering;

    struct LocalHttpFetchGuard {
        _guard: std::sync::MutexGuard<'static, ()>,
    }

    impl Drop for LocalHttpFetchGuard {
        fn drop(&mut self) {
            HTTP_FETCH_ALLOW_LOCAL_TARGETS.store(false, Ordering::SeqCst);
        }
    }

    fn deny_local_http_fetch_targets() -> LocalHttpFetchGuard {
        let guard = HTTP_FETCH_TEST_MUTEX
            .get_or_init(|| std::sync::Mutex::new(()))
            .lock()
            .expect("http fetch test mutex should lock");
        HTTP_FETCH_ALLOW_LOCAL_TARGETS.store(false, Ordering::SeqCst);
        LocalHttpFetchGuard { _guard: guard }
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
}
