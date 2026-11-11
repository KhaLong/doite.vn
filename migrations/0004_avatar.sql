-- Ảnh đại diện: JPEG 256×256 do server mã hoá lại từ ảnh người dùng tải lên
-- (bỏ EXIF/GPS và mọi dữ liệu lạ trong file gốc). avatar_updated_at làm số phiên bản
-- trên đường dẫn ảnh để trình duyệt cache lâu mà vẫn thấy ảnh mới khi đổi.
ALTER TABLE users
  ADD COLUMN avatar MEDIUMBLOB NULL,
  ADD COLUMN avatar_updated_at DATETIME(3) NULL;
