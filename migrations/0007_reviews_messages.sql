-- Đánh giá: chỉ người tham gia một giao dịch đã hoàn tất mới viết được, mỗi người một đánh giá cho mỗi giao dịch.
CREATE TABLE reviews (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  trade_id BIGINT UNSIGNED NOT NULL,
  reviewer_id BIGINT UNSIGNED NOT NULL,
  reviewee_id BIGINT UNSIGNED NOT NULL,
  stars TINYINT UNSIGNED NOT NULL,
  comment VARCHAR(500) NOT NULL DEFAULT '',
  created_at DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),
  PRIMARY KEY (id),
  UNIQUE KEY uq_reviews_trade_reviewer (trade_id, reviewer_id),
  KEY idx_reviews_reviewee (reviewee_id, created_at),
  CONSTRAINT fk_reviews_trade FOREIGN KEY (trade_id) REFERENCES trades (id) ON DELETE CASCADE,
  CONSTRAINT fk_reviews_reviewer FOREIGN KEY (reviewer_id) REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT fk_reviews_reviewee FOREIGN KEY (reviewee_id) REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT chk_reviews_stars CHECK (stars BETWEEN 1 AND 5),
  CONSTRAINT chk_reviews_people CHECK (reviewer_id <> reviewee_id)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci;

-- Tin nhắn giữa hai người. Một cặp người dùng chỉ có một hội thoại (user_low < user_high).
CREATE TABLE conversations (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_low BIGINT UNSIGNED NOT NULL,
  user_high BIGINT UNSIGNED NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),
  last_message_at DATETIME(3) NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_conversations_pair (user_low, user_high),
  KEY idx_conversations_high (user_high),
  CONSTRAINT fk_conversations_low FOREIGN KEY (user_low) REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT fk_conversations_high FOREIGN KEY (user_high) REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT chk_conversations_order CHECK (user_low < user_high)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci;

CREATE TABLE messages (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  conversation_id BIGINT UNSIGNED NOT NULL,
  sender_id BIGINT UNSIGNED NOT NULL,
  body VARCHAR(1000) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),
  read_at DATETIME(3) NULL,
  PRIMARY KEY (id),
  KEY idx_messages_conversation (conversation_id, id),
  KEY idx_messages_unread (conversation_id, sender_id, read_at),
  CONSTRAINT fk_messages_conversation FOREIGN KEY (conversation_id) REFERENCES conversations (id) ON DELETE CASCADE,
  CONSTRAINT fk_messages_sender FOREIGN KEY (sender_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci;
