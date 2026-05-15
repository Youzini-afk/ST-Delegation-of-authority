use std::collections::HashMap;

use serde::{Deserialize, Serialize};
use serde_json::Value as JsonValue;

use crate::pagination::{CursorPageInfo, CursorPageRequest};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TriviumOpenRequest {
    pub(crate) db_path: String,
    pub(crate) dim: Option<usize>,
    pub(crate) dtype: Option<String>,
    pub(crate) sync_mode: Option<String>,
    pub(crate) storage_mode: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TriviumInsertRequest {
    #[serde(flatten)]
    pub(crate) open: TriviumOpenRequest,
    pub(crate) vector: Vec<f64>,
    pub(crate) payload: JsonValue,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TriviumInsertWithIdRequest {
    #[serde(flatten)]
    pub(crate) open: TriviumOpenRequest,
    pub(crate) id: u64,
    pub(crate) vector: Vec<f64>,
    pub(crate) payload: JsonValue,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TriviumBulkUpsertItem {
    pub(crate) id: u64,
    pub(crate) vector: Vec<f64>,
    pub(crate) payload: JsonValue,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TriviumBulkUpsertRequest {
    #[serde(flatten)]
    pub(crate) open: TriviumOpenRequest,
    pub(crate) items: Vec<TriviumBulkUpsertItem>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TriviumGetRequest {
    #[serde(flatten)]
    pub(crate) open: TriviumOpenRequest,
    pub(crate) id: u64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TriviumUpdatePayloadRequest {
    #[serde(flatten)]
    pub(crate) open: TriviumOpenRequest,
    pub(crate) id: u64,
    pub(crate) payload: JsonValue,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TriviumUpdateVectorRequest {
    #[serde(flatten)]
    pub(crate) open: TriviumOpenRequest,
    pub(crate) id: u64,
    pub(crate) vector: Vec<f64>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TriviumDeleteRequest {
    #[serde(flatten)]
    pub(crate) open: TriviumOpenRequest,
    pub(crate) id: u64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TriviumLinkRequest {
    #[serde(flatten)]
    pub(crate) open: TriviumOpenRequest,
    pub(crate) src: u64,
    pub(crate) dst: u64,
    pub(crate) label: Option<String>,
    pub(crate) weight: Option<f64>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TriviumBulkLinkItem {
    pub(crate) src: u64,
    pub(crate) dst: u64,
    pub(crate) label: Option<String>,
    pub(crate) weight: Option<f64>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TriviumBulkLinkRequest {
    #[serde(flatten)]
    pub(crate) open: TriviumOpenRequest,
    pub(crate) items: Vec<TriviumBulkLinkItem>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TriviumUnlinkRequest {
    #[serde(flatten)]
    pub(crate) open: TriviumOpenRequest,
    pub(crate) src: u64,
    pub(crate) dst: u64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TriviumBulkUnlinkItem {
    pub(crate) src: u64,
    pub(crate) dst: u64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TriviumBulkUnlinkRequest {
    #[serde(flatten)]
    pub(crate) open: TriviumOpenRequest,
    pub(crate) items: Vec<TriviumBulkUnlinkItem>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TriviumBulkDeleteItem {
    pub(crate) id: u64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TriviumBulkDeleteRequest {
    #[serde(flatten)]
    pub(crate) open: TriviumOpenRequest,
    pub(crate) items: Vec<TriviumBulkDeleteItem>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TriviumNeighborsRequest {
    #[serde(flatten)]
    pub(crate) open: TriviumOpenRequest,
    pub(crate) id: u64,
    pub(crate) depth: Option<usize>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TriviumSearchRequest {
    #[serde(flatten)]
    pub(crate) open: TriviumOpenRequest,
    pub(crate) vector: Vec<f64>,
    pub(crate) top_k: Option<usize>,
    pub(crate) expand_depth: Option<usize>,
    pub(crate) min_score: Option<f32>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TriviumSearchAdvancedRequest {
    #[serde(flatten)]
    pub(crate) open: TriviumOpenRequest,
    pub(crate) vector: Vec<f64>,
    pub(crate) query_text: Option<String>,
    pub(crate) top_k: Option<usize>,
    pub(crate) expand_depth: Option<usize>,
    pub(crate) min_score: Option<f32>,
    pub(crate) teleport_alpha: Option<f32>,
    pub(crate) enable_advanced_pipeline: Option<bool>,
    pub(crate) enable_sparse_residual: Option<bool>,
    pub(crate) fista_lambda: Option<f32>,
    pub(crate) fista_threshold: Option<f32>,
    pub(crate) enable_dpp: Option<bool>,
    pub(crate) dpp_quality_weight: Option<f32>,
    pub(crate) enable_refractory_fatigue: Option<bool>,
    pub(crate) enable_inverse_inhibition: Option<bool>,
    pub(crate) lateral_inhibition_threshold: Option<usize>,
    pub(crate) force_brute_force: Option<bool>,
    pub(crate) text_boost: Option<f32>,
    pub(crate) enable_text_hybrid_search: Option<bool>,
    pub(crate) bm25_k1: Option<f32>,
    pub(crate) bm25_b: Option<f32>,
    pub(crate) payload_filter: Option<JsonValue>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TriviumSearchHybridRequest {
    #[serde(flatten)]
    pub(crate) open: TriviumOpenRequest,
    pub(crate) vector: Vec<f64>,
    pub(crate) query_text: String,
    pub(crate) top_k: Option<usize>,
    pub(crate) expand_depth: Option<usize>,
    pub(crate) min_score: Option<f32>,
    pub(crate) hybrid_alpha: Option<f32>,
    pub(crate) payload_filter: Option<JsonValue>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TriviumTqlRequest {
    #[serde(flatten)]
    pub(crate) open: TriviumOpenRequest,
    pub(crate) query: String,
    pub(crate) page: Option<CursorPageRequest>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TriviumTqlMutRequest {
    #[serde(flatten)]
    pub(crate) open: TriviumOpenRequest,
    pub(crate) query: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TriviumCreateIndexRequest {
    #[serde(flatten)]
    pub(crate) open: TriviumOpenRequest,
    pub(crate) field: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TriviumDropIndexRequest {
    #[serde(flatten)]
    pub(crate) open: TriviumOpenRequest,
    pub(crate) field: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TriviumIndexTextRequest {
    #[serde(flatten)]
    pub(crate) open: TriviumOpenRequest,
    pub(crate) id: u64,
    pub(crate) text: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TriviumIndexKeywordRequest {
    #[serde(flatten)]
    pub(crate) open: TriviumOpenRequest,
    pub(crate) id: u64,
    pub(crate) keyword: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TriviumBuildTextIndexRequest {
    #[serde(flatten)]
    pub(crate) open: TriviumOpenRequest,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TriviumCompactRequest {
    #[serde(flatten)]
    pub(crate) open: TriviumOpenRequest,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TriviumFlushRequest {
    #[serde(flatten)]
    pub(crate) open: TriviumOpenRequest,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TriviumStatRequest {
    #[serde(flatten)]
    pub(crate) open: TriviumOpenRequest,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TriviumInsertResponse {
    pub(crate) id: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TriviumBulkFailure {
    pub(crate) index: usize,
    pub(crate) message: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TriviumBulkMutationResponse {
    pub(crate) total_count: usize,
    pub(crate) success_count: usize,
    pub(crate) failure_count: usize,
    pub(crate) failures: Vec<TriviumBulkFailure>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TriviumBulkUpsertResponseItem {
    pub(crate) index: usize,
    pub(crate) id: u64,
    pub(crate) action: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TriviumBulkUpsertResponse {
    pub(crate) total_count: usize,
    pub(crate) success_count: usize,
    pub(crate) failure_count: usize,
    pub(crate) failures: Vec<TriviumBulkFailure>,
    pub(crate) items: Vec<TriviumBulkUpsertResponseItem>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TriviumEdgeView {
    pub(crate) target_id: u64,
    pub(crate) label: String,
    pub(crate) weight: f64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TriviumNodeView {
    pub(crate) id: u64,
    pub(crate) vector: Vec<f64>,
    pub(crate) payload: JsonValue,
    pub(crate) edges: Vec<TriviumEdgeView>,
    pub(crate) num_edges: usize,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TriviumSearchHit {
    pub(crate) id: u64,
    pub(crate) score: f64,
    pub(crate) payload: JsonValue,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TriviumNeighborsResponse {
    pub(crate) ids: Vec<u64>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TriviumTqlResponse {
    pub(crate) rows: Vec<HashMap<String, TriviumNodeView>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) page: Option<CursorPageInfo>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TriviumTqlMutResponse {
    pub(crate) affected: usize,
    pub(crate) created_ids: Vec<u64>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TriviumSearchStageTiming {
    pub(crate) stage: String,
    pub(crate) elapsed_ms: f64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TriviumSearchContext {
    pub(crate) custom_data: JsonValue,
    pub(crate) stage_timings: Vec<TriviumSearchStageTiming>,
    pub(crate) aborted: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TriviumSearchHybridWithContextResponse {
    pub(crate) hits: Vec<TriviumSearchHit>,
    pub(crate) context: TriviumSearchContext,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TriviumDatabaseRecord {
    pub(crate) name: String,
    pub(crate) file_name: String,
    pub(crate) dim: Option<usize>,
    pub(crate) dtype: Option<String>,
    pub(crate) sync_mode: Option<String>,
    pub(crate) storage_mode: Option<String>,
    pub(crate) size_bytes: u64,
    pub(crate) wal_size_bytes: u64,
    pub(crate) vec_size_bytes: u64,
    pub(crate) total_size_bytes: u64,
    pub(crate) updated_at: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TriviumStatResponse {
    pub(crate) database: String,
    pub(crate) file_path: String,
    pub(crate) exists: bool,
    pub(crate) node_count: usize,
    pub(crate) edge_count: usize,
    pub(crate) text_index_count: Option<usize>,
    pub(crate) last_flush_at: Option<String>,
    pub(crate) vector_dim: Option<usize>,
    pub(crate) database_size: u64,
    pub(crate) wal_size: u64,
    pub(crate) vec_size: u64,
    pub(crate) estimated_memory_bytes: usize,
    #[serde(flatten)]
    pub(crate) record: TriviumDatabaseRecord,
}

#[derive(Clone, Copy)]
pub(crate) enum TriviumDTypeTag {
    F32,
    F16,
    U64,
}

impl TriviumDTypeTag {
    pub(crate) fn as_str(self) -> &'static str {
        match self {
            Self::F32 => "f32",
            Self::F16 => "f16",
            Self::U64 => "u64",
        }
    }
}
