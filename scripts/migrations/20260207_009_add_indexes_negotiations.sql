-- +migrate Up
CREATE INDEX idx_negotiations_property_active ON negotiations(property_id, active);
CREATE INDEX idx_negotiations_status_active_created ON negotiations(status, active, created_at);
CREATE INDEX idx_negotiations_expires_at ON negotiations(expires_at);
CREATE INDEX idx_negotiation_documents_negotiation ON negotiation_documents(negotiation_id);
CREATE INDEX idx_negotiation_contracts_negotiation ON negotiation_contracts(negotiation_id);
CREATE INDEX idx_negotiation_signatures_negotiation ON negotiation_signatures(negotiation_id);
CREATE INDEX idx_negotiation_close_negotiation ON negotiation_close_submissions(negotiation_id);
CREATE INDEX idx_commission_splits_submission ON commission_splits(close_submission_id);

-- +migrate Down
DROP INDEX idx_negotiations_property_active ON negotiations;
DROP INDEX idx_negotiations_status_active_created ON negotiations;
DROP INDEX idx_negotiations_expires_at ON negotiations;
DROP INDEX idx_negotiation_documents_negotiation ON negotiation_documents;
DROP INDEX idx_negotiation_contracts_negotiation ON negotiation_contracts;
DROP INDEX idx_negotiation_signatures_negotiation ON negotiation_signatures;
DROP INDEX idx_negotiation_close_negotiation ON negotiation_close_submissions;
DROP INDEX idx_commission_splits_submission ON commission_splits;
