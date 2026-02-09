-- +migrate Up
CREATE TABLE IF NOT EXISTS negotiation_documents (
  id INT PRIMARY KEY AUTO_INCREMENT,
  negotiation_id INT NOT NULL,
  doc_name VARCHAR(255) NOT NULL,
  doc_url TEXT NOT NULL,
  status ENUM('PENDING_REVIEW', 'APPROVED', 'APPROVED_WITH_REMARKS', 'REJECTED') NOT NULL DEFAULT 'PENDING_REVIEW',
  review_comment TEXT NULL,
  uploaded_by_user_id INT NOT NULL,
  reviewed_by_user_id INT NULL,
  reviewed_at DATETIME NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_neg_docs_negotiation FOREIGN KEY (negotiation_id) REFERENCES negotiations(id) ON DELETE CASCADE,
  CONSTRAINT fk_neg_docs_uploaded_by FOREIGN KEY (uploaded_by_user_id) REFERENCES users(id) ON DELETE RESTRICT,
  CONSTRAINT fk_neg_docs_reviewed_by FOREIGN KEY (reviewed_by_user_id) REFERENCES admins(id) ON DELETE SET NULL
);

-- +migrate Down
DROP TABLE IF EXISTS negotiation_documents;
