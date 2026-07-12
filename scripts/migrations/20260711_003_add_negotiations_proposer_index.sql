-- +migrate Up
-- Covers GET /negotiations/mine?propertyId= for the authenticated proposer.
SET @has_proposer_property_index := (
  SELECT COUNT(*)
  FROM information_schema.statistics
  WHERE table_schema = DATABASE()
    AND table_name = 'negotiations'
    AND index_name = 'idx_negotiations_proposer_property'
);
SET @add_proposer_property_index_sql := IF(
  @has_proposer_property_index = 0,
  'ALTER TABLE negotiations ADD INDEX idx_negotiations_proposer_property (proposer_id, property_id, created_at)',
  'SELECT 1'
);
PREPARE stmt FROM @add_proposer_property_index_sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- +migrate Down
SET @has_proposer_property_index := (
  SELECT COUNT(*)
  FROM information_schema.statistics
  WHERE table_schema = DATABASE()
    AND table_name = 'negotiations'
    AND index_name = 'idx_negotiations_proposer_property'
);
SET @drop_proposer_property_index_sql := IF(
  @has_proposer_property_index > 0,
  'ALTER TABLE negotiations DROP INDEX idx_negotiations_proposer_property',
  'SELECT 1'
);
PREPARE stmt FROM @drop_proposer_property_index_sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
