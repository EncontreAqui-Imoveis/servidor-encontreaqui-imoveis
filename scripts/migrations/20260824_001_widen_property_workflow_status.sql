-- +migrate Up
-- Property workflow states are extensible. Legacy ENUM schemas truncated
-- approval writes such as 'negociacao' when that value was absent.
ALTER TABLE properties MODIFY COLUMN status VARCHAR(64) NOT NULL;

-- +migrate Down
-- Deliberately no-op: restoring an ENUM would reintroduce data-loss risk for
-- states created by newer workflow versions.
SELECT 1;
