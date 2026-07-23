-- +migrate Up
-- Lançamento é uma classificação comercial independente do tipo físico.
SET @has_market_stage := (
  SELECT COUNT(*)
  FROM information_schema.columns
  WHERE table_schema = DATABASE()
    AND table_name = 'properties'
    AND column_name = 'market_stage'
);
SET @add_market_stage_sql := IF(
  @has_market_stage = 0,
  "ALTER TABLE properties ADD COLUMN market_stage ENUM('STANDARD', 'LAUNCH') NOT NULL DEFAULT 'STANDARD' AFTER purpose",
  'SELECT 1'
);
PREPARE stmt FROM @add_market_stage_sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @has_market_stage_index := (
  SELECT COUNT(*)
  FROM information_schema.statistics
  WHERE table_schema = DATABASE()
    AND table_name = 'properties'
    AND index_name = 'idx_properties_market_stage_listing'
);
SET @add_market_stage_index_sql := IF(
  @has_market_stage_index = 0,
  'CREATE INDEX idx_properties_market_stage_listing ON properties (market_stage, purpose, status, visibility)',
  'SELECT 1'
);
PREPARE stmt FROM @add_market_stage_index_sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- +migrate Down
DROP INDEX IF EXISTS idx_properties_market_stage_listing ON properties;
ALTER TABLE properties DROP COLUMN IF EXISTS market_stage;
