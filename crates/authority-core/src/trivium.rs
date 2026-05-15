use std::collections::HashMap;
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::time::Instant;

use half::f16;
use serde_json::{Map as JsonMap, Value as JsonValue, json};
use triviumdb::database::{
    Config as TriviumConfig, Database as TriviumDatabase, SearchConfig as TriviumSearchConfig,
    StorageMode as TriviumStorageMode,
};
use triviumdb::filter::Filter as TriviumFilter;
use triviumdb::hook::HookContext as TriviumRawHookContext;
use triviumdb::node::{NodeView as TriviumRawNodeView, SearchHit as TriviumRawSearchHit};
use triviumdb::storage::wal::SyncMode as TriviumSyncMode;

use crate::constants::{MAX_TRIVIUM_BULK_ITEMS, SLOW_TRIVIUM_LOG_MS};
use crate::error::ApiError;
use crate::pagination::slice_vec_page;
use crate::trivium_types::*;
use crate::{emit_if_slow, system_time_to_iso, validate_non_empty};

pub(crate) fn handle_trivium_insert(request: TriviumInsertRequest) -> Result<JsonValue, ApiError> {
    let TriviumInsertRequest {
        mut open,
        vector,
        payload,
    } = request;
    infer_trivium_open_dimension(&mut open, Some(vector.len()));
    let id = match parse_trivium_dtype(open.dtype.as_deref())? {
        TriviumDTypeTag::F32 => {
            let mut db = open_trivium_f32(&open)?;
            db.insert(
                &vector.iter().map(|&value| value as f32).collect::<Vec<_>>(),
                payload,
            )
            .map_err(to_trivium_error)?
        }
        TriviumDTypeTag::F16 => {
            let mut db = open_trivium_f16(&open)?;
            db.insert(
                &vector
                    .iter()
                    .map(|&value| f16::from_f64(value))
                    .collect::<Vec<_>>(),
                payload,
            )
            .map_err(to_trivium_error)?
        }
        TriviumDTypeTag::U64 => {
            let mut db = open_trivium_u64(&open)?;
            db.insert(
                &vector.iter().map(|&value| value as u64).collect::<Vec<_>>(),
                payload,
            )
            .map_err(to_trivium_error)?
        }
    };

    Ok(serde_json::to_value(TriviumInsertResponse { id })
        .expect("trivium insert response should serialize"))
}

pub(crate) fn handle_trivium_insert_with_id(
    request: TriviumInsertWithIdRequest,
) -> Result<JsonValue, ApiError> {
    let TriviumInsertWithIdRequest {
        mut open,
        id,
        vector,
        payload,
    } = request;
    infer_trivium_open_dimension(&mut open, Some(vector.len()));
    match parse_trivium_dtype(open.dtype.as_deref())? {
        TriviumDTypeTag::F32 => {
            let mut db = open_trivium_f32(&open)?;
            db.insert_with_id(
                id,
                &vector.iter().map(|&value| value as f32).collect::<Vec<_>>(),
                payload,
            )
            .map_err(to_trivium_error)?;
        }
        TriviumDTypeTag::F16 => {
            let mut db = open_trivium_f16(&open)?;
            db.insert_with_id(
                id,
                &vector
                    .iter()
                    .map(|&value| f16::from_f64(value))
                    .collect::<Vec<_>>(),
                payload,
            )
            .map_err(to_trivium_error)?;
        }
        TriviumDTypeTag::U64 => {
            let mut db = open_trivium_u64(&open)?;
            db.insert_with_id(
                id,
                &vector.iter().map(|&value| value as u64).collect::<Vec<_>>(),
                payload,
            )
            .map_err(to_trivium_error)?;
        }
    }

    Ok(json!({ "ok": true }))
}

pub(crate) fn handle_trivium_bulk_upsert(request: TriviumBulkUpsertRequest) -> Result<JsonValue, ApiError> {
    validate_trivium_bulk_item_count(request.items.len())?;
    let TriviumBulkUpsertRequest {
        mut open,
        items: input_items,
    } = request;
    let total_count = input_items.len();
    if total_count == 0 {
        return Ok(serde_json::to_value(TriviumBulkUpsertResponse {
            total_count,
            success_count: 0,
            failure_count: 0,
            failures: Vec::new(),
            items: Vec::new(),
        })
        .expect("trivium bulk upsert response should serialize"));
    }
    infer_trivium_open_dimension(
        &mut open,
        input_items
            .iter()
            .find(|item| !item.vector.is_empty())
            .map(|item| item.vector.len()),
    );

    let mut failures = Vec::new();
    let mut items = Vec::new();
    match parse_trivium_dtype(open.dtype.as_deref())? {
        TriviumDTypeTag::F32 => {
            let mut db = open_trivium_f32(&open)?;
            for (index, item) in input_items.into_iter().enumerate() {
                let existing_node = db.get(item.id);
                let exists = existing_node.is_some();
                let vector = item
                    .vector
                    .iter()
                    .map(|&value| value as f32)
                    .collect::<Vec<_>>();
                let result = if let Some(existing_node) = existing_node {
                    let previous_vector = existing_node.vector;
                    match db.update_vector(item.id, &vector) {
                        Ok(()) => match db.update_payload(item.id, item.payload) {
                            Ok(()) => Ok(()),
                            Err(error) => {
                                let _ = db.update_vector(item.id, &previous_vector);
                                Err(error)
                            }
                        },
                        Err(error) => Err(error),
                    }
                } else {
                    db.insert_with_id(item.id, &vector, item.payload)
                        .map(|_| ())
                };
                match result {
                    Ok(()) => items.push(TriviumBulkUpsertResponseItem {
                        index,
                        id: item.id,
                        action: String::from(if exists { "updated" } else { "inserted" }),
                    }),
                    Err(error) => failures.push(TriviumBulkFailure {
                        index,
                        message: to_trivium_error(error).message,
                    }),
                }
            }
        }
        TriviumDTypeTag::F16 => {
            let mut db = open_trivium_f16(&open)?;
            for (index, item) in input_items.into_iter().enumerate() {
                let existing_node = db.get(item.id);
                let exists = existing_node.is_some();
                let vector = item
                    .vector
                    .iter()
                    .map(|&value| f16::from_f64(value))
                    .collect::<Vec<_>>();
                let result = if let Some(existing_node) = existing_node {
                    let previous_vector = existing_node.vector;
                    match db.update_vector(item.id, &vector) {
                        Ok(()) => match db.update_payload(item.id, item.payload) {
                            Ok(()) => Ok(()),
                            Err(error) => {
                                let _ = db.update_vector(item.id, &previous_vector);
                                Err(error)
                            }
                        },
                        Err(error) => Err(error),
                    }
                } else {
                    db.insert_with_id(item.id, &vector, item.payload)
                        .map(|_| ())
                };
                match result {
                    Ok(()) => items.push(TriviumBulkUpsertResponseItem {
                        index,
                        id: item.id,
                        action: String::from(if exists { "updated" } else { "inserted" }),
                    }),
                    Err(error) => failures.push(TriviumBulkFailure {
                        index,
                        message: to_trivium_error(error).message,
                    }),
                }
            }
        }
        TriviumDTypeTag::U64 => {
            let mut db = open_trivium_u64(&open)?;
            for (index, item) in input_items.into_iter().enumerate() {
                let existing_node = db.get(item.id);
                let exists = existing_node.is_some();
                let vector = item
                    .vector
                    .iter()
                    .map(|&value| value as u64)
                    .collect::<Vec<_>>();
                let result = if let Some(existing_node) = existing_node {
                    let previous_vector = existing_node.vector;
                    match db.update_vector(item.id, &vector) {
                        Ok(()) => match db.update_payload(item.id, item.payload) {
                            Ok(()) => Ok(()),
                            Err(error) => {
                                let _ = db.update_vector(item.id, &previous_vector);
                                Err(error)
                            }
                        },
                        Err(error) => Err(error),
                    }
                } else {
                    db.insert_with_id(item.id, &vector, item.payload)
                        .map(|_| ())
                };
                match result {
                    Ok(()) => items.push(TriviumBulkUpsertResponseItem {
                        index,
                        id: item.id,
                        action: String::from(if exists { "updated" } else { "inserted" }),
                    }),
                    Err(error) => failures.push(TriviumBulkFailure {
                        index,
                        message: to_trivium_error(error).message,
                    }),
                }
            }
        }
    }

    Ok(serde_json::to_value(TriviumBulkUpsertResponse {
        total_count,
        success_count: items.len(),
        failure_count: failures.len(),
        failures,
        items,
    })
    .expect("trivium bulk upsert response should serialize"))
}

pub(crate) fn handle_trivium_get(request: TriviumGetRequest) -> Result<JsonValue, ApiError> {
    let TriviumGetRequest { open, id } = request;
    let node = match parse_trivium_dtype(open.dtype.as_deref())? {
        TriviumDTypeTag::F32 => open_trivium_f32(&open)?
            .get(id)
            .map(|node| map_trivium_node(node, |value| value as f64)),
        TriviumDTypeTag::F16 => open_trivium_f16(&open)?
            .get(id)
            .map(|node| map_trivium_node(node, |value| value.to_f64())),
        TriviumDTypeTag::U64 => open_trivium_u64(&open)?
            .get(id)
            .map(|node| map_trivium_node(node, |value| value as f64)),
    };
    Ok(json!({ "node": node }))
}

pub(crate) fn handle_trivium_update_payload(
    request: TriviumUpdatePayloadRequest,
) -> Result<JsonValue, ApiError> {
    let TriviumUpdatePayloadRequest { open, id, payload } = request;
    match parse_trivium_dtype(open.dtype.as_deref())? {
        TriviumDTypeTag::F32 => open_trivium_f32(&open)?
            .update_payload(id, payload)
            .map_err(to_trivium_error)?,
        TriviumDTypeTag::F16 => open_trivium_f16(&open)?
            .update_payload(id, payload)
            .map_err(to_trivium_error)?,
        TriviumDTypeTag::U64 => open_trivium_u64(&open)?
            .update_payload(id, payload)
            .map_err(to_trivium_error)?,
    }
    Ok(json!({ "ok": true }))
}

pub(crate) fn handle_trivium_bulk_unlink(request: TriviumBulkUnlinkRequest) -> Result<JsonValue, ApiError> {
    validate_trivium_bulk_item_count(request.items.len())?;
    let total_count = request.items.len();
    let mut failures = Vec::new();
    match parse_trivium_dtype(request.open.dtype.as_deref())? {
        TriviumDTypeTag::F32 => {
            let mut db = open_trivium_f32(&request.open)?;
            for (index, item) in request.items.into_iter().enumerate() {
                if let Err(error) = db.unlink(item.src, item.dst) {
                    failures.push(TriviumBulkFailure {
                        index,
                        message: to_trivium_error(error).message,
                    });
                }
            }
        }
        TriviumDTypeTag::F16 => {
            let mut db = open_trivium_f16(&request.open)?;
            for (index, item) in request.items.into_iter().enumerate() {
                if let Err(error) = db.unlink(item.src, item.dst) {
                    failures.push(TriviumBulkFailure {
                        index,
                        message: to_trivium_error(error).message,
                    });
                }
            }
        }
        TriviumDTypeTag::U64 => {
            let mut db = open_trivium_u64(&request.open)?;
            for (index, item) in request.items.into_iter().enumerate() {
                if let Err(error) = db.unlink(item.src, item.dst) {
                    failures.push(TriviumBulkFailure {
                        index,
                        message: to_trivium_error(error).message,
                    });
                }
            }
        }
    }

    Ok(serde_json::to_value(TriviumBulkMutationResponse {
        total_count,
        success_count: total_count.saturating_sub(failures.len()),
        failure_count: failures.len(),
        failures,
    })
    .expect("trivium bulk unlink response should serialize"))
}

pub(crate) fn handle_trivium_update_vector(
    request: TriviumUpdateVectorRequest,
) -> Result<JsonValue, ApiError> {
    let TriviumUpdateVectorRequest { open, id, vector } = request;
    match parse_trivium_dtype(open.dtype.as_deref())? {
        TriviumDTypeTag::F32 => {
            open_trivium_f32(&open)?
                .update_vector(
                    id,
                    &vector.iter().map(|&value| value as f32).collect::<Vec<_>>(),
                )
                .map_err(to_trivium_error)?;
        }
        TriviumDTypeTag::F16 => {
            open_trivium_f16(&open)?
                .update_vector(
                    id,
                    &vector
                        .iter()
                        .map(|&value| f16::from_f64(value))
                        .collect::<Vec<_>>(),
                )
                .map_err(to_trivium_error)?;
        }
        TriviumDTypeTag::U64 => {
            open_trivium_u64(&open)?
                .update_vector(
                    id,
                    &vector.iter().map(|&value| value as u64).collect::<Vec<_>>(),
                )
                .map_err(to_trivium_error)?;
        }
    }
    Ok(json!({ "ok": true }))
}

pub(crate) fn handle_trivium_delete(request: TriviumDeleteRequest) -> Result<JsonValue, ApiError> {
    let TriviumDeleteRequest { open, id } = request;
    match parse_trivium_dtype(open.dtype.as_deref())? {
        TriviumDTypeTag::F32 => open_trivium_f32(&open)?
            .delete(id)
            .map_err(to_trivium_error)?,
        TriviumDTypeTag::F16 => open_trivium_f16(&open)?
            .delete(id)
            .map_err(to_trivium_error)?,
        TriviumDTypeTag::U64 => open_trivium_u64(&open)?
            .delete(id)
            .map_err(to_trivium_error)?,
    }
    Ok(json!({ "ok": true }))
}

pub(crate) fn handle_trivium_bulk_delete(request: TriviumBulkDeleteRequest) -> Result<JsonValue, ApiError> {
    validate_trivium_bulk_item_count(request.items.len())?;
    let total_count = request.items.len();
    let mut failures = Vec::new();
    match parse_trivium_dtype(request.open.dtype.as_deref())? {
        TriviumDTypeTag::F32 => {
            let mut db = open_trivium_f32(&request.open)?;
            for (index, item) in request.items.into_iter().enumerate() {
                if let Err(error) = db.delete(item.id) {
                    failures.push(TriviumBulkFailure {
                        index,
                        message: to_trivium_error(error).message,
                    });
                }
            }
        }
        TriviumDTypeTag::F16 => {
            let mut db = open_trivium_f16(&request.open)?;
            for (index, item) in request.items.into_iter().enumerate() {
                if let Err(error) = db.delete(item.id) {
                    failures.push(TriviumBulkFailure {
                        index,
                        message: to_trivium_error(error).message,
                    });
                }
            }
        }
        TriviumDTypeTag::U64 => {
            let mut db = open_trivium_u64(&request.open)?;
            for (index, item) in request.items.into_iter().enumerate() {
                if let Err(error) = db.delete(item.id) {
                    failures.push(TriviumBulkFailure {
                        index,
                        message: to_trivium_error(error).message,
                    });
                }
            }
        }
    }

    Ok(serde_json::to_value(TriviumBulkMutationResponse {
        total_count,
        success_count: total_count.saturating_sub(failures.len()),
        failure_count: failures.len(),
        failures,
    })
    .expect("trivium bulk delete response should serialize"))
}

pub(crate) fn handle_trivium_link(request: TriviumLinkRequest) -> Result<JsonValue, ApiError> {
    let TriviumLinkRequest {
        open,
        src,
        dst,
        label,
        weight,
    } = request;
    let label = label.unwrap_or_else(|| String::from("related"));
    let weight = weight.unwrap_or(1.0) as f32;
    match parse_trivium_dtype(open.dtype.as_deref())? {
        TriviumDTypeTag::F32 => open_trivium_f32(&open)?
            .link(src, dst, &label, weight)
            .map_err(to_trivium_error)?,
        TriviumDTypeTag::F16 => open_trivium_f16(&open)?
            .link(src, dst, &label, weight)
            .map_err(to_trivium_error)?,
        TriviumDTypeTag::U64 => open_trivium_u64(&open)?
            .link(src, dst, &label, weight)
            .map_err(to_trivium_error)?,
    }
    Ok(json!({ "ok": true }))
}

pub(crate) fn handle_trivium_bulk_link(request: TriviumBulkLinkRequest) -> Result<JsonValue, ApiError> {
    validate_trivium_bulk_item_count(request.items.len())?;
    let total_count = request.items.len();
    let mut failures = Vec::new();
    match parse_trivium_dtype(request.open.dtype.as_deref())? {
        TriviumDTypeTag::F32 => {
            let mut db = open_trivium_f32(&request.open)?;
            for (index, item) in request.items.into_iter().enumerate() {
                let label = item.label.unwrap_or_else(|| String::from("related"));
                let weight = item.weight.unwrap_or(1.0) as f32;
                if let Err(error) = db.link(item.src, item.dst, &label, weight) {
                    failures.push(TriviumBulkFailure {
                        index,
                        message: to_trivium_error(error).message,
                    });
                }
            }
        }
        TriviumDTypeTag::F16 => {
            let mut db = open_trivium_f16(&request.open)?;
            for (index, item) in request.items.into_iter().enumerate() {
                let label = item.label.unwrap_or_else(|| String::from("related"));
                let weight = item.weight.unwrap_or(1.0) as f32;
                if let Err(error) = db.link(item.src, item.dst, &label, weight) {
                    failures.push(TriviumBulkFailure {
                        index,
                        message: to_trivium_error(error).message,
                    });
                }
            }
        }
        TriviumDTypeTag::U64 => {
            let mut db = open_trivium_u64(&request.open)?;
            for (index, item) in request.items.into_iter().enumerate() {
                let label = item.label.unwrap_or_else(|| String::from("related"));
                let weight = item.weight.unwrap_or(1.0) as f32;
                if let Err(error) = db.link(item.src, item.dst, &label, weight) {
                    failures.push(TriviumBulkFailure {
                        index,
                        message: to_trivium_error(error).message,
                    });
                }
            }
        }
    }

    Ok(serde_json::to_value(TriviumBulkMutationResponse {
        total_count,
        success_count: total_count.saturating_sub(failures.len()),
        failure_count: failures.len(),
        failures,
    })
    .expect("trivium bulk link response should serialize"))
}

pub(crate) fn handle_trivium_unlink(request: TriviumUnlinkRequest) -> Result<JsonValue, ApiError> {
    let TriviumUnlinkRequest { open, src, dst } = request;
    match parse_trivium_dtype(open.dtype.as_deref())? {
        TriviumDTypeTag::F32 => open_trivium_f32(&open)?
            .unlink(src, dst)
            .map_err(to_trivium_error)?,
        TriviumDTypeTag::F16 => open_trivium_f16(&open)?
            .unlink(src, dst)
            .map_err(to_trivium_error)?,
        TriviumDTypeTag::U64 => open_trivium_u64(&open)?
            .unlink(src, dst)
            .map_err(to_trivium_error)?,
    }
    Ok(json!({ "ok": true }))
}

pub(crate) fn handle_trivium_neighbors(request: TriviumNeighborsRequest) -> Result<JsonValue, ApiError> {
    let TriviumNeighborsRequest { open, id, depth } = request;
    let depth = depth.unwrap_or(1);
    let ids = match parse_trivium_dtype(open.dtype.as_deref())? {
        TriviumDTypeTag::F32 => open_trivium_f32(&open)?.neighbors(id, depth),
        TriviumDTypeTag::F16 => open_trivium_f16(&open)?.neighbors(id, depth),
        TriviumDTypeTag::U64 => open_trivium_u64(&open)?.neighbors(id, depth),
    };
    Ok(serde_json::to_value(TriviumNeighborsResponse { ids })
        .expect("trivium neighbors response should serialize"))
}

pub(crate) fn handle_trivium_search(request: TriviumSearchRequest) -> Result<JsonValue, ApiError> {
    let started = Instant::now();
    let TriviumSearchRequest {
        open,
        vector,
        top_k,
        expand_depth,
        min_score,
    } = request;
    let top_k = top_k.unwrap_or(5);
    let expand_depth = expand_depth.unwrap_or(0);
    let min_score = min_score.unwrap_or(0.5);
    let hits = match parse_trivium_dtype(open.dtype.as_deref())? {
        TriviumDTypeTag::F32 => open_trivium_f32(&open)?
            .search(
                &vector.iter().map(|&value| value as f32).collect::<Vec<_>>(),
                top_k,
                expand_depth,
                min_score,
            )
            .map_err(to_trivium_error)?,
        TriviumDTypeTag::F16 => open_trivium_f16(&open)?
            .search(
                &vector
                    .iter()
                    .map(|&value| f16::from_f64(value))
                    .collect::<Vec<_>>(),
                top_k,
                expand_depth,
                min_score,
            )
            .map_err(to_trivium_error)?,
        TriviumDTypeTag::U64 => open_trivium_u64(&open)?
            .search(
                &vector.iter().map(|&value| value as u64).collect::<Vec<_>>(),
                top_k,
                expand_depth,
                min_score,
            )
            .map_err(to_trivium_error)?,
    };
    let hits: Vec<TriviumSearchHit> = hits.into_iter().map(map_trivium_search_hit).collect();
    emit_if_slow(
        "trivium_slow_search",
        started.elapsed(),
        SLOW_TRIVIUM_LOG_MS,
        json!({
            "dbPath": open.db_path,
            "mode": "vector",
            "topK": top_k,
            "hitCount": hits.len(),
        }),
    );
    Ok(json!({ "hits": hits }))
}

pub(crate) fn handle_trivium_search_advanced(
    request: TriviumSearchAdvancedRequest,
) -> Result<JsonValue, ApiError> {
    let started = Instant::now();
    if let Some(value) = request.query_text.as_deref() {
        validate_non_empty("queryText", value)?;
    }

    let config = build_trivium_advanced_search_config(&request)?;
    let query_text = request.query_text.as_deref();
    let hits = match parse_trivium_dtype(request.open.dtype.as_deref())? {
        TriviumDTypeTag::F32 => open_trivium_f32(&request.open)?
            .search_hybrid(
                query_text,
                Some(
                    &request
                        .vector
                        .iter()
                        .map(|&value| value as f32)
                        .collect::<Vec<_>>(),
                ),
                &config,
            )
            .map_err(to_trivium_error)?,
        TriviumDTypeTag::F16 => open_trivium_f16(&request.open)?
            .search_hybrid(
                query_text,
                Some(
                    &request
                        .vector
                        .iter()
                        .map(|&value| f16::from_f64(value))
                        .collect::<Vec<_>>(),
                ),
                &config,
            )
            .map_err(to_trivium_error)?,
        TriviumDTypeTag::U64 => open_trivium_u64(&request.open)?
            .search_hybrid(
                query_text,
                Some(
                    &request
                        .vector
                        .iter()
                        .map(|&value| value as u64)
                        .collect::<Vec<_>>(),
                ),
                &config,
            )
            .map_err(to_trivium_error)?,
    };
    let hits: Vec<TriviumSearchHit> = hits.into_iter().map(map_trivium_search_hit).collect();
    emit_if_slow(
        "trivium_slow_search",
        started.elapsed(),
        SLOW_TRIVIUM_LOG_MS,
        json!({
            "dbPath": request.open.db_path,
            "mode": "advanced",
            "topK": request.top_k.unwrap_or(5),
            "hitCount": hits.len(),
        }),
    );
    Ok(json!({ "hits": hits }))
}

pub(crate) fn handle_trivium_search_hybrid(
    request: TriviumSearchHybridRequest,
) -> Result<JsonValue, ApiError> {
    let started = Instant::now();
    validate_non_empty("queryText", &request.query_text)?;

    let config = build_trivium_hybrid_search_config(&request)?;
    let hits = match parse_trivium_dtype(request.open.dtype.as_deref())? {
        TriviumDTypeTag::F32 => open_trivium_f32(&request.open)?
            .search_hybrid(
                Some(&request.query_text),
                Some(
                    &request
                        .vector
                        .iter()
                        .map(|&value| value as f32)
                        .collect::<Vec<_>>(),
                ),
                &config,
            )
            .map_err(to_trivium_error)?,
        TriviumDTypeTag::F16 => open_trivium_f16(&request.open)?
            .search_hybrid(
                Some(&request.query_text),
                Some(
                    &request
                        .vector
                        .iter()
                        .map(|&value| f16::from_f64(value))
                        .collect::<Vec<_>>(),
                ),
                &config,
            )
            .map_err(to_trivium_error)?,
        TriviumDTypeTag::U64 => open_trivium_u64(&request.open)?
            .search_hybrid(
                Some(&request.query_text),
                Some(
                    &request
                        .vector
                        .iter()
                        .map(|&value| value as u64)
                        .collect::<Vec<_>>(),
                ),
                &config,
            )
            .map_err(to_trivium_error)?,
    };
    let hits: Vec<TriviumSearchHit> = hits.into_iter().map(map_trivium_search_hit).collect();
    emit_if_slow(
        "trivium_slow_search",
        started.elapsed(),
        SLOW_TRIVIUM_LOG_MS,
        json!({
            "dbPath": request.open.db_path,
            "mode": "hybrid",
            "topK": request.top_k.unwrap_or(5),
            "hitCount": hits.len(),
        }),
    );
    Ok(json!({ "hits": hits }))
}

pub(crate) fn handle_trivium_search_hybrid_with_context(
    request: TriviumSearchHybridRequest,
) -> Result<JsonValue, ApiError> {
    let started = Instant::now();
    validate_non_empty("queryText", &request.query_text)?;

    let config = build_trivium_hybrid_search_config(&request)?;
    let (hits, context) = match parse_trivium_dtype(request.open.dtype.as_deref())? {
        TriviumDTypeTag::F32 => open_trivium_f32(&request.open)?
            .search_hybrid_with_context(
                Some(&request.query_text),
                Some(
                    &request
                        .vector
                        .iter()
                        .map(|&value| value as f32)
                        .collect::<Vec<_>>(),
                ),
                &config,
            )
            .map_err(to_trivium_error)?,
        TriviumDTypeTag::F16 => open_trivium_f16(&request.open)?
            .search_hybrid_with_context(
                Some(&request.query_text),
                Some(
                    &request
                        .vector
                        .iter()
                        .map(|&value| f16::from_f64(value))
                        .collect::<Vec<_>>(),
                ),
                &config,
            )
            .map_err(to_trivium_error)?,
        TriviumDTypeTag::U64 => open_trivium_u64(&request.open)?
            .search_hybrid_with_context(
                Some(&request.query_text),
                Some(
                    &request
                        .vector
                        .iter()
                        .map(|&value| value as u64)
                        .collect::<Vec<_>>(),
                ),
                &config,
            )
            .map_err(to_trivium_error)?,
    };
    let hits: Vec<TriviumSearchHit> = hits.into_iter().map(map_trivium_search_hit).collect();
    emit_if_slow(
        "trivium_slow_search",
        started.elapsed(),
        SLOW_TRIVIUM_LOG_MS,
        json!({
            "dbPath": request.open.db_path,
            "mode": "hybrid-context",
            "topK": request.top_k.unwrap_or(5),
            "hitCount": hits.len(),
        }),
    );
    Ok(
        serde_json::to_value(TriviumSearchHybridWithContextResponse {
            hits,
            context: map_trivium_hook_context(context),
        })
        .expect("trivium hybrid search with context response should serialize"),
    )
}

pub(crate) fn handle_trivium_tql(request: TriviumTqlRequest) -> Result<JsonValue, ApiError> {
    validate_non_empty("query", &request.query)?;

    let mut rows = match parse_trivium_dtype(request.open.dtype.as_deref())? {
        TriviumDTypeTag::F32 => map_trivium_query_rows(
            open_trivium_f32(&request.open)?
                .tql(&request.query)
                .map_err(to_trivium_error)?,
            |value| value as f64,
        ),
        TriviumDTypeTag::F16 => map_trivium_query_rows(
            open_trivium_f16(&request.open)?
                .tql(&request.query)
                .map_err(to_trivium_error)?,
            |value| value.to_f64(),
        ),
        TriviumDTypeTag::U64 => map_trivium_query_rows(
            open_trivium_u64(&request.open)?
                .tql(&request.query)
                .map_err(to_trivium_error)?,
            |value| value as f64,
        ),
    };
    if request.page.is_some() {
        sort_trivium_query_rows(&mut rows);
    }
    let (rows, page) = slice_vec_page(rows, request.page.as_ref(), 100, 1000)?;

    Ok(
        serde_json::to_value(TriviumTqlResponse { rows, page })
            .expect("trivium tql response should serialize"),
    )
}

pub(crate) fn handle_trivium_tql_mut(request: TriviumTqlMutRequest) -> Result<JsonValue, ApiError> {
    validate_non_empty("query", &request.query)?;

    let result = match parse_trivium_dtype(request.open.dtype.as_deref())? {
        TriviumDTypeTag::F32 => open_trivium_f32(&request.open)?
            .tql_mut(&request.query)
            .map_err(to_trivium_error)?,
        TriviumDTypeTag::F16 => open_trivium_f16(&request.open)?
            .tql_mut(&request.query)
            .map_err(to_trivium_error)?,
        TriviumDTypeTag::U64 => open_trivium_u64(&request.open)?
            .tql_mut(&request.query)
            .map_err(to_trivium_error)?,
    };

    Ok(
        serde_json::to_value(TriviumTqlMutResponse {
            affected: result.affected,
            created_ids: result.created_ids,
        })
        .expect("trivium tql mutation response should serialize"),
    )
}

pub(crate) fn handle_trivium_create_index(request: TriviumCreateIndexRequest) -> Result<JsonValue, ApiError> {
    validate_non_empty("field", &request.field)?;

    match parse_trivium_dtype(request.open.dtype.as_deref())? {
        TriviumDTypeTag::F32 => open_trivium_f32(&request.open)?.create_index(&request.field),
        TriviumDTypeTag::F16 => open_trivium_f16(&request.open)?.create_index(&request.field),
        TriviumDTypeTag::U64 => open_trivium_u64(&request.open)?.create_index(&request.field),
    }

    Ok(json!({ "ok": true }))
}

pub(crate) fn handle_trivium_drop_index(request: TriviumDropIndexRequest) -> Result<JsonValue, ApiError> {
    validate_non_empty("field", &request.field)?;

    match parse_trivium_dtype(request.open.dtype.as_deref())? {
        TriviumDTypeTag::F32 => open_trivium_f32(&request.open)?.drop_index(&request.field),
        TriviumDTypeTag::F16 => open_trivium_f16(&request.open)?.drop_index(&request.field),
        TriviumDTypeTag::U64 => open_trivium_u64(&request.open)?.drop_index(&request.field),
    }

    Ok(json!({ "ok": true }))
}

pub(crate) fn handle_trivium_index_text(request: TriviumIndexTextRequest) -> Result<JsonValue, ApiError> {
    validate_non_empty("text", &request.text)?;

    match parse_trivium_dtype(request.open.dtype.as_deref())? {
        TriviumDTypeTag::F32 => {
            let mut db = open_trivium_f32(&request.open)?;
            db.index_text(request.id, &request.text)
                .map_err(to_trivium_error)?;
        }
        TriviumDTypeTag::F16 => {
            let mut db = open_trivium_f16(&request.open)?;
            db.index_text(request.id, &request.text)
                .map_err(to_trivium_error)?;
        }
        TriviumDTypeTag::U64 => {
            let mut db = open_trivium_u64(&request.open)?;
            db.index_text(request.id, &request.text)
                .map_err(to_trivium_error)?;
        }
    }

    Ok(json!({ "ok": true }))
}

pub(crate) fn handle_trivium_index_keyword(
    request: TriviumIndexKeywordRequest,
) -> Result<JsonValue, ApiError> {
    validate_non_empty("keyword", &request.keyword)?;

    match parse_trivium_dtype(request.open.dtype.as_deref())? {
        TriviumDTypeTag::F32 => {
            let mut db = open_trivium_f32(&request.open)?;
            db.index_keyword(request.id, &request.keyword)
                .map_err(to_trivium_error)?;
        }
        TriviumDTypeTag::F16 => {
            let mut db = open_trivium_f16(&request.open)?;
            db.index_keyword(request.id, &request.keyword)
                .map_err(to_trivium_error)?;
        }
        TriviumDTypeTag::U64 => {
            let mut db = open_trivium_u64(&request.open)?;
            db.index_keyword(request.id, &request.keyword)
                .map_err(to_trivium_error)?;
        }
    }

    Ok(json!({ "ok": true }))
}

pub(crate) fn handle_trivium_build_text_index(
    request: TriviumBuildTextIndexRequest,
) -> Result<JsonValue, ApiError> {
    match parse_trivium_dtype(request.open.dtype.as_deref())? {
        TriviumDTypeTag::F32 => {
            let mut db = open_trivium_f32(&request.open)?;
            db.build_text_index().map_err(to_trivium_error)?;
        }
        TriviumDTypeTag::F16 => {
            let mut db = open_trivium_f16(&request.open)?;
            db.build_text_index().map_err(to_trivium_error)?;
        }
        TriviumDTypeTag::U64 => {
            let mut db = open_trivium_u64(&request.open)?;
            db.build_text_index().map_err(to_trivium_error)?;
        }
    }

    Ok(json!({ "ok": true }))
}

pub(crate) fn handle_trivium_compact(request: TriviumCompactRequest) -> Result<JsonValue, ApiError> {
    let TriviumCompactRequest { open } = request;
    match parse_trivium_dtype(open.dtype.as_deref())? {
        TriviumDTypeTag::F32 => open_trivium_f32(&open)?.compact().map_err(to_trivium_error)?,
        TriviumDTypeTag::F16 => open_trivium_f16(&open)?.compact().map_err(to_trivium_error)?,
        TriviumDTypeTag::U64 => open_trivium_u64(&open)?.compact().map_err(to_trivium_error)?,
    }

    Ok(json!({ "ok": true }))
}

pub(crate) fn handle_trivium_flush(request: TriviumFlushRequest) -> Result<JsonValue, ApiError> {
    let TriviumFlushRequest { open } = request;
    match parse_trivium_dtype(open.dtype.as_deref())? {
        TriviumDTypeTag::F32 => open_trivium_f32(&open)?.flush().map_err(to_trivium_error)?,
        TriviumDTypeTag::F16 => open_trivium_f16(&open)?.flush().map_err(to_trivium_error)?,
        TriviumDTypeTag::U64 => open_trivium_u64(&open)?.flush().map_err(to_trivium_error)?,
    }
    Ok(json!({ "ok": true }))
}

pub(crate) fn handle_trivium_stat(request: TriviumStatRequest) -> Result<JsonValue, ApiError> {
    let TriviumStatRequest { open } = request;
    validate_non_empty("dbPath", &open.db_path)?;
    validate_trivium_dim(open.dim)?;

    let dtype = parse_trivium_dtype(open.dtype.as_deref())?;
    let sync_mode = parse_trivium_sync_mode(open.sync_mode.as_deref())?;
    let storage_mode = parse_trivium_storage_mode(open.storage_mode.as_deref())?;
    let db_path = Path::new(&open.db_path);
    let file_name = db_path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or(&open.db_path)
        .to_string();
    let database = db_path
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("default")
        .to_string();
    let exists = db_path.exists();
    let detected_dim = if exists {
        read_trivium_dimension_from_file(db_path)
    } else {
        None
    };

    let mut record = build_trivium_database_record(
        &open.db_path,
        database.clone(),
        file_name,
        detected_dim.or(open.dim),
        Some(dtype.as_str().to_string()),
        Some(trivium_sync_mode_to_string(sync_mode).to_string()),
        Some(trivium_storage_mode_to_string(storage_mode).to_string()),
    );

    if !exists {
        let response = TriviumStatResponse {
            database,
            file_path: open.db_path,
            exists: false,
            node_count: 0,
            edge_count: 0,
            text_index_count: None,
            last_flush_at: None,
            vector_dim: record.dim,
            database_size: record.size_bytes,
            wal_size: record.wal_size_bytes,
            vec_size: record.vec_size_bytes,
            estimated_memory_bytes: 0,
            record,
        };
        return Ok(serde_json::to_value(response).expect("trivium stat response should serialize"));
    }

    let (node_count, edge_count, estimated_memory_bytes) = match dtype {
        TriviumDTypeTag::F32 => {
            let db = open_trivium_f32(&open)?;
            let edge_count = db
                .all_node_ids()
                .into_iter()
                .map(|id| db.get_edges(id).len())
                .sum();
            (db.node_count(), edge_count, db.estimated_memory())
        }
        TriviumDTypeTag::F16 => {
            let db = open_trivium_f16(&open)?;
            let edge_count = db
                .all_node_ids()
                .into_iter()
                .map(|id| db.get_edges(id).len())
                .sum();
            (db.node_count(), edge_count, db.estimated_memory())
        }
        TriviumDTypeTag::U64 => {
            let db = open_trivium_u64(&open)?;
            let edge_count = db
                .all_node_ids()
                .into_iter()
                .map(|id| db.get_edges(id).len())
                .sum();
            (db.node_count(), edge_count, db.estimated_memory())
        }
    };
    record.dim = detected_dim.or(record.dim);

    let response = TriviumStatResponse {
        database,
        file_path: open.db_path,
        exists: true,
        node_count,
        edge_count,
        text_index_count: None,
        last_flush_at: None,
        vector_dim: record.dim,
        database_size: record.size_bytes,
        wal_size: record.wal_size_bytes,
        vec_size: record.vec_size_bytes,
        estimated_memory_bytes,
        record,
    };
    Ok(serde_json::to_value(response).expect("trivium stat response should serialize"))
}

fn parse_trivium_dtype(value: Option<&str>) -> Result<TriviumDTypeTag, ApiError> {
    match value.unwrap_or("f32") {
        "f32" => Ok(TriviumDTypeTag::F32),
        "f16" => Ok(TriviumDTypeTag::F16),
        "u64" => Ok(TriviumDTypeTag::U64),
        other => Err(ApiError {
            status_code: 400,
            message: format!("trivium dtype must be one of f32/f16/u64, got {other}"),
        }),
    }
}

fn parse_trivium_sync_mode(value: Option<&str>) -> Result<TriviumSyncMode, ApiError> {
    match value.unwrap_or("normal") {
        "full" => Ok(TriviumSyncMode::Full),
        "normal" => Ok(TriviumSyncMode::Normal),
        "off" => Ok(TriviumSyncMode::Off),
        other => Err(ApiError {
            status_code: 400,
            message: format!("trivium syncMode must be one of full/normal/off, got {other}"),
        }),
    }
}

fn parse_trivium_storage_mode(value: Option<&str>) -> Result<TriviumStorageMode, ApiError> {
    match value.unwrap_or("mmap") {
        "mmap" => Ok(TriviumStorageMode::Mmap),
        "rom" => Ok(TriviumStorageMode::Rom),
        other => Err(ApiError {
            status_code: 400,
            message: format!("trivium storageMode must be one of mmap/rom, got {other}"),
        }),
    }
}

fn build_trivium_config(request: &TriviumOpenRequest) -> Result<TriviumConfig, ApiError> {
    validate_non_empty("dbPath", &request.db_path)?;
    let db_path = Path::new(&request.db_path);
    let stored_dim = if db_path.exists() {
        read_trivium_dimension_from_file(db_path)
    } else {
        None
    };
    if matches!(request.dim, Some(0)) {
        return Err(ApiError {
            status_code: 400,
            message: String::from("trivium dim must be positive"),
        });
    }
    if let (Some(request_dim), Some(stored_dim)) = (request.dim, stored_dim) {
        if request_dim != stored_dim {
            return Err(ApiError {
                status_code: 400,
                message: format!(
                    "trivium database is {stored_dim}-dimensional; request dim is {request_dim}"
                ),
            });
        }
    }
    Ok(TriviumConfig {
        dim: request.dim.or(stored_dim).unwrap_or(1536),
        sync_mode: parse_trivium_sync_mode(request.sync_mode.as_deref())?,
        storage_mode: parse_trivium_storage_mode(request.storage_mode.as_deref())?,
    })
}

fn validate_trivium_dim(dim: Option<usize>) -> Result<(), ApiError> {
    if matches!(dim, Some(0)) {
        return Err(ApiError {
            status_code: 400,
            message: String::from("trivium dim must be positive"),
        });
    }
    Ok(())
}

fn infer_trivium_open_dimension(request: &mut TriviumOpenRequest, vector_dim: Option<usize>) {
    if request.dim.is_some() {
        return;
    }
    request.dim = read_trivium_dimension_from_file(Path::new(&request.db_path)).or(vector_dim);
}

fn open_trivium_f32(request: &TriviumOpenRequest) -> Result<TriviumDatabase<f32>, ApiError> {
    TriviumDatabase::<f32>::open_with_config(&request.db_path, build_trivium_config(request)?)
        .map_err(to_trivium_error)
}

fn open_trivium_f16(request: &TriviumOpenRequest) -> Result<TriviumDatabase<f16>, ApiError> {
    TriviumDatabase::<f16>::open_with_config(&request.db_path, build_trivium_config(request)?)
        .map_err(to_trivium_error)
}

fn open_trivium_u64(request: &TriviumOpenRequest) -> Result<TriviumDatabase<u64>, ApiError> {
    TriviumDatabase::<u64>::open_with_config(&request.db_path, build_trivium_config(request)?)
        .map_err(to_trivium_error)
}

fn map_trivium_node<T, F>(node: TriviumRawNodeView<T>, map_value: F) -> TriviumNodeView
where
    T: Copy,
    F: Fn(T) -> f64,
{
    let edges: Vec<TriviumEdgeView> = node
        .edges
        .into_iter()
        .map(|edge| TriviumEdgeView {
            target_id: edge.target_id,
            label: edge.label,
            weight: edge.weight as f64,
        })
        .collect();
    let num_edges = edges.len();

    TriviumNodeView {
        id: node.id,
        vector: node.vector.into_iter().map(map_value).collect(),
        payload: node.payload,
        edges,
        num_edges,
    }
}

fn map_trivium_search_hit(hit: TriviumRawSearchHit) -> TriviumSearchHit {
    TriviumSearchHit {
        id: hit.id,
        score: hit.score as f64,
        payload: hit.payload,
    }
}

fn map_trivium_query_rows<T, F>(
    rows: Vec<HashMap<String, TriviumRawNodeView<T>>>,
    map_value: F,
) -> Vec<HashMap<String, TriviumNodeView>>
where
    T: Copy,
    F: Fn(T) -> f64 + Copy,
{
    rows.into_iter()
        .map(|row| {
            row.into_iter()
                .map(|(key, node)| (key, map_trivium_node(node, map_value)))
                .collect()
        })
        .collect()
}

fn sort_trivium_query_rows(rows: &mut [HashMap<String, TriviumNodeView>]) {
    rows.sort_by_cached_key(trivium_query_row_sort_key);
}

fn trivium_query_row_sort_key(row: &HashMap<String, TriviumNodeView>) -> Vec<(String, u64)> {
    let mut fields = row
        .iter()
        .map(|(key, node)| (key.clone(), node.id))
        .collect::<Vec<_>>();
    fields.sort();
    fields
}

fn map_trivium_hook_context(context: TriviumRawHookContext) -> TriviumSearchContext {
    TriviumSearchContext {
        custom_data: context.custom_data,
        stage_timings: context
            .stage_timings
            .into_iter()
            .map(|(stage, elapsed)| TriviumSearchStageTiming {
                stage,
                elapsed_ms: elapsed.as_secs_f64() * 1000.0,
            })
            .collect(),
        aborted: context.abort,
    }
}

fn build_trivium_advanced_search_config(
    request: &TriviumSearchAdvancedRequest,
) -> Result<TriviumSearchConfig, ApiError> {
    Ok(TriviumSearchConfig {
        top_k: request.top_k.unwrap_or(5),
        expand_depth: request.expand_depth.unwrap_or(2),
        min_score: request.min_score.unwrap_or(0.1),
        teleport_alpha: request.teleport_alpha.unwrap_or(0.0),
        enable_advanced_pipeline: request.enable_advanced_pipeline.unwrap_or(true),
        enable_sparse_residual: request.enable_sparse_residual.unwrap_or(false),
        fista_lambda: request.fista_lambda.unwrap_or(0.1),
        fista_threshold: request.fista_threshold.unwrap_or(0.3),
        enable_dpp: request.enable_dpp.unwrap_or(false),
        dpp_quality_weight: request.dpp_quality_weight.unwrap_or(1.0),
        enable_refractory_fatigue: request.enable_refractory_fatigue.unwrap_or(false),
        enable_inverse_inhibition: request.enable_inverse_inhibition.unwrap_or(false),
        lateral_inhibition_threshold: request.lateral_inhibition_threshold.unwrap_or(0),
        force_brute_force: request.force_brute_force.unwrap_or(false),
        text_boost: request.text_boost.unwrap_or(1.5),
        enable_text_hybrid_search: request.enable_text_hybrid_search.unwrap_or(false),
        bm25_k1: request.bm25_k1.unwrap_or(1.2),
        bm25_b: request.bm25_b.unwrap_or(0.75),
        payload_filter: request
            .payload_filter
            .as_ref()
            .map(parse_trivium_filter_condition)
            .transpose()?,
    })
}

fn build_trivium_hybrid_search_config(
    request: &TriviumSearchHybridRequest,
) -> Result<TriviumSearchConfig, ApiError> {
    let hybrid_alpha = request.hybrid_alpha.unwrap_or(0.7);
    Ok(TriviumSearchConfig {
        top_k: request.top_k.unwrap_or(5),
        expand_depth: request.expand_depth.unwrap_or(2),
        min_score: request.min_score.unwrap_or(0.1),
        text_boost: (1.0 - hybrid_alpha).max(0.1) * 3.0,
        enable_text_hybrid_search: true,
        payload_filter: request
            .payload_filter
            .as_ref()
            .map(parse_trivium_filter_condition)
            .transpose()?,
        ..Default::default()
    })
}

fn parse_trivium_filter_condition(value: &JsonValue) -> Result<TriviumFilter, ApiError> {
    let object = value.as_object().ok_or_else(|| ApiError {
        status_code: 400,
        message: String::from("trivium filter condition must be a JSON object"),
    })?;
    parse_trivium_filter_object(object)
}

fn parse_trivium_filter_object(
    object: &JsonMap<String, JsonValue>,
) -> Result<TriviumFilter, ApiError> {
    let mut filters = Vec::new();

    for (key, value) in object {
        if key == "$and" {
            let values = value.as_array().ok_or_else(|| ApiError {
                status_code: 400,
                message: String::from("trivium filter $and must be an array"),
            })?;
            let filters_and = values
                .iter()
                .map(parse_trivium_filter_condition)
                .collect::<Result<Vec<_>, _>>()?;
            filters.push(TriviumFilter::And(filters_and));
            continue;
        }

        if key == "$or" {
            let values = value.as_array().ok_or_else(|| ApiError {
                status_code: 400,
                message: String::from("trivium filter $or must be an array"),
            })?;
            let filters_or = values
                .iter()
                .map(parse_trivium_filter_condition)
                .collect::<Result<Vec<_>, _>>()?;
            filters.push(TriviumFilter::Or(filters_or));
            continue;
        }

        if let Some(operator_map) = value.as_object() {
            for (operator, operand) in operator_map {
                let filter = match operator.as_str() {
                    "$eq" => TriviumFilter::Eq(key.clone(), operand.clone()),
                    "$ne" => TriviumFilter::Ne(key.clone(), operand.clone()),
                    "$gt" => TriviumFilter::Gt(
                        key.clone(),
                        operand.as_f64().ok_or_else(|| ApiError {
                            status_code: 400,
                            message: String::from("trivium filter $gt requires a number"),
                        })?,
                    ),
                    "$gte" => TriviumFilter::Gte(
                        key.clone(),
                        operand.as_f64().ok_or_else(|| ApiError {
                            status_code: 400,
                            message: String::from("trivium filter $gte requires a number"),
                        })?,
                    ),
                    "$lt" => TriviumFilter::Lt(
                        key.clone(),
                        operand.as_f64().ok_or_else(|| ApiError {
                            status_code: 400,
                            message: String::from("trivium filter $lt requires a number"),
                        })?,
                    ),
                    "$lte" => TriviumFilter::Lte(
                        key.clone(),
                        operand.as_f64().ok_or_else(|| ApiError {
                            status_code: 400,
                            message: String::from("trivium filter $lte requires a number"),
                        })?,
                    ),
                    "$in" => TriviumFilter::In(
                        key.clone(),
                        operand.as_array().cloned().ok_or_else(|| ApiError {
                            status_code: 400,
                            message: String::from("trivium filter $in requires an array"),
                        })?,
                    ),
                    "$exists" => TriviumFilter::Exists(
                        key.clone(),
                        operand.as_bool().ok_or_else(|| ApiError {
                            status_code: 400,
                            message: String::from("trivium filter $exists requires a boolean"),
                        })?,
                    ),
                    "$nin" => TriviumFilter::Nin(
                        key.clone(),
                        operand.as_array().cloned().ok_or_else(|| ApiError {
                            status_code: 400,
                            message: String::from("trivium filter $nin requires an array"),
                        })?,
                    ),
                    "$size" => TriviumFilter::Size(
                        key.clone(),
                        operand.as_u64().ok_or_else(|| ApiError {
                            status_code: 400,
                            message: String::from(
                                "trivium filter $size requires a non-negative integer",
                            ),
                        })? as usize,
                    ),
                    "$all" => TriviumFilter::All(
                        key.clone(),
                        operand.as_array().cloned().ok_or_else(|| ApiError {
                            status_code: 400,
                            message: String::from("trivium filter $all requires an array"),
                        })?,
                    ),
                    "$type" => TriviumFilter::TypeMatch(
                        key.clone(),
                        operand
                            .as_str()
                            .ok_or_else(|| ApiError {
                                status_code: 400,
                                message: String::from("trivium filter $type requires a string"),
                            })?
                            .to_string(),
                    ),
                    other => {
                        return Err(ApiError {
                            status_code: 400,
                            message: format!("unsupported trivium filter operator: {other}"),
                        });
                    }
                };
                filters.push(filter);
            }
        } else {
            filters.push(TriviumFilter::Eq(key.clone(), value.clone()));
        }
    }

    if filters.is_empty() {
        Ok(TriviumFilter::Eq(String::from("none"), JsonValue::Null))
    } else if filters.len() == 1 {
        Ok(filters
            .pop()
            .expect("trivium filter should contain one item"))
    } else {
        Ok(TriviumFilter::And(filters))
    }
}

pub(crate) fn read_trivium_dimension_from_file(path: &Path) -> Option<usize> {
    let mut file = fs::File::open(path).ok()?;
    let mut header = [0u8; 10];
    file.read_exact(&mut header).ok()?;
    if &header[0..4] != b"TVDB" {
        return None;
    }
    let dim = u32::from_le_bytes([header[6], header[7], header[8], header[9]]) as usize;
    (dim > 0).then_some(dim)
}

pub(crate) fn build_trivium_database_record(
    db_path: &str,
    database: String,
    file_name: String,
    dim: Option<usize>,
    dtype: Option<String>,
    sync_mode: Option<String>,
    storage_mode: Option<String>,
) -> TriviumDatabaseRecord {
    let path = Path::new(db_path);
    let wal_path = PathBuf::from(format!("{}.wal", db_path));
    let vec_path = PathBuf::from(format!("{}.vec", db_path));
    let main_metadata = fs::metadata(path).ok();
    let wal_metadata = fs::metadata(&wal_path).ok();
    let vec_metadata = fs::metadata(&vec_path).ok();
    let size_bytes = main_metadata
        .as_ref()
        .map(|metadata| metadata.len())
        .unwrap_or(0);
    let wal_size_bytes = wal_metadata
        .as_ref()
        .map(|metadata| metadata.len())
        .unwrap_or(0);
    let vec_size_bytes = vec_metadata
        .as_ref()
        .map(|metadata| metadata.len())
        .unwrap_or(0);
    let actual_storage_mode = if main_metadata.is_some() {
        Some(if vec_metadata.is_some() {
            String::from("mmap")
        } else {
            String::from("rom")
        })
    } else {
        storage_mode
    };
    let mut timestamps = Vec::new();
    if let Some(metadata) = &main_metadata {
        timestamps.push(metadata.modified().ok().and_then(system_time_to_iso));
    }
    if let Some(metadata) = &wal_metadata {
        timestamps.push(metadata.modified().ok().and_then(system_time_to_iso));
    }
    if let Some(metadata) = &vec_metadata {
        timestamps.push(metadata.modified().ok().and_then(system_time_to_iso));
    }
    timestamps.retain(|value| value.is_some());
    timestamps.sort();

    TriviumDatabaseRecord {
        name: database,
        file_name,
        dim,
        dtype,
        sync_mode,
        storage_mode: actual_storage_mode,
        size_bytes,
        wal_size_bytes,
        vec_size_bytes,
        total_size_bytes: size_bytes + wal_size_bytes + vec_size_bytes,
        updated_at: timestamps.into_iter().flatten().last(),
    }
}

fn trivium_sync_mode_to_string(mode: TriviumSyncMode) -> &'static str {
    match mode {
        TriviumSyncMode::Full => "full",
        TriviumSyncMode::Normal => "normal",
        TriviumSyncMode::Off => "off",
    }
}

fn trivium_storage_mode_to_string(mode: TriviumStorageMode) -> &'static str {
    match mode {
        TriviumStorageMode::Mmap => "mmap",
        TriviumStorageMode::Rom => "rom",
    }
}


fn to_trivium_error(error: impl std::fmt::Display) -> ApiError {
    ApiError {
        status_code: 400,
        message: format!("trivium_error: {error}"),
    }
}

fn validate_trivium_bulk_item_count(count: usize) -> Result<(), ApiError> {
    if count <= MAX_TRIVIUM_BULK_ITEMS {
        return Ok(());
    }
    Err(ApiError {
        status_code: 400,
        message: format!("trivium bulk item count exceeds {}", MAX_TRIVIUM_BULK_ITEMS),
    })
}
