-- +migrate Up
SET @has_deleted_at := (
  SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'properties' AND column_name = 'deleted_at'
);
SET @add_deleted_at := IF(@has_deleted_at = 0,
  'ALTER TABLE properties ADD COLUMN deleted_at DATETIME NULL', 'SELECT 1');
PREPARE stmt FROM @add_deleted_at; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_deleted_by := (
  SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'properties' AND column_name = 'deleted_by_user_id'
);
SET @add_deleted_by := IF(@has_deleted_by = 0,
  'ALTER TABLE properties ADD COLUMN deleted_by_user_id INT NULL', 'SELECT 1');
PREPARE stmt FROM @add_deleted_by; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_deletion_reason := (
  SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'properties' AND column_name = 'deletion_reason'
);
SET @add_deletion_reason := IF(@has_deletion_reason = 0,
  'ALTER TABLE properties ADD COLUMN deletion_reason TEXT NULL', 'SELECT 1');
PREPARE stmt FROM @add_deletion_reason; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_reason_omitted := (
  SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'properties' AND column_name = 'deletion_reason_omitted'
);
SET @add_reason_omitted := IF(@has_reason_omitted = 0,
  'ALTER TABLE properties ADD COLUMN deletion_reason_omitted TINYINT(1) NOT NULL DEFAULT 0', 'SELECT 1');
PREPARE stmt FROM @add_reason_omitted; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_deleted_index := (
  SELECT COUNT(*) FROM information_schema.statistics
  WHERE table_schema = DATABASE() AND table_name = 'properties' AND index_name = 'idx_properties_deleted_at'
);
SET @add_deleted_index := IF(@has_deleted_index = 0,
  'ALTER TABLE properties ADD INDEX idx_properties_deleted_at (deleted_at)', 'SELECT 1');
PREPARE stmt FROM @add_deleted_index; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- +migrate Down
SELECT 1;
