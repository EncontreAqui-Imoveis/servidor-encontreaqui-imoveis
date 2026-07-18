-- +migrate Up
-- Preserve ambiguous legacy contracts as NULL instead of silently assuming sale.
SET @has_contract_deal_type := (
  SELECT COUNT(*)
  FROM information_schema.columns
  WHERE table_schema = DATABASE()
    AND table_name = 'contracts'
    AND column_name = 'deal_type'
);
SET @add_contract_deal_type_sql := IF(
  @has_contract_deal_type = 0,
  "ALTER TABLE contracts ADD COLUMN deal_type ENUM('sale', 'rent') NULL AFTER property_id",
  'SELECT 1'
);
PREPARE stmt FROM @add_contract_deal_type_sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

UPDATE contracts c
JOIN negotiations n ON n.id = c.negotiation_id
SET c.deal_type = CASE
  WHEN LOWER(TRIM(n.deal_type)) = 'rent' THEN 'rent'
  WHEN LOWER(TRIM(n.deal_type)) = 'sale' THEN 'sale'
  ELSE NULL
END
WHERE c.deal_type IS NULL
   OR c.deal_type NOT IN ('sale', 'rent');

SET @has_contract_deal_type_index := (
  SELECT COUNT(*)
  FROM information_schema.statistics
  WHERE table_schema = DATABASE()
    AND table_name = 'contracts'
    AND index_name = 'idx_contracts_deal_type_status'
);
SET @add_contract_deal_type_index_sql := IF(
  @has_contract_deal_type_index = 0,
  'ALTER TABLE contracts ADD INDEX idx_contracts_deal_type_status (deal_type, status)',
  'SELECT 1'
);
PREPARE stmt FROM @add_contract_deal_type_index_sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- +migrate Down
ALTER TABLE contracts DROP INDEX IF EXISTS idx_contracts_deal_type_status;
ALTER TABLE contracts DROP COLUMN IF EXISTS deal_type;
