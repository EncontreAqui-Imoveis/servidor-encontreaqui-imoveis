-- +migrate Up
CREATE TABLE IF NOT EXISTS negotiation_signatures (
  id INT PRIMARY KEY AUTO_INCREMENT,
  negotiation_id INT NOT NULL,
  signed_by_role ENUM('CAPTADOR', 'SELLER_BROKER', 'CLIENT') NOT NULL,
  signed_file_url TEXT NOT NULL,
  signed_proof_image_url TEXT NULL,
  signed_by_user_id INT NULL,
  validation_status ENUM('PENDING', 'APPROVED', 'REJECTED') NOT NULL DEFAULT 'PENDING',
  validation_comment TEXT NULL,
  validated_by_admin_id INT NULL,
  validated_at DATETIME NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_neg_sig_negotiation FOREIGN KEY (negotiation_id) REFERENCES negotiations(id) ON DELETE CASCADE,
  CONSTRAINT fk_neg_sig_user FOREIGN KEY (signed_by_user_id) REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT fk_neg_sig_admin FOREIGN KEY (validated_by_admin_id) REFERENCES admins(id) ON DELETE SET NULL
);

-- +migrate Down
DROP TABLE IF EXISTS negotiation_signatures;
