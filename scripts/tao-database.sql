-- Tạo database và tài khoản MySQL cho doite.vn (chạy MỘT lần bằng tài khoản root).
--   mysql -u root -p < scripts/tao-database.sql
-- Đổi 'DOI_MAT_KHAU_NAY' thành mật khẩu thật, rồi ghi đúng mật khẩu đó vào DATABASE_URL trong .env.
-- Bảng không tạo ở đây: server tự chạy migrations/ mỗi lần khởi động.

CREATE DATABASE IF NOT EXISTS doite CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;

CREATE USER IF NOT EXISTS 'doite'@'localhost' IDENTIFIED BY 'DOI_MAT_KHAU_NAY';
CREATE USER IF NOT EXISTS 'doite'@'127.0.0.1' IDENTIFIED BY 'DOI_MAT_KHAU_NAY';
GRANT ALL PRIVILEGES ON doite.* TO 'doite'@'localhost';
GRANT ALL PRIVILEGES ON doite.* TO 'doite'@'127.0.0.1';
FLUSH PRIVILEGES;
