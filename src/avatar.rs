//! Ảnh đại diện: tải lên (đổi), xoá, và phục vụ ảnh.
//!
//! Trình duyệt đã cắt vuông và thu nhỏ trước khi gửi, nhưng server không tin file gửi lên:
//! giải mã bằng `image`, cắt vuông 256×256 và mã hoá lại thành JPEG. File gốc (EXIF, GPS,
//! dữ liệu giấu kèm) không bao giờ được lưu hay trả lại.

use std::io::Cursor;

use axum::{
    Json,
    body::Bytes,
    extract::{Path, State},
    http::{HeaderMap, HeaderValue, StatusCode, header},
    response::{IntoResponse, Response},
};
use image::{ImageReader, imageops::FilterType};
use serde_json::json;

use crate::auth::{self, AppState};

/// Kích thước ảnh lưu (vuông).
const SIZE: u32 = 256;
/// Giới hạn ảnh gửi lên (trình duyệt gửi bản đã thu nhỏ, thường dưới 100 KB).
pub const MAX_UPLOAD_BYTES: usize = 5 * 1024 * 1024;
/// Ảnh có cạnh lớn hơn thế này thì từ chối (chặn ảnh "bom" giải nén ra hàng GB).
const MAX_SOURCE_SIDE: u32 = 8000;
const JPEG_QUALITY: u8 = 85;

/// SQL: đường dẫn ảnh của người dùng `u`, có số phiên bản; NULL khi chưa có ảnh.
pub const AVATAR_URL_SQL: &str = "IF(u.avatar_updated_at IS NULL, NULL, \
     CONCAT('/anh-dai-dien/', u.username, '.jpg?v=', FLOOR(UNIX_TIMESTAMP(u.avatar_updated_at) * 1000)))";

fn no_store(mut response: Response) -> Response {
    response.headers_mut().insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    response
}

fn fail(status: StatusCode, reason: &str) -> Response {
    no_store((status, Json(json!({ "ok": false, "reason": reason }))).into_response())
}

#[derive(Debug, PartialEq)]
pub enum AvatarError {
    Unreadable,
    TooLarge,
}

/// Giải mã ảnh (JPEG, PNG, WebP), cắt vuông ở giữa, thu về 256×256, mã hoá JPEG.
pub fn normalize(bytes: &[u8]) -> Result<Vec<u8>, AvatarError> {
    let reader = ImageReader::new(Cursor::new(bytes)).with_guessed_format().map_err(|_| AvatarError::Unreadable)?;
    if !matches!(
        reader.format(),
        Some(image::ImageFormat::Jpeg | image::ImageFormat::Png | image::ImageFormat::WebP)
    ) {
        return Err(AvatarError::Unreadable);
    }
    let (width, height) = reader.into_dimensions().map_err(|_| AvatarError::Unreadable)?;
    if width > MAX_SOURCE_SIDE || height > MAX_SOURCE_SIDE {
        return Err(AvatarError::TooLarge);
    }
    let decoded = ImageReader::new(Cursor::new(bytes))
        .with_guessed_format()
        .map_err(|_| AvatarError::Unreadable)?
        .decode()
        .map_err(|_| AvatarError::Unreadable)?;
    let square = decoded.resize_to_fill(SIZE, SIZE, FilterType::Lanczos3).to_rgb8();
    let mut out = Vec::new();
    image::codecs::jpeg::JpegEncoder::new_with_quality(&mut out, JPEG_QUALITY)
        .encode_image(&square)
        .map_err(|_| AvatarError::Unreadable)?;
    Ok(out)
}

/// PUT /api/account/avatar — thân request là file ảnh (Content-Type image/*).
/// Kiểu nội dung image/* không phải "simple request", form của trang khác không gửi được.
pub async fn upload(State(state): State<AppState>, headers: HeaderMap, body: Bytes) -> Response {
    if !auth::same_origin(&headers) {
        return fail(StatusCode::FORBIDDEN, "forbidden");
    }
    let is_image = headers
        .get(header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .is_some_and(|v| v.starts_with("image/"));
    if !is_image || body.is_empty() {
        return fail(StatusCode::UNSUPPORTED_MEDIA_TYPE, "anh-khong-doc-duoc");
    }
    let user_id = match auth::current_user_id(&state.db, &headers).await {
        Ok(Some(id)) => id,
        Ok(None) => return fail(StatusCode::UNAUTHORIZED, "chua-dang-nhap"),
        Err(e) => {
            eprintln!("avatar upload: {e}");
            return fail(StatusCode::INTERNAL_SERVER_ERROR, "loi-may-chu");
        }
    };
    let jpeg = match tokio::task::spawn_blocking(move || normalize(&body)).await {
        Ok(Ok(jpeg)) => jpeg,
        Ok(Err(AvatarError::TooLarge)) => return fail(StatusCode::PAYLOAD_TOO_LARGE, "anh-qua-lon"),
        Ok(Err(AvatarError::Unreadable)) => return fail(StatusCode::UNPROCESSABLE_ENTITY, "anh-khong-doc-duoc"),
        Err(e) => {
            eprintln!("avatar decode: {e}");
            return fail(StatusCode::INTERNAL_SERVER_ERROR, "loi-may-chu");
        }
    };
    if let Err(e) = sqlx::query("UPDATE users SET avatar = ?, avatar_updated_at = UTC_TIMESTAMP(3) WHERE id = ?")
        .bind(&jpeg)
        .bind(user_id)
        .execute(&state.db)
        .await
    {
        eprintln!("save avatar: {e}");
        return fail(StatusCode::INTERNAL_SERVER_ERROR, "loi-may-chu");
    }
    avatar_url_response(&state, user_id).await
}

/// DELETE /api/account/avatar — quay về chữ viết tắt.
pub async fn remove(State(state): State<AppState>, headers: HeaderMap) -> Response {
    if !auth::same_origin(&headers) {
        return fail(StatusCode::FORBIDDEN, "forbidden");
    }
    let user_id = match auth::current_user_id(&state.db, &headers).await {
        Ok(Some(id)) => id,
        Ok(None) => return fail(StatusCode::UNAUTHORIZED, "chua-dang-nhap"),
        Err(e) => {
            eprintln!("avatar remove: {e}");
            return fail(StatusCode::INTERNAL_SERVER_ERROR, "loi-may-chu");
        }
    };
    match sqlx::query("UPDATE users SET avatar = NULL, avatar_updated_at = NULL WHERE id = ?")
        .bind(user_id)
        .execute(&state.db)
        .await
    {
        Ok(_) => no_store(Json(json!({ "ok": true, "avatarUrl": null })).into_response()),
        Err(e) => {
            eprintln!("remove avatar: {e}");
            fail(StatusCode::INTERNAL_SERVER_ERROR, "loi-may-chu")
        }
    }
}

async fn avatar_url_response(state: &AppState, user_id: u64) -> Response {
    let url: Result<Option<String>, _> = sqlx::query_scalar(&format!("SELECT {AVATAR_URL_SQL} FROM users u WHERE u.id = ?"))
        .bind(user_id)
        .fetch_one(&state.db)
        .await;
    match url {
        Ok(url) => no_store(Json(json!({ "ok": true, "avatarUrl": url })).into_response()),
        Err(e) => {
            eprintln!("avatar url: {e}");
            fail(StatusCode::INTERNAL_SERVER_ERROR, "loi-may-chu")
        }
    }
}

/// GET /anh-dai-dien/{username}.jpg — ảnh công khai (hiện trên tin đăng).
/// Đường dẫn có ?v=… đổi mỗi lần đổi ảnh, nên cache được lâu.
pub async fn serve(State(state): State<AppState>, Path(file): Path<String>) -> Response {
    let Some(username) = file.strip_suffix(".jpg") else {
        return StatusCode::NOT_FOUND.into_response();
    };
    if username.is_empty() || username.len() > 20 {
        return StatusCode::NOT_FOUND.into_response();
    }
    let jpeg: Result<Option<Option<Vec<u8>>>, _> =
        sqlx::query_scalar("SELECT avatar FROM users WHERE username = ? AND phone_verified_at IS NOT NULL")
            .bind(username)
            .fetch_optional(&state.db)
            .await;
    match jpeg {
        Ok(Some(Some(bytes))) => {
            let mut response = bytes.into_response();
            let headers = response.headers_mut();
            headers.insert(header::CONTENT_TYPE, HeaderValue::from_static("image/jpeg"));
            headers.insert(header::CACHE_CONTROL, HeaderValue::from_static("public, max-age=31536000, immutable"));
            headers.insert(header::HeaderName::from_static("x-content-type-options"), HeaderValue::from_static("nosniff"));
            response
        }
        Ok(_) => StatusCode::NOT_FOUND.into_response(),
        Err(e) => {
            eprintln!("serve avatar: {e}");
            StatusCode::INTERNAL_SERVER_ERROR.into_response()
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::{ImageBuffer, Rgb};

    fn encode(format: image::ImageFormat, width: u32, height: u32) -> Vec<u8> {
        let img = ImageBuffer::from_fn(width, height, |x, y| Rgb([(x % 255) as u8, (y % 255) as u8, 90]));
        let mut out = Cursor::new(Vec::new());
        img.write_to(&mut out, format).unwrap();
        out.into_inner()
    }

    #[test]
    fn png_becomes_square_jpeg() {
        let jpeg = normalize(&encode(image::ImageFormat::Png, 640, 360)).unwrap();
        assert_eq!(&jpeg[..3], &[0xFF, 0xD8, 0xFF]);
        let back = image::load_from_memory(&jpeg).unwrap();
        assert_eq!((back.width(), back.height()), (SIZE, SIZE));
    }

    #[test]
    fn jpeg_is_reencoded() {
        assert!(normalize(&encode(image::ImageFormat::Jpeg, 300, 500)).is_ok());
    }

    #[test]
    fn junk_and_other_formats_are_rejected() {
        assert_eq!(normalize(b"<svg onload=alert(1)>"), Err(AvatarError::Unreadable));
        assert_eq!(normalize(&encode(image::ImageFormat::Bmp, 10, 10)), Err(AvatarError::Unreadable));
        assert_eq!(normalize(&[]), Err(AvatarError::Unreadable));
    }
}
