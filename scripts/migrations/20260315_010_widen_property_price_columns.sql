-- +migrate Up
ALTER TABLE properties MODIFY COLUMN price DECIMAL(12, 2) NOT NULL;
ALTER TABLE properties MODIFY COLUMN price_sale DECIMAL(12, 2) NULL;
ALTER TABLE properties MODIFY COLUMN price_rent DECIMAL(12, 2) NULL;
ALTER TABLE properties MODIFY COLUMN promotion_price DECIMAL(12, 2) NULL;
ALTER TABLE properties MODIFY COLUMN promotional_rent_price DECIMAL(12, 2) NULL;

-- +migrate Down
-- no-op: previous decimal precision is not restored safely
