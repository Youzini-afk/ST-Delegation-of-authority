use std::fs;
use std::path::{Path, PathBuf};

use base64::Engine;
use base64::engine::general_purpose::STANDARD as BASE64_STANDARD;
use rusqlite::{Connection, OptionalExtension, params};
use serde_json::{Value as JsonValue, json};

use crate::constants::MAX_BLOB_BYTES;
use crate::core_types::{
    BlobGetResponse, BlobOpenReadResponse, BlobRecord, StorageBlobDeleteRequest,
    StorageBlobGetRequest, StorageBlobListRequest, StorageBlobPutRequest,
};
use crate::db::{open_connection, to_sql_error};
use crate::error::ApiError;
use crate::{
    current_timestamp_iso, decode_blob_content, ensure_control_schema, sanitize_file_segment,
    to_internal_error, validate_non_empty, validate_source_file_path,
};

pub(crate) fn handle_storage_blob_put(
    request: StorageBlobPutRequest,
) -> Result<JsonValue, ApiError> {
    validate_non_empty("userHandle", &request.user_handle)?;
    validate_non_empty("extensionId", &request.extension_id)?;
    validate_non_empty("blobDir", &request.blob_dir)?;

    let name = if request.name.trim().is_empty() {
        String::from("blob")
    } else {
        request.name.clone()
    };
    let blob_id = sanitize_file_segment(&name);

    let connection = open_connection(&request.db_path)?;
    ensure_control_schema(&connection)?;
    let binary_path = blob_binary_path(&request.blob_dir, &request.extension_id, &blob_id);
    if let Some(parent) = binary_path.parent() {
        fs::create_dir_all(parent).map_err(to_internal_error)?;
    }
    let size_bytes = if let Some(source_path) = request
        .source_path
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        let source_size = validate_source_file_path(source_path)?;
        if source_size > MAX_BLOB_BYTES as u64 {
            return Err(ApiError {
                status_code: 400,
                message: format!("Blob exceeds {} bytes", MAX_BLOB_BYTES),
            });
        }
        fs::copy(source_path, &binary_path).map_err(to_internal_error)?;
        usize::try_from(source_size).unwrap_or(MAX_BLOB_BYTES)
    } else {
        let payload = decode_blob_content(request.encoding.as_deref(), &request.content)?;
        if payload.len() > MAX_BLOB_BYTES {
            return Err(ApiError {
                status_code: 400,
                message: format!("Blob exceeds {} bytes", MAX_BLOB_BYTES),
            });
        }
        fs::write(&binary_path, &payload).map_err(to_internal_error)?;
        payload.len()
    };

    let record = BlobRecord {
        id: blob_id,
        name,
        content_type: request
            .content_type
            .unwrap_or_else(|| String::from("application/octet-stream")),
        size: size_bytes as i64,
        updated_at: current_timestamp_iso(),
    };
    upsert_blob_record(
        &connection,
        &request.user_handle,
        &request.extension_id,
        &record,
    )?;
    Ok(serde_json::to_value(record).expect("blob record should serialize"))
}

pub(crate) fn handle_storage_blob_get(
    request: StorageBlobGetRequest,
) -> Result<JsonValue, ApiError> {
    validate_non_empty("userHandle", &request.user_handle)?;
    validate_non_empty("extensionId", &request.extension_id)?;
    validate_non_empty("blobDir", &request.blob_dir)?;
    validate_non_empty("id", &request.id)?;

    let connection = open_connection(&request.db_path)?;
    ensure_control_schema(&connection)?;
    let record = fetch_blob_record(
        &connection,
        &request.user_handle,
        &request.extension_id,
        &request.id,
    )?
    .ok_or_else(|| ApiError {
        status_code: 400,
        message: String::from("Blob not found"),
    })?;
    let binary_path = blob_binary_path(&request.blob_dir, &request.extension_id, &record.id);
    if !binary_path.exists() {
        return Err(ApiError {
            status_code: 400,
            message: String::from("Blob not found"),
        });
    }

    let content = BASE64_STANDARD.encode(fs::read(binary_path).map_err(to_internal_error)?);
    Ok(serde_json::to_value(BlobGetResponse {
        record,
        content,
        encoding: "base64",
    })
    .expect("blob get response should serialize"))
}

pub(crate) fn handle_storage_blob_open_read(
    request: StorageBlobGetRequest,
) -> Result<JsonValue, ApiError> {
    validate_non_empty("userHandle", &request.user_handle)?;
    validate_non_empty("extensionId", &request.extension_id)?;
    validate_non_empty("blobDir", &request.blob_dir)?;
    validate_non_empty("id", &request.id)?;

    let connection = open_connection(&request.db_path)?;
    ensure_control_schema(&connection)?;
    let record = fetch_blob_record(
        &connection,
        &request.user_handle,
        &request.extension_id,
        &request.id,
    )?
    .ok_or_else(|| ApiError {
        status_code: 400,
        message: String::from("Blob not found"),
    })?;
    let binary_path = blob_binary_path(&request.blob_dir, &request.extension_id, &record.id);
    let metadata = fs::symlink_metadata(&binary_path).map_err(|error| {
        if error.kind() == std::io::ErrorKind::NotFound {
            return ApiError {
                status_code: 400,
                message: String::from("Blob not found"),
            };
        }
        to_internal_error(error)
    })?;
    if metadata.file_type().is_symlink() {
        return Err(ApiError {
            status_code: 400,
            message: String::from("blob_path_symlink_not_allowed"),
        });
    }
    if !metadata.is_file() {
        return Err(ApiError {
            status_code: 400,
            message: String::from("blob_path_is_not_file"),
        });
    }

    Ok(serde_json::to_value(BlobOpenReadResponse {
        record,
        source_path: binary_path.to_string_lossy().into_owned(),
    })
    .expect("blob open read response should serialize"))
}

pub(crate) fn handle_storage_blob_delete(
    request: StorageBlobDeleteRequest,
) -> Result<JsonValue, ApiError> {
    validate_non_empty("userHandle", &request.user_handle)?;
    validate_non_empty("extensionId", &request.extension_id)?;
    validate_non_empty("blobDir", &request.blob_dir)?;
    validate_non_empty("id", &request.id)?;

    let connection = open_connection(&request.db_path)?;
    ensure_control_schema(&connection)?;
    delete_blob_record(
        &connection,
        &request.user_handle,
        &request.extension_id,
        &request.id,
    )?;
    let binary_path = blob_binary_path(&request.blob_dir, &request.extension_id, &request.id);
    if let Err(error) = fs::remove_file(binary_path) {
        if error.kind() != std::io::ErrorKind::NotFound {
            return Err(to_internal_error(error));
        }
    }

    Ok(json!({ "ok": true }))
}

pub(crate) fn handle_storage_blob_list(
    request: StorageBlobListRequest,
) -> Result<JsonValue, ApiError> {
    validate_non_empty("userHandle", &request.user_handle)?;
    validate_non_empty("extensionId", &request.extension_id)?;
    validate_non_empty("blobDir", &request.blob_dir)?;

    let connection = open_connection(&request.db_path)?;
    ensure_control_schema(&connection)?;
    let entries = fetch_blob_records(&connection, &request.user_handle, &request.extension_id)?;
    Ok(json!({ "entries": entries }))
}

pub(crate) fn blob_binary_path(blob_dir: &str, extension_id: &str, blob_id: &str) -> PathBuf {
    Path::new(blob_dir)
        .join(sanitize_file_segment(extension_id))
        .join(format!("{}.bin", sanitize_file_segment(blob_id)))
}

fn upsert_blob_record(
    connection: &Connection,
    user_handle: &str,
    extension_id: &str,
    record: &BlobRecord,
) -> Result<(), ApiError> {
    connection
        .execute(
            "INSERT INTO authority_blob_records (user_handle, extension_id, id, name, content_type, size, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
         ON CONFLICT(user_handle, extension_id, id) DO UPDATE SET
            name = excluded.name,
            content_type = excluded.content_type,
            size = excluded.size,
            updated_at = excluded.updated_at",
            params![
                user_handle,
                extension_id,
                &record.id,
                &record.name,
                &record.content_type,
                record.size,
                &record.updated_at,
            ],
        )
        .map_err(to_sql_error)?;
    Ok(())
}

fn fetch_blob_record(
    connection: &Connection,
    user_handle: &str,
    extension_id: &str,
    blob_id: &str,
) -> Result<Option<BlobRecord>, ApiError> {
    let mut statement = connection
        .prepare(
            "SELECT id, name, content_type, size, updated_at
         FROM authority_blob_records
         WHERE user_handle = ?1 AND extension_id = ?2 AND id = ?3",
        )
        .map_err(to_sql_error)?;
    statement
        .query_row(
            params![user_handle, extension_id, blob_id],
            blob_record_from_row,
        )
        .optional()
        .map_err(to_sql_error)
}

fn fetch_blob_records(
    connection: &Connection,
    user_handle: &str,
    extension_id: &str,
) -> Result<Vec<BlobRecord>, ApiError> {
    let mut statement = connection
        .prepare(
            "SELECT id, name, content_type, size, updated_at
         FROM authority_blob_records
         WHERE user_handle = ?1 AND extension_id = ?2
         ORDER BY updated_at DESC, id DESC",
        )
        .map_err(to_sql_error)?;
    let rows = statement
        .query_map(params![user_handle, extension_id], blob_record_from_row)
        .map_err(to_sql_error)?;
    let mut records = Vec::new();
    for row in rows {
        records.push(row.map_err(to_sql_error)?);
    }
    Ok(records)
}

fn delete_blob_record(
    connection: &Connection,
    user_handle: &str,
    extension_id: &str,
    blob_id: &str,
) -> Result<(), ApiError> {
    connection
        .execute(
            "DELETE FROM authority_blob_records WHERE user_handle = ?1 AND extension_id = ?2 AND id = ?3",
            params![user_handle, extension_id, blob_id],
        )
        .map_err(to_sql_error)?;
    Ok(())
}

fn blob_record_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<BlobRecord> {
    Ok(BlobRecord {
        id: row.get(0)?,
        name: row.get(1)?,
        content_type: row.get(2)?,
        size: row.get(3)?,
        updated_at: row.get(4)?,
    })
}
