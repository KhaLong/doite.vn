-- Tin nhắn: chống gửi trùng và mở đường cho các loại tin khác.
-- client_id: mã do trình duyệt tạo cho mỗi lần gửi; gửi lại (mất mạng, bấm hai lần) cùng mã thì
--            server trả lại đúng tin cũ, không tạo tin mới. UNIQUE theo người gửi.
-- kind:      loại tin. Hiện chỉ 'text'. Công cụ sau này (ảnh, đề nghị tỷ giá, ảnh chuyển khoản, tin hệ thống…)
--            thêm loại mới + dữ liệu riêng trong meta, không phải đổi bảng.
-- meta:      dữ liệu riêng của loại tin (JSON), NULL với tin chữ.
ALTER TABLE messages
  ADD COLUMN client_id VARCHAR(36) NULL,
  ADD COLUMN kind VARCHAR(16) NOT NULL DEFAULT 'text',
  ADD COLUMN meta JSON NULL,
  ADD UNIQUE KEY uq_messages_client (sender_id, client_id),
  ADD CONSTRAINT chk_messages_kind CHECK (kind IN ('text'));
