-- +migrate Up
ALTER TABLE sre_external_services ADD COLUMN probe_url VARCHAR(255);

-- Atualizando serviços com URLs de status/ping reais (ou simuladas para Cloudinary se não houver uma pública fácil)
UPDATE sre_external_services SET probe_url = 'https://www.google.com' WHERE name = 'Vercel';
UPDATE sre_external_services SET probe_url = 'https://railway.com' WHERE name = 'Railway';
UPDATE sre_external_services SET probe_url = 'https://cloudinary.com' WHERE name = 'Cloudinary';
UPDATE sre_external_services SET probe_url = 'https://www.google.com' WHERE name = 'Cloudflare R2';
UPDATE sre_external_services SET probe_url = 'https://www.brevo.com' WHERE name = 'Brevo';
UPDATE sre_external_services SET probe_url = 'https://firebase.google.com' WHERE name = 'Firebase';

-- +migrate Down
ALTER TABLE sre_external_services DROP COLUMN probe_url;
