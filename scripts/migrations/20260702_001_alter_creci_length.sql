-- +migrate Up
ALTER TABLE registration_drafts DROP COLUMN IF EXISTS active_broker_creci;
ALTER TABLE registration_drafts MODIFY COLUMN creci VARCHAR(8) NULL;
ALTER TABLE registration_drafts DROP INDEX IF EXISTS uq_registration_drafts_open_broker_creci;
ALTER TABLE registration_drafts ADD COLUMN IF NOT EXISTS active_broker_creci VARCHAR(8) AS (
  CASE WHEN status = 'OPEN' AND profile_type = 'broker' THEN creci ELSE NULL END
) STORED;
ALTER TABLE registration_drafts ADD UNIQUE KEY uq_registration_drafts_open_broker_creci (active_broker_creci);

ALTER TABLE brokers MODIFY COLUMN creci VARCHAR(8) NULL;

-- +migrate Down
ALTER TABLE registration_drafts DROP COLUMN IF EXISTS active_broker_creci;
ALTER TABLE registration_drafts MODIFY COLUMN creci VARCHAR(50) NULL;
ALTER TABLE registration_drafts DROP INDEX IF EXISTS uq_registration_drafts_open_broker_creci;
ALTER TABLE registration_drafts ADD COLUMN IF NOT EXISTS active_broker_creci VARCHAR(50) AS (
  CASE WHEN status = 'OPEN' AND profile_type = 'broker' THEN creci ELSE NULL END
) STORED;
ALTER TABLE registration_drafts ADD UNIQUE KEY uq_registration_drafts_open_broker_creci (active_broker_creci);

ALTER TABLE brokers MODIFY COLUMN creci VARCHAR(50) NULL;
