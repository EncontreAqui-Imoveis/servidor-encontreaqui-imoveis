-- +migrate Up
ALTER TABLE negotiation_documents
  ADD COLUMN IF NOT EXISTS metadata_json JSON NULL AFTER document_type;

-- +migrate Down
ALTER TABLE negotiation_documents
  DROP COLUMN IF EXISTS metadata_json;
