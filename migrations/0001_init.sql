-- doite.vn: accounts, sessions, OTP codes, password resets and exchange posts.
-- All times are UTC.

-- Phone is stored as E.164 (+84 followed by 9 digits). A row with
-- phone_verified_at NULL is a sign-up still waiting for its OTP.
CREATE TABLE users (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  username VARCHAR(20) NOT NULL,
  display_name VARCHAR(50) NOT NULL,
  phone VARCHAR(16) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  phone_verified_at DATETIME(3) NULL,
  terms_accepted_at DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),
  -- Reputation shown on each post. Filled by the trading system later.
  trades_count INT UNSIGNED NOT NULL DEFAULT 0,
  success_permille SMALLINT UNSIGNED NULL,
  escrow_vnd BIGINT UNSIGNED NOT NULL DEFAULT 0,
  business_verified BOOLEAN NOT NULL DEFAULT FALSE,
  created_at DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),
  updated_at DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),
  PRIMARY KEY (id),
  UNIQUE KEY uq_users_username (username),
  UNIQUE KEY uq_users_phone (phone),
  CONSTRAINT chk_users_success CHECK (success_permille IS NULL OR success_permille <= 1000)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci;

-- Only a SHA-256 of the cookie token is stored.
CREATE TABLE sessions (
  token_hash BINARY(32) NOT NULL,
  user_id BIGINT UNSIGNED NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),
  expires_at DATETIME(3) NOT NULL,
  PRIMARY KEY (token_hash),
  KEY idx_sessions_user (user_id),
  KEY idx_sessions_expires (expires_at),
  CONSTRAINT fk_sessions_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci;

-- One-time SMS codes. Only a SHA-256 of the code is stored.
CREATE TABLE otp_codes (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  phone VARCHAR(16) NOT NULL,
  purpose VARCHAR(16) NOT NULL,
  code_hash BINARY(32) NOT NULL,
  attempts TINYINT UNSIGNED NOT NULL DEFAULT 0,
  created_at DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),
  expires_at DATETIME(3) NOT NULL,
  consumed_at DATETIME(3) NULL,
  PRIMARY KEY (id),
  KEY idx_otp_phone (phone, purpose, id),
  CONSTRAINT chk_otp_purpose CHECK (purpose IN ('register', 'reset'))
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci;

-- Issued after a reset OTP is verified; allows exactly one password change.
CREATE TABLE password_resets (
  token_hash BINARY(32) NOT NULL,
  user_id BIGINT UNSIGNED NOT NULL,
  expires_at DATETIME(3) NOT NULL,
  PRIMARY KEY (token_hash),
  KEY idx_resets_user (user_id),
  CONSTRAINT fk_resets_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci;

-- Exchange posts on the homepage board ("Bảng tin").
-- kind: sell = cần bán CNY, buy = cần mua CNY, pay = nạp Alipay / thanh toán hộ.
-- channels: comma list of filter keys (alipay, wechat, bank, taobao).
CREATE TABLE posts (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id BIGINT UNSIGNED NOT NULL,
  kind VARCHAR(8) NOT NULL,
  amount_cny INT UNSIGNED NOT NULL,
  rate_vnd INT UNSIGNED NOT NULL,
  channel_label VARCHAR(120) NOT NULL,
  channels VARCHAR(100) NOT NULL,
  limit_label VARCHAR(120) NOT NULL DEFAULT '',
  urgent_label VARCHAR(120) NULL,
  status VARCHAR(8) NOT NULL DEFAULT 'open',
  created_at DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),
  PRIMARY KEY (id),
  KEY idx_posts_open (status, created_at),
  CONSTRAINT fk_posts_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT chk_posts_kind CHECK (kind IN ('sell', 'buy', 'pay')),
  CONSTRAINT chk_posts_status CHECK (status IN ('open', 'closed'))
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci;
