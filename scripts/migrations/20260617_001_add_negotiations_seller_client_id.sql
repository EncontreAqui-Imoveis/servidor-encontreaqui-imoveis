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

SET @fk_delete_rule := (
  SELECT DELETE_RULE
  FROM information_schema.REFERENTIAL_CONSTRAINTS
  WHERE CONSTRAINT_SCHEMA = DATABASE()
    AND TABLE_NAME = 'negotiations'
    AND CONSTRAINT_NAME = 'fk_negotiations_seller_client'
  LIMIT 1
);
SET @drop_fk_sql := IF(
  @fk_delete_rule IS NOT NULL AND UPPER(@fk_delete_rule) <> 'RESTRICT',
  'ALTER TABLE negotiations DROP FOREIGN KEY fk_negotiations_seller_client',
  'SELECT 1'
);
PREPARE stmt FROM @drop_fk_sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @has_fk := (
  SELECT COUNT(*)
  FROM information_schema.REFERENTIAL_CONSTRAINTS
  WHERE CONSTRAINT_SCHEMA = DATABASE()
    AND TABLE_NAME = 'negotiations'
    AND CONSTRAINT_NAME = 'fk_negotiations_seller_client'
);
SET @add_fk_sql := IF(
  @has_fk = 0,
  'ALTER TABLE negotiations ADD CONSTRAINT fk_negotiations_seller_client FOREIGN KEY (seller_client_id) REFERENCES users(id) ON DELETE RESTRICT',
  'SELECT 1'
);
PREPARE stmt FROM @add_fk_sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

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

SET @has_fk := (
  SELECT COUNT(*)
  FROM information_schema.REFERENTIAL_CONSTRAINTS
  WHERE CONSTRAINT_SCHEMA = DATABASE()
    AND TABLE_NAME = 'negotiations'
    AND CONSTRAINT_NAME = 'fk_negotiations_seller_client'
);
SET @drop_fk_sql := IF(
  @has_fk = 1,
  'ALTER TABLE negotiations DROP FOREIGN KEY fk_negotiations_seller_client',
  'SELECT 1'
);
PREPARE stmt FROM @drop_fk_sql;
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
