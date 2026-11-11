//! Tin nhắn giữa hai người dùng (cần đăng nhập). Một cặp người có một hội thoại.
//!
//! Thời gian thực: mọi thay đổi được đẩy qua `realtime::Hub` (SSE, GET /api/events):
//! `message` (tin mới, tới cả hai người và mọi tab), `read` (người kia đã xem tới tin nào),
//! `typing` (người kia đang soạn), `unread` (số chưa đọc mới của người nhận).
//!
//! Độ tin cậy:
//! - Gửi có `clientId` (trình duyệt tạo): gửi lại cùng mã thì trả lại đúng tin cũ, không tạo tin trùng.
//! - Đánh dấu đã xem chỉ khi trình duyệt báo (POST …/read), tức người dùng thật sự đang xem.
//! - Lấy tin theo `after` (bù tin lỡ khi nối lại) và `before` (xem tin cũ hơn), luôn theo thứ tự id.
//!
//! Mở rộng: mỗi tin có `kind` + `meta` (JSON). Hiện chỉ nhận `text`; công cụ mới (ảnh, đề nghị tỷ giá,
//! ảnh chuyển khoản…) thêm một nhánh trong `validate_kind` và một kiểu hiển thị ở tin-nhan.html.

use axum::{
    Json,
    extract::{Path, Query, State},
    http::{HeaderMap, HeaderValue, StatusCode, header},
    response::{IntoResponse, Response},
};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sqlx::MySqlPool;

use crate::auth::{self, AppState};

const BODY_MAX_CHARS: usize = 1000;
/// Mỗi người tối đa chừng này tin trong 15 phút (chống spam).
const MAX_MESSAGES_PER_WINDOW: u32 = 300;
/// Báo "đang soạn" tối đa chừng này lần trong 15 phút (trình duyệt gửi ≤ 1 lần / 3 giây).
const MAX_TYPING_PER_WINDOW: u32 = 600;
const PAGE: u32 = 50;

fn no_store(mut response: Response) -> Response {
    response.headers_mut().insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    response
}

fn fail(status: StatusCode, reason: &str) -> Response {
    no_store((status, Json(json!({ "ok": false, "reason": reason }))).into_response())
}

fn internal(context: &str, error: impl std::fmt::Display) -> Response {
    eprintln!("{context}: {error}");
    fail(StatusCode::INTERNAL_SERVER_ERROR, "loi-may-chu")
}

async fn signed_in(state: &AppState, headers: &HeaderMap) -> Result<u64, Box<Response>> {
    match auth::current_user_id(&state.db, headers).await {
        Ok(Some(id)) => Ok(id),
        Ok(None) => Err(Box::new(fail(StatusCode::UNAUTHORIZED, "chua-dang-nhap"))),
        Err(e) => Err(Box::new(internal("messages auth", e))),
    }
}

/// Người còn lại của hội thoại, nếu `me` thuộc hội thoại đó. Người ngoài hội thoại luôn nhận "không tìm thấy".
async fn partner_of(db: &MySqlPool, conversation: u64, me: u64) -> sqlx::Result<Option<u64>> {
    sqlx::query_scalar(
        "SELECT IF(user_low = ?, user_high, user_low) FROM conversations WHERE id = ? AND (user_low = ? OR user_high = ?)",
    )
    .bind(me)
    .bind(conversation)
    .bind(me)
    .bind(me)
    .fetch_optional(db)
    .await
}

/// Số tin chưa đọc của một người (chấm đỏ trên header).
pub async fn unread_count(db: &MySqlPool, me: u64) -> sqlx::Result<i64> {
    sqlx::query_scalar(
        "SELECT COUNT(*) FROM messages m JOIN conversations c ON c.id = m.conversation_id \
         WHERE (c.user_low = ? OR c.user_high = ?) AND m.sender_id <> ? AND m.read_at IS NULL",
    )
    .bind(me)
    .bind(me)
    .bind(me)
    .fetch_one(db)
    .await
}

async fn push_unread(state: &AppState, user_id: u64) {
    if let Ok(count) = unread_count(&state.db, user_id).await {
        state.hub.publish(user_id, "unread", &json!({ "count": count }));
    }
}

#[derive(sqlx::FromRow, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct Partner {
    username: String,
    display_name: String,
    avatar_url: Option<String>,
}

async fn partner_view(db: &MySqlPool, user_id: u64) -> sqlx::Result<Partner> {
    sqlx::query_as(&format!(
        "SELECT u.username, u.display_name, {} AS avatar_url FROM users u WHERE u.id = ?",
        crate::avatar::AVATAR_URL_SQL
    ))
    .bind(user_id)
    .fetch_one(db)
    .await
}

#[derive(Serialize)]
#[serde(transparent)]
struct Flag(bool);

impl From<i64> for Flag {
    fn from(value: i64) -> Self {
        Flag(value != 0)
    }
}

// ---------- Hội thoại ----------

#[derive(Deserialize)]
pub struct StartRequest {
    username: String,
}

/// POST /api/messages/start — mở (hoặc lấy lại) hội thoại với một người.
pub async fn start(State(state): State<AppState>, headers: HeaderMap, Json(request): Json<StartRequest>) -> Response {
    if !auth::same_origin(&headers) {
        return fail(StatusCode::FORBIDDEN, "forbidden");
    }
    let me = match signed_in(&state, &headers).await {
        Ok(id) => id,
        Err(response) => return *response,
    };
    let other: Option<u64> = match sqlx::query_scalar("SELECT id FROM users WHERE username = ? AND phone_verified_at IS NOT NULL")
        .bind(request.username.trim().to_lowercase())
        .fetch_optional(&state.db)
        .await
    {
        Ok(id) => id,
        Err(e) => return internal("message start", e),
    };
    let Some(other) = other else {
        return fail(StatusCode::NOT_FOUND, "khong-tim-thay");
    };
    if other == me {
        return fail(StatusCode::BAD_REQUEST, "chinh-minh");
    }
    let (low, high) = (me.min(other), me.max(other));
    // INSERT IGNORE + UNIQUE(user_low, user_high): hai người bấm "Nhắn tin" cùng lúc vẫn ra một hội thoại
    if let Err(e) = sqlx::query("INSERT IGNORE INTO conversations (user_low, user_high) VALUES (?, ?)")
        .bind(low)
        .bind(high)
        .execute(&state.db)
        .await
    {
        return internal("create conversation", e);
    }
    match sqlx::query_scalar::<_, u64>("SELECT id FROM conversations WHERE user_low = ? AND user_high = ?")
        .bind(low)
        .bind(high)
        .fetch_one(&state.db)
        .await
    {
        Ok(id) => no_store(Json(json!({ "ok": true, "conversationId": id })).into_response()),
        Err(e) => internal("load conversation", e),
    }
}

#[derive(sqlx::FromRow, Serialize)]
#[serde(rename_all = "camelCase")]
struct ConversationRow {
    id: u64,
    username: String,
    display_name: String,
    avatar_url: Option<String>,
    last_body: Option<String>,
    last_kind: Option<String>,
    last_at: Option<String>,
    #[sqlx(try_from = "i64")]
    last_from_me: Flag,
    unread: i64,
}

/// GET /api/messages — danh sách hội thoại, mới nhất trước.
pub async fn conversations(State(state): State<AppState>, headers: HeaderMap) -> Response {
    let me = match signed_in(&state, &headers).await {
        Ok(id) => id,
        Err(response) => return *response,
    };
    let rows: Vec<ConversationRow> = match sqlx::query_as(&format!(
        "SELECT c.id, u.username, u.display_name, {} AS avatar_url, \
                last.body AS last_body, last.kind AS last_kind, \
                DATE_FORMAT(last.created_at, '%Y-%m-%dT%H:%i:%s.%fZ') AS last_at, \
                COALESCE(last.sender_id = ?, 0) AS last_from_me, \
                (SELECT COUNT(*) FROM messages m WHERE m.conversation_id = c.id AND m.sender_id <> ? AND m.read_at IS NULL) AS unread \
         FROM conversations c \
         JOIN users u ON u.id = IF(c.user_low = ?, c.user_high, c.user_low) \
         LEFT JOIN messages last ON last.id = (SELECT MAX(m.id) FROM messages m WHERE m.conversation_id = c.id) \
         WHERE c.user_low = ? OR c.user_high = ? \
         ORDER BY COALESCE(c.last_message_at, c.created_at) DESC, c.id DESC LIMIT 200",
        crate::avatar::AVATAR_URL_SQL
    ))
    .bind(me)
    .bind(me)
    .bind(me)
    .bind(me)
    .bind(me)
    .fetch_all(&state.db)
    .await
    {
        Ok(rows) => rows,
        Err(e) => return internal("list conversations", e),
    };
    no_store(Json(json!({ "ok": true, "conversations": rows })).into_response())
}

/// GET /api/messages/unread — số tin chưa đọc (trang không mở SSE vẫn hỏi được).
pub async fn unread(State(state): State<AppState>, headers: HeaderMap) -> Response {
    let me = match signed_in(&state, &headers).await {
        Ok(id) => id,
        Err(response) => return *response,
    };
    match unread_count(&state.db, me).await {
        Ok(count) => no_store(Json(json!({ "ok": true, "count": count })).into_response()),
        Err(e) => internal("unread", e),
    }
}

// ---------- Tin trong hội thoại ----------

#[derive(sqlx::FromRow, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct MessageRow {
    id: u64,
    sender_id: u64,
    body: String,
    kind: String,
    meta: Option<Value>,
    client_id: Option<String>,
    at: String,
}

/// Một tin gửi xuống trình duyệt: thêm `mine` theo người nhận, bỏ id người gửi.
fn message_view(row: &MessageRow, viewer: u64) -> Value {
    json!({
        "id": row.id,
        "mine": row.sender_id == viewer,
        "body": row.body,
        "kind": row.kind,
        "meta": row.meta,
        "clientId": if row.sender_id == viewer { row.client_id.clone() } else { None },
        "at": row.at,
    })
}

const MESSAGE_COLUMNS: &str = "m.id, m.sender_id, m.body, m.kind, m.meta, m.client_id, \
     DATE_FORMAT(m.created_at, '%Y-%m-%dT%H:%i:%s.%fZ') AS at";

#[derive(Deserialize)]
pub struct ThreadQuery {
    /// Tin có id lớn hơn (bù tin lỡ khi nối lại)
    #[serde(default)]
    after: Option<u64>,
    /// Tin có id nhỏ hơn (xem tin cũ hơn)
    #[serde(default)]
    before: Option<u64>,
}

/// GET /api/messages/{id}?after=|before= — tối đa 50 tin, thứ tự cũ → mới. Không tự đánh dấu đã xem.
pub async fn thread(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(conversation): Path<u64>,
    Query(query): Query<ThreadQuery>,
) -> Response {
    let me = match signed_in(&state, &headers).await {
        Ok(id) => id,
        Err(response) => return *response,
    };
    let other = match partner_of(&state.db, conversation, me).await {
        Ok(Some(id)) => id,
        Ok(None) => return fail(StatusCode::NOT_FOUND, "khong-tim-thay"),
        Err(e) => return internal("thread access", e),
    };
    let result: sqlx::Result<Vec<MessageRow>> = match (query.after, query.before) {
        (Some(after), _) => {
            sqlx::query_as(&format!(
                "SELECT {MESSAGE_COLUMNS} FROM messages m WHERE m.conversation_id = ? AND m.id > ? ORDER BY m.id LIMIT ?"
            ))
            .bind(conversation)
            .bind(after)
            .bind(PAGE + 1)
            .fetch_all(&state.db)
            .await
        }
        (None, before) => {
            sqlx::query_as(&format!(
                "SELECT * FROM (SELECT {MESSAGE_COLUMNS} FROM messages m WHERE m.conversation_id = ? AND m.id < ? \
                 ORDER BY m.id DESC LIMIT ?) recent ORDER BY id"
            ))
            .bind(conversation)
            .bind(before.unwrap_or(u64::MAX))
            .bind(PAGE + 1)
            .fetch_all(&state.db)
            .await
        }
    };
    let mut rows = match result {
        Ok(rows) => rows,
        Err(e) => return internal("thread messages", e),
    };
    // Lấy dư một tin để biết còn nữa không
    let more = rows.len() > PAGE as usize;
    if more {
        if query.after.is_some() {
            rows.truncate(PAGE as usize);
        } else {
            rows.remove(0);
        }
    }
    let read_up_to: Option<u64> = match sqlx::query_scalar(
        "SELECT MAX(id) FROM messages WHERE conversation_id = ? AND sender_id = ? AND read_at IS NOT NULL",
    )
    .bind(conversation)
    .bind(me)
    .fetch_one(&state.db)
    .await
    {
        Ok(id) => id,
        Err(e) => return internal("read receipt", e),
    };
    let partner = match partner_view(&state.db, other).await {
        Ok(partner) => partner,
        Err(e) => return internal("thread partner", e),
    };
    let messages: Vec<Value> = rows.iter().map(|row| message_view(row, me)).collect();
    no_store(
        Json(json!({
            "ok": true,
            "partner": partner,
            "messages": messages,
            // after: còn tin mới hơn chưa trả; before (mặc định): còn tin cũ hơn
            "hasMore": more,
            "partnerReadUpTo": read_up_to,
        }))
        .into_response(),
    )
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadRequest {
    up_to: u64,
}

/// POST /api/messages/{id}/read — người dùng đang xem hội thoại: đánh dấu đã xem tới tin `upTo`.
pub async fn mark_read(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(conversation): Path<u64>,
    Json(request): Json<ReadRequest>,
) -> Response {
    if !auth::same_origin(&headers) {
        return fail(StatusCode::FORBIDDEN, "forbidden");
    }
    let me = match signed_in(&state, &headers).await {
        Ok(id) => id,
        Err(response) => return *response,
    };
    let other = match partner_of(&state.db, conversation, me).await {
        Ok(Some(id)) => id,
        Ok(None) => return fail(StatusCode::NOT_FOUND, "khong-tim-thay"),
        Err(e) => return internal("read access", e),
    };
    let changed = match sqlx::query(
        "UPDATE messages SET read_at = UTC_TIMESTAMP(3) \
         WHERE conversation_id = ? AND sender_id = ? AND id <= ? AND read_at IS NULL",
    )
    .bind(conversation)
    .bind(other)
    .bind(request.up_to)
    .execute(&state.db)
    .await
    {
        Ok(result) => result.rows_affected(),
        Err(e) => return internal("mark read", e),
    };
    if changed > 0 {
        // Người gửi thấy "Đã xem"; mọi tab của mình cập nhật số chưa đọc
        let up_to: Option<u64> = sqlx::query_scalar(
            "SELECT MAX(id) FROM messages WHERE conversation_id = ? AND sender_id = ? AND read_at IS NOT NULL",
        )
        .bind(conversation)
        .bind(other)
        .fetch_one(&state.db)
        .await
        .unwrap_or(None);
        state.hub.publish(other, "read", &json!({ "conversationId": conversation, "upTo": up_to }));
        push_unread(&state, me).await;
        state.hub.publish(me, "conversation-read", &json!({ "conversationId": conversation }));
    }
    no_store(Json(json!({ "ok": true })).into_response())
}

/// POST /api/messages/{id}/typing — báo người kia "đang soạn tin" (trình duyệt gửi ≤ 1 lần / 3 giây).
pub async fn typing(State(state): State<AppState>, headers: HeaderMap, Path(conversation): Path<u64>) -> Response {
    if !auth::same_origin(&headers) {
        return fail(StatusCode::FORBIDDEN, "forbidden");
    }
    let me = match signed_in(&state, &headers).await {
        Ok(id) => id,
        Err(response) => return *response,
    };
    let key = format!("typing:{me}");
    if state.limiter.count(&key) >= MAX_TYPING_PER_WINDOW {
        return no_store(Json(json!({ "ok": true })).into_response());
    }
    state.limiter.record(&key);
    match partner_of(&state.db, conversation, me).await {
        Ok(Some(other)) => {
            state.hub.publish(other, "typing", &json!({ "conversationId": conversation }));
            no_store(Json(json!({ "ok": true })).into_response())
        }
        Ok(None) => fail(StatusCode::NOT_FOUND, "khong-tim-thay"),
        Err(e) => internal("typing access", e),
    }
}

// ---------- Gửi tin ----------

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SendRequest {
    #[serde(default = "text_kind")]
    kind: String,
    #[serde(default)]
    body: String,
    /// Dữ liệu riêng của loại tin; `text` không dùng, công cụ sau này đọc trong `validate_kind`
    #[serde(default)]
    #[allow(dead_code)]
    meta: Option<Value>,
    /// Mã do trình duyệt tạo (UUID) — gửi lại cùng mã không tạo tin trùng
    #[serde(default)]
    client_id: Option<String>,
}

fn text_kind() -> String {
    "text".into()
}

fn clean_body(raw: &str) -> Option<String> {
    let text = raw.trim();
    let valid = !text.is_empty()
        && text.chars().count() <= BODY_MAX_CHARS
        && !text.chars().any(|c| c.is_control() && c != '\n' && c != '\t');
    valid.then(|| text.to_owned())
}

fn valid_client_id(id: &str) -> bool {
    (8..=36).contains(&id.len()) && id.bytes().all(|b| b.is_ascii_hexdigit() || b == b'-')
}

/// Kiểm từng loại tin. Thêm công cụ mới: thêm một nhánh ở đây (và giá trị trong CHECK của bảng).
fn validate_kind(request: &SendRequest) -> Result<(String, Option<Value>), &'static str> {
    match request.kind.as_str() {
        "text" => clean_body(&request.body).map(|body| (body, None)).ok_or("noi-dung-sai"),
        _ => Err("loai-tin-chua-ho-tro"),
    }
}

/// POST /api/messages/{id} — gửi tin; đẩy `message` tới cả hai người, `unread` tới người nhận.
pub async fn send(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(conversation): Path<u64>,
    Json(request): Json<SendRequest>,
) -> Response {
    if !auth::same_origin(&headers) {
        return fail(StatusCode::FORBIDDEN, "forbidden");
    }
    let me = match signed_in(&state, &headers).await {
        Ok(id) => id,
        Err(response) => return *response,
    };
    let other = match partner_of(&state.db, conversation, me).await {
        Ok(Some(id)) => id,
        Ok(None) => return fail(StatusCode::NOT_FOUND, "khong-tim-thay"),
        Err(e) => return internal("send access", e),
    };
    let (body, meta) = match validate_kind(&request) {
        Ok(valid) => valid,
        Err(reason) => return fail(StatusCode::BAD_REQUEST, reason),
    };
    let client_id = request.client_id.filter(|id| valid_client_id(id));

    // Gửi lại cùng clientId (mất mạng, bấm hai lần): trả đúng tin đã có, không đếm vào giới hạn
    if let Some(id) = &client_id {
        match existing_by_client_id(&state.db, me, id).await {
            Ok(Some(row)) => return no_store(Json(json!({ "ok": true, "message": message_view(&row, me), "duplicate": true })).into_response()),
            Ok(None) => {}
            Err(e) => return internal("dedupe lookup", e),
        }
    }
    let key = format!("messages:{me}");
    if state.limiter.count(&key) >= MAX_MESSAGES_PER_WINDOW {
        return fail(StatusCode::TOO_MANY_REQUESTS, "qua-nhieu-lan");
    }
    state.limiter.record(&key);

    let inserted = sqlx::query("INSERT INTO messages (conversation_id, sender_id, body, kind, meta, client_id) VALUES (?, ?, ?, ?, ?, ?)")
        .bind(conversation)
        .bind(me)
        .bind(&body)
        .bind(&request.kind)
        .bind(meta.as_ref().map(Value::to_string))
        .bind(&client_id)
        .execute(&state.db)
        .await;
    let id = match inserted {
        Ok(result) => result.last_insert_id(),
        // Hai lần gửi cùng mã đến gần như cùng lúc: lần sau dính UNIQUE, trả về tin của lần trước
        Err(sqlx::Error::Database(e)) if e.is_unique_violation() => {
            let id = client_id.as_deref().unwrap_or_default();
            return match existing_by_client_id(&state.db, me, id).await {
                Ok(Some(row)) => no_store(Json(json!({ "ok": true, "message": message_view(&row, me), "duplicate": true })).into_response()),
                Ok(None) => internal("dedupe race", "missing row"),
                Err(e) => internal("dedupe race", e),
            };
        }
        Err(e) => return internal("insert message", e),
    };
    if let Err(e) = sqlx::query("UPDATE conversations SET last_message_at = UTC_TIMESTAMP(3) WHERE id = ?")
        .bind(conversation)
        .execute(&state.db)
        .await
    {
        eprintln!("touch conversation: {e}");
    }
    let row: MessageRow = match sqlx::query_as(&format!("SELECT {MESSAGE_COLUMNS} FROM messages m WHERE m.id = ?"))
        .bind(id)
        .fetch_one(&state.db)
        .await
    {
        Ok(row) => row,
        Err(e) => return internal("load message", e),
    };

    // Đẩy tới người nhận (kèm thông tin người gửi để danh sách hội thoại hiện ngay) và các tab khác của mình
    match partner_view(&state.db, me).await {
        Ok(sender) => state.hub.publish(
            other,
            "message",
            &json!({ "conversationId": conversation, "message": message_view(&row, other), "partner": sender }),
        ),
        Err(e) => eprintln!("sender view: {e}"),
    }
    match partner_view(&state.db, other).await {
        Ok(receiver) => state.hub.publish(
            me,
            "message",
            &json!({ "conversationId": conversation, "message": message_view(&row, me), "partner": receiver }),
        ),
        Err(e) => eprintln!("receiver view: {e}"),
    }
    push_unread(&state, other).await;
    no_store(Json(json!({ "ok": true, "message": message_view(&row, me) })).into_response())
}

async fn existing_by_client_id(db: &MySqlPool, sender: u64, client_id: &str) -> sqlx::Result<Option<MessageRow>> {
    sqlx::query_as(&format!("SELECT {MESSAGE_COLUMNS} FROM messages m WHERE m.sender_id = ? AND m.client_id = ?"))
        .bind(sender)
        .bind(client_id)
        .fetch_optional(db)
        .await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn message_body_rules() {
        assert_eq!(clean_body("  chào bạn \n"), Some("chào bạn".into()));
        assert_eq!(clean_body("   "), None);
        assert_eq!(clean_body(&"x".repeat(1001)), None);
        assert_eq!(clean_body(&"ữ".repeat(1000)), Some("ữ".repeat(1000)));
        assert_eq!(clean_body("a\u{0000}b"), None);
        assert_eq!(clean_body("dòng 1\ndòng 2"), Some("dòng 1\ndòng 2".into()));
        assert_eq!(clean_body("😀 emoji"), Some("😀 emoji".into()));
    }

    #[test]
    fn client_id_shape() {
        assert!(valid_client_id("3f2b8c1e-9a4d-4e1f-8b2a-1c3d5e7f9a0b"));
        assert!(!valid_client_id("short"));
        assert!(!valid_client_id("'; DROP TABLE messages; --"));
    }

    #[test]
    fn only_text_kind_for_now() {
        let request = |kind: &str| SendRequest { kind: kind.into(), body: "chào".into(), meta: None, client_id: None };
        assert!(validate_kind(&request("text")).is_ok());
        assert_eq!(validate_kind(&request("image")), Err("loai-tin-chua-ho-tro"));
    }

    #[test]
    fn message_view_hides_sender_and_foreign_client_id() {
        let row = MessageRow { id: 5, sender_id: 1, body: "hi".into(), kind: "text".into(), meta: None, client_id: Some("abcd1234".into()), at: "x".into() };
        let mine = message_view(&row, 1);
        let theirs = message_view(&row, 2);
        assert_eq!(mine["mine"], true);
        assert_eq!(mine["clientId"], "abcd1234");
        assert_eq!(theirs["mine"], false);
        assert!(theirs["clientId"].is_null());
        assert!(theirs.get("senderId").is_none());
    }
}
