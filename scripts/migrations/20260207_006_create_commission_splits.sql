-- +migrate Up
CREATE TABLE IF NOT EXISTS commission_splits (
  id INT PRIMARY KEY AUTO_INCREMENT,
  close_submission_id INT NOT NULL,
  split_role ENUM('CAPTADOR', 'PLATFORM', 'SELLER_BROKER') NOT NULL,
  recipient_user_id INT NULL,
  percent_value DECIMAL(10,4) NULL,
  amount_value DECIMAL(14,2) NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_commission_split_submission FOREIGN KEY (close_submission_id) REFERENCES negotiation_close_submissions(id) ON DELETE CASCADE,
  CONSTRAINT fk_commission_split_user FOREIGN KEY (recipient_user_id) REFERENCES users(id) ON DELETE SET NULL,
  UNIQUE KEY uq_commission_split_role (close_submission_id, split_role)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- +migrate Down
DROP TABLE IF EXISTS commission_splits;
