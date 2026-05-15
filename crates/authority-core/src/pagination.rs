use serde::{Deserialize, Serialize};

use crate::error::ApiError;

#[derive(Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CursorPageRequest {
    pub(crate) cursor: Option<String>,
    pub(crate) limit: Option<usize>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CursorPageInfo {
    pub(crate) next_cursor: Option<String>,
    pub(crate) limit: usize,
    pub(crate) has_more: bool,
    pub(crate) total_count: usize,
}

pub(crate) fn normalize_offset_page_request(
    page: Option<&CursorPageRequest>,
    legacy_limit: Option<usize>,
    default_limit: usize,
    max_limit: usize,
) -> Result<(usize, usize), ApiError> {
    let limit = page
        .and_then(|value| value.limit)
        .or(legacy_limit)
        .unwrap_or(default_limit)
        .clamp(1, max_limit);
    let offset = parse_offset_cursor(page.and_then(|value| value.cursor.as_deref()))?;
    Ok((offset, limit))
}

fn parse_offset_cursor(cursor: Option<&str>) -> Result<usize, ApiError> {
    match cursor {
        Some(value) if !value.is_empty() => value.parse::<usize>().map_err(|_| ApiError {
            status_code: 400,
            message: String::from("invalid_page_cursor"),
        }),
        _ => Ok(0),
    }
}

pub(crate) fn parse_event_cursor(cursor: Option<&str>) -> Result<Option<i64>, ApiError> {
    match cursor {
        Some(value) if !value.is_empty() => value.parse::<i64>().map(Some).map_err(|_| ApiError {
            status_code: 400,
            message: String::from("invalid_event_cursor"),
        }),
        _ => Ok(None),
    }
}

pub(crate) fn build_offset_page_info(offset: usize, limit: usize, total_count: usize) -> CursorPageInfo {
    let next_offset = offset.saturating_add(limit);
    CursorPageInfo {
        next_cursor: if next_offset < total_count {
            Some(next_offset.to_string())
        } else {
            None
        },
        limit,
        has_more: next_offset < total_count,
        total_count,
    }
}

pub(crate) fn slice_vec_page<T>(
    items: Vec<T>,
    page: Option<&CursorPageRequest>,
    default_limit: usize,
    max_limit: usize,
) -> Result<(Vec<T>, Option<CursorPageInfo>), ApiError> {
    match page {
        Some(page_request) => {
            let total_count = items.len();
            let (offset, limit) =
                normalize_offset_page_request(Some(page_request), None, default_limit, max_limit)?;
            let paged = items.into_iter().skip(offset).take(limit).collect();
            Ok((
                paged,
                Some(build_offset_page_info(offset, limit, total_count)),
            ))
        }
        None => Ok((items, None)),
    }
}
