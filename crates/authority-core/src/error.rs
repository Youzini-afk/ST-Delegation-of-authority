use axum::Json;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use serde_json::json;

#[derive(Debug)]
pub(crate) struct ApiError {
    pub(crate) status_code: u16,
    pub(crate) message: String,
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        let status =
            StatusCode::from_u16(self.status_code).unwrap_or(StatusCode::INTERNAL_SERVER_ERROR);
        let body = json!({ "error": self.message });
        (status, Json(body)).into_response()
    }
}
