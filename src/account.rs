//! Trang cá nhân: thông tin tài khoản, lịch sử đăng nhập (thời gian, IP, vị trí,
//! thiết bị), đăng xuất khỏi các thiết bị khác.
//!
//! Vị trí: tra IP trong file GeoLite2-City.mmdb của MaxMind (biến GEOIP_DB). Không có
//! file thì để trống ("Chưa xác định vị trí" trên trang). IP nội bộ ghi "Mạng nội bộ".
//! Không gửi IP của khách cho dịch vụ bên ngoài.

use std::net::{IpAddr, SocketAddr};

use axum::{
    Json,
    extract::{ConnectInfo, State},
    http::{HeaderMap, HeaderValue, StatusCode, header},
    response::{IntoResponse, Response},
};
use maxminddb::{Reader, geoip2};
use serde::Serialize;
use serde_json::json;
use sqlx::MySqlPool;

use crate::auth::{self, AppState};

const HISTORY_LIMIT: u32 = 20;
pub const HISTORY_DAYS: i64 = 90;
const USER_AGENT_MAX: usize = 255;

/// IP và trình duyệt của request đăng nhập.
pub struct ClientInfo {
    pub ip: IpAddr,
    pub user_agent: String,
}

/// Sau reverse proxy (TRUST_PROXY=true) lấy IP đầu tiên trong X-Forwarded-For;
/// không thì lấy IP của kết nối (không tin header do khách tự gửi).
pub fn client_info(addr: SocketAddr, headers: &HeaderMap, trust_proxy: bool) -> ClientInfo {
    let forwarded = trust_proxy
        .then(|| headers.get("x-forwarded-for")?.to_str().ok()?.split(',').next()?.trim().parse::<IpAddr>().ok())
        .flatten();
    let user_agent = headers
        .get(header::USER_AGENT)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .chars()
        .take(USER_AGENT_MAX)
        .collect();
    ClientInfo { ip: forwarded.unwrap_or(addr.ip()), user_agent }
}

fn is_internal(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(v4) => v4.is_loopback() || v4.is_private() || v4.is_link_local() || v4.is_unspecified(),
        IpAddr::V6(v6) => {
            v6.is_loopback()
                || v6.is_unspecified()
                || (v6.segments()[0] & 0xfe00) == 0xfc00 // unique local
                || (v6.segments()[0] & 0xffc0) == 0xfe80 // link local
                || v6.to_ipv4_mapped().is_some_and(|v4| is_internal(IpAddr::V4(v4)))
        }
    }
}

/// GeoLite2 chỉ có tên tiếng Anh; đổi các tên hay gặp sang tiếng Việt.
fn vietnamese(name: &str) -> &str {
    match name {
        "Vietnam" => "Việt Nam",
        "Hanoi" => "Hà Nội",
        "Ho Chi Minh City" => "TP. Hồ Chí Minh",
        "Da Nang" => "Đà Nẵng",
        "Haiphong" | "Hai Phong" => "Hải Phòng",
        "Can Tho" => "Cần Thơ",
        "China" => "Trung Quốc",
        _ => name,
    }
}

/// "Hà Nội, Việt Nam"; `None` khi chưa có dữ liệu GeoIP hoặc IP không có trong dữ liệu.
pub fn locate(geo: Option<&Reader<Vec<u8>>>, ip: IpAddr) -> Option<String> {
    if is_internal(ip) {
        return Some("Mạng nội bộ".into());
    }
    fn english<'a>(names: Option<std::collections::BTreeMap<&'a str, &'a str>>) -> Option<&'a str> {
        names.and_then(|n| n.get("en").copied())
    }
    let city: geoip2::City = geo?.lookup(ip).ok()?;
    let place = english(city.city.and_then(|c| c.names))
        .or_else(|| english(city.subdivisions.and_then(|s| s.into_iter().next()).and_then(|s| s.names)));
    let country = english(city.country.and_then(|c| c.names));
    match (place, country) {
        (Some(p), Some(c)) => Some(format!("{}, {}", vietnamese(p), vietnamese(c))),
        (None, Some(c)) => Some(vietnamese(c).to_owned()),
        (Some(p), None) => Some(vietnamese(p).to_owned()),
        (None, None) => None,
    }
}

/// Ghi một lần đăng nhập. Lỗi ở đây chỉ log, không chặn đăng nhập.
pub async fn record_login(state: &AppState, user_id: u64, success: bool, client: &ClientInfo, session_hash: Option<Vec<u8>>) {
    let location = locate(state.geo.as_deref(), client.ip);
    if let Err(e) = sqlx::query(
        "INSERT INTO login_events (user_id, success, ip, user_agent, location, session_hash) VALUES (?, ?, ?, ?, ?, ?)",
    )
    .bind(user_id)
    .bind(success)
    .bind(client.ip.to_string())
    .bind(&client.user_agent)
    .bind(location)
    .bind(session_hash)
    .execute(&state.db)
    .await
    {
        eprintln!("record login: {e}");
    }
}

#[derive(sqlx::FromRow)]
struct AccountRow {
    id: u64,
    username: String,
    display_name: String,
    phone: String,
    joined: String,
    avatar_url: Option<String>,
}

#[derive(sqlx::FromRow, Serialize)]
#[serde(rename_all = "camelCase")]
struct LoginRow {
    /// ISO 8601, UTC
    at: String,
    success: bool,
    ip: String,
    user_agent: String,
    location: Option<String>,
    current: bool,
}

/// "+84 912 ••• 678"
fn mask_phone(phone: &str) -> String {
    match phone.strip_prefix("+84") {
        Some(d) if d.len() == 9 => format!("+84 {} ••• {}", &d[..3], &d[6..]),
        _ => "•••".into(),
    }
}

async fn signed_in(db: &MySqlPool, headers: &HeaderMap) -> sqlx::Result<Option<(AccountRow, Vec<u8>)>> {
    let Some(token_hash) = auth::session_hash(headers) else {
        return Ok(None);
    };
    let row: Option<AccountRow> = sqlx::query_as(&format!(
        "SELECT u.id, u.username, u.display_name, u.phone, \
                DATE_FORMAT(u.created_at, '%Y-%m-%dT%H:%i:%sZ') AS joined, {} AS avatar_url \
         FROM sessions s JOIN users u ON u.id = s.user_id \
         WHERE s.token_hash = ? AND s.expires_at > UTC_TIMESTAMP(3)",
        crate::avatar::AVATAR_URL_SQL
    ))
    .bind(&token_hash)
    .fetch_optional(db)
    .await?;
    Ok(row.map(|r| (r, token_hash)))
}

fn no_store(mut response: Response) -> Response {
    response.headers_mut().insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    response
}

fn fail(status: StatusCode, reason: &str) -> Response {
    no_store((status, Json(json!({ "ok": false, "reason": reason }))).into_response())
}

/// Phiên mở trước khi có lịch sử đăng nhập (hoặc ghi lỗi) chưa có dòng nào: ghi bù một dòng
/// "Phiên này" với thời gian tạo phiên, IP và trình duyệt của request hiện tại.
async fn backfill_current_session(state: &AppState, user_id: u64, token_hash: &[u8], client: &ClientInfo) {
    let recorded: Result<Option<u64>, _> = sqlx::query_scalar("SELECT id FROM login_events WHERE session_hash = ? LIMIT 1")
        .bind(token_hash)
        .fetch_optional(&state.db)
        .await;
    if !matches!(recorded, Ok(None)) {
        return;
    }
    let location = locate(state.geo.as_deref(), client.ip);
    if let Err(e) = sqlx::query(
        "INSERT INTO login_events (user_id, success, ip, user_agent, location, session_hash, created_at) \
         SELECT ?, TRUE, ?, ?, ?, token_hash, created_at FROM sessions WHERE token_hash = ?",
    )
    .bind(user_id)
    .bind(client.ip.to_string())
    .bind(&client.user_agent)
    .bind(location)
    .bind(token_hash)
    .execute(&state.db)
    .await
    {
        eprintln!("backfill session: {e}");
    }
}

/// GET /api/account: tài khoản + 20 lần đăng nhập gần nhất trong 90 ngày.
pub async fn overview(
    State(state): State<AppState>,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
) -> Response {
    let (account, token_hash) = match signed_in(&state.db, &headers).await {
        Ok(Some(found)) => found,
        Ok(None) => return fail(StatusCode::UNAUTHORIZED, "chua-dang-nhap"),
        Err(e) => {
            eprintln!("account: {e}");
            return fail(StatusCode::INTERNAL_SERVER_ERROR, "loi-may-chu");
        }
    };
    let client = client_info(addr, &headers, state.trust_proxy);
    backfill_current_session(&state, account.id, &token_hash, &client).await;
    let logins: Vec<LoginRow> = match sqlx::query_as(
        "SELECT DATE_FORMAT(created_at, '%Y-%m-%dT%H:%i:%sZ') AS at, success, ip, user_agent, location, \
                (session_hash IS NOT NULL AND session_hash = ?) AS current \
         FROM login_events \
         WHERE user_id = ? AND created_at > UTC_TIMESTAMP(3) - INTERVAL ? DAY \
         ORDER BY created_at DESC, id DESC LIMIT ?",
    )
    .bind(&token_hash)
    .bind(account.id)
    .bind(HISTORY_DAYS)
    .bind(HISTORY_LIMIT)
    .fetch_all(&state.db)
    .await
    {
        Ok(rows) => rows,
        Err(e) => {
            eprintln!("login history: {e}");
            return fail(StatusCode::INTERNAL_SERVER_ERROR, "loi-may-chu");
        }
    };
    no_store(
        Json(json!({
            "ok": true,
            "user": {
                "username": account.username,
                "displayName": account.display_name,
                "phone": mask_phone(&account.phone),
                "joined": account.joined,
                "avatarUrl": account.avatar_url,
            },
            "logins": logins,
        }))
        .into_response(),
    )
}

/// POST /api/account/logout-others: xoá mọi phiên khác của tài khoản, giữ phiên này.
pub async fn logout_others(State(state): State<AppState>, headers: HeaderMap) -> Response {
    if !auth::same_origin(&headers) {
        return fail(StatusCode::FORBIDDEN, "forbidden");
    }
    let (account, token_hash) = match signed_in(&state.db, &headers).await {
        Ok(Some(found)) => found,
        Ok(None) => return fail(StatusCode::UNAUTHORIZED, "chua-dang-nhap"),
        Err(e) => {
            eprintln!("logout others: {e}");
            return fail(StatusCode::INTERNAL_SERVER_ERROR, "loi-may-chu");
        }
    };
    match sqlx::query("DELETE FROM sessions WHERE user_id = ? AND token_hash <> ?")
        .bind(account.id)
        .bind(&token_hash)
        .execute(&state.db)
        .await
    {
        Ok(result) => no_store(Json(json!({ "ok": true, "ended": result.rows_affected() })).into_response()),
        Err(e) => {
            eprintln!("logout others: {e}");
            fail(StatusCode::INTERNAL_SERVER_ERROR, "loi-may-chu")
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn internal_addresses() {
        for ip in ["127.0.0.1", "10.1.2.3", "192.168.1.5", "172.16.0.1", "::1", "fd00::1", "::ffff:192.168.1.1"] {
            assert!(is_internal(ip.parse().unwrap()), "{ip}");
        }
        for ip in ["113.161.72.15", "8.8.8.8", "2001:4860:4860::8888"] {
            assert!(!is_internal(ip.parse().unwrap()), "{ip}");
        }
    }

    #[test]
    fn locate_without_geoip() {
        assert_eq!(locate(None, "127.0.0.1".parse().unwrap()), Some("Mạng nội bộ".into()));
        assert_eq!(locate(None, "113.161.72.15".parse().unwrap()), None);
    }

    #[test]
    fn phone_is_masked() {
        assert_eq!(mask_phone("+84912345678"), "+84 912 ••• 678");
        assert_eq!(mask_phone("bad"), "•••");
    }

    #[test]
    fn forwarded_ip_only_when_trusted() {
        let mut headers = HeaderMap::new();
        headers.insert("x-forwarded-for", HeaderValue::from_static("113.161.72.15, 10.0.0.1"));
        let addr: SocketAddr = "10.0.0.1:5000".parse().unwrap();
        assert_eq!(client_info(addr, &headers, true).ip.to_string(), "113.161.72.15");
        assert_eq!(client_info(addr, &headers, false).ip.to_string(), "10.0.0.1");
    }
}
