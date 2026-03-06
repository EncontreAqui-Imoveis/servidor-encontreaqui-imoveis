-- +migrate Up
CREATE TABLE IF NOT EXISTS email_verification_requests (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NULL,
  email VARCHAR(255) NOT NULL,
  attempt_number INT NOT NULL,
  cooldown_seconds INT NOT NULL,
  expires_at DATETIME NOT NULL,
  sent_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  status ENUM('sent', 'verified', 'expired') NOT NULL DEFAULT 'sent',
  INDEX idx_email_verification_email_sent_at (email, sent_at),
  INDEX idx_email_verification_user_sent_at (user_id, sent_at)
);

CREATE TABLE IF NOT EXISTS negotiation_proposal_idempotency (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  idempotency_key VARCHAR(128) NOT NULL,
  negotiation_id CHAR(36) NULL,
  document_id BIGINT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_negotiation_proposal_idempotency_user_key (user_id, idempotency_key),
  INDEX idx_negotiation_proposal_idempotency_negotiation (negotiation_id)
);

-- +migrate Down
DROP TABLE IF EXISTS negotiation_proposal_idempotency;
DROP TABLE IF EXISTS email_verification_requests;
