-- +migrate Up
-- Bilateral acknowledgement of the physical-contract draft. This is not an
-- electronic signature: every decision is tied to one immutable revision.
SET @contract_status_type := (
  SELECT column_type
  FROM information_schema.columns
  WHERE table_schema = DATABASE()
    AND table_name = 'contracts'
    AND column_name = 'status'
  LIMIT 1
);
SET @ensure_contract_review_status_sql := IF(
  @contract_status_type IS NULL OR LOCATE('AWAITING_MINUTE_REVIEW', UPPER(@contract_status_type)) > 0,
  'SELECT 1',
  'ALTER TABLE contracts MODIFY COLUMN status ENUM(''AWAITING_DOCS'', ''IN_DRAFT'', ''AWAITING_MINUTE_REVIEW'', ''AWAITING_SIGNATURES'', ''FINALIZED'', ''CANCELLED'') NOT NULL DEFAULT ''AWAITING_DOCS'''
);
PREPARE stmt FROM @ensure_contract_review_status_sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

CREATE TABLE IF NOT EXISTS contract_draft_revisions (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  contract_id CHAR(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  negotiation_id CHAR(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  document_id BIGINT UNSIGNED NOT NULL,
  revision_number INT UNSIGNED NOT NULL,
  original_file_name VARCHAR(512) NULL,
  created_by_admin_id INT NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  replaced_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_contract_draft_revision_number (contract_id, revision_number),
  KEY idx_contract_draft_revision_active (contract_id, is_active, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS contract_draft_reviews (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  revision_id BIGINT UNSIGNED NOT NULL,
  contract_id CHAR(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  reviewer_user_id INT NOT NULL,
  reviewer_side ENUM('seller', 'buyer') NOT NULL,
  decision ENUM('CONSENTED', 'CHANGES_REQUESTED') NOT NULL,
  reason TEXT NULL,
  decided_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_contract_draft_review_side (revision_id, reviewer_side),
  KEY idx_contract_draft_review_contract (contract_id, revision_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- +migrate Down
-- Deliberately preserve acknowledgement records in a rollback. Removing them
-- would erase operational evidence of who reviewed a physical contract draft.
SELECT 1;
