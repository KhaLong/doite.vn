//! Bảng tin: các tin đổi tệ đang mở (chưa hết hạn), kèm uy tín người đăng; đăng tin mới.

use axum::{
    Json,
    extract::State,
    http::{HeaderMap, HeaderValue, StatusCode, header},
    response::{IntoResponse, Response},
};
use serde::{Deserialize, Serialize};
use serde_json::json;

use crate::auth::{self, AppState};

/// Trả tối đa chừng này tin mới nhất; trang chủ tự lọc và đếm phía trình duyệt.
const MAX_POSTS: u32 = 200;

/// Tỷ giá tham chiếu (₫/¥) dùng để chặn tỷ giá nhập nhầm. Khớp REFERENCE.mid ở index.html.
/// Khi có nguồn tỷ giá thật thì thay bằng giá lấy từ nguồn đó.
pub const REFERENCE_RATE_VND: u32 = 3530;
/// Tỷ giá được lệch tối đa ±10% so với tham chiếu.
const RATE_BAND_PERCENT: u32 = 10;
const AMOUNT_MIN_CNY: u32 = 100;
const AMOUNT_MAX_CNY: u32 = 1_000_000;
const NOTE_MAX_CHARS: usize = 120;
/// Mỗi tài khoản tối đa chừng này tin đang mở (chống spam).
const MAX_OPEN_POSTS: i64 = 5;
/// Hạn nhận chào giá được chọn (phút): 30 phút, 2 giờ, 24 giờ.
const ALLOWED_MINUTES: [u32; 3] = [30, 120, 1440];
/// Khoá kênh (dùng cho bộ lọc Kênh) → nhãn hiện trên tin.
const CHANNELS: [(&str, &str); 4] = [
    ("alipay", "Alipay"),
    ("wechat", "WeChat Pay"),
    ("bank", "Ngân hàng"),
    ("taobao", "QR Taobao / 1688"),
];

/// Điều kiện SQL của tin còn trên Bảng tin.
const OPEN_SQL: &str = "p.status = 'open' AND (p.expires_at IS NULL OR p.expires_at > UTC_TIMESTAMP(3))";

#[derive(sqlx::FromRow, Serialize)]
#[serde(rename_all = "camelCase")]
struct PostRow {
    id: u64,
    kind: String,
    amount_cny: u32,
    rate_vnd: u32,
    channel_label: String,
    channels: String,
    limit_label: String,
    urgent_label: Option<String>,
    age_seconds: i64,
    /// Số giây còn nhận chào giá; null khi tin không có hạn.
    expires_in_seconds: Option<i64>,
    username: String,
    display_name: String,
    avatar_url: Option<String>,
    trades_count: u32,
    success_permille: Option<u16>,
    escrow_vnd: u64,
    business_verified: bool,
    /// Tin của người đang xem (đã đăng nhập): không có nút Chào giá, được tô nổi.
    #[sqlx(try_from = "i64")]
    mine: MineFlag,
}

/// MySQL trả biểu thức so sánh dạng số nguyên; đổi sang bool khi gửi JSON.
#[derive(Serialize)]
#[serde(transparent)]
struct MineFlag(bool);

impl From<i64> for MineFlag {
    fn from(value: i64) -> Self {
        MineFlag(value != 0)
    }
}

pub async fn list(State(state): State<AppState>, headers: HeaderMap) -> Response {
    // Chưa đăng nhập: id 0, không tin nào là "của mình"
    let viewer = auth::current_user_id(&state.db, &headers).await.ok().flatten().unwrap_or(0);
    let rows: Result<Vec<PostRow>, _> = sqlx::query_as(&format!(
        "SELECT p.id, p.kind, p.amount_cny, p.rate_vnd, p.channel_label, p.channels, p.limit_label, \
                p.urgent_label, TIMESTAMPDIFF(SECOND, p.created_at, UTC_TIMESTAMP(3)) AS age_seconds, \
                TIMESTAMPDIFF(SECOND, UTC_TIMESTAMP(3), p.expires_at) AS expires_in_seconds, \
                u.username, u.display_name, {} AS avatar_url, u.trades_count, u.success_permille, u.escrow_vnd, u.business_verified, \
                (p.user_id = ?) AS mine \
         FROM posts p JOIN users u ON u.id = p.user_id \
         WHERE {OPEN_SQL} \
         ORDER BY p.created_at DESC LIMIT ?",
        crate::avatar::AVATAR_URL_SQL
    ))
    .bind(viewer)
    .bind(MAX_POSTS)
    .fetch_all(&state.db)
    .await;
    match rows {
        Ok(posts) => {
            let mut response = Json(json!({ "ok": true, "posts": posts })).into_response();
            response
                .headers_mut()
                .insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
            response
        }
        Err(e) => {
            eprintln!("list posts: {e}");
            fail(StatusCode::INTERNAL_SERVER_ERROR, "loi-may-chu", None)
        }
    }
}

fn fail(status: StatusCode, reason: &str, field: Option<&str>) -> Response {
    let mut response = (status, Json(json!({ "ok": false, "reason": reason, "field": field }))).into_response();
    response.headers_mut().insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    response
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewPost {
    kind: String,
    amount_cny: u32,
    rate_vnd: u32,
    channels: Vec<String>,
    #[serde(default)]
    note: String,
    minutes: u32,
}

/// Tin đã kiểm, sẵn sàng ghi.
#[derive(Debug, PartialEq)]
struct ValidPost {
    kind: &'static str,
    channel_keys: String,
    channel_label: String,
    note: String,
}

fn rate_band() -> (u32, u32) {
    let delta = REFERENCE_RATE_VND * RATE_BAND_PERCENT / 100;
    (REFERENCE_RATE_VND - delta, REFERENCE_RATE_VND + delta)
}

/// Lỗi trả về `(reason, field)`; reason khớp với dang-tin.html.
fn validate(post: &NewPost) -> Result<ValidPost, (&'static str, &'static str)> {
    let kind = match post.kind.as_str() {
        "sell" => "sell",
        "buy" => "buy",
        "pay" => "pay",
        _ => return Err(("loai-sai", "kind")),
    };
    if !(AMOUNT_MIN_CNY..=AMOUNT_MAX_CNY).contains(&post.amount_cny) {
        return Err(("so-te-sai", "amount"));
    }
    let (low, high) = rate_band();
    if !(low..=high).contains(&post.rate_vnd) {
        return Err(("ty-gia-lech", "rate"));
    }
    // Giữ thứ tự cố định, bỏ trùng và khoá lạ
    let picked: Vec<(&str, &str)> = CHANNELS.iter().copied().filter(|(key, _)| post.channels.iter().any(|c| c == key)).collect();
    if picked.is_empty() || picked.len() != post.channels.len() {
        return Err(("kenh-sai", "channels"));
    }
    let note = post.note.split_whitespace().collect::<Vec<_>>().join(" ");
    if note.chars().count() > NOTE_MAX_CHARS || note.chars().any(char::is_control) {
        return Err(("ghi-chu-dai", "note"));
    }
    if !ALLOWED_MINUTES.contains(&post.minutes) {
        return Err(("han-sai", "minutes"));
    }
    Ok(ValidPost {
        kind,
        channel_keys: picked.iter().map(|(key, _)| *key).collect::<Vec<_>>().join(","),
        channel_label: picked.iter().map(|(_, label)| *label).collect::<Vec<_>>().join(" · "),
        note,
    })
}

/// POST /api/posts — đăng tin (cần đăng nhập).
pub async fn create(State(state): State<AppState>, headers: HeaderMap, Json(request): Json<NewPost>) -> Response {
    if !auth::same_origin(&headers) {
        return fail(StatusCode::FORBIDDEN, "forbidden", None);
    }
    let user_id = match auth::current_user_id(&state.db, &headers).await {
        Ok(Some(id)) => id,
        Ok(None) => return fail(StatusCode::UNAUTHORIZED, "chua-dang-nhap", None),
        Err(e) => {
            eprintln!("create post: {e}");
            return fail(StatusCode::INTERNAL_SERVER_ERROR, "loi-may-chu", None);
        }
    };
    let post = match validate(&request) {
        Ok(post) => post,
        Err((reason, field)) => return fail(StatusCode::BAD_REQUEST, reason, Some(field)),
    };
    let open: Result<i64, _> = sqlx::query_scalar(&format!("SELECT COUNT(*) FROM posts p WHERE p.user_id = ? AND {OPEN_SQL}"))
        .bind(user_id)
        .fetch_one(&state.db)
        .await;
    match open {
        Ok(count) if count >= MAX_OPEN_POSTS => return fail(StatusCode::CONFLICT, "qua-so-tin", None),
        Ok(_) => {}
        Err(e) => {
            eprintln!("count open posts: {e}");
            return fail(StatusCode::INTERNAL_SERVER_ERROR, "loi-may-chu", None);
        }
    }
    let inserted = sqlx::query(
        "INSERT INTO posts (user_id, kind, amount_cny, rate_vnd, channel_label, channels, limit_label, expires_at) \
         VALUES (?, ?, ?, ?, ?, ?, ?, DATE_ADD(UTC_TIMESTAMP(3), INTERVAL ? MINUTE))",
    )
    .bind(user_id)
    .bind(post.kind)
    .bind(request.amount_cny)
    .bind(request.rate_vnd)
    .bind(&post.channel_label)
    .bind(&post.channel_keys)
    .bind(&post.note)
    .bind(request.minutes)
    .execute(&state.db)
    .await;
    match inserted {
        Ok(result) => {
            let mut response = Json(json!({ "ok": true, "id": result.last_insert_id() })).into_response();
            response.headers_mut().insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
            response
        }
        Err(e) => {
            eprintln!("insert post: {e}");
            fail(StatusCode::INTERNAL_SERVER_ERROR, "loi-may-chu", None)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn post(kind: &str, amount: u32, rate: u32, channels: &[&str], note: &str, minutes: u32) -> NewPost {
        NewPost {
            kind: kind.into(),
            amount_cny: amount,
            rate_vnd: rate,
            channels: channels.iter().map(|c| c.to_string()).collect(),
            note: note.into(),
            minutes,
        }
    }

    #[test]
    fn valid_post_builds_labels_in_fixed_order() {
        let ok = validate(&post("sell", 5000, 3535, &["bank", "alipay"], "  Tối thiểu   3.000 ¥ ", 1440)).unwrap();
        assert_eq!(ok.channel_keys, "alipay,bank");
        assert_eq!(ok.channel_label, "Alipay · Ngân hàng");
        assert_eq!(ok.note, "Tối thiểu 3.000 ¥");
    }

    #[test]
    fn rejects_bad_fields() {
        assert_eq!(validate(&post("swap", 5000, 3535, &["bank"], "", 30)).unwrap_err().1, "kind");
        assert_eq!(validate(&post("sell", 99, 3535, &["bank"], "", 30)).unwrap_err().1, "amount");
        assert_eq!(validate(&post("sell", 1_000_001, 3535, &["bank"], "", 30)).unwrap_err().1, "amount");
        assert_eq!(validate(&post("sell", 5000, 3000, &["bank"], "", 30)).unwrap_err().1, "rate");
        assert_eq!(validate(&post("sell", 5000, 3900, &["bank"], "", 30)).unwrap_err().1, "rate");
        assert_eq!(validate(&post("sell", 5000, 3535, &[], "", 30)).unwrap_err().1, "channels");
        assert_eq!(validate(&post("sell", 5000, 3535, &["paypal"], "", 30)).unwrap_err().1, "channels");
        assert_eq!(validate(&post("sell", 5000, 3535, &["bank"], &"x".repeat(121), 30)).unwrap_err().1, "note");
        assert_eq!(validate(&post("sell", 5000, 3535, &["bank"], "", 45)).unwrap_err().1, "minutes");
    }

    #[test]
    fn rate_band_is_ten_percent() {
        assert_eq!(rate_band(), (3177, 3883));
    }
}
