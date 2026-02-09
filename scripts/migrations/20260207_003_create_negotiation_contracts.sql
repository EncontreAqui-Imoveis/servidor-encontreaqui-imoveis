-- +migrate Up
CREATE TABLE IF NOT EXISTS negotiation_contracts (
  id INT PRIMARY KEY AUTO_INCREMENT,
  negotiation_id INT NOT NULL,
  version INT NOT NULL,
  contract_url TEXT NOT NULL,
  uploaded_by_admin_id INT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_neg_contract_negotiation FOREIGN KEY (negotiation_id) REFERENCES negotiations(id) ON DELETE CASCADE,
  CONSTRAINT fk_neg_contract_admin FOREIGN KEY (uploaded_by_admin_id) REFERENCES admins(id) ON DELETE RESTRICT,
  UNIQUE KEY uq_negotiation_contract_version (negotiation_id, version)
);

-- +migrate Down
DROP TABLE IF EXISTS negotiation_contracts;
