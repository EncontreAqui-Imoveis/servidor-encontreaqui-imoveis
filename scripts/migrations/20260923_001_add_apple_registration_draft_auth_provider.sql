-- +migrate Up
-- Expand the provider enum without changing existing draft data.
ALTER TABLE registration_drafts
  MODIFY COLUMN auth_provider ENUM('email', 'google', 'apple', 'firebase') NOT NULL DEFAULT 'email';

-- +migrate Down
-- Intentionally non-destructive: removing 'apple' would invalidate Apple drafts
-- created by newer application versions.
SELECT 1;
