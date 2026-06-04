-- +migrate Up
UPDATE negotiations n
JOIN properties p ON p.id = n.property_id
SET n.selling_broker_id = p.broker_id
WHERE n.selling_broker_id IS NULL
  AND n.buyer_client_id IS NULL
  AND p.broker_id IS NOT NULL
  AND COALESCE(UPPER(TRIM(n.status)), '') NOT IN ('REFUSED', 'CANCELLED');

UPDATE negotiations
SET status = 'CANCELLED'
WHERE selling_broker_id IS NULL
  AND buyer_client_id IS NULL
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

ALTER TABLE negotiations
  ADD CONSTRAINT chk_negotiations_selling_broker_required
  CHECK (selling_broker_id IS NOT NULL);
