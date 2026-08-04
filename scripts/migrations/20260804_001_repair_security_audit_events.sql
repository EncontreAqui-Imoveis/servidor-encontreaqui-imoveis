-- +migrate Up
-- Repair for environments where the migration ledger contains the original
-- audit migration but the physical table was not created.
CREATE TABLE IF NOT EXISTS security_audit_events (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  event_type VARCHAR(80) NOT NULL,
  severity ENUM('INFO', 'WARNING', 'HIGH', 'CRITICAL') NOT NULL,
  request_id CHAR(36) NULL,
  actor_role VARCHAR(48) NOT NULL DEFAULT 'anonymous',
  http_method VARCHAR(12) NOT NULL,
  route VARCHAR(255) NOT NULL,
  status_code SMALLINT UNSIGNED NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_security_audit_events_created (created_at),
  KEY idx_security_audit_events_type_created (event_type, created_at),
  KEY idx_security_audit_events_status_created (status_code, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- +migrate Down
-- The original migration owns this table. Never drop audit evidence during a repair rollback.
SELECT 1;
