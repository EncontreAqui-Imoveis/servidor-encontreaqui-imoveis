-- +migrate Up
CREATE TABLE IF NOT EXISTS contract_document_rejections (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  contract_id CHAR(36) COLLATE utf8mb4_0900_ai_ci NOT NULL,
  negotiation_id CHAR(36) COLLATE utf8mb4_0900_ai_ci NOT NULL,
  source_document_id BIGINT UNSIGNED NULL,
  document_type VARCHAR(128) NULL,
  document_label VARCHAR(255) NULL,
  original_file_name VARCHAR(512) NULL,
  owner_side ENUM('seller', 'buyer') NULL,
  reason TEXT NOT NULL,
  uploaded_by_user_id INT NULL,
  rejected_by_admin_id INT NULL,
  rejected_at DATETIME NOT NULL,
  legacy_audit_key VARCHAR(191) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_contract_document_rejections_legacy_audit (legacy_audit_key),
  KEY idx_contract_document_rejections_contract_date (contract_id, rejected_at),
  KEY idx_contract_document_rejections_negotiation_date (negotiation_id, rejected_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

SET @admins_table_exists := (
  SELECT COUNT(*)
  FROM information_schema.tables
  WHERE table_schema = DATABASE() AND table_name = 'admins'
);
SET @admins_role_exists := (
  SELECT COUNT(*)
  FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'admins' AND column_name = 'role'
);
SET @admins_add_role_sql := IF(
  @admins_table_exists = 1 AND @admins_role_exists = 0,
  "ALTER TABLE admins ADD COLUMN role VARCHAR(50) NOT NULL DEFAULT 'admin' AFTER password_hash",
  'SELECT 1'
);
PREPARE stmt FROM @admins_add_role_sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @admins_normalize_role_sql := IF(
  @admins_table_exists = 1,
  "UPDATE admins SET role = 'admin' WHERE role IS NULL OR LOWER(TRIM(role)) NOT IN ('admin', 'document_operator')",
  'SELECT 1'
);
PREPARE stmt FROM @admins_normalize_role_sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- +migrate Down
DROP TABLE IF EXISTS contract_document_rejections;
