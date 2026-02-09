-- +migrate Up
CREATE TABLE IF NOT EXISTS negotiations (
  id INT PRIMARY KEY AUTO_INCREMENT,
  property_id INT NOT NULL,
  captador_user_id INT NOT NULL,
  seller_broker_user_id INT NOT NULL,
  status ENUM(
    'DRAFT',
    'PENDING_ACTIVATION',
    'DOCS_IN_REVIEW',
    'CONTRACT_AVAILABLE',
    'SIGNED_PENDING_VALIDATION',
    'CLOSE_SUBMITTED',
    'SOLD_COMMISSIONED',
    'RENTED_COMMISSIONED',
    'SOLD_NO_COMMISSION',
    'RENTED_NO_COMMISSION',
    'CANCELLED',
    'EXPIRED',
    'ARCHIVED'
  ) NOT NULL DEFAULT 'DRAFT',
  active TINYINT(1) NOT NULL DEFAULT 0,
  started_at DATETIME NULL,
  expires_at DATETIME NULL,
  last_activity_at DATETIME NULL,
  created_by_user_id INT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_negotiations_property FOREIGN KEY (property_id) REFERENCES properties(id) ON DELETE CASCADE,
  CONSTRAINT fk_negotiations_captador FOREIGN KEY (captador_user_id) REFERENCES users(id) ON DELETE RESTRICT,
  CONSTRAINT fk_negotiations_seller FOREIGN KEY (seller_broker_user_id) REFERENCES users(id) ON DELETE RESTRICT,
  CONSTRAINT fk_negotiations_created_by FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE RESTRICT
);

-- +migrate Down
DROP TABLE IF EXISTS negotiations;
