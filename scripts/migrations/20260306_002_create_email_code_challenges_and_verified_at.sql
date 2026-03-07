-- +migrate Up
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS email_verified_at DATETIME NULL AFTER email;

CREATE TABLE IF NOT EXISTS email_code_challenges (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NULL,
  email VARCHAR(255) NOT NULL,
  purpose ENUM('verify_email', 'password_reset') NOT NULL,
  code_hash CHAR(64) NOT NULL,
  send_attempt_number INT NOT NULL,
  failed_attempts INT NOT NULL DEFAULT 0,
  max_attempts INT NOT NULL DEFAULT 5,
  cooldown_seconds INT NOT NULL,
  expires_at DATETIME NOT NULL,
  sent_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  delivery_provider VARCHAR(32) NOT NULL DEFAULT 'brevo',
  status ENUM('sent', 'verified', 'consumed', 'expired', 'locked') NOT NULL DEFAULT 'sent',
  verified_at DATETIME NULL,
  consumed_at DATETIME NULL,
  session_token_hash CHAR(64) NULL,
  session_expires_at DATETIME NULL,
  INDEX idx_email_code_challenges_email_purpose_sent_at (email, purpose, sent_at),
  INDEX idx_email_code_challenges_user_purpose_sent_at (user_id, purpose, sent_at),
  INDEX idx_email_code_challenges_status_expires_at (status, expires_at)
);

-- +migrate Down
DROP TABLE IF EXISTS email_code_challenges;
ALTER TABLE users
  DROP COLUMN IF EXISTS email_verified_at;
