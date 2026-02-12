CREATE TABLE IF NOT EXISTS negotiation_documents (
  id INT NOT NULL AUTO_INCREMENT,
  negotiation_id CHAR(36) NOT NULL,
  type ENUM('proposal', 'contract', 'other') NOT NULL,
  file_content MEDIUMBLOB NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_negotiation_documents_negotiation (negotiation_id),
  KEY idx_negotiation_documents_type_created (type, created_at),
  CONSTRAINT fk_negotiation_documents_negotiation
    FOREIGN KEY (negotiation_id) REFERENCES negotiations(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
