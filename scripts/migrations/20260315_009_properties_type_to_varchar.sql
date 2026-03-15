-- +migrate Up
ALTER TABLE properties MODIFY COLUMN type VARCHAR(100) NOT NULL;

-- +migrate Down
-- no-op: previous enum variants are not preserved safely
