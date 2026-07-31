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

SET @has_notifications_created_index := (
  SELECT COUNT(*)
  FROM information_schema.statistics
  WHERE table_schema = DATABASE()
    AND table_name = 'notifications'
    AND index_name = 'idx_notifications_created_at'
);
SET @add_notifications_created_index_sql := IF(
  @has_notifications_created_index = 0,
  'ALTER TABLE notifications ADD INDEX idx_notifications_created_at (created_at)',
  'SELECT 1'
);
PREPARE stmt FROM @add_notifications_created_index_sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- +migrate Down
SET @has_notifications_created_index := (
  SELECT COUNT(*)
  FROM information_schema.statistics
  WHERE table_schema = DATABASE()
    AND table_name = 'notifications'
    AND index_name = 'idx_notifications_created_at'
);
SET @drop_notifications_created_index_sql := IF(
  @has_notifications_created_index > 0,
  'ALTER TABLE notifications DROP INDEX idx_notifications_created_at',
  'SELECT 1'
);
PREPARE stmt FROM @drop_notifications_created_index_sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

DROP TABLE IF EXISTS privacy_requests;
DROP TABLE IF EXISTS privacy_retention_runs;
