//! Tài khoản doite.vn: đăng ký bằng số điện thoại (xác minh OTP qua SMS),
//! đăng nhập bằng tên đăng nhập hoặc số điện thoại, quên mật khẩu.
//!
//! - Mật khẩu: Argon2id, băm ngoài luồng async.
//! - Phiên: token ngẫu nhiên 256-bit trong cookie HttpOnly, SameSite=Lax; DB chỉ lưu SHA-256.
//! - OTP: 6 số, sống 5 phút, tối đa 5 lần nhập sai, gửi lại sau 60 giây; DB chỉ lưu SHA-256.
//! - CSRF: chỉ nhận JSON + kiểm Origin + cookie SameSite.
//! - Chống dò: giới hạn theo IP và theo tài khoản (bộ nhớ trong, một tiến trình).
//! - Không lộ số nào đã có tài khoản ở luồng quên mật khẩu.
//!
//! Mọi lỗi trả về `{ ok: false, reason, field }`; `reason` khớp với `auth.js`.

use std::{
    collections::HashMap,
    net::SocketAddr,
    sync::{Arc, Mutex, OnceLock},
    time::{Duration, Instant},
};

use argon2::{Argon2, PasswordHash, PasswordHasher, PasswordVerifier, password_hash::SaltString};
use axum::{
    Json,
    extract::{ConnectInfo, State},
    http::{HeaderMap, HeaderValue, StatusCode, header},
    response::{IntoResponse, Response},
};
use rand_core::{OsRng, RngCore};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use sqlx::MySqlPool;

use crate::account::{self, ClientInfo};

pub const SESSION_COOKIE: &str = "doite_session";
const SESSION_DAYS: i64 = 30;
const PASSWORD_MIN_CHARS: usize = 8;
const PASSWORD_MAX_CHARS: usize = 128;
const OTP_MINUTES: i64 = 5;
const OTP_MAX_ATTEMPTS: u8 = 5;
const OTP_RESEND_SECONDS: i64 = 60;
const RESET_MINUTES: i64 = 15;

const LIMIT_WINDOW: Duration = Duration::from_secs(15 * 60);
const MAX_FAILED_LOGINS_PER_ACCOUNT: u32 = 10;
const MAX_FAILED_LOGINS_PER_IP: u32 = 30;
const MAX_REGISTRATIONS_PER_IP: u32 = 10;
const MAX_OTP_SENDS_PER_PHONE: u32 = 5;
const MAX_OTP_CHECKS_PER_IP: u32 = 50;

#[derive(Clone)]
pub struct AppState {
    pub db: MySqlPool,
    pub limiter: Arc<RateLimiter>,
    pub cookie_secure: bool,
    /// File GeoLite2-City.mmdb (biến GEOIP_DB) để tra vị trí theo IP; không có thì bỏ qua.
    pub geo: Option<Arc<maxminddb::Reader<Vec<u8>>>>,
    /// Chạy sau reverse proxy tin cậy: đọc IP thật từ X-Forwarded-For.
    pub trust_proxy: bool,
    /// Kênh đẩy sự kiện thời gian thực (SSE) tới các tab đang mở.
    pub hub: Arc<crate::realtime::Hub>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UserView {
    username: String,
    display_name: String,
    /// "/anh-dai-dien/<tên>.jpg?v=…" hoặc null khi chưa có ảnh đại diện
    avatar_url: Option<String>,
}

// ---------- Responses ----------

fn respond(status: StatusCode, body: Value, cookie: Option<HeaderValue>) -> Response {
    let mut response = (status, Json(body)).into_response();
    let headers = response.headers_mut();
    headers.insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    if let Some(cookie) = cookie {
        headers.insert(header::SET_COOKIE, cookie);
    }
    response
}

fn ok(body: Value) -> Response {
    let mut body = body;
    body["ok"] = Value::Bool(true);
    respond(StatusCode::OK, body, None)
}

fn fail(status: StatusCode, reason: &str, field: Option<&str>) -> Response {
    respond(status, json!({ "ok": false, "reason": reason, "field": field }), None)
}

fn internal_error(context: &str, error: impl std::fmt::Display) -> Response {
    // Không bao giờ log nội dung request: có mật khẩu và mã OTP.
    eprintln!("{context}: {error}");
    fail(StatusCode::INTERNAL_SERVER_ERROR, "loi-may-chu", None)
}

fn forbidden() -> Response {
    fail(StatusCode::FORBIDDEN, "forbidden", None)
}

fn rate_limited() -> Response {
    fail(StatusCode::TOO_MANY_REQUESTS, "qua-nhieu-lan", None)
}

// ---------- Validation ----------

/// Số di động Việt Nam về dạng E.164 `+84xxxxxxxxx`.
/// Nhận "0912 345 678", "912345678", "+84 912 345 678", "84912345678".
pub fn normalize_phone(raw: &str) -> Option<String> {
    if raw.chars().any(|c| !(c.is_ascii_digit() || c == ' ' || c == '+' || c == '.' || c == '-')) {
        return None;
    }
    let mut digits: String = raw.chars().filter(char::is_ascii_digit).collect();
    if digits.len() == 11 && digits.starts_with("84") {
        digits.drain(..2);
    }
    if digits.len() == 10 && digits.starts_with('0') {
        digits.remove(0);
    }
    let valid = digits.len() == 9 && matches!(digits.as_bytes()[0], b'3' | b'5' | b'7' | b'8' | b'9');
    valid.then(|| format!("+84{digits}"))
}

/// 4–20 ký tự: chữ không dấu, số, dấu chấm, gạch dưới. Lưu chữ thường.
fn normalize_username(raw: &str) -> Option<String> {
    let username = raw.trim().to_lowercase();
    let valid = (4..=20).contains(&username.len())
        && username
            .bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'.' || b == b'_');
    valid.then_some(username)
}

fn normalize_display_name(raw: &str) -> Option<String> {
    let name = raw.split_whitespace().collect::<Vec<_>>().join(" ");
    let length = name.chars().count();
    let valid = (2..=50).contains(&length) && !name.chars().any(char::is_control);
    valid.then_some(name)
}

fn password_length_ok(password: &str) -> bool {
    (PASSWORD_MIN_CHARS..=PASSWORD_MAX_CHARS).contains(&password.chars().count())
}

/// Chặn request trình duyệt từ trang khác.
pub fn same_origin(headers: &HeaderMap) -> bool {
    let Some(origin) = headers.get(header::ORIGIN).and_then(|v| v.to_str().ok()) else {
        return true;
    };
    let Some(host) = headers.get(header::HOST).and_then(|v| v.to_str().ok()) else {
        return false;
    };
    origin == format!("http://{host}") || origin == format!("https://{host}")
}

// ---------- Passwords ----------

fn hash_blocking(password: &str) -> Result<String, argon2::password_hash::Error> {
    let salt = SaltString::generate(&mut OsRng);
    Argon2::default()
        .hash_password(password.as_bytes(), &salt)
        .map(|hash| hash.to_string())
}

async fn hash_password(password: String) -> Result<String, String> {
    tokio::task::spawn_blocking(move || hash_blocking(&password))
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())
}

/// `None` vẫn kiểm với một hash giả, để tài khoản không tồn tại tốn thời gian
/// như sai mật khẩu (không dò được tài khoản bằng thời gian phản hồi).
async fn verify_password(password: String, stored_hash: Option<String>) -> bool {
    static DUMMY_HASH: OnceLock<String> = OnceLock::new();
    tokio::task::spawn_blocking(move || {
        let known = stored_hash.is_some();
        let hash = stored_hash.unwrap_or_else(|| {
            DUMMY_HASH
                .get_or_init(|| hash_blocking("doite-timing-equalizer").unwrap_or_default())
                .clone()
        });
        let matches = PasswordHash::new(&hash)
            .map(|parsed| Argon2::default().verify_password(password.as_bytes(), &parsed).is_ok())
            .unwrap_or(false);
        known && matches
    })
    .await
    .unwrap_or(false)
}

// ---------- Tokens, sessions ----------

fn sha256(value: &str) -> Vec<u8> {
    Sha256::digest(value.as_bytes()).to_vec()
}

fn random_token() -> String {
    let mut bytes = [0u8; 32];
    OsRng.fill_bytes(&mut bytes);
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

fn session_cookie(token: &str, secure: bool) -> HeaderValue {
    let secure = if secure { "; Secure" } else { "" };
    let max_age = SESSION_DAYS * 24 * 60 * 60;
    HeaderValue::from_str(&format!(
        "{SESSION_COOKIE}={token}; Path=/; HttpOnly; SameSite=Lax; Max-Age={max_age}{secure}"
    ))
    .expect("session cookie is ASCII")
}

fn cleared_cookie(secure: bool) -> HeaderValue {
    let secure = if secure { "; Secure" } else { "" };
    HeaderValue::from_str(&format!("{SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0{secure}"))
        .expect("cookie is ASCII")
}

fn session_token(headers: &HeaderMap) -> Option<&str> {
    headers
        .get_all(header::COOKIE)
        .iter()
        .filter_map(|value| value.to_str().ok())
        .flat_map(|value| value.split(';'))
        .find_map(|pair| {
            let (name, value) = pair.trim().split_once('=')?;
            (name == SESSION_COOKIE && !value.is_empty() && value.len() <= 128).then_some(value)
        })
}

/// SHA-256 của token phiên trong cookie (để so với `sessions`, `login_events`).
pub fn session_hash(headers: &HeaderMap) -> Option<Vec<u8>> {
    session_token(headers).map(sha256)
}

/// Mở phiên mới và ghi một lần đăng nhập thành công vào lịch sử.
async fn start_session(state: &AppState, user_id: u64, user: UserView, client: &ClientInfo) -> Response {
    let token = random_token();
    let inserted = sqlx::query(
        "INSERT INTO sessions (token_hash, user_id, expires_at) \
         VALUES (?, ?, DATE_ADD(UTC_TIMESTAMP(3), INTERVAL ? DAY))",
    )
    .bind(sha256(&token))
    .bind(user_id)
    .bind(SESSION_DAYS)
    .execute(&state.db)
    .await;
    if inserted.is_ok() {
        account::record_login(state, user_id, true, client, Some(sha256(&token))).await;
    }
    match inserted {
        Ok(_) => respond(
            StatusCode::OK,
            json!({ "ok": true, "user": user }),
            Some(session_cookie(&token, state.cookie_secure)),
        ),
        Err(e) => internal_error("create session", e),
    }
}

/// Người dùng đang đăng nhập của request này (cookie còn hạn).
pub async fn current_user(db: &MySqlPool, headers: &HeaderMap) -> sqlx::Result<Option<UserView>> {
    let Some(token) = session_token(headers) else {
        return Ok(None);
    };
    let row: Option<(String, String, Option<String>)> = sqlx::query_as(&format!(
        "SELECT u.username, u.display_name, {} FROM sessions s JOIN users u ON u.id = s.user_id \
         WHERE s.token_hash = ? AND s.expires_at > UTC_TIMESTAMP(3)",
        crate::avatar::AVATAR_URL_SQL
    ))
    .bind(sha256(token))
    .fetch_optional(db)
    .await?;
    Ok(row.map(|(username, display_name, avatar_url)| UserView { username, display_name, avatar_url }))
}

/// Id người dùng của phiên trong cookie (còn hạn).
pub async fn current_user_id(db: &MySqlPool, headers: &HeaderMap) -> sqlx::Result<Option<u64>> {
    let Some(token) = session_token(headers) else {
        return Ok(None);
    };
    sqlx::query_scalar("SELECT user_id FROM sessions WHERE token_hash = ? AND expires_at > UTC_TIMESTAMP(3)")
        .bind(sha256(token))
        .fetch_optional(db)
        .await
}

// ---------- OTP ----------

#[derive(Clone, Copy, PartialEq, Debug)]
enum Purpose {
    Register,
    Reset,
}

impl Purpose {
    fn from_flow(flow: &str) -> Option<Self> {
        match flow {
            "dang-ky" => Some(Self::Register),
            "quen-mk" => Some(Self::Reset),
            _ => None,
        }
    }

    fn as_str(self) -> &'static str {
        match self {
            Self::Register => "register",
            Self::Reset => "reset",
        }
    }
}

/// Gửi mã tới điện thoại. Hiện chỉ in ra console (SMS_MODE=log, để thử).
/// Nối nhà cung cấp SMS thật (eSMS, SpeedSMS, Twilio…) ở đây trước khi chạy thật.
fn send_otp(phone: &str, purpose: Purpose, code: &str) {
    let what = match purpose {
        Purpose::Register => "đăng ký",
        Purpose::Reset => "đặt lại mật khẩu",
    };
    println!("[OTP thử] {phone} ({what}): {code}");
}

fn new_otp_code() -> String {
    // 0..999_999 đều nhau: lấy mẫu lại khi rơi vào phần dư của u32.
    loop {
        let value = OsRng.next_u32();
        if value < u32::MAX - (u32::MAX % 1_000_000) {
            return format!("{:06}", value % 1_000_000);
        }
    }
}

fn otp_hash(phone: &str, code: &str) -> Vec<u8> {
    sha256(&format!("{phone}:{code}"))
}

/// Tạo và gửi mã mới (mã cũ cùng mục đích bị huỷ).
/// `Ok(false)`: chưa gửi vì chưa hết 60 giây hoặc gửi quá nhiều lần cho số này.
async fn issue_otp(state: &AppState, phone: &str, purpose: Purpose) -> sqlx::Result<bool> {
    let last_age: Option<i64> = sqlx::query_scalar(
        "SELECT TIMESTAMPDIFF(SECOND, created_at, UTC_TIMESTAMP(3)) FROM otp_codes \
         WHERE phone = ? AND purpose = ? ORDER BY id DESC LIMIT 1",
    )
    .bind(phone)
    .bind(purpose.as_str())
    .fetch_optional(&state.db)
    .await?;
    if last_age.is_some_and(|age| age < OTP_RESEND_SECONDS) {
        return Ok(false);
    }
    let phone_key = format!("otp-send:{phone}");
    if state.limiter.count(&phone_key) >= MAX_OTP_SENDS_PER_PHONE {
        return Ok(false);
    }
    state.limiter.record(&phone_key);

    let code = new_otp_code();
    sqlx::query(
        "UPDATE otp_codes SET consumed_at = UTC_TIMESTAMP(3) \
         WHERE phone = ? AND purpose = ? AND consumed_at IS NULL",
    )
    .bind(phone)
    .bind(purpose.as_str())
    .execute(&state.db)
    .await?;
    sqlx::query(
        "INSERT INTO otp_codes (phone, purpose, code_hash, expires_at) \
         VALUES (?, ?, ?, DATE_ADD(UTC_TIMESTAMP(3), INTERVAL ? MINUTE))",
    )
    .bind(phone)
    .bind(purpose.as_str())
    .bind(otp_hash(phone, &code))
    .bind(OTP_MINUTES)
    .execute(&state.db)
    .await?;
    send_otp(phone, purpose, &code);
    Ok(true)
}

enum OtpCheck {
    Valid,
    Wrong,
    Expired,
}

async fn check_otp(db: &MySqlPool, phone: &str, purpose: Purpose, code: &str) -> sqlx::Result<OtpCheck> {
    let row: Option<(u64, Vec<u8>, u8, i64)> = sqlx::query_as(
        "SELECT id, code_hash, attempts, (expires_at > UTC_TIMESTAMP(3)) FROM otp_codes \
         WHERE phone = ? AND purpose = ? AND consumed_at IS NULL ORDER BY id DESC LIMIT 1",
    )
    .bind(phone)
    .bind(purpose.as_str())
    .fetch_optional(db)
    .await?;
    let Some((id, stored, attempts, live)) = row else {
        return Ok(OtpCheck::Expired);
    };
    if live == 0 || attempts >= OTP_MAX_ATTEMPTS {
        return Ok(OtpCheck::Expired);
    }
    if stored != otp_hash(phone, code) {
        sqlx::query("UPDATE otp_codes SET attempts = attempts + 1 WHERE id = ?")
            .bind(id)
            .execute(db)
            .await?;
        // Lần sai cuối cùng: mã coi như hết hạn, phải xin mã mới.
        return Ok(if attempts + 1 >= OTP_MAX_ATTEMPTS { OtpCheck::Expired } else { OtpCheck::Wrong });
    }
    sqlx::query("UPDATE otp_codes SET consumed_at = UTC_TIMESTAMP(3) WHERE id = ?")
        .bind(id)
        .execute(db)
        .await?;
    Ok(OtpCheck::Valid)
}

// ---------- Rate limiting ----------

#[derive(Default)]
pub struct RateLimiter {
    counters: Mutex<HashMap<String, (u32, Instant)>>,
}

impl RateLimiter {
    pub(crate) fn count(&self, key: &str) -> u32 {
        let counters = self.counters.lock().unwrap_or_else(|e| e.into_inner());
        match counters.get(key) {
            Some((count, started)) if started.elapsed() < LIMIT_WINDOW => *count,
            _ => 0,
        }
    }

    pub(crate) fn record(&self, key: &str) {
        let mut counters = self.counters.lock().unwrap_or_else(|e| e.into_inner());
        if counters.len() > 50_000 {
            counters.retain(|_, (_, started)| started.elapsed() < LIMIT_WINDOW);
        }
        let entry = counters.entry(key.to_owned()).or_insert((0, Instant::now()));
        if entry.1.elapsed() >= LIMIT_WINDOW {
            *entry = (0, Instant::now());
        }
        entry.0 += 1;
    }

    fn clear(&self, key: &str) {
        self.counters.lock().unwrap_or_else(|e| e.into_inner()).remove(key);
    }
}

// ---------- Handlers ----------

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RegisterRequest {
    username: String,
    display_name: String,
    phone: String,
    password: String,
    #[serde(default)]
    accepted_terms: bool,
}

/// Tạo tài khoản chờ xác minh và gửi OTP. Tài khoản chỉ dùng được sau bước OTP.
pub async fn register(
    State(state): State<AppState>,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    Json(request): Json<RegisterRequest>,
) -> Response {
    if !same_origin(&headers) {
        return forbidden();
    }
    let ip_key = format!("register:{}", addr.ip());
    if state.limiter.count(&ip_key) >= MAX_REGISTRATIONS_PER_IP {
        return rate_limited();
    }

    let Some(username) = normalize_username(&request.username) else {
        return fail(StatusCode::BAD_REQUEST, "ten-dang-nhap-sai", Some("username"));
    };
    let Some(display_name) = normalize_display_name(&request.display_name) else {
        return fail(StatusCode::BAD_REQUEST, "ten-hien-thi-sai", Some("display-name"));
    };
    let Some(phone) = normalize_phone(&request.phone) else {
        return fail(StatusCode::BAD_REQUEST, "so-dien-thoai-sai", Some("phone"));
    };
    if !password_length_ok(&request.password) {
        return fail(StatusCode::BAD_REQUEST, "mat-khau-sai", Some("password"));
    }
    if !request.accepted_terms {
        return fail(StatusCode::BAD_REQUEST, "chua-dong-y", Some("terms"));
    }
    state.limiter.record(&ip_key);

    // Đã có tài khoản xác minh dùng số hoặc tên này?
    let taken: Vec<(String, String)> = match sqlx::query_as(
        "SELECT username, phone FROM users \
         WHERE phone_verified_at IS NOT NULL AND (username = ? OR phone = ?)",
    )
    .bind(&username)
    .bind(&phone)
    .fetch_all(&state.db)
    .await
    {
        Ok(rows) => rows,
        Err(e) => return internal_error("check taken", e),
    };
    if taken.iter().any(|(_, p)| *p == phone) {
        return fail(StatusCode::CONFLICT, "da-co", Some("phone"));
    }
    if taken.iter().any(|(u, _)| *u == username) {
        return fail(StatusCode::CONFLICT, "trung-ten", Some("username"));
    }

    let password_hash = match hash_password(request.password).await {
        Ok(hash) => hash,
        Err(e) => return internal_error("hash password", e),
    };
    // Đăng ký dở dang (chưa nhập OTP) của cùng số hay cùng tên thì thay bằng bản mới.
    if let Err(e) = sqlx::query("DELETE FROM users WHERE phone_verified_at IS NULL AND (username = ? OR phone = ?)")
        .bind(&username)
        .bind(&phone)
        .execute(&state.db)
        .await
    {
        return internal_error("drop pending signup", e);
    }
    let inserted = sqlx::query(
        "INSERT INTO users (username, display_name, phone, password_hash) VALUES (?, ?, ?, ?)",
    )
    .bind(&username)
    .bind(&display_name)
    .bind(&phone)
    .bind(&password_hash)
    .execute(&state.db)
    .await;
    match inserted {
        Ok(_) => {}
        Err(sqlx::Error::Database(e)) if e.is_unique_violation() => {
            return fail(StatusCode::CONFLICT, "trung-ten", Some("username"));
        }
        Err(e) => return internal_error("insert user", e),
    }
    // Đăng ký mới luôn được một mã mới, kể cả khi vừa đăng ký lại trong 60 giây.
    if let Err(e) = sqlx::query("DELETE FROM otp_codes WHERE phone = ? AND purpose = 'register'")
        .bind(&phone)
        .execute(&state.db)
        .await
    {
        return internal_error("reset register otp", e);
    }
    match issue_otp(&state, &phone, Purpose::Register).await {
        Ok(true) => ok(json!({ "phone": phone })),
        Ok(false) => rate_limited(),
        Err(e) => internal_error("issue otp", e),
    }
}

#[derive(Deserialize)]
pub struct VerifyRequest {
    phone: String,
    code: String,
    flow: String,
}

/// Đăng ký: xác minh số, mở phiên. Quên mật khẩu: trả về `resetToken` dùng một lần.
pub async fn verify_otp(
    State(state): State<AppState>,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    Json(request): Json<VerifyRequest>,
) -> Response {
    if !same_origin(&headers) {
        return forbidden();
    }
    let ip_key = format!("otp-check:{}", addr.ip());
    if state.limiter.count(&ip_key) >= MAX_OTP_CHECKS_PER_IP {
        return rate_limited();
    }
    state.limiter.record(&ip_key);
    let (Some(purpose), Some(phone)) = (Purpose::from_flow(&request.flow), normalize_phone(&request.phone)) else {
        return fail(StatusCode::BAD_REQUEST, "sai", None);
    };
    let code = request.code.trim();
    if code.len() != 6 || !code.bytes().all(|b| b.is_ascii_digit()) {
        return fail(StatusCode::BAD_REQUEST, "sai", None);
    }
    match check_otp(&state.db, &phone, purpose, code).await {
        Ok(OtpCheck::Valid) => {}
        Ok(OtpCheck::Wrong) => return fail(StatusCode::BAD_REQUEST, "sai", None),
        Ok(OtpCheck::Expired) => return fail(StatusCode::GONE, "het-han", None),
        Err(e) => return internal_error("check otp", e),
    }

    match purpose {
        Purpose::Register => {
            let pending: Option<(u64, String, String)> = match sqlx::query_as(
                "SELECT id, username, display_name FROM users WHERE phone = ? AND phone_verified_at IS NULL",
            )
            .bind(&phone)
            .fetch_optional(&state.db)
            .await
            {
                Ok(row) => row,
                Err(e) => return internal_error("load pending user", e),
            };
            let Some((user_id, username, display_name)) = pending else {
                return fail(StatusCode::GONE, "het-han", None);
            };
            if let Err(e) = sqlx::query("UPDATE users SET phone_verified_at = UTC_TIMESTAMP(3) WHERE id = ?")
                .bind(user_id)
                .execute(&state.db)
                .await
            {
                return internal_error("verify phone", e);
            }
            let client = account::client_info(addr, &headers, state.trust_proxy);
            start_session(&state, user_id, UserView { username, display_name, avatar_url: None }, &client).await
        }
        Purpose::Reset => {
            let user_id: Option<u64> = match sqlx::query_scalar(
                "SELECT id FROM users WHERE phone = ? AND phone_verified_at IS NOT NULL",
            )
            .bind(&phone)
            .fetch_optional(&state.db)
            .await
            {
                Ok(id) => id,
                Err(e) => return internal_error("load reset user", e),
            };
            let Some(user_id) = user_id else {
                return fail(StatusCode::GONE, "het-han", None);
            };
            let token = random_token();
            if let Err(e) = sqlx::query(
                "INSERT INTO password_resets (token_hash, user_id, expires_at) \
                 VALUES (?, ?, DATE_ADD(UTC_TIMESTAMP(3), INTERVAL ? MINUTE))",
            )
            .bind(sha256(&token))
            .bind(user_id)
            .bind(RESET_MINUTES)
            .execute(&state.db)
            .await
            {
                return internal_error("create reset", e);
            }
            ok(json!({ "resetToken": token }))
        }
    }
}

#[derive(Deserialize)]
pub struct ResendRequest {
    phone: String,
    flow: String,
}

/// Gửi lại mã. Luôn trả `ok` nếu hợp lệ, không cho biết số đó có tài khoản hay không.
pub async fn resend_otp(State(state): State<AppState>, headers: HeaderMap, Json(request): Json<ResendRequest>) -> Response {
    if !same_origin(&headers) {
        return forbidden();
    }
    let (Some(purpose), Some(phone)) = (Purpose::from_flow(&request.flow), normalize_phone(&request.phone)) else {
        return fail(StatusCode::BAD_REQUEST, "so-dien-thoai-sai", Some("phone"));
    };
    let condition = match purpose {
        Purpose::Register => "phone_verified_at IS NULL",
        Purpose::Reset => "phone_verified_at IS NOT NULL",
    };
    let exists: Option<u64> = match sqlx::query_scalar(&format!("SELECT id FROM users WHERE phone = ? AND {condition}"))
        .bind(&phone)
        .fetch_optional(&state.db)
        .await
    {
        Ok(id) => id,
        Err(e) => return internal_error("load user for resend", e),
    };
    if exists.is_some() {
        match issue_otp(&state, &phone, purpose).await {
            Ok(true) => {}
            Ok(false) => return rate_limited(),
            Err(e) => return internal_error("resend otp", e),
        }
    }
    ok(json!({}))
}

#[derive(Deserialize)]
pub struct ResetRequest {
    phone: String,
}

/// Bước 1 quên mật khẩu. Luôn trả `ok` (không lộ số nào đã đăng ký).
pub async fn request_reset(State(state): State<AppState>, headers: HeaderMap, Json(request): Json<ResetRequest>) -> Response {
    if !same_origin(&headers) {
        return forbidden();
    }
    let Some(phone) = normalize_phone(&request.phone) else {
        return fail(StatusCode::BAD_REQUEST, "so-dien-thoai-sai", Some("phone"));
    };
    let exists: Option<u64> =
        match sqlx::query_scalar("SELECT id FROM users WHERE phone = ? AND phone_verified_at IS NOT NULL")
            .bind(&phone)
            .fetch_optional(&state.db)
            .await
        {
            Ok(id) => id,
            Err(e) => return internal_error("load user for reset", e),
        };
    if exists.is_some()
        && let Err(e) = issue_otp(&state, &phone, Purpose::Reset).await
    {
        return internal_error("issue reset otp", e);
    }
    ok(json!({}))
}

#[derive(Deserialize)]
pub struct NewPasswordRequest {
    token: String,
    password: String,
}

/// Bước cuối quên mật khẩu: đổi mật khẩu, đăng xuất mọi phiên cũ.
pub async fn reset_password(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(request): Json<NewPasswordRequest>,
) -> Response {
    if !same_origin(&headers) {
        return forbidden();
    }
    if !password_length_ok(&request.password) {
        return fail(StatusCode::BAD_REQUEST, "mat-khau-sai", Some("new-password"));
    }
    let user_id: Option<u64> = match sqlx::query_scalar(
        "SELECT user_id FROM password_resets WHERE token_hash = ? AND expires_at > UTC_TIMESTAMP(3)",
    )
    .bind(sha256(request.token.trim()))
    .fetch_optional(&state.db)
    .await
    {
        Ok(id) => id,
        Err(e) => return internal_error("load reset", e),
    };
    let Some(user_id) = user_id else {
        return fail(StatusCode::GONE, "het-han", None);
    };
    let password_hash = match hash_password(request.password).await {
        Ok(hash) => hash,
        Err(e) => return internal_error("hash password", e),
    };
    if let Err(e) = sqlx::query("UPDATE users SET password_hash = ?, updated_at = UTC_TIMESTAMP(3) WHERE id = ?")
        .bind(&password_hash)
        .bind(user_id)
        .execute(&state.db)
        .await
    {
        return internal_error("update password", e);
    }
    for (sql, context) in [
        ("DELETE FROM password_resets WHERE user_id = ?", "drop resets"),
        ("DELETE FROM sessions WHERE user_id = ?", "drop sessions"),
    ] {
        if let Err(e) = sqlx::query(sql).bind(user_id).execute(&state.db).await {
            return internal_error(context, e);
        }
    }
    ok(json!({}))
}

#[derive(Deserialize)]
pub struct LoginRequest {
    identifier: String,
    password: String,
}

/// Đăng nhập bằng tên đăng nhập hoặc số điện thoại. Sai gì cũng chỉ một câu trả lời.
pub async fn login(
    State(state): State<AppState>,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    Json(request): Json<LoginRequest>,
) -> Response {
    if !same_origin(&headers) {
        return forbidden();
    }
    let (column, value) = match normalize_phone(&request.identifier) {
        Some(phone) => ("phone", phone),
        None => ("username", request.identifier.trim().to_lowercase()),
    };
    let ip_key = format!("login-ip:{}", addr.ip());
    let account_key = format!("login-account:{value}");
    if state.limiter.count(&ip_key) >= MAX_FAILED_LOGINS_PER_IP
        || state.limiter.count(&account_key) >= MAX_FAILED_LOGINS_PER_ACCOUNT
    {
        return rate_limited();
    }

    let row: Option<(u64, String, String, String)> = if value.is_empty() || value.len() > 32 {
        None
    } else {
        match sqlx::query_as(&format!(
            "SELECT id, username, display_name, password_hash FROM users \
             WHERE {column} = ? AND phone_verified_at IS NOT NULL"
        ))
        .bind(&value)
        .fetch_optional(&state.db)
        .await
        {
            Ok(row) => row,
            Err(e) => return internal_error("load user", e),
        }
    };
    let client = account::client_info(addr, &headers, state.trust_proxy);
    let stored_hash = row.as_ref().map(|(_, _, _, hash)| hash.clone());
    if !verify_password(request.password, stored_hash).await {
        state.limiter.record(&ip_key);
        state.limiter.record(&account_key);
        // Sai mật khẩu vào tài khoản có thật: ghi lại để chủ tài khoản thấy ở trang cá nhân
        if let Some((user_id, ..)) = &row {
            account::record_login(&state, *user_id, false, &client, None).await;
        }
        return fail(StatusCode::UNAUTHORIZED, "sai", None);
    }
    let Some((user_id, username, display_name, _)) = row else {
        return fail(StatusCode::UNAUTHORIZED, "sai", None);
    };
    state.limiter.clear(&account_key);

    // Dọn phiên và mã hết hạn; lỗi ở đây không được chặn đăng nhập.
    for sql in [
        "DELETE FROM sessions WHERE expires_at <= UTC_TIMESTAMP(3)",
        "DELETE FROM otp_codes WHERE expires_at <= UTC_TIMESTAMP(3) - INTERVAL 1 DAY",
        "DELETE FROM password_resets WHERE expires_at <= UTC_TIMESTAMP(3)",
    ] {
        if let Err(e) = sqlx::query(sql).execute(&state.db).await {
            eprintln!("cleanup: {e}");
        }
    }
    if let Err(e) = sqlx::query("DELETE FROM login_events WHERE created_at <= UTC_TIMESTAMP(3) - INTERVAL ? DAY")
        .bind(account::HISTORY_DAYS)
        .execute(&state.db)
        .await
    {
        eprintln!("cleanup login events: {e}");
    }
    start_session(&state, user_id, UserView { username, display_name, avatar_url: None }, &client).await
}

pub async fn logout(State(state): State<AppState>, headers: HeaderMap) -> Response {
    if !same_origin(&headers) {
        return forbidden();
    }
    if let Some(token) = session_token(&headers)
        && let Err(e) = sqlx::query("DELETE FROM sessions WHERE token_hash = ?")
            .bind(sha256(token))
            .execute(&state.db)
            .await
    {
        return internal_error("delete session", e);
    }
    respond(StatusCode::OK, json!({ "ok": true }), Some(cleared_cookie(state.cookie_secure)))
}

pub async fn me(State(state): State<AppState>, headers: HeaderMap) -> Response {
    match current_user(&state.db, &headers).await {
        Ok(Some(user)) => ok(json!({ "user": user })),
        Ok(None) => fail(StatusCode::UNAUTHORIZED, "chua-dang-nhap", None),
        Err(e) => internal_error("load session", e),
    }
}

/// Đăng nhập Google chưa được cấu hình.
pub async fn google() -> Response {
    fail(StatusCode::NOT_IMPLEMENTED, "google-chua-bat", None)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn phone_forms_are_accepted() {
        for raw in ["0912345678", "912345678", "+84 912 345 678", "84912345678", "0912.345.678", "0912-345-678"] {
            assert_eq!(normalize_phone(raw), Some("+84912345678".into()), "{raw}");
        }
    }

    #[test]
    fn bad_phones_are_rejected() {
        for raw in ["", "091234", "0212345678", "+84000000001", "0912345678a", "09123456789", "+1 912 345 678"] {
            assert_eq!(normalize_phone(raw), None, "{raw}");
        }
    }

    #[test]
    fn username_rules() {
        assert_eq!(normalize_username(" MinhAnh.HN "), Some("minhanh.hn".into()));
        assert_eq!(normalize_username("an_1"), Some("an_1".into()));
        for bad in ["abc", "minh anh", "minhánh", "a".repeat(21).as_str(), "an-1"] {
            assert_eq!(normalize_username(bad), None, "{bad}");
        }
    }

    #[test]
    fn display_name_is_collapsed() {
        assert_eq!(normalize_display_name("  Minh   Anh  "), Some("Minh Anh".into()));
        assert_eq!(normalize_display_name("A"), None);
    }

    #[test]
    fn otp_codes_are_six_digits() {
        for _ in 0..200 {
            let code = new_otp_code();
            assert_eq!(code.len(), 6);
            assert!(code.bytes().all(|b| b.is_ascii_digit()));
        }
    }

    #[test]
    fn session_cookie_is_found_among_others() {
        let mut headers = HeaderMap::new();
        headers.insert(header::COOKIE, HeaderValue::from_static("a=1; doite_session=abc; b=2"));
        assert_eq!(session_token(&headers), Some("abc"));
    }

    #[test]
    fn cross_site_origin_is_rejected() {
        let mut headers = HeaderMap::new();
        headers.insert(header::HOST, HeaderValue::from_static("127.0.0.1:3001"));
        headers.insert(header::ORIGIN, HeaderValue::from_static("https://evil.example"));
        assert!(!same_origin(&headers));
        headers.insert(header::ORIGIN, HeaderValue::from_static("http://127.0.0.1:3001"));
        assert!(same_origin(&headers));
    }
}
