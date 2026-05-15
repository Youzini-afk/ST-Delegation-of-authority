use std::collections::HashMap;

use serde::{Deserialize, Serialize};
use serde_json::Value as JsonValue;

use crate::pagination::CursorPageRequest;

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ControlUserInfo {
    pub(crate) handle: String,
    pub(crate) is_admin: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ControlInitConfig {
    pub(crate) extension_id: String,
    pub(crate) display_name: String,
    pub(crate) version: String,
    pub(crate) install_type: String,
    pub(crate) declared_permissions: JsonValue,
    pub(crate) ui_label: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ControlSessionInitRequest {
    pub(crate) db_path: String,
    pub(crate) session_token: String,
    pub(crate) timestamp: String,
    pub(crate) user: ControlUserInfo,
    pub(crate) config: ControlInitConfig,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ControlSessionGetRequest {
    pub(crate) db_path: String,
    pub(crate) user_handle: String,
    pub(crate) session_token: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ControlExtensionsListRequest {
    pub(crate) db_path: String,
    pub(crate) user_handle: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ControlExtensionGetRequest {
    pub(crate) db_path: String,
    pub(crate) user_handle: String,
    pub(crate) extension_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ControlAuditRecordInput {
    pub(crate) timestamp: String,
    pub(crate) kind: String,
    pub(crate) extension_id: String,
    pub(crate) message: String,
    pub(crate) details: Option<JsonValue>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ControlAuditLogRequest {
    pub(crate) db_path: String,
    pub(crate) user_handle: String,
    pub(crate) record: ControlAuditRecordInput,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ControlAuditRecentRequest {
    pub(crate) db_path: String,
    pub(crate) user_handle: String,
    pub(crate) extension_id: String,
    pub(crate) limit: Option<usize>,
    pub(crate) page: Option<CursorPageRequest>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ControlGrantListRequest {
    pub(crate) db_path: String,
    pub(crate) user_handle: String,
    pub(crate) extension_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ControlGrantGetRequest {
    pub(crate) db_path: String,
    pub(crate) user_handle: String,
    pub(crate) extension_id: String,
    pub(crate) key: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ControlGrantUpsertRequest {
    pub(crate) db_path: String,
    pub(crate) user_handle: String,
    pub(crate) extension_id: String,
    pub(crate) grant: ControlGrantRecord,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ControlGrantResetRequest {
    pub(crate) db_path: String,
    pub(crate) user_handle: String,
    pub(crate) extension_id: String,
    pub(crate) keys: Option<Vec<String>>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ControlPoliciesRequest {
    pub(crate) db_path: String,
    pub(crate) user_handle: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ControlPoliciesPartial {
    pub(crate) defaults: Option<HashMap<String, String>>,
    pub(crate) extensions: Option<HashMap<String, HashMap<String, ControlPolicyEntry>>>,
    pub(crate) limits: Option<ControlLimitsPoliciesDocument>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ControlPoliciesSaveRequest {
    pub(crate) db_path: String,
    pub(crate) actor: ControlUserInfo,
    pub(crate) partial: ControlPoliciesPartial,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ControlJobsListRequest {
    pub(crate) db_path: String,
    pub(crate) user_handle: String,
    pub(crate) extension_id: Option<String>,
    pub(crate) page: Option<CursorPageRequest>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ControlJobGetRequest {
    pub(crate) db_path: String,
    pub(crate) user_handle: String,
    pub(crate) job_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ControlJobUpsertRequest {
    pub(crate) db_path: String,
    pub(crate) user_handle: String,
    pub(crate) job: ControlJobRecord,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ControlJobCreateRequest {
    pub(crate) db_path: String,
    pub(crate) user_handle: String,
    pub(crate) extension_id: String,
    #[serde(rename = "type")]
    pub(crate) job_type: String,
    pub(crate) payload: Option<JsonValue>,
    #[serde(default)]
    pub(crate) timeout_ms: Option<i64>,
    #[serde(default)]
    pub(crate) idempotency_key: Option<String>,
    #[serde(default)]
    pub(crate) max_attempts: Option<i64>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ControlJobCancelRequest {
    pub(crate) db_path: String,
    pub(crate) user_handle: String,
    pub(crate) extension_id: String,
    pub(crate) job_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ControlJobRequeueRequest {
    pub(crate) db_path: String,
    pub(crate) user_handle: String,
    pub(crate) extension_id: String,
    pub(crate) job_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct StorageKvGetRequest {
    pub(crate) db_path: String,
    pub(crate) key: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct StorageKvSetRequest {
    pub(crate) db_path: String,
    pub(crate) key: String,
    pub(crate) value: JsonValue,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct StorageKvDeleteRequest {
    pub(crate) db_path: String,
    pub(crate) key: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct StorageKvListRequest {
    pub(crate) db_path: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct StorageBlobPutRequest {
    pub(crate) db_path: String,
    pub(crate) user_handle: String,
    pub(crate) extension_id: String,
    pub(crate) blob_dir: String,
    pub(crate) name: String,
    pub(crate) content: String,
    pub(crate) encoding: Option<String>,
    pub(crate) content_type: Option<String>,
    pub(crate) source_path: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct StorageBlobGetRequest {
    pub(crate) db_path: String,
    pub(crate) user_handle: String,
    pub(crate) extension_id: String,
    pub(crate) blob_dir: String,
    pub(crate) id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct StorageBlobDeleteRequest {
    pub(crate) db_path: String,
    pub(crate) user_handle: String,
    pub(crate) extension_id: String,
    pub(crate) blob_dir: String,
    pub(crate) id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct StorageBlobListRequest {
    pub(crate) db_path: String,
    pub(crate) user_handle: String,
    pub(crate) extension_id: String,
    pub(crate) blob_dir: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ControlEventsPollRequest {
    pub(crate) db_path: String,
    pub(crate) user_handle: String,
    pub(crate) channel: String,
    pub(crate) after_id: Option<i64>,
    pub(crate) limit: Option<usize>,
    pub(crate) page: Option<CursorPageRequest>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CoreHttpFetchRequest {
    pub(crate) url: String,
    pub(crate) method: Option<String>,
    pub(crate) headers: Option<HashMap<String, String>>,
    pub(crate) body: Option<String>,
    pub(crate) body_encoding: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CoreHttpFetchOpenRequest {
    pub(crate) url: String,
    pub(crate) method: Option<String>,
    pub(crate) headers: Option<HashMap<String, String>>,
    pub(crate) body: Option<String>,
    pub(crate) body_encoding: Option<String>,
    pub(crate) body_source_path: Option<String>,
    pub(crate) response_path: String,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ControlGrantRecord {
    pub(crate) key: String,
    pub(crate) resource: String,
    pub(crate) target: String,
    pub(crate) status: String,
    pub(crate) scope: String,
    pub(crate) risk_level: String,
    pub(crate) updated_at: String,
    pub(crate) source: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) choice: Option<String>,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ControlPolicyEntry {
    pub(crate) key: String,
    pub(crate) resource: String,
    pub(crate) target: String,
    pub(crate) status: String,
    pub(crate) risk_level: String,
    pub(crate) updated_at: String,
    pub(crate) source: String,
}

#[derive(Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ControlExtensionLimitsPolicy {
    #[serde(default)]
    pub(crate) inline_threshold_bytes: HashMap<String, u64>,
    #[serde(default)]
    pub(crate) transfer_max_bytes: HashMap<String, u64>,
}

#[derive(Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ControlLimitsPoliciesDocument {
    #[serde(default)]
    pub(crate) extensions: HashMap<String, ControlExtensionLimitsPolicy>,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ControlPoliciesDocument {
    pub(crate) defaults: HashMap<String, String>,
    pub(crate) extensions: HashMap<String, HashMap<String, ControlPolicyEntry>>,
    #[serde(default)]
    pub(crate) limits: ControlLimitsPoliciesDocument,
    pub(crate) updated_at: String,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum JobAttemptEvent {
    Started,
    RetryScheduled,
    Completed,
    Failed,
    Cancelled,
    Recovered,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct JobAttemptRecord {
    pub(crate) attempt: i64,
    pub(crate) event: JobAttemptEvent,
    pub(crate) timestamp: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) summary: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) backoff_ms: Option<i64>,
}

pub(crate) fn is_none_or_empty_attempt_history(value: &Option<Vec<JobAttemptRecord>>) -> bool {
    value.as_ref().map(|items| items.is_empty()).unwrap_or(true)
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ControlJobRecord {
    pub(crate) id: String,
    pub(crate) extension_id: String,
    #[serde(rename = "type")]
    pub(crate) job_type: String,
    pub(crate) status: String,
    pub(crate) created_at: String,
    pub(crate) updated_at: String,
    pub(crate) progress: i64,
    pub(crate) summary: Option<String>,
    pub(crate) error: Option<String>,
    pub(crate) payload: Option<JsonValue>,
    pub(crate) result: Option<JsonValue>,
    pub(crate) channel: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) started_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) finished_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) timeout_ms: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) idempotency_key: Option<String>,
    #[serde(default, skip_serializing_if = "is_zero")]
    pub(crate) attempt: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) max_attempts: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) cancel_requested_at: Option<String>,
    #[serde(default, skip_serializing_if = "is_none_or_empty_attempt_history")]
    pub(crate) attempt_history: Option<Vec<JobAttemptRecord>>,
}

pub(crate) fn is_zero(value: &i64) -> bool {
    *value == 0
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct BlobRecord {
    pub(crate) id: String,
    pub(crate) name: String,
    pub(crate) content_type: String,
    pub(crate) size: i64,
    pub(crate) updated_at: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct BlobGetResponse {
    pub(crate) record: BlobRecord,
    pub(crate) content: String,
    pub(crate) encoding: &'static str,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct BlobOpenReadResponse {
    pub(crate) record: BlobRecord,
    pub(crate) source_path: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ControlEventRecord {
    pub(crate) id: i64,
    pub(crate) timestamp: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) extension_id: Option<String>,
    pub(crate) channel: String,
    pub(crate) name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) payload: Option<JsonValue>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct HttpFetchResponse {
    pub(crate) url: String,
    pub(crate) hostname: String,
    pub(crate) status: u16,
    pub(crate) ok: bool,
    pub(crate) headers: HashMap<String, String>,
    pub(crate) body: String,
    pub(crate) body_encoding: String,
    pub(crate) content_type: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct HttpFetchOpenResponse {
    pub(crate) url: String,
    pub(crate) hostname: String,
    pub(crate) status: u16,
    pub(crate) ok: bool,
    pub(crate) headers: HashMap<String, String>,
    pub(crate) body_encoding: String,
    pub(crate) content_type: String,
    pub(crate) size_bytes: usize,
}

pub(crate) struct FetchedHttpResponse {
    pub(crate) status: u16,
    pub(crate) ok: bool,
    pub(crate) headers: HashMap<String, String>,
    pub(crate) content_type: String,
    pub(crate) body_encoding: String,
    pub(crate) body_bytes: Vec<u8>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ControlExtensionRecord {
    pub(crate) id: String,
    pub(crate) install_type: String,
    pub(crate) display_name: String,
    pub(crate) version: String,
    pub(crate) first_seen_at: String,
    pub(crate) last_seen_at: String,
    pub(crate) declared_permissions: JsonValue,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) ui_label: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ControlSessionExtensionInfo {
    pub(crate) id: String,
    pub(crate) install_type: String,
    pub(crate) display_name: String,
    pub(crate) version: String,
    pub(crate) first_seen_at: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ControlSessionSnapshot {
    pub(crate) session_token: String,
    pub(crate) created_at: String,
    pub(crate) user: ControlUserInfo,
    pub(crate) extension: ControlSessionExtensionInfo,
    pub(crate) declared_permissions: JsonValue,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ControlAuditRecord {
    pub(crate) timestamp: String,
    pub(crate) kind: String,
    pub(crate) extension_id: String,
    pub(crate) message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) details: Option<JsonValue>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PrivateFileMkdirRequest {
    pub(crate) root_dir: String,
    pub(crate) path: String,
    pub(crate) recursive: Option<bool>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PrivateFileReadDirRequest {
    pub(crate) root_dir: String,
    pub(crate) path: String,
    pub(crate) limit: Option<usize>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PrivateFileWriteRequest {
    pub(crate) root_dir: String,
    pub(crate) path: String,
    pub(crate) content: String,
    pub(crate) encoding: Option<String>,
    pub(crate) create_parents: Option<bool>,
    pub(crate) source_path: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PrivateFileReadRequest {
    pub(crate) root_dir: String,
    pub(crate) path: String,
    pub(crate) encoding: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PrivateFileDeleteRequest {
    pub(crate) root_dir: String,
    pub(crate) path: String,
    pub(crate) recursive: Option<bool>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PrivateFileStatRequest {
    pub(crate) root_dir: String,
    pub(crate) path: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PrivateFileEntry {
    pub(crate) name: String,
    pub(crate) path: String,
    pub(crate) kind: String,
    pub(crate) size_bytes: i64,
    pub(crate) updated_at: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PrivateFileResponse {
    pub(crate) entry: PrivateFileEntry,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PrivateFileListResponse {
    pub(crate) entries: Vec<PrivateFileEntry>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PrivateFileReadResponse {
    pub(crate) entry: PrivateFileEntry,
    pub(crate) content: String,
    pub(crate) encoding: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PrivateFileOpenReadResponse {
    pub(crate) entry: PrivateFileEntry,
    pub(crate) source_path: String,
}

