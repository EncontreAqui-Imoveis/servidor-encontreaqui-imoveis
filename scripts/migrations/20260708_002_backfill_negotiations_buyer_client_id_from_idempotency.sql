-- +migrate Up
UPDATE negotiations n
JOIN (
  SELECT npi.negotiation_id, MIN(npi.user_id) AS buyer_client_id
  FROM negotiation_proposal_idempotency npi
  WHERE npi.user_id IS NOT NULL
    AND npi.user_id > 0
  GROUP BY npi.negotiation_id
) proposal_users ON proposal_users.negotiation_id = n.id
SET n.buyer_client_id = proposal_users.buyer_client_id
WHERE n.buyer_client_id IS NULL
  AND proposal_users.buyer_client_id IS NOT NULL
  AND proposal_users.buyer_client_id > 0;

-- +migrate Down
-- Backfill de legado é irreversível por desenho.
