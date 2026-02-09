-- +migrate Up
ALTER TABLE properties
  ADD COLUMN IF NOT EXISTS visibility ENUM('PUBLIC', 'HIDDEN') NOT NULL DEFAULT 'PUBLIC';

ALTER TABLE properties
  ADD COLUMN IF NOT EXISTS lifecycle_status ENUM('AVAILABLE', 'SOLD', 'RENTED') NOT NULL DEFAULT 'AVAILABLE';

-- +migrate Down
ALTER TABLE properties
  DROP COLUMN IF EXISTS visibility;

ALTER TABLE properties
  DROP COLUMN IF EXISTS lifecycle_status;
