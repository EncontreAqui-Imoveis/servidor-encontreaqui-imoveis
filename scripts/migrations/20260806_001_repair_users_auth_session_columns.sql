-- +migrate Up
-- Repair partially bootstrapped databases where historical auth migrations were
-- recorded in schema_migrations without all physical users columns being present.
-- Every statement is idempotent and intentionally avoids PREPARE/multi-statement SQL.
ALTER TABLE users ADD COLUMN IF NOT EXISTS firebase_uid VARCHAR(255) NULL;

ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified_at DATETIME NULL;

ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash VARCHAR(255) NULL;

ALTER TABLE users ADD COLUMN IF NOT EXISTS phone VARCHAR(20) NULL;

ALTER TABLE users ADD COLUMN IF NOT EXISTS street VARCHAR(255) NULL;

ALTER TABLE users ADD COLUMN IF NOT EXISTS number VARCHAR(20) NULL;

ALTER TABLE users ADD COLUMN IF NOT EXISTS complement VARCHAR(255) NULL;

ALTER TABLE users ADD COLUMN IF NOT EXISTS bairro VARCHAR(255) NULL;

ALTER TABLE users ADD COLUMN IF NOT EXISTS city VARCHAR(100) NULL;

ALTER TABLE users ADD COLUMN IF NOT EXISTS state VARCHAR(50) NULL;

ALTER TABLE users ADD COLUMN IF NOT EXISTS cep VARCHAR(20) NULL;

ALTER TABLE users ADD COLUMN IF NOT EXISTS cpf VARCHAR(20) NULL;

ALTER TABLE users ADD COLUMN IF NOT EXISTS token_version INT NOT NULL DEFAULT 1;

UPDATE users
SET token_version = 1
WHERE token_version IS NULL OR token_version < 1;

-- +migrate Down
-- This repair protects live authentication data. Rollback is intentionally a no-op.
SELECT 1;
