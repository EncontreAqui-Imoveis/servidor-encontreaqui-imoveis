-- +migrate Up
CREATE TABLE IF NOT EXISTS registration_drafts (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  draft_id CHAR(36) NOT NULL,
  draft_token_hash CHAR(64) NOT NULL,
  status ENUM('OPEN', 'COMPLETED', 'DISCARDED', 'EXPIRED') NOT NULL DEFAULT 'OPEN',
  profile_type ENUM('client', 'broker') NOT NULL DEFAULT 'client',
  email VARCHAR(255) NOT NULL,
  email_normalized VARCHAR(255) GENERATED ALWAYS AS (LOWER(TRIM(email))) STORED,
  name VARCHAR(255) NULL,
  phone VARCHAR(25) NULL,
  street VARCHAR(255) NULL,
  number VARCHAR(50) NULL,
  complement VARCHAR(255) NULL,
  bairro VARCHAR(255) NULL,
  city VARCHAR(100) NULL,
  state VARCHAR(2) NULL,
  cep VARCHAR(20) NULL,
  without_number TINYINT(1) NOT NULL DEFAULT 0,
  creci VARCHAR(50) NULL,
  auth_provider ENUM('email', 'google', 'firebase') NOT NULL DEFAULT 'email',
  google_uid VARCHAR(128) NULL,
  firebase_uid VARCHAR(128) NULL,
  provider_aud VARCHAR(255) NULL,
  provider_metadata JSON NULL,
  email_verified_at DATETIME NULL,
  phone_verified_at DATETIME NULL,
  password_hash VARCHAR(255) NULL,
  password_hash_expires_at DATETIME NULL,
  current_step ENUM(
    'IDENTITY',
    'CONTACT',
    'ADDRESS',
    'VERIFICATION',
    'FINALIZE_CHOICE',
    'FINALIZE_READY',
    'DONE'
  ) NOT NULL DEFAULT 'IDENTITY',
  revision INT NOT NULL DEFAULT 1,
  expires_at DATETIME NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  completed_at DATETIME NULL,
  discarded_at DATETIME NULL,
  user_id INT NULL,
  active_email VARCHAR(255) AS (
    CASE WHEN status = 'OPEN' THEN email_normalized ELSE NULL END
  ) STORED,
  active_broker_creci VARCHAR(50) AS (
    CASE WHEN status = 'OPEN' AND profile_type = 'broker' THEN creci ELSE NULL END
  ) STORED,
  PRIMARY KEY (id),
  UNIQUE KEY uq_registration_drafts_draft_id (draft_id),
  UNIQUE KEY uq_registration_drafts_draft_token_hash (draft_token_hash),
  UNIQUE KEY uq_registration_drafts_open_email (active_email),
  UNIQUE KEY uq_registration_drafts_open_broker_creci (active_broker_creci),
  INDEX idx_registration_drafts_status (status),
  INDEX idx_registration_drafts_profile (profile_type),
  INDEX idx_registration_drafts_expires_at (expires_at),
  INDEX idx_registration_drafts_user_id (user_id),
  INDEX idx_registration_drafts_google_uid (google_uid),
  INDEX idx_registration_drafts_firebase_uid (firebase_uid),
  CONSTRAINT fk_registration_drafts_user_id
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS registration_phone_otps (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  draft_id BIGINT UNSIGNED NOT NULL,
  phone VARCHAR(25) NOT NULL,
  session_token CHAR(36) NOT NULL,
  code_hash CHAR(64) NOT NULL,
  attempts SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  max_attempts SMALLINT UNSIGNED NOT NULL DEFAULT 5,
  cooldown_seconds SMALLINT UNSIGNED NOT NULL DEFAULT 60,
  sent_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  expires_at DATETIME NOT NULL,
  consumed_at DATETIME NULL,
  invalidated TINYINT(1) NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  INDEX idx_registration_phone_otps_draft (draft_id, invalidated, consumed_at),
  INDEX idx_registration_phone_otps_phone (phone, sent_at),
  UNIQUE KEY uq_registration_phone_otps_session (session_token),
  CONSTRAINT fk_registration_phone_otps_draft
    FOREIGN KEY (draft_id) REFERENCES registration_drafts(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS registration_draft_documents (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  draft_id BIGINT UNSIGNED NOT NULL,
  creci_front_url VARCHAR(1024) NOT NULL,
  creci_back_url VARCHAR(1024) NOT NULL,
  selfie_url VARCHAR(1024) NOT NULL,
  status ENUM('UPLOADED', 'PENDING', 'INVALID') NOT NULL DEFAULT 'UPLOADED',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_registration_draft_documents_draft (draft_id),
  CONSTRAINT fk_registration_draft_documents_draft
    FOREIGN KEY (draft_id) REFERENCES registration_drafts(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

ALTER TABLE email_code_challenges
  ADD COLUMN IF NOT EXISTS draft_id BIGINT UNSIGNED NULL,
  ADD COLUMN IF NOT EXISTS draft_token_hash CHAR(64) NULL,
  ADD COLUMN IF NOT EXISTS draft_step INT NULL;

ALTER TABLE email_code_challenges
  ADD INDEX IF NOT EXISTS idx_email_code_challenges_draft (draft_id, purpose, status, sent_at);

ALTER TABLE email_code_challenges
  ADD CONSTRAINT fk_email_code_challenges_draft
    FOREIGN KEY (draft_id) REFERENCES registration_drafts(id) ON DELETE CASCADE;

-- +migrate Down
ALTER TABLE email_code_challenges
  DROP FOREIGN KEY fk_email_code_challenges_draft;
ALTER TABLE email_code_challenges
  DROP INDEX idx_email_code_challenges_draft,
  DROP COLUMN IF EXISTS draft_step,
  DROP COLUMN IF EXISTS draft_token_hash,
  DROP COLUMN IF EXISTS draft_id;

DROP TABLE IF EXISTS registration_draft_documents;
DROP TABLE IF EXISTS registration_phone_otps;
DROP TABLE IF EXISTS registration_drafts;
