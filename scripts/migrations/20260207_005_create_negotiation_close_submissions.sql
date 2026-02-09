-- +migrate Up
CREATE TABLE IF NOT EXISTS negotiation_close_submissions (
  id INT PRIMARY KEY AUTO_INCREMENT,
  negotiation_id INT NOT NULL,
  close_type ENUM('SOLD', 'RENTED') NOT NULL,
  commission_mode ENUM('PERCENT', 'AMOUNT') NOT NULL,
  commission_total_percent DECIMAL(10,4) NULL,
  commission_total_amount DECIMAL(14,2) NULL,
  payment_proof_url TEXT NOT NULL,
  submitted_by_user_id INT NOT NULL,
  approved_by_admin_id INT NULL,
  approved_at DATETIME NULL,
  no_commission_reason TEXT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_neg_close_negotiation FOREIGN KEY (negotiation_id) REFERENCES negotiations(id) ON DELETE CASCADE,
  CONSTRAINT fk_neg_close_submitted_by FOREIGN KEY (submitted_by_user_id) REFERENCES users(id) ON DELETE RESTRICT,
  CONSTRAINT fk_neg_close_approved_by FOREIGN KEY (approved_by_admin_id) REFERENCES admins(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- +migrate Down
DROP TABLE IF EXISTS negotiation_close_submissions;
