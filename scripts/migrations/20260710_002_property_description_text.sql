-- +migrate Up
-- Existing installations may predate the TEXT definition in src/database/init.ts.
ALTER TABLE properties MODIFY COLUMN description TEXT NOT NULL;

-- +migrate Down
-- TEXT data cannot be safely narrowed without a potentially destructive truncation.
SELECT 1;
