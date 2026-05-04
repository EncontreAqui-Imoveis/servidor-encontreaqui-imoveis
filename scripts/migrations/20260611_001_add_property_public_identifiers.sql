-- +migrate Up
ALTER TABLE properties
  ADD COLUMN public_id CHAR(36) NULL UNIQUE,
  ADD COLUMN public_code CHAR(6) NULL UNIQUE;

-- +migrate Down
ALTER TABLE properties
  DROP COLUMN public_code,
  DROP COLUMN public_id;
