-- +migrate Up
-- Permite novos tipos de documento (cliente CNH/RG/CPF, slots de outros) sem alterar ENUM a cada inclusão.
ALTER TABLE negotiation_documents
  MODIFY COLUMN document_type VARCHAR(80) NULL;

-- +migrate Down
-- Revert não restaura ENUM original; em produção avaliar backup antes.
