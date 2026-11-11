-- Giao dịch: một tin đổi tệ khớp với một chào giá đã được nhận.
-- owner_id: người đăng tin; counterparty_id: người chào giá. kind theo tin
-- (sell = người đăng bán CNY, buy = người đăng mua CNY, pay = người đăng cần nạp/thanh toán hộ).
-- Trạng thái: processing (đang xử lý), completed (hoàn tất), cancelled (đã huỷ), disputed (khiếu nại).
-- Bảng do luồng chào giá ghi (chưa làm); trang cá nhân chỉ đọc.
CREATE TABLE trades (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  post_id BIGINT UNSIGNED NULL,
  owner_id BIGINT UNSIGNED NOT NULL,
  counterparty_id BIGINT UNSIGNED NOT NULL,
  kind VARCHAR(8) NOT NULL,
  amount_cny INT UNSIGNED NOT NULL,
  rate_vnd INT UNSIGNED NOT NULL,
  status VARCHAR(12) NOT NULL DEFAULT 'processing',
  created_at DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),
  completed_at DATETIME(3) NULL,
  PRIMARY KEY (id),
  KEY idx_trades_owner (owner_id, created_at),
  KEY idx_trades_counterparty (counterparty_id, created_at),
  CONSTRAINT fk_trades_post FOREIGN KEY (post_id) REFERENCES posts (id) ON DELETE SET NULL,
  CONSTRAINT fk_trades_owner FOREIGN KEY (owner_id) REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT fk_trades_counterparty FOREIGN KEY (counterparty_id) REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT chk_trades_kind CHECK (kind IN ('sell', 'buy', 'pay')),
  CONSTRAINT chk_trades_status CHECK (status IN ('processing', 'completed', 'cancelled', 'disputed')),
  CONSTRAINT chk_trades_parties CHECK (owner_id <> counterparty_id)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci;
