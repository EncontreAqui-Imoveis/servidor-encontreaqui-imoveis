-- +migrate Up
SET @has_col := (
  SELECT COUNT(*)
  FROM information_schema.columns
  WHERE table_schema = DATABASE()
    AND table_name = 'negotiations'
    AND column_name = 'last_draft_edit_at'
);
SET @ddl := IF(
  @has_col = 0,
  'ALTER TABLE negotiations ADD COLUMN last_draft_edit_at DATETIME(3) NULL',
  'SELECT 1'
);
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- +migrate Down
SET @has_col := (
  SELECT COUNT(*)
  FROM information_schema.columns
  WHERE table_schema = DATABASE()
    AND table_name = 'negotiations'
    AND column_name = 'last_draft_edit_at'
);
SET @ddl := IF(
  @has_col = 1,
  'ALTER TABLE negotiations DROP COLUMN last_draft_edit_at',
  'SELECT 1'
);
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
