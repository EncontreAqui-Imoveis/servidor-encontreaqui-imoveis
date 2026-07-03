-- +migrate Up
CREATE TABLE IF NOT EXISTS auth_phone_otps (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  phone VARCHAR(25) NOT NULL,
  session_token CHAR(36) NOT NULL,
  code_hash CHAR(64) NOT NULL,
  attempts SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  max_attempts SMALLINT UNSIGNED NOT NULL DEFAULT 5,
  cooldown_seconds SMALLINT UNSIGNED NOT NULL DEFAULT 60,
  sent_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  expires_at DATETIME NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_auth_phone_otps_session (session_token),
  INDEX idx_auth_phone_otps_phone (phone, sent_at),
  INDEX idx_auth_phone_otps_expires_at (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- +migrate Down
DROP TABLE IF EXISTS auth_phone_otps;
