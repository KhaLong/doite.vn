//! Trang cá nhân công khai của một người dùng: uy tín, tin đang mở, đánh giá.
//! Không trả số điện thoại, lịch sử đăng nhập hay chi tiết giao dịch của họ.
//! Đánh giá: chỉ người đã cùng hoàn tất một giao dịch mới viết được, mỗi giao dịch một lần.

use axum::{
    Json,
    extract::{Path, State},
    http::{HeaderMap, HeaderValue, StatusCode, header},
    response::{IntoResponse, Response},
};
use serde::{Deserialize, Serialize};
use serde_json::json;

use crate::auth::{self, AppState};

const REVIEW_LIMIT: u32 = 30;
const COMMENT_MAX_CHARS: usize = 500;

fn no_store(mut response: Response) -> Response {
    response.headers_mut().insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    response
}

fn fail(status: StatusCode, reason: &str, field: Option<&str>) -> Response {
    no_store((status, Json(json!({ "ok": false, "reason": reason, "field": field }))).into_response())
}

fn internal(context: &str, error: impl std::fmt::Display) -> Response {
    eprintln!("{context}: {error}");
    fail(StatusCode::INTERNAL_SERVER_ERROR, "loi-may-chu", None)
}

#[derive(sqlx::FromRow)]
struct ProfileRow {
    id: u64,
    username: String,
    display_name: String,
    avatar_url: Option<String>,
    joined: String,
    trades_count: u32,
    success_permille: Option<u16>,
    escrow_vnd: u64,
    business_verified: bool,
    completed_trades: i64,
    disputed_trades: i64,
    review_count: i64,
    review_avg: Option<f64>,
}

#[derive(sqlx::FromRow, Serialize)]
#[serde(rename_all = "camelCase")]
struct PostRow {
    id: u64,
    kind: String,
    amount_cny: u32,
    rate_vnd: u32,
    channel_label: String,
    limit_label: String,
    age_seconds: i64,
    expires_in_seconds: Option<i64>,
}

#[derive(sqlx::FromRow, Serialize)]
#[serde(rename_all = "camelCase")]
struct ReviewRow {
    id: u64,
    stars: u8,
    comment: String,
    at: String,
    reviewer_username: String,
    reviewer_name: String,
    reviewer_avatar: Option<String>,
    trade_kind: String,
    trade_amount_cny: u32,
    /// Người được đánh giá là người đăng tin của giao dịch đó (để ghi Bán / Mua từ phía họ)
    #[sqlx(try_from = "i64")]
    reviewee_owned: Flag,
}

#[derive(sqlx::FromRow, Serialize)]
#[serde(rename_all = "camelCase")]
struct ReviewableTrade {
    id: u64,
    kind: String,
    amount_cny: u32,
    rate_vnd: u32,
    at: String,
    #[sqlx(try_from = "i64")]
    mine: Flag,
}

#[derive(Serialize)]
#[serde(transparent)]
struct Flag(bool);

impl From<i64> for Flag {
    fn from(value: i64) -> Self {
        Flag(value != 0)
    }
}

/// Tỷ lệ thành công ‰: số mẫu có sẵn thì dùng, không thì hoàn tất / (hoàn tất + khiếu nại).
fn success_permille(stored: Option<u16>, completed: i64, disputed: i64) -> Option<u16> {
    stored.or_else(|| {
        let total = completed + disputed;
        (total > 0).then(|| u16::try_from(completed * 1000 / total).unwrap_or(1000))
    })
}

async fn load_profile(state: &AppState, username: &str) -> sqlx::Result<Option<ProfileRow>> {
    sqlx::query_as(&format!(
        "SELECT u.id, u.username, u.display_name, {} AS avatar_url, \
                DATE_FORMAT(u.created_at, '%Y-%m-%dT%H:%i:%sZ') AS joined, \
                u.trades_count, u.success_permille, u.escrow_vnd, u.business_verified, \
                (SELECT COUNT(*) FROM trades t WHERE (t.owner_id = u.id OR t.counterparty_id = u.id) AND t.status = 'completed') AS completed_trades, \
                (SELECT COUNT(*) FROM trades t WHERE (t.owner_id = u.id OR t.counterparty_id = u.id) AND t.status = 'disputed') AS disputed_trades, \
                (SELECT COUNT(*) FROM reviews r WHERE r.reviewee_id = u.id) AS review_count, \
                (SELECT CAST(AVG(r.stars) AS DOUBLE) FROM reviews r WHERE r.reviewee_id = u.id) AS review_avg \
         FROM users u WHERE u.username = ? AND u.phone_verified_at IS NOT NULL",
        crate::avatar::AVATAR_URL_SQL
    ))
    .bind(username.trim().to_lowercase())
    .fetch_optional(&state.db)
    .await
}

/// Giao dịch hoàn tất giữa người xem và người này mà người xem chưa đánh giá.
async fn reviewable(state: &AppState, viewer: u64, target: u64) -> sqlx::Result<Vec<ReviewableTrade>> {
    sqlx::query_as(
        "SELECT t.id, t.kind, t.amount_cny, t.rate_vnd, DATE_FORMAT(COALESCE(t.completed_at, t.created_at), '%Y-%m-%dT%H:%i:%sZ') AS at, \
                (t.owner_id = ?) AS mine \
         FROM trades t \
         WHERE t.status = 'completed' \
           AND ((t.owner_id = ? AND t.counterparty_id = ?) OR (t.owner_id = ? AND t.counterparty_id = ?)) \
           AND NOT EXISTS (SELECT 1 FROM reviews r WHERE r.trade_id = t.id AND r.reviewer_id = ?) \
         ORDER BY t.created_at DESC LIMIT 50",
    )
    .bind(viewer)
    .bind(viewer)
    .bind(target)
    .bind(target)
    .bind(viewer)
    .bind(viewer)
    .fetch_all(&state.db)
    .await
}

/// GET /api/users/{username}
pub async fn profile(State(state): State<AppState>, headers: HeaderMap, Path(username): Path<String>) -> Response {
    let user = match load_profile(&state, &username).await {
        Ok(Some(user)) => user,
        Ok(None) => return fail(StatusCode::NOT_FOUND, "khong-tim-thay", None),
        Err(e) => return internal("public profile", e),
    };
    let viewer = auth::current_user_id(&state.db, &headers).await.ok().flatten();
    let posts: Vec<PostRow> = match sqlx::query_as(
        "SELECT p.id, p.kind, p.amount_cny, p.rate_vnd, p.channel_label, p.limit_label, \
                TIMESTAMPDIFF(SECOND, p.created_at, UTC_TIMESTAMP(3)) AS age_seconds, \
                TIMESTAMPDIFF(SECOND, UTC_TIMESTAMP(3), p.expires_at) AS expires_in_seconds \
         FROM posts p WHERE p.user_id = ? AND p.status = 'open' \
           AND (p.expires_at IS NULL OR p.expires_at > UTC_TIMESTAMP(3)) \
         ORDER BY p.created_at DESC LIMIT 50",
    )
    .bind(user.id)
    .fetch_all(&state.db)
    .await
    {
        Ok(rows) => rows,
        Err(e) => return internal("public posts", e),
    };
    let reviews: Vec<ReviewRow> = match sqlx::query_as(&format!(
        "SELECT r.id, r.stars, r.comment, DATE_FORMAT(r.created_at, '%Y-%m-%dT%H:%i:%sZ') AS at, \
                u.username AS reviewer_username, u.display_name AS reviewer_name, {} AS reviewer_avatar, \
                t.kind AS trade_kind, t.amount_cny AS trade_amount_cny, (t.owner_id = r.reviewee_id) AS reviewee_owned \
         FROM reviews r JOIN users u ON u.id = r.reviewer_id JOIN trades t ON t.id = r.trade_id \
         WHERE r.reviewee_id = ? ORDER BY r.created_at DESC LIMIT ?",
        crate::avatar::AVATAR_URL_SQL
    ))
    .bind(user.id)
    .bind(REVIEW_LIMIT)
    .fetch_all(&state.db)
    .await
    {
        Ok(rows) => rows,
        Err(e) => return internal("public reviews", e),
    };
    let is_self = viewer == Some(user.id);
    let can_review = match viewer {
        Some(viewer) if !is_self => match reviewable(&state, viewer, user.id).await {
            Ok(trades) => Some(trades),
            Err(e) => return internal("reviewable trades", e),
        },
        _ => None,
    };
    let completed = i64::from(user.trades_count) + user.completed_trades;
    no_store(
        Json(json!({
            "ok": true,
            "user": {
                "username": user.username,
                "displayName": user.display_name,
                "avatarUrl": user.avatar_url,
                "joined": user.joined,
                "completedTrades": completed,
                "successPermille": success_permille(user.success_permille, completed, user.disputed_trades),
                "escrowVnd": user.escrow_vnd,
                "businessVerified": user.business_verified,
                "reviewCount": user.review_count,
                "reviewAverage": user.review_avg,
            },
            "posts": posts,
            "reviews": reviews,
            "viewer": {
                "signedIn": viewer.is_some(),
                "isSelf": is_self,
                // null khi chưa đăng nhập hoặc là chính mình
                "reviewableTrades": can_review,
            },
        }))
        .into_response(),
    )
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewReview {
    trade_id: u64,
    stars: u8,
    #[serde(default)]
    comment: String,
}

fn clean_comment(raw: &str) -> Result<String, ()> {
    // Giữ xuống dòng, gộp khoảng trắng thừa trong từng dòng, bỏ dòng trống thừa
    let lines: Vec<String> = raw.lines().map(|line| line.split_whitespace().collect::<Vec<_>>().join(" ")).collect();
    let text = lines.join("\n").trim().to_owned();
    let text = text.split("\n\n\n").collect::<Vec<_>>().join("\n\n");
    if text.chars().count() > COMMENT_MAX_CHARS || text.chars().any(|c| c.is_control() && c != '\n') {
        return Err(());
    }
    Ok(text)
}

/// POST /api/users/{username}/reviews — chỉ người đã cùng hoàn tất giao dịch đó.
pub async fn create_review(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(username): Path<String>,
    Json(request): Json<NewReview>,
) -> Response {
    if !auth::same_origin(&headers) {
        return fail(StatusCode::FORBIDDEN, "forbidden", None);
    }
    let viewer = match auth::current_user_id(&state.db, &headers).await {
        Ok(Some(id)) => id,
        Ok(None) => return fail(StatusCode::UNAUTHORIZED, "chua-dang-nhap", None),
        Err(e) => return internal("review auth", e),
    };
    let target = match load_profile(&state, &username).await {
        Ok(Some(user)) => user.id,
        Ok(None) => return fail(StatusCode::NOT_FOUND, "khong-tim-thay", None),
        Err(e) => return internal("review target", e),
    };
    if !(1..=5).contains(&request.stars) {
        return fail(StatusCode::BAD_REQUEST, "chua-chon-sao", Some("stars"));
    }
    let Ok(comment) = clean_comment(&request.comment) else {
        return fail(StatusCode::BAD_REQUEST, "binh-luan-dai", Some("comment"));
    };
    let allowed = match reviewable(&state, viewer, target).await {
        Ok(trades) => trades.iter().any(|t| t.id == request.trade_id),
        Err(e) => return internal("review check", e),
    };
    if !allowed {
        return fail(StatusCode::FORBIDDEN, "khong-du-dieu-kien", Some("trade"));
    }
    match sqlx::query("INSERT INTO reviews (trade_id, reviewer_id, reviewee_id, stars, comment) VALUES (?, ?, ?, ?, ?)")
        .bind(request.trade_id)
        .bind(viewer)
        .bind(target)
        .bind(request.stars)
        .bind(&comment)
        .execute(&state.db)
        .await
    {
        Ok(result) => no_store(Json(json!({ "ok": true, "id": result.last_insert_id() })).into_response()),
        Err(sqlx::Error::Database(e)) if e.is_unique_violation() => fail(StatusCode::CONFLICT, "da-danh-gia", Some("trade")),
        Err(e) => internal("insert review", e),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn success_rate_prefers_stored_then_computes() {
        assert_eq!(success_permille(Some(992), 0, 0), Some(992));
        assert_eq!(success_permille(None, 9, 1), Some(900));
        assert_eq!(success_permille(None, 0, 0), None);
    }

    #[test]
    fn comment_is_cleaned_and_limited() {
        assert_eq!(clean_comment("  Giao   nhanh,\n uy tín  ").unwrap(), "Giao nhanh,\nuy tín");
        assert!(clean_comment(&"x".repeat(501)).is_err());
        assert!(clean_comment("a\u{0007}b").is_err());
        assert_eq!(clean_comment("").unwrap(), "");
    }
}
