-- ATENCAO: este script APAGA TODOS OS DADOS.
-- Use apenas apos backup.

SET FOREIGN_KEY_CHECKS = 0;

TRUNCATE TABLE favoritos;
TRUNCATE TABLE user_device_tokens;
TRUNCATE TABLE password_reset_tokens;
TRUNCATE TABLE support_requests;
TRUNCATE TABLE notifications;
TRUNCATE TABLE broker_documents;
TRUNCATE TABLE sales;
TRUNCATE TABLE featured_properties;
TRUNCATE TABLE property_images;
TRUNCATE TABLE properties;
TRUNCATE TABLE brokers;
TRUNCATE TABLE users;
TRUNCATE TABLE agencies;
TRUNCATE TABLE admins;

SET FOREIGN_KEY_CHECKS = 1;

-- Seed admin
INSERT INTO admins (name, email, password_hash, role)
VALUES (
  'Admin EncontreAqui',
  'encontreaquiimoveisapp@gmail.com',
  '$2a$08$1WyqcC1u2Uf.ibhVo2D.6.FfAZ9JHmvOSHsQbYbt1jOGtRO3n/dXC',
  'admin'
);
