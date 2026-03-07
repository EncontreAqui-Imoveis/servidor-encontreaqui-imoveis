-- +migrate Up
CREATE TABLE IF NOT EXISTS sre_external_services (
    id INT PRIMARY KEY AUTO_INCREMENT,
    name VARCHAR(255) NOT NULL UNIQUE,
    provider VARCHAR(255) NOT NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'operational',
    latency VARCHAR(50) DEFAULT NULL,
    cost DECIMAL(10, 2) NOT NULL DEFAULT 0.00,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

INSERT INTO sre_external_services (name, provider, status, latency, cost) VALUES
('Vercel', 'Deployment', 'operational', '45ms', 135.50),
('Railway', 'API Engine', 'operational', '82ms', 180.00),
('Cloudflare R2', 'Storage', 'operational', NULL, 45.00),
('Cloudinary', 'CDN', 'operational', NULL, 89.90),
('Brevo', 'Email/Marketing', 'operational', NULL, 50.00),
('Firebase', 'Auth/Push', 'operational', NULL, 0.00)
ON DUPLICATE KEY UPDATE name=name;

-- +migrate Down
DROP TABLE IF EXISTS sre_external_services;
