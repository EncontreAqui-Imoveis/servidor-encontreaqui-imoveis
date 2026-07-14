-- +migrate Up
-- Preserve cancelled contracts for audit without leaving them mutable. TiDB
-- requires a full ENUM declaration when adding a value.
SET @contract_status_type := (
  SELECT column_type
  FROM information_schema.columns
  WHERE table_schema = DATABASE()
    AND table_name = 'contracts'
    AND column_name = 'status'
  LIMIT 1
);
SET @add_cancelled_status_sql := IF(
  @contract_status_type IS NULL OR LOCATE("'CANCELLED'", @contract_status_type) > 0,
  'SELECT 1',
  "ALTER TABLE contracts MODIFY COLUMN status ENUM('AWAITING_DOCS', 'IN_DRAFT', 'AWAITING_SIGNATURES', 'FINALIZED', 'CANCELLED') NOT NULL DEFAULT 'AWAITING_DOCS'"
);
PREPARE stmt FROM @add_cancelled_status_sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- +migrate Down
-- A cancelled audit record cannot be safely coerced back to a mutable state.
SELECT 1;
