-- +migrate Up
ALTER TABLE negotiation_documents
  MODIFY COLUMN file_content LONGBLOB NULL;

ALTER TABLE negotiation_documents
  ADD COLUMN storage_provider VARCHAR(32) NULL AFTER file_content;

ALTER TABLE negotiation_documents
  ADD COLUMN storage_bucket VARCHAR(255) NULL AFTER storage_provider;

ALTER TABLE negotiation_documents
  ADD COLUMN storage_key VARCHAR(1024) NULL AFTER storage_bucket;

ALTER TABLE negotiation_documents
  ADD COLUMN storage_content_type VARCHAR(255) NULL AFTER storage_key;

ALTER TABLE negotiation_documents
  ADD COLUMN storage_size_bytes BIGINT NULL AFTER storage_content_type;

ALTER TABLE negotiation_documents
  ADD COLUMN storage_etag VARCHAR(255) NULL AFTER storage_size_bytes;

-- +migrate Down
ALTER TABLE negotiation_documents
  DROP COLUMN storage_etag;

ALTER TABLE negotiation_documents
  DROP COLUMN storage_size_bytes;

ALTER TABLE negotiation_documents
  DROP COLUMN storage_content_type;

ALTER TABLE negotiation_documents
  DROP COLUMN storage_key;

ALTER TABLE negotiation_documents
  DROP COLUMN storage_bucket;

ALTER TABLE negotiation_documents
  DROP COLUMN storage_provider;

ALTER TABLE negotiation_documents
  MODIFY COLUMN file_content LONGBLOB NOT NULL;
