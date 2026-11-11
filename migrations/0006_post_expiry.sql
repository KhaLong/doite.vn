-- Hạn nhận chào giá của tin. Hết hạn thì tin không còn trên Bảng tin.
-- NULL: không hết hạn (tin mẫu cũ).
ALTER TABLE posts
  ADD COLUMN expires_at DATETIME(3) NULL,
  ADD KEY idx_posts_owner_open (user_id, status, expires_at);
