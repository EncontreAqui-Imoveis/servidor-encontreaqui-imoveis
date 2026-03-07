-- +migrate Up
CREATE TABLE IF NOT EXISTS sre_releases (
    id INT PRIMARY KEY AUTO_INCREMENT,
    platform VARCHAR(50) NOT NULL,
    repo VARCHAR(255) NOT NULL,
    version VARCHAR(50) NOT NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'success',
    impact TEXT,
    applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Seed with some initial data if empty
INSERT INTO sre_releases (platform, repo, version, status, impact) 
SELECT 'github', 'backend', '1.4.9', 'success', 'Nenhum'
WHERE NOT EXISTS (SELECT 1 FROM sre_releases);

INSERT INTO sre_releases (platform, repo, version, status, impact)
SELECT 'github', 'backend', '1.4.8', 'stable', 'Nenhum'
WHERE NOT EXISTS (SELECT 1 FROM sre_releases WHERE version = '1.4.8');

-- +migrate Down
DROP TABLE IF EXISTS sre_releases;
