-- +migrate Up
-- The actor model uses proposer_id and advertiser_id. Legal qualification lives in payment_details.
SET @legacy_fk_drop_sql := (
  SELECT CASE
    WHEN COUNT(*) = 0 THEN 'SELECT 1'
    ELSE CONCAT(
      'ALTER TABLE negotiations ',
      GROUP_CONCAT(CONCAT('DROP FOREIGN KEY `', constraint_name, '`') SEPARATOR ', ')
    )
  END
  FROM information_schema.key_column_usage
  WHERE table_schema = DATABASE()
    AND table_name = 'negotiations'
    AND column_name IN ('client_cpf', 'buyer_client_id', 'seller_client_id')
    AND referenced_table_name IS NOT NULL
);
PREPARE stmt FROM @legacy_fk_drop_sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @legacy_check_drop_sql := (
  SELECT CASE
    WHEN COUNT(*) = 0 THEN 'SELECT 1'
    ELSE CONCAT(
      'ALTER TABLE negotiations ',
      GROUP_CONCAT(CONCAT('DROP CHECK `', constraint_name, '`') SEPARATOR ', ')
    )
  END
  FROM information_schema.table_constraints
  WHERE table_schema = DATABASE()
    AND table_name = 'negotiations'
    AND constraint_type = 'CHECK'
);
PREPARE stmt FROM @legacy_check_drop_sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

ALTER TABLE negotiations
  DROP COLUMN client_cpf,
  DROP COLUMN buyer_client_id,
  DROP COLUMN seller_client_id;

-- +migrate Down
-- Irreversible: the removed fields contained deprecated identity data.
SELECT 1;
