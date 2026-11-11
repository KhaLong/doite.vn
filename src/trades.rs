//! Lịch sử giao dịch trên trang cá nhân: các giao dịch người dùng là người đăng tin
//! hoặc người chào giá, nhìn từ phía người đó (Bán / Mua / Thanh toán), lọc theo trạng thái.

use std::collections::HashMap;

use axum::{
    Json,
    extract::{Query, State},
    http::{HeaderMap, HeaderValue, StatusCode, header},
    response::{IntoResponse, Response},
};
use serde::{Deserialize, Serialize};
use serde_json::json;

use crate::auth::{self, AppState};

const PAGE_SIZE: u32 = 20;

#[derive(Deserialize)]
pub struct TradesQuery {
    /// all | processing (gồm cả khiếu nại) | completed | cancelled
    #[serde(default)]
    status: Option<String>,
    #[serde(default)]
    offset: Option<u32>,
}

#[derive(sqlx::FromRow)]
struct TradeRow {
    id: u64,
    at: String,
    mine: i64,
    kind: String,
    amount_cny: u32,
    rate_vnd: u32,
    status: String,
    partner_name: String,
    partner_username: String,
    partner_avatar: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct TradeView {
    id: u64,
    /// ISO 8601, UTC
    at: String,
    /// Nhìn từ phía người xem: sell = mình bán CNY, buy = mình mua CNY,
    /// pay = mình nhờ thanh toán hộ, pay-for = mình thanh toán hộ người khác.
    side: &'static str,
    amount_cny: u32,
    rate_vnd: u32,
    total_vnd: u64,
    status: String,
    partner: Partner,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Partner {
    username: String,
    display_name: String,
    avatar_url: Option<String>,
}

/// Loại giao dịch nhìn từ người xem. Người chào giá đứng ở phía ngược với tin.
fn side(kind: &str, mine: bool) -> &'static str {
    match (kind, mine) {
        ("sell", true) | ("buy", false) => "sell",
        ("buy", true) | ("sell", false) => "buy",
        ("pay", true) => "pay",
        _ => "pay-for",
    }
}

fn status_filter(status: Option<&str>) -> Option<&'static str> {
    match status {
        Some("processing") => Some("t.status IN ('processing', 'disputed')"),
        Some("completed") => Some("t.status = 'completed'"),
        Some("cancelled") => Some("t.status = 'cancelled'"),
        _ => None,
    }
}

fn fail(status: StatusCode, reason: &str) -> Response {
    let mut response = (status, Json(json!({ "ok": false, "reason": reason }))).into_response();
    response.headers_mut().insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    response
}

/// GET /api/account/trades?status=&offset=
pub async fn list(State(state): State<AppState>, headers: HeaderMap, Query(query): Query<TradesQuery>) -> Response {
    let user_id = match auth::current_user_id(&state.db, &headers).await {
        Ok(Some(id)) => id,
        Ok(None) => return fail(StatusCode::UNAUTHORIZED, "chua-dang-nhap"),
        Err(e) => {
            eprintln!("trades: {e}");
            return fail(StatusCode::INTERNAL_SERVER_ERROR, "loi-may-chu");
        }
    };
    let offset = query.offset.unwrap_or(0).min(100_000);
    let filter = status_filter(query.status.as_deref())
        .map(|clause| format!(" AND {clause}"))
        .unwrap_or_default();
    // Đối tác đứng tên alias `u` để dùng chung AVATAR_URL_SQL. Lấy dư một dòng để biết còn trang sau.
    let sql = format!(
        "SELECT t.id, DATE_FORMAT(t.created_at, '%Y-%m-%dT%H:%i:%sZ') AS at, (t.owner_id = ?) AS mine, \
                t.kind, t.amount_cny, t.rate_vnd, t.status, u.display_name AS partner_name, u.username AS partner_username, {} AS partner_avatar \
         FROM trades t JOIN users u ON u.id = IF(t.owner_id = ?, t.counterparty_id, t.owner_id) \
         WHERE (t.owner_id = ? OR t.counterparty_id = ?){filter} \
         ORDER BY (t.status IN ('processing', 'disputed')) DESC, t.created_at DESC, t.id DESC \
         LIMIT ? OFFSET ?",
        crate::avatar::AVATAR_URL_SQL
    );
    let rows: Vec<TradeRow> = match sqlx::query_as(&sql)
        .bind(user_id)
        .bind(user_id)
        .bind(user_id)
        .bind(user_id)
        .bind(PAGE_SIZE + 1)
        .bind(offset)
        .fetch_all(&state.db)
        .await
    {
        Ok(rows) => rows,
        Err(e) => {
            eprintln!("trades list: {e}");
            return fail(StatusCode::INTERNAL_SERVER_ERROR, "loi-may-chu");
        }
    };
    let counted: Vec<(String, i64)> = match sqlx::query_as(
        "SELECT status, COUNT(*) FROM trades WHERE owner_id = ? OR counterparty_id = ? GROUP BY status",
    )
    .bind(user_id)
    .bind(user_id)
    .fetch_all(&state.db)
    .await
    {
        Ok(rows) => rows,
        Err(e) => {
            eprintln!("trades count: {e}");
            return fail(StatusCode::INTERNAL_SERVER_ERROR, "loi-may-chu");
        }
    };
    let by_status: HashMap<String, i64> = counted.into_iter().collect();
    let count = |s: &str| by_status.get(s).copied().unwrap_or(0);
    let has_more = rows.len() > PAGE_SIZE as usize;
    let trades: Vec<TradeView> = rows
        .into_iter()
        .take(PAGE_SIZE as usize)
        .map(|r| TradeView {
            id: r.id,
            at: r.at,
            side: side(&r.kind, r.mine != 0),
            amount_cny: r.amount_cny,
            rate_vnd: r.rate_vnd,
            total_vnd: u64::from(r.amount_cny) * u64::from(r.rate_vnd),
            status: r.status,
            partner: Partner { username: r.partner_username, display_name: r.partner_name, avatar_url: r.partner_avatar },
        })
        .collect();
    let mut response = Json(json!({
        "ok": true,
        "trades": trades,
        "hasMore": has_more,
        "counts": {
            "all": by_status.values().sum::<i64>(),
            "processing": count("processing") + count("disputed"),
            "completed": count("completed"),
            "cancelled": count("cancelled"),
        },
    }))
    .into_response();
    response.headers_mut().insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    response
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn side_is_seen_from_viewer() {
        assert_eq!(side("sell", true), "sell"); // mình đăng tin bán
        assert_eq!(side("sell", false), "buy"); // mình chào giá mua của người bán
        assert_eq!(side("buy", true), "buy");
        assert_eq!(side("buy", false), "sell");
        assert_eq!(side("pay", true), "pay");
        assert_eq!(side("pay", false), "pay-for");
    }

    #[test]
    fn unknown_status_means_all() {
        assert_eq!(status_filter(Some("x' OR 1=1")), None);
        assert_eq!(status_filter(None), None);
        assert!(status_filter(Some("processing")).unwrap().contains("disputed"));
    }
}
