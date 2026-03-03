-- +migrate Up
ALTER TABLE properties
  ADD COLUMN IF NOT EXISTS promotion_price DECIMAL(12, 2) NULL,
  ADD COLUMN IF NOT EXISTS promotional_rent_price DECIMAL(12, 2) NULL;

-- +migrate Down
ALTER TABLE properties
  DROP COLUMN IF EXISTS promotional_rent_price,
  DROP COLUMN IF EXISTS promotion_price;
