-- +migrate Up
-- Older databases used narrow ENUMs for workflow values. New contract stages
-- (for example CONTRACT_DRAFTING) must not be rejected by TiDB as truncated
-- enum data during administrative approval or rejection.
ALTER TABLE negotiations
  MODIFY COLUMN status VARCHAR(64) NOT NULL;

ALTER TABLE negotiation_history
  MODIFY COLUMN from_status VARCHAR(64) NOT NULL,
  MODIFY COLUMN to_status VARCHAR(64) NOT NULL;

-- +migrate Down
-- Intentionally non-destructive: restoring an ENUM would discard valid
-- workflow values that were introduced after the legacy schema.
SELECT 1;
