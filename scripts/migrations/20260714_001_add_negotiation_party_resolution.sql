-- +migrate Up
-- Stores the proposal initiator's contractual side and an optional, verified
-- buyer account link. Neither field is an authorization shortcut by itself.
SET @has_initiator_side := (
  SELECT COUNT(*)
  FROM information_schema.columns
  WHERE table_schema = DATABASE()
    AND table_name = 'negotiations'
    AND column_name = 'initiator_side'
);
SET @add_initiator_side_sql := IF(
  @has_initiator_side = 0,
  "ALTER TABLE negotiations ADD COLUMN initiator_side ENUM('buyer', 'seller') NULL AFTER advertiser_id",
  'SELECT 1'
);
PREPARE stmt FROM @add_initiator_side_sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @has_legal_buyer_user_id := (
  SELECT COUNT(*)
  FROM information_schema.columns
  WHERE table_schema = DATABASE()
    AND table_name = 'negotiations'
    AND column_name = 'legal_buyer_user_id'
);
SET @add_legal_buyer_user_id_sql := IF(
  @has_legal_buyer_user_id = 0,
  'ALTER TABLE negotiations ADD COLUMN legal_buyer_user_id INT NULL AFTER initiator_side',
  'SELECT 1'
);
PREPARE stmt FROM @add_legal_buyer_user_id_sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @has_legal_buyer_fk := (
  SELECT COUNT(*)
  FROM information_schema.table_constraints
  WHERE table_schema = DATABASE()
    AND table_name = 'negotiations'
    AND constraint_name = 'fk_negotiations_legal_buyer_user'
);
SET @add_legal_buyer_fk_sql := IF(
  @has_legal_buyer_fk = 0,
  'ALTER TABLE negotiations ADD CONSTRAINT fk_negotiations_legal_buyer_user FOREIGN KEY (legal_buyer_user_id) REFERENCES users(id) ON DELETE SET NULL',
  'SELECT 1'
);
PREPARE stmt FROM @add_legal_buyer_fk_sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @has_legal_buyer_index := (
  SELECT COUNT(*)
  FROM information_schema.statistics
  WHERE table_schema = DATABASE()
    AND table_name = 'negotiations'
    AND index_name = 'idx_negotiations_legal_buyer_created'
);
SET @add_legal_buyer_index_sql := IF(
  @has_legal_buyer_index = 0,
  'ALTER TABLE negotiations ADD INDEX idx_negotiations_legal_buyer_created (legal_buyer_user_id, created_at)',
  'SELECT 1'
);
PREPARE stmt FROM @add_legal_buyer_index_sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- +migrate Down
ALTER TABLE negotiations DROP FOREIGN KEY IF EXISTS fk_negotiations_legal_buyer_user;
ALTER TABLE negotiations DROP INDEX IF EXISTS idx_negotiations_legal_buyer_created;
ALTER TABLE negotiations DROP COLUMN IF EXISTS legal_buyer_user_id;
ALTER TABLE negotiations DROP COLUMN IF EXISTS initiator_side;
