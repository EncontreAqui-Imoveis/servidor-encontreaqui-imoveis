-- +migrate Up
-- The legacy cpf column remains temporarily for an explicit, auditable backfill.
-- New writes use the encrypted representation below.
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS cpf_ciphertext TEXT NULL,
  ADD COLUMN IF NOT EXISTS cpf_lookup_hash VARCHAR(67) NULL,
  ADD COLUMN IF NOT EXISTS cpf_last4 CHAR(4) NULL,
  ADD COLUMN IF NOT EXISTS cpf_key_version VARCHAR(16) NULL;

CREATE INDEX IF NOT EXISTS idx_users_cpf_lookup_hash ON users (cpf_lookup_hash);

-- +migrate Down
-- Deliberately non-destructive: ciphertext may be the only remaining copy after
-- the approved backfill. Rollback is application-level during the transition.
SELECT 1;
