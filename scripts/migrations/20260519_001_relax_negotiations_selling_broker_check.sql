-- +migrate Up
SET @has_constraint := (
  SELECT COUNT(*)
  FROM information_schema.table_constraints
  WHERE table_schema = DATABASE()
    AND table_name = 'negotiations'
    AND constraint_name = 'chk_negotiations_selling_broker_required'
    AND constraint_type = 'CHECK'
);
SET @drop_sql := IF(
  @has_constraint = 1,
  'ALTER TABLE negotiations DROP CHECK chk_negotiations_selling_broker_required',
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
  FROM information_schema.table_constraints
  WHERE table_schema = DATABASE()
    AND table_name = 'negotiations'
    AND constraint_name = 'chk_negotiations_selling_broker_required'
    AND constraint_type = 'CHECK'
);
SET @drop_sql := IF(
  @has_constraint = 1,
  'ALTER TABLE negotiations DROP CHECK chk_negotiations_selling_broker_required',
  'SELECT 1'
);
PREPARE stmt FROM @drop_sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

ALTER TABLE negotiations
  ADD CONSTRAINT chk_negotiations_selling_broker_required
  CHECK (selling_broker_id IS NOT NULL);
