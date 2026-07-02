-- +migrate Up
ALTER TABLE registration_drafts DROP COLUMN IF EXISTS active_broker_creci;
ALTER TABLE registration_drafts MODIFY COLUMN creci VARCHAR(8) NULL;
ALTER TABLE registration_drafts DROP INDEX IF EXISTS uq_registration_drafts_open_broker_creci;

ALTER TABLE brokers MODIFY COLUMN creci VARCHAR(8) NULL;

-- +migrate Down
ALTER TABLE registration_drafts DROP COLUMN IF EXISTS active_broker_creci;
ALTER TABLE registration_drafts MODIFY COLUMN creci VARCHAR(50) NULL;
ALTER TABLE registration_drafts DROP INDEX IF EXISTS uq_registration_drafts_open_broker_creci;

ALTER TABLE brokers MODIFY COLUMN creci VARCHAR(50) NULL;
