-- Lịch sử đăng nhập cho trang cá nhân: mỗi lần đăng nhập thành công (kể cả lúc
-- xác minh OTP đăng ký) và mỗi lần sai mật khẩu vào một tài khoản có thật.
-- Vị trí tra từ IP lúc ghi (GeoLite2 nếu có), để lịch sử không đổi khi dữ liệu GeoIP cập nhật.
-- session_hash: SHA-256 token của phiên tạo ra ở lần này, để đánh dấu "Phiên này".
-- Giữ 90 ngày (dọn khi có người đăng nhập).
CREATE TABLE login_events (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id BIGINT UNSIGNED NOT NULL,
  success BOOLEAN NOT NULL,
  ip VARCHAR(45) NOT NULL,
  user_agent VARCHAR(255) NOT NULL DEFAULT '',
  location VARCHAR(120) NULL,
  session_hash BINARY(32) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),
  PRIMARY KEY (id),
  KEY idx_login_events_user (user_id, created_at),
  KEY idx_login_events_created (created_at),
  CONSTRAINT fk_login_events_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci;
