-- +migrate Up
CREATE TABLE IF NOT EXISTS contracts (
  id CHAR(36) COLLATE utf8mb4_0900_ai_ci NOT NULL,
  negotiation_id CHAR(36) COLLATE utf8mb4_0900_ai_ci NOT NULL,
  property_id INT NOT NULL,
  status ENUM('AWAITING_DOCS', 'IN_DRAFT', 'AWAITING_SIGNATURES', 'FINALIZED') NOT NULL DEFAULT 'AWAITING_DOCS',
  seller_info JSON NULL,
  buyer_info JSON NULL,
  commission_data JSON NULL,
  seller_approval_status ENUM('PENDING', 'APPROVED', 'APPROVED_WITH_RES', 'REJECTED') NOT NULL DEFAULT 'PENDING',
  buyer_approval_status ENUM('PENDING', 'APPROVED', 'APPROVED_WITH_RES', 'REJECTED') NOT NULL DEFAULT 'PENDING',
  seller_approval_reason JSON NULL,
  buyer_approval_reason JSON NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_contracts_negotiation (negotiation_id),
  KEY idx_contracts_property (property_id),
  KEY idx_contracts_status (status),
  CONSTRAINT fk_contracts_negotiation
    FOREIGN KEY (negotiation_id) REFERENCES negotiations(id) ON DELETE CASCADE,
  CONSTRAINT fk_contracts_property
    FOREIGN KEY (property_id) REFERENCES properties(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

ALTER TABLE contracts
  ADD COLUMN IF NOT EXISTS seller_approval_status ENUM('PENDING', 'APPROVED', 'APPROVED_WITH_RES', 'REJECTED') NOT NULL DEFAULT 'PENDING' AFTER commission_data,
  ADD COLUMN IF NOT EXISTS buyer_approval_status ENUM('PENDING', 'APPROVED', 'APPROVED_WITH_RES', 'REJECTED') NOT NULL DEFAULT 'PENDING' AFTER seller_approval_status,
  ADD COLUMN IF NOT EXISTS seller_approval_reason JSON NULL AFTER buyer_approval_status,
  ADD COLUMN IF NOT EXISTS buyer_approval_reason JSON NULL AFTER seller_approval_reason;

ALTER TABLE negotiation_documents
  ADD COLUMN IF NOT EXISTS document_type ENUM(
    'doc_identidade',
    'comprovante_endereco',
    'certidao_casamento_nascimento',
    'certidao_inteiro_teor',
    'certidao_onus_acoes',
    'comprovante_renda',
    'contrato_minuta',
    'contrato_assinado',
    'comprovante_pagamento',
    'boleto_vistoria'
  ) NULL AFTER type;

-- +migrate Down
ALTER TABLE negotiation_documents
  DROP COLUMN IF EXISTS document_type;

DROP TABLE IF EXISTS contracts;
