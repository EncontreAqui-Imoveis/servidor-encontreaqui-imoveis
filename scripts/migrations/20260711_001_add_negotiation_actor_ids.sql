-- +migrate Up
-- Access actors are distinct from the legal qualification stored in proposal fields.
SET @has_proposer_id := (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'negotiations' AND column_name = 'proposer_id');
SET @add_proposer_id_sql := IF(@has_proposer_id = 0, 'ALTER TABLE negotiations ADD COLUMN proposer_id INT NULL AFTER buyer_client_id', 'SELECT 1');
PREPARE stmt FROM @add_proposer_id_sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @has_advertiser_id := (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'negotiations' AND column_name = 'advertiser_id');
SET @add_advertiser_id_sql := IF(@has_advertiser_id = 0, 'ALTER TABLE negotiations ADD COLUMN advertiser_id INT NULL AFTER proposer_id', 'SELECT 1');
PREPARE stmt FROM @add_advertiser_id_sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Idempotency records prove a legacy proposer only when there is exactly one account.
UPDATE negotiations n
JOIN (
  SELECT negotiation_id, MIN(user_id) AS proposer_id
  FROM negotiation_proposal_idempotency
  WHERE user_id IS NOT NULL AND user_id > 0
  GROUP BY negotiation_id
  HAVING COUNT(DISTINCT user_id) = 1
) evidence ON evidence.negotiation_id = n.id
SET n.proposer_id = evidence.proposer_id
WHERE n.proposer_id IS NULL;

-- owner_id is the authoritative advertiser relation in the current property schema.
UPDATE negotiations n
JOIN properties p ON p.id = n.property_id
JOIN users advertiser ON advertiser.id = p.owner_id
SET n.advertiser_id = advertiser.id
WHERE n.advertiser_id IS NULL AND p.owner_id IS NOT NULL;

SET @has_proposer_fk := (SELECT COUNT(*) FROM information_schema.table_constraints WHERE table_schema = DATABASE() AND table_name = 'negotiations' AND constraint_name = 'fk_negotiations_proposer');
SET @add_proposer_fk_sql := IF(@has_proposer_fk = 0, 'ALTER TABLE negotiations ADD CONSTRAINT fk_negotiations_proposer FOREIGN KEY (proposer_id) REFERENCES users(id) ON DELETE SET NULL', 'SELECT 1');
PREPARE stmt FROM @add_proposer_fk_sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @has_advertiser_fk := (SELECT COUNT(*) FROM information_schema.table_constraints WHERE table_schema = DATABASE() AND table_name = 'negotiations' AND constraint_name = 'fk_negotiations_advertiser');
SET @add_advertiser_fk_sql := IF(@has_advertiser_fk = 0, 'ALTER TABLE negotiations ADD CONSTRAINT fk_negotiations_advertiser FOREIGN KEY (advertiser_id) REFERENCES users(id) ON DELETE SET NULL', 'SELECT 1');
PREPARE stmt FROM @add_advertiser_fk_sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @has_proposer_index := (SELECT COUNT(*) FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'negotiations' AND index_name = 'idx_negotiations_proposer_created');
SET @add_proposer_index_sql := IF(@has_proposer_index = 0, 'ALTER TABLE negotiations ADD INDEX idx_negotiations_proposer_created (proposer_id, created_at)', 'SELECT 1');
PREPARE stmt FROM @add_proposer_index_sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @has_advertiser_index := (SELECT COUNT(*) FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'negotiations' AND index_name = 'idx_negotiations_advertiser_property');
SET @add_advertiser_index_sql := IF(@has_advertiser_index = 0, 'ALTER TABLE negotiations ADD INDEX idx_negotiations_advertiser_property (advertiser_id, property_id)', 'SELECT 1');
PREPARE stmt FROM @add_advertiser_index_sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- +migrate Down
ALTER TABLE negotiations DROP FOREIGN KEY IF EXISTS fk_negotiations_advertiser;
ALTER TABLE negotiations DROP FOREIGN KEY IF EXISTS fk_negotiations_proposer;
ALTER TABLE negotiations DROP INDEX IF EXISTS idx_negotiations_proposer_created;
ALTER TABLE negotiations DROP INDEX IF EXISTS idx_negotiations_advertiser_property;
ALTER TABLE negotiations DROP COLUMN IF EXISTS advertiser_id;
ALTER TABLE negotiations DROP COLUMN IF EXISTS proposer_id;
