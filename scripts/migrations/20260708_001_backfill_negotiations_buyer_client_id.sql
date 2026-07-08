-- +migrate Up
UPDATE negotiations
SET client_cpf = COALESCE(
  NULLIF(client_cpf, ''),
  JSON_UNQUOTE(JSON_EXTRACT(payment_details, '$.details.clientCpf')),
  JSON_UNQUOTE(JSON_EXTRACT(payment_details, '$.details.client_cpf')),
  JSON_UNQUOTE(JSON_EXTRACT(payment_details, '$.clientCpf')),
  JSON_UNQUOTE(JSON_EXTRACT(payment_details, '$.client_cpf'))
)
WHERE (client_cpf IS NULL OR client_cpf = '')
  AND payment_details IS NOT NULL;

UPDATE negotiations
SET buyer_client_id = COALESCE(
  buyer_client_id,
  CASE
    WHEN JSON_UNQUOTE(JSON_EXTRACT(payment_details, '$.details.buyerUserId')) REGEXP '^[0-9]+$'
    THEN CAST(JSON_UNQUOTE(JSON_EXTRACT(payment_details, '$.details.buyerUserId')) AS UNSIGNED)
    ELSE NULL
  END,
  CASE
    WHEN JSON_UNQUOTE(JSON_EXTRACT(payment_details, '$.buyerUserId')) REGEXP '^[0-9]+$'
    THEN CAST(JSON_UNQUOTE(JSON_EXTRACT(payment_details, '$.buyerUserId')) AS UNSIGNED)
    ELSE NULL
  END
)
WHERE buyer_client_id IS NULL
  AND payment_details IS NOT NULL
  AND (
    NULLIF(JSON_UNQUOTE(JSON_EXTRACT(payment_details, '$.details.buyerUserId')), '') IS NOT NULL
    OR NULLIF(JSON_UNQUOTE(JSON_EXTRACT(payment_details, '$.buyerUserId')), '') IS NOT NULL
  );

UPDATE negotiations n
JOIN users u ON REPLACE(REPLACE(REPLACE(REPLACE(COALESCE(u.cpf, ''), '.', ''), '-', ''), '/', ''), ' ', '') =
  REPLACE(REPLACE(REPLACE(REPLACE(COALESCE(n.client_cpf, ''), '.', ''), '-', ''), '/', ''), ' ', '')
SET n.buyer_client_id = u.id
WHERE n.buyer_client_id IS NULL
  AND NULLIF(n.client_cpf, '') IS NOT NULL;

-- +migrate Down
-- Backfill de legado é irreversível por desenho.
