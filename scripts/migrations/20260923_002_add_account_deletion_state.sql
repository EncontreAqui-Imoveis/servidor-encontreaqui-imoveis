-- +migrate Up
-- These nullable timestamps leave all existing accounts and privacy requests unchanged.
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS deletion_requested_at DATETIME NULL,
  ADD COLUMN IF NOT EXISTS deletion_completed_at DATETIME NULL;

-- Processing metadata is intentionally unset for existing requests. Attempts start at zero.
ALTER TABLE privacy_requests
  ADD COLUMN IF NOT EXISTS scheduled_for DATETIME NULL,
  ADD COLUMN IF NOT EXISTS access_revoked_at DATETIME NULL,
  ADD COLUMN IF NOT EXISTS processing_started_at DATETIME NULL,
  ADD COLUMN IF NOT EXISTS attempt_count INT UNSIGNED NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_error_code VARCHAR(120) NULL;

-- +migrate Down
-- Intentionally non-destructive: dropping these columns could discard deletion
-- processing history written by a newer application version.
SELECT 1;
