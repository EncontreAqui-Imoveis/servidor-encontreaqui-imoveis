ALTER TABLE negotiation_documents
  ADD COLUMN IF NOT EXISTS metadata_json JSON NULL AFTER document_type;
