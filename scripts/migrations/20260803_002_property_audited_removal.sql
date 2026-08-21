-- +migrate Up
-- Native idempotent DDL is supported by TiDB without enabling multi-statement mode.
ALTER TABLE properties ADD COLUMN IF NOT EXISTS deleted_at DATETIME NULL;
ALTER TABLE properties ADD COLUMN IF NOT EXISTS deleted_by_user_id INT NULL;
ALTER TABLE properties ADD COLUMN IF NOT EXISTS deletion_reason TEXT NULL;
ALTER TABLE properties ADD COLUMN IF NOT EXISTS deletion_reason_omitted TINYINT(1) NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_properties_deleted_at ON properties (deleted_at);

-- +migrate Down
SELECT 1;
