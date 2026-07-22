-- +migrate Up
-- A finalização é o evento financeiro canônico. A projeção abaixo preserva a
-- comissão do corretor mesmo se o imóvel for posteriormente relistado.
SET @has_contract_finalized_at := (
  SELECT COUNT(*)
  FROM information_schema.columns
  WHERE table_schema = DATABASE()
    AND table_name = 'contracts'
    AND column_name = 'finalized_at'
);
SET @add_contract_finalized_at_sql := IF(
  @has_contract_finalized_at = 0,
  'ALTER TABLE contracts ADD COLUMN finalized_at DATETIME NULL AFTER updated_at',
  'SELECT 1'
);
PREPARE stmt FROM @add_contract_finalized_at_sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

CREATE TABLE IF NOT EXISTS contract_commission_allocations (
  id CHAR(36) COLLATE utf8mb4_0900_ai_ci NOT NULL,
  contract_id CHAR(36) COLLATE utf8mb4_0900_ai_ci NOT NULL,
  negotiation_id CHAR(36) COLLATE utf8mb4_0900_ai_ci NOT NULL,
  broker_id INT NOT NULL,
  role ENUM('CAPTURING', 'SELLING') NOT NULL,
  deal_type ENUM('sale', 'rent') NOT NULL,
  base_amount DECIMAL(15,2) NOT NULL,
  amount DECIMAL(15,2) NOT NULL,
  status ENUM('RECORDED', 'CANCELLED') NOT NULL DEFAULT 'RECORDED',
  finalized_at DATETIME NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_contract_commission_allocations_contract_broker_role (contract_id, broker_id, role),
  KEY idx_contract_commission_allocations_broker_finalized (broker_id, finalized_at),
  KEY idx_contract_commission_allocations_contract (contract_id),
  CONSTRAINT fk_contract_commission_allocations_contract
    FOREIGN KEY (contract_id) REFERENCES contracts(id) ON DELETE CASCADE,
  CONSTRAINT fk_contract_commission_allocations_negotiation
    FOREIGN KEY (negotiation_id) REFERENCES negotiations(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- +migrate Down
DROP TABLE IF EXISTS contract_commission_allocations;
ALTER TABLE contracts DROP COLUMN IF EXISTS finalized_at;
