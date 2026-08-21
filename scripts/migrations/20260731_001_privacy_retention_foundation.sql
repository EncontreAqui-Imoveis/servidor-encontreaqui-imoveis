-- +migrate Up
CREATE TABLE IF NOT EXISTS privacy_retention_runs (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  job_name VARCHAR(80) NOT NULL,
  status ENUM('SUCCESS', 'FAILED') NOT NULL,
  cutoff_at DATETIME NULL,
  deleted_count INT UNSIGNED NOT NULL DEFAULT 0,
  error_code VARCHAR(120) NULL,
  started_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at DATETIME NULL,
  PRIMARY KEY (id),
  KEY idx_privacy_retention_runs_job_created (job_name, started_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS privacy_requests (
  id CHAR(36) NOT NULL,
  requester_user_id BIGINT UNSIGNED NOT NULL,
  request_type ENUM('ACCESS', 'CORRECTION', 'DELETION', 'OPPOSITION', 'PORTABILITY') NOT NULL,
  status ENUM('PENDING', 'IN_REVIEW', 'COMPLETED', 'DENIED') NOT NULL DEFAULT 'PENDING',
  resolution_code VARCHAR(80) NULL,
  requested_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  resolved_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_privacy_requests_requester_status (requester_user_id, status, requested_at),
  KEY idx_privacy_requests_status_requested (status, requested_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- TiDB Cloud rejects PREPARE/EXECUTE unless multi-statement mode is enabled.
-- Native idempotent DDL keeps this migration safe without weakening that setting.
CREATE INDEX IF NOT EXISTS idx_notifications_created_at ON notifications (created_at);

-- +migrate Down
DROP INDEX IF EXISTS idx_notifications_created_at ON notifications;

DROP TABLE IF EXISTS privacy_requests;
DROP TABLE IF EXISTS privacy_retention_runs;
