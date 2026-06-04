-- +migrate Up
UPDATE negotiations n
JOIN properties p ON p.id = n.property_id
SET n.selling_broker_id = p.broker_id
WHERE n.selling_broker_id IS NULL
  AND n.buyer_client_id IS NULL
  AND p.broker_id IS NOT NULL
  AND COALESCE(UPPER(TRIM(n.status)), '') NOT IN ('REFUSED', 'CANCELLED');

UPDATE negotiations
SET status = 'CANCELLED'
WHERE selling_broker_id IS NULL
  AND buyer_client_id IS NULL
  AND COALESCE(UPPER(TRIM(status)), '') NOT IN ('REFUSED', 'CANCELLED');

-- CHECK removido temporariamente para impedir falha de boot enquanto o fluxo
-- de seller client ainda não está formalmente modelado.

-- +migrate Down
-- no-op
