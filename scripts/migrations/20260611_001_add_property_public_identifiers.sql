-- +migrate Up
ALTER TABLE properties
  ADD COLUMN IF NOT EXISTS public_id CHAR(36) NULL,
  ADD COLUMN IF NOT EXISTS public_code CHAR(6) NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_properties_public_id ON properties(public_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_properties_public_code ON properties(public_code);

-- +migrate Down
ALTER TABLE properties
  DROP INDEX IF EXISTS idx_properties_public_id,
  DROP INDEX IF EXISTS idx_properties_public_code,
  DROP COLUMN public_code,
  DROP COLUMN public_id;
