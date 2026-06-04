-- +migrate Up
SET @has_column := (
  SELECT COUNT(*)
  FROM information_schema.columns
  WHERE table_schema = DATABASE()
    AND table_name = 'negotiations'
    AND column_name = 'seller_client_id'
);
SET @add_column_sql := IF(
  @has_column = 0,
  'ALTER TABLE negotiations ADD COLUMN seller_client_id INT NULL AFTER selling_broker_id',
  'SELECT 1'
);
PREPARE stmt FROM @add_column_sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

UPDATE negotiations n
JOIN properties p ON p.id = n.property_id
SET n.seller_client_id = p.owner_id
WHERE n.seller_client_id IS NULL
  AND p.owner_id IS NOT NULL
  AND COALESCE(UPPER(TRIM(n.status)), '') NOT IN ('REFUSED', 'CANCELLED');

UPDATE negotiations
SET status = 'CANCELLED'
WHERE seller_client_id IS NULL
  AND selling_broker_id IS NULL
  AND COALESCE(UPPER(TRIM(status)), '') NOT IN ('REFUSED', 'CANCELLED');

SET @has_constraint := (
  SELECT COUNT(*)
  FROM information_schema.tidb_check_constraints
  WHERE CONSTRAINT_SCHEMA = DATABASE()
    AND table_name = 'negotiations'
    AND constraint_name = 'chk_negotiations_selling_broker_required'
);
SET @drop_sql := IF(
  @has_constraint = 1,
  'ALTER TABLE negotiations DROP CONSTRAINT chk_negotiations_selling_broker_required',
  'SELECT 1'
);
PREPARE stmt FROM @drop_sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

ALTER TABLE negotiations
  ADD CONSTRAINT chk_negotiations_selling_broker_required
  CHECK (
    selling_broker_id IS NOT NULL
    OR seller_client_id IS NOT NULL
    OR UPPER(TRIM(status)) IN ('REFUSED', 'CANCELLED')
  );

-- +migrate Down
SET @has_constraint := (
  SELECT COUNT(*)
  FROM information_schema.tidb_check_constraints
  WHERE CONSTRAINT_SCHEMA = DATABASE()
    AND table_name = 'negotiations'
    AND constraint_name = 'chk_negotiations_selling_broker_required'
);
SET @drop_sql := IF(
  @has_constraint = 1,
  'ALTER TABLE negotiations DROP CONSTRAINT chk_negotiations_selling_broker_required',
  'SELECT 1'
);
PREPARE stmt FROM @drop_sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @has_column := (
  SELECT COUNT(*)
  FROM information_schema.columns
  WHERE table_schema = DATABASE()
    AND table_name = 'negotiations'
    AND column_name = 'seller_client_id'
);
SET @drop_column_sql := IF(
  @has_column = 1,
  'ALTER TABLE negotiations DROP COLUMN seller_client_id',
  'SELECT 1'
);
PREPARE stmt FROM @drop_column_sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
