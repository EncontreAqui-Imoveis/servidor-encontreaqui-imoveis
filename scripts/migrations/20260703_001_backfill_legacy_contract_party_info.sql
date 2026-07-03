-- +migrate Up
UPDATE contracts c
JOIN negotiations n ON n.id = c.negotiation_id
JOIN properties p ON p.id = c.property_id
LEFT JOIN users owner_user ON owner_user.id = p.owner_id
SET
  c.seller_info = CASE
    WHEN (
      c.seller_info IS NULL
      OR JSON_TYPE(c.seller_info) = 'NULL'
      OR JSON_LENGTH(c.seller_info) = 0
    )
      AND (
        NULLIF(p.owner_name, '') IS NOT NULL
        OR NULLIF(owner_user.name, '') IS NOT NULL
        OR NULLIF(p.owner_phone, '') IS NOT NULL
      )
    THEN CAST(
      JSON_OBJECT(
        'nome', COALESCE(NULLIF(p.owner_name, ''), NULLIF(owner_user.name, '')),
        'telefone', NULLIF(p.owner_phone, '')
      ) AS JSON
    )
    ELSE c.seller_info
  END,
  c.buyer_info = CASE
    WHEN (
      c.buyer_info IS NULL
      OR JSON_TYPE(c.buyer_info) = 'NULL'
      OR JSON_LENGTH(c.buyer_info) = 0
    )
      AND (
        NULLIF(n.client_name, '') IS NOT NULL
        OR NULLIF(n.client_cpf, '') IS NOT NULL
      )
    THEN CAST(
      JSON_OBJECT(
        'clientName', NULLIF(n.client_name, ''),
        'clientCpf', NULLIF(n.client_cpf, '')
      ) AS JSON
    )
    ELSE c.buyer_info
  END
WHERE
  (
    (c.seller_info IS NULL OR JSON_TYPE(c.seller_info) = 'NULL' OR JSON_LENGTH(c.seller_info) = 0)
    AND (
      NULLIF(p.owner_name, '') IS NOT NULL
      OR NULLIF(owner_user.name, '') IS NOT NULL
      OR NULLIF(p.owner_phone, '') IS NOT NULL
    )
  )
  OR (
    (c.buyer_info IS NULL OR JSON_TYPE(c.buyer_info) = 'NULL' OR JSON_LENGTH(c.buyer_info) = 0)
    AND (
      NULLIF(n.client_name, '') IS NOT NULL
      OR NULLIF(n.client_cpf, '') IS NOT NULL
    )
  );

UPDATE negotiations n
JOIN properties p ON p.id = n.property_id
SET
  n.capturing_broker_id = CASE
    WHEN n.capturing_broker_id IS NULL THEN p.broker_id
    ELSE n.capturing_broker_id
  END,
  n.selling_broker_id = CASE
    WHEN n.selling_broker_id IS NULL THEN COALESCE(n.capturing_broker_id, p.broker_id)
    ELSE n.selling_broker_id
  END
WHERE p.broker_id IS NOT NULL
  AND (n.capturing_broker_id IS NULL OR n.selling_broker_id IS NULL);

-- +migrate Down
-- Backfill de legado é irreversível por desenho.
