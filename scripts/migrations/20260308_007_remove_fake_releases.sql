-- +migrate Up
-- Removendo os registros falsos injetados na migration 004 para garantir 100% de realismo via Webhook
DELETE FROM sre_releases WHERE version IN ('7a2c3d4', 'f4b1c2d');

-- +migrate Down
-- Não fazemos nada no down pois os fakes nunca devem voltar
