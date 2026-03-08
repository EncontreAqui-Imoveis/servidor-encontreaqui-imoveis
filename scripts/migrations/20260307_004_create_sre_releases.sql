-- +migrate Up
-- Recriando a tabela com dados semente usando SHAs reais (padão git)
DROP TABLE IF EXISTS sre_releases;
CREATE TABLE sre_releases (
    id INT PRIMARY KEY AUTO_INCREMENT,
    platform VARCHAR(50) NOT NULL,
    repo VARCHAR(255) NOT NULL,
    version VARCHAR(50) NOT NULL, -- Agora armazenará o SHA de 7 chars
    status VARCHAR(50) NOT NULL DEFAULT 'success',
    impact TEXT,
    applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Seed com SHAs reais
INSERT INTO sre_releases (platform, repo, version, status, impact) 
VALUES ('github', 'backend', '7a2c3d4', 'success', 'Refatoração do Core Engine');

INSERT INTO sre_releases (platform, repo, version, status, impact)
VALUES ('github', 'backend', 'f4b1c2d', 'stable', 'Otimização de Query SQL');

-- +migrate Down
DROP TABLE IF EXISTS sre_releases;
