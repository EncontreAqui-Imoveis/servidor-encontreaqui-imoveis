-- +migrate Up
-- The PIN is stored as an HMAC digest only. Plain PINs are transient and must
-- never be persisted, logged, or sent in notification payloads.
SET @has_handshake_pin := (
  SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE()
    AND table_name = 'negotiations'
    AND column_name = 'handshake_pin'
);
SET @add_handshake_pin_sql := IF(
  @has_handshake_pin = 0,
  'ALTER TABLE negotiations ADD COLUMN handshake_pin CHAR(64) NULL AFTER legal_buyer_user_id',
  'SELECT 1'
);
PREPARE stmt FROM @add_handshake_pin_sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @has_handshake_status := (
  SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE()
    AND table_name = 'negotiations'
    AND column_name = 'handshake_status'
);
SET @add_handshake_status_sql := IF(
  @has_handshake_status = 0,
  "ALTER TABLE negotiations ADD COLUMN handshake_status ENUM('PENDING', 'VERIFIED', 'REJECTED') NOT NULL DEFAULT 'PENDING' AFTER handshake_pin",
  'SELECT 1'
);
PREPARE stmt FROM @add_handshake_status_sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @has_handshake_attempts := (
  SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE()
    AND table_name = 'negotiations'
    AND column_name = 'handshake_attempts'
);
SET @add_handshake_attempts_sql := IF(
  @has_handshake_attempts = 0,
  'ALTER TABLE negotiations ADD COLUMN handshake_attempts TINYINT UNSIGNED NOT NULL DEFAULT 0 AFTER handshake_status',
  'SELECT 1'
);
PREPARE stmt FROM @add_handshake_attempts_sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- +migrate Down
ALTER TABLE negotiations DROP COLUMN IF EXISTS handshake_attempts;
ALTER TABLE negotiations DROP COLUMN IF EXISTS handshake_status;
ALTER TABLE negotiations DROP COLUMN IF EXISTS handshake_pin;
