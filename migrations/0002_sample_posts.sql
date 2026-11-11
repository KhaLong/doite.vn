-- Sample board so the homepage is not empty during development.
-- These accounts cannot sign in: '!' is not a valid Argon2 hash, and their
-- phones (+84000…) can never pass phone validation.
INSERT INTO users (username, display_name, phone, password_hash, phone_verified_at, trades_count, success_permille, escrow_vnd, business_verified) VALUES
  ('mau.minhchau', 'Nguyễn Hoàng Minh Châu', '+84000000001', '!', UTC_TIMESTAMP(3), 42, 1000, 0, FALSE),
  ('mau.hakhau', 'Đại Lý Đổi Tệ Hà Khẩu', '+84000000002', '!', UTC_TIMESTAMP(3), 310, 995, 50000000, FALSE),
  ('mau.vanlong', 'Trần Văn Long', '+84000000003', '!', UTC_TIMESTAMP(3), 18, 980, 0, FALSE),
  ('mau.logistics', 'Logistics Vận Chuyển', '+84000000004', '!', UTC_TIMESTAMP(3), 0, NULL, 0, TRUE),
  ('mau.yennhi', 'Lê Hoàng Yến Nhi', '+84000000005', '!', UTC_TIMESTAMP(3), 0, NULL, 0, FALSE),
  ('mau.quocbao', 'Phạm Quốc Bảo', '+84000000006', '!', UTC_TIMESTAMP(3), 85, 992, 0, FALSE);

INSERT INTO posts (user_id, kind, amount_cny, rate_vnd, channel_label, channels, limit_label, urgent_label, created_at)
SELECT u.id, s.kind, s.amount_cny, s.rate_vnd, s.channel_label, s.channels, s.limit_label, s.urgent_label,
       UTC_TIMESTAMP(3) - INTERVAL s.minutes_ago MINUTE
FROM (
  SELECT 'mau.minhchau' AS username, 'sell' AS kind, 12500 AS amount_cny, 3535 AS rate_vnd, 'Vietcombank · Alipay' AS channel_label, 'bank,alipay' AS channels, 'Tối thiểu 3.000 ¥' AS limit_label, NULL AS urgent_label, 2 AS minutes_ago
  UNION ALL SELECT 'mau.hakhau', 'buy', 30000, 3520, 'Ví Alipay cá nhân', 'alipay', 'Từ 5.000 ¥ đến hết', NULL, 8
  UNION ALL SELECT 'mau.vanlong', 'pay', 4200, 3540, 'Quét QR đơn Taobao', 'taobao', 'Chụp bill xác nhận ngay', NULL, 15
  UNION ALL SELECT 'mau.logistics', 'sell', 150000, 3538, 'Chia nhỏ hoặc nhận trọn gói', 'bank', 'Từ 20.000 ¥/lệnh', NULL, 24
  UNION ALL SELECT 'mau.yennhi', 'buy', 1500, 3525, 'WeChat Pay Hồng Bao', 'wechat', 'Từ 1.500 ¥', 'Cần gấp, còn 15 phút', 35
  UNION ALL SELECT 'mau.quocbao', 'sell', 8000, 3542, 'Techcombank QR 24/7', 'bank', 'Nhận trọn 8.000 ¥', 'Hết hạn chào giá sau 12 phút', 41
) AS s
JOIN users u ON u.username = s.username;
