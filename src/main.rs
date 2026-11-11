//! doite.vn: sàn P2P đổi CNY ↔ VND. Server Axum phục vụ các trang HTML và API,
//! dữ liệu trong MySQL (migrations/ tự chạy khi khởi động).

mod account;
mod auth;
mod avatar;
mod messages;
mod posts;
mod realtime;
mod trades;
mod users;

use auth::AppState;
use axum::{
    Router,
    extract::{DefaultBodyLimit, State},
    http::{HeaderMap, HeaderName, HeaderValue, header},
    response::{Html, IntoResponse, Redirect, Response},
    routing::{get, post, put},
};
use sqlx::mysql::MySqlPoolOptions;
use std::{env, net::SocketAddr, sync::Arc};

const HOME: &str = include_str!("../index.html");
const LOGIN: &str = include_str!("../dang-nhap.html");
const REGISTER: &str = include_str!("../dang-ky.html");
const FORGOT: &str = include_str!("../quen-mat-khau.html");
const ACCOUNT: &str = include_str!("../tai-khoan.html");
const NEW_POST: &str = include_str!("../dang-tin.html");
const PUBLIC_PROFILE: &str = include_str!("../nguoi-dung.html");
const MESSAGES: &str = include_str!("../tin-nhan.html");
const AUTH_SCRIPT: &str = include_str!("../auth.js");
const TRANSITIONS_CSS: &str = include_str!("../page-transitions.css");
const TRANSITIONS_JS: &str = include_str!("../page-transitions.js");
const LIVE_JS: &str = include_str!("../live.js");

fn app(state: AppState) -> Router {
    Router::new()
        .route("/api/auth/register", post(auth::register))
        .route("/api/auth/otp/verify", post(auth::verify_otp))
        .route("/api/auth/otp/resend", post(auth::resend_otp))
        .route("/api/auth/reset/request", post(auth::request_reset))
        .route("/api/auth/reset", post(auth::reset_password))
        .route("/api/auth/login", post(auth::login))
        .route("/api/auth/logout", post(auth::logout))
        .route("/api/auth/me", get(auth::me))
        .route("/api/auth/google", post(auth::google))
        .route("/api/account", get(account::overview))
        .route("/api/account/logout-others", post(account::logout_others))
        .route(
            "/api/account/avatar",
            put(avatar::upload)
                .delete(avatar::remove)
                .layer(DefaultBodyLimit::max(avatar::MAX_UPLOAD_BYTES)),
        )
        .route("/anh-dai-dien/{file}", get(avatar::serve))
        .route("/api/account/trades", get(trades::list))
        .route("/api/users/{username}", get(users::profile))
        .route("/api/users/{username}/reviews", post(users::create_review))
        .route("/api/messages", get(messages::conversations))
        .route("/api/messages/start", post(messages::start))
        .route("/api/messages/unread", get(messages::unread))
        .route("/api/messages/{id}", get(messages::thread).post(messages::send))
        .route("/api/messages/{id}/read", post(messages::mark_read))
        .route("/api/messages/{id}/typing", post(messages::typing))
        .route("/api/events", get(realtime::events))
        .route("/nguoi-dung/{username}", get(|| async { page(PUBLIC_PROFILE) }))
        .route("/tin-nhan.html", get(messages_page))
        .route("/api/posts", get(posts::list).post(posts::create))
        .route("/", get(home))
        .route("/index.html", get(home))
        .route("/dang-nhap.html", get(login_page))
        .route("/dang-ky.html", get(register_page))
        .route("/quen-mat-khau.html", get(forgot_page))
        .route("/tai-khoan.html", get(account_page))
        .route("/dang-tin.html", get(new_post_page))
        .route("/auth.js", get(auth_script))
        .route("/page-transitions.css", get(|| async { asset(TRANSITIONS_CSS, "text/css; charset=utf-8") }))
        .route("/page-transitions.js", get(|| async { asset(TRANSITIONS_JS, "text/javascript; charset=utf-8") }))
        .route("/live.js", get(|| async { asset(LIVE_JS, "text/javascript; charset=utf-8") }))
        .with_state(state)
}

fn page(html: &'static str) -> Response {
    let mut response = Html(html).into_response();
    let headers = response.headers_mut();
    headers.insert(header::CACHE_CONTROL, HeaderValue::from_static("no-cache"));
    headers.insert(HeaderName::from_static("x-content-type-options"), HeaderValue::from_static("nosniff"));
    headers.insert(HeaderName::from_static("referrer-policy"), HeaderValue::from_static("same-origin"));
    headers.insert(HeaderName::from_static("x-frame-options"), HeaderValue::from_static("DENY"));
    response
}

async fn home() -> Response {
    page(HOME)
}

/// Đã đăng nhập thì không cần trang đăng nhập / đăng ký: về trang chủ.
async fn auth_page(state: &AppState, headers: &HeaderMap, html: &'static str) -> Response {
    match auth::current_user(&state.db, headers).await {
        Ok(Some(_)) => Redirect::to("/").into_response(),
        Ok(None) => page(html),
        // Lỗi DB không được che mất form; API sẽ tự báo lỗi.
        Err(e) => {
            eprintln!("load session: {e}");
            page(html)
        }
    }
}

async fn login_page(State(state): State<AppState>, headers: HeaderMap) -> Response {
    auth_page(&state, &headers, LOGIN).await
}

async fn register_page(State(state): State<AppState>, headers: HeaderMap) -> Response {
    auth_page(&state, &headers, REGISTER).await
}

async fn forgot_page() -> Response {
    page(FORGOT)
}

/// Đăng tin cần đăng nhập: chưa vào thì sang đăng nhập, xong quay lại form (giữ ?cny=).
async fn new_post_page(
    State(state): State<AppState>,
    headers: HeaderMap,
    axum::extract::RawQuery(query): axum::extract::RawQuery,
) -> Response {
    match auth::current_user(&state.db, &headers).await {
        Ok(None) => {
            let back = match query.as_deref().and_then(|q| q.split('&').find_map(|kv| kv.strip_prefix("cny="))) {
                Some(cny) if !cny.is_empty() && cny.bytes().all(|b| b.is_ascii_digit()) => format!("dang-tin.html%3Fcny%3D{cny}"),
                _ => "dang-tin.html".to_owned(),
            };
            Redirect::to(&format!("/dang-nhap.html?tiep={back}")).into_response()
        }
        Ok(Some(_)) => page(NEW_POST),
        Err(e) => {
            eprintln!("load session: {e}");
            page(NEW_POST)
        }
    }
}

/// Tin nhắn cần đăng nhập (giữ ?u= để mở đúng hội thoại sau khi đăng nhập).
async fn messages_page(
    State(state): State<AppState>,
    headers: HeaderMap,
    axum::extract::RawQuery(query): axum::extract::RawQuery,
) -> Response {
    match auth::current_user(&state.db, &headers).await {
        Ok(None) => {
            let back = match query.as_deref().and_then(|q| q.split('&').find_map(|kv| kv.strip_prefix("u="))) {
                Some(user) if !user.is_empty() && user.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'.' || b == b'_') => {
                    format!("tin-nhan.html%3Fu%3D{user}")
                }
                _ => "tin-nhan.html".to_owned(),
            };
            Redirect::to(&format!("/dang-nhap.html?tiep={back}")).into_response()
        }
        Ok(Some(_)) => page(MESSAGES),
        Err(e) => {
            eprintln!("load session: {e}");
            page(MESSAGES)
        }
    }
}

/// Trang cá nhân cần đăng nhập: chưa vào thì sang đăng nhập, xong quay lại đây.
async fn account_page(State(state): State<AppState>, headers: HeaderMap) -> Response {
    match auth::current_user(&state.db, &headers).await {
        Ok(Some(_)) => page(ACCOUNT),
        Ok(None) => Redirect::to("/dang-nhap.html?tiep=tai-khoan.html").into_response(),
        // Lỗi DB: vẫn trả trang, trang tự báo lỗi khi gọi API
        Err(e) => {
            eprintln!("load session: {e}");
            page(ACCOUNT)
        }
    }
}

/// File tĩnh nhúng sẵn (CSS, JS), no-cache để sửa xong tải lại là thấy.
fn asset(body: &'static str, content_type: &'static str) -> Response {
    let mut response = body.into_response();
    let headers = response.headers_mut();
    headers.insert(header::CONTENT_TYPE, HeaderValue::from_static(content_type));
    headers.insert(header::CACHE_CONTROL, HeaderValue::from_static("no-cache"));
    response
}

async fn auth_script() -> Response {
    let mut response = AUTH_SCRIPT.into_response();
    let headers = response.headers_mut();
    headers.insert(header::CONTENT_TYPE, HeaderValue::from_static("text/javascript; charset=utf-8"));
    headers.insert(header::CACHE_CONTROL, HeaderValue::from_static("no-cache"));
    response
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    // Máy dev đọc .env; khi triển khai thật đặt biến môi trường trực tiếp.
    dotenvy::dotenv().ok();
    let database_url = env::var("DATABASE_URL").map_err(|_| "Thiếu DATABASE_URL (xem .env.example)")?;
    let db = MySqlPoolOptions::new().max_connections(10).connect(&database_url).await?;
    sqlx::migrate!("./migrations").run(&db).await?;
    // GeoLite2-City.mmdb của MaxMind (tải miễn phí sau khi đăng ký). Không có thì vị trí để trống.
    let geo = match env::var("GEOIP_DB") {
        Ok(path) if !path.is_empty() => match maxminddb::Reader::open_readfile(&path) {
            Ok(reader) => Some(Arc::new(reader)),
            Err(e) => {
                eprintln!("Không mở được GEOIP_DB {path}: {e}. Vị trí đăng nhập sẽ để trống.");
                None
            }
        },
        _ => {
            println!("Chưa đặt GEOIP_DB: vị trí đăng nhập sẽ ghi \"Chưa xác định vị trí\".");
            None
        }
    };
    let state = AppState {
        db,
        limiter: Arc::default(),
        cookie_secure: env::var("COOKIE_SECURE").is_ok_and(|v| v == "true"),
        geo,
        trust_proxy: env::var("TRUST_PROXY").is_ok_and(|v| v == "true"),
        hub: Arc::default(),
    };
    if env::var("SMS_MODE").unwrap_or_else(|_| "log".into()) == "log" {
        println!("SMS_MODE=log: mã OTP chỉ in ra đây, chưa gửi SMS thật.");
    }

    let address: SocketAddr = env::var("BIND_ADDR").unwrap_or_else(|_| "127.0.0.1:3001".into()).parse()?;
    let listener = tokio::net::TcpListener::bind(address).await?;
    println!("doite.vn đang chạy tại http://{}", listener.local_addr()?);
    // Địa chỉ peer dùng cho giới hạn theo IP. Sau reverse proxy cần đọc
    // X-Forwarded-For từ proxy tin cậy trước khi triển khai.
    let hub = state.hub.clone();
    axum::serve(listener, app(state).into_make_service_with_connect_info::<SocketAddr>())
        .with_graceful_shutdown(async move {
            let _ = tokio::signal::ctrl_c().await;
            // Kết nối SSE mở mãi: đóng kênh để chúng kết thúc, server mới tắt được
            hub.close_all();
        })
        .await?;
    Ok(())
}
