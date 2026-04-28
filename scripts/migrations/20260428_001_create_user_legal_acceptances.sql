-- +migrate Up
CREATE TABLE IF NOT EXISTS user_legal_acceptances (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id INT NOT NULL,
  type ENUM('terms', 'privacy', 'broker_agreement') NOT NULL,
  version VARCHAR(64) NOT NULL,
  accepted_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ip VARCHAR(45) NULL,
  user_agent VARCHAR(255) NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_user_legal_acceptances_user_type_version (user_id, type, version),
  INDEX idx_user_legal_acceptances_user_id (user_id),
  INDEX idx_user_legal_acceptances_type (type),
  INDEX idx_user_legal_acceptances_accepted_at (accepted_at),
  CONSTRAINT fk_user_legal_acceptances_user
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- +migrate Down
DROP TABLE IF EXISTS user_legal_acceptances;
