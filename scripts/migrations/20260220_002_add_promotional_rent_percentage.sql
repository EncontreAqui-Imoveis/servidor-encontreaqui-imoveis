-- +migrate Up
ALTER TABLE properties
  ADD COLUMN IF NOT EXISTS promotional_rent_percentage DECIMAL(5, 2) NULL;

-- +migrate Down
ALTER TABLE properties
  DROP COLUMN IF EXISTS promotional_rent_percentage;
