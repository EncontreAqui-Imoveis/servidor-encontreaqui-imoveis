-- +migrate Up
ALTER TABLE negotiations
  DROP CHECK chk_negotiations_selling_broker_required,
  ADD CONSTRAINT chk_negotiations_selling_broker_required
  CHECK (
    selling_broker_id IS NOT NULL
    OR UPPER(TRIM(status)) IN ('REFUSED', 'CANCELLED')
  );

-- +migrate Down
ALTER TABLE negotiations
  DROP CHECK chk_negotiations_selling_broker_required,
  ADD CONSTRAINT chk_negotiations_selling_broker_required
  CHECK (selling_broker_id IS NOT NULL);
