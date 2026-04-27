-- +migrate Up
UPDATE registration_drafts
  SET draft_id = SUBSTRING(draft_id, 7)
  WHERE draft_id LIKE 'draft-%'
    AND CHAR_LENGTH(draft_id) = 42;

ALTER TABLE registration_drafts
  MODIFY draft_id CHAR(36) NOT NULL;

ALTER TABLE registration_drafts
  MODIFY draft_token_hash CHAR(64) NOT NULL;

-- +migrate Down
ALTER TABLE registration_drafts
  MODIFY draft_id CHAR(42) NOT NULL;

ALTER TABLE registration_drafts
  MODIFY draft_token_hash CHAR(64) NOT NULL;
