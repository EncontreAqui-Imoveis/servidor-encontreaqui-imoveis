-- +migrate Up
ALTER TABLE negotiations
  ADD COLUMN last_draft_edit_at DATETIME(3) NULL;

-- +migrate Down
ALTER TABLE negotiations DROP COLUMN last_draft_edit_at;
