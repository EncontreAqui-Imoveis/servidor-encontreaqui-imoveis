-- +migrate Up
-- Unidade da área construída (o valor em area_construida permanece em m² após conversão na API).
-- sem_quadra / sem_lote: quando 1, quadra/lote são opcionais (cadastro explícito "sem quadra/lote").

ALTER TABLE properties
  ADD COLUMN area_construida_unidade VARCHAR(20) NOT NULL DEFAULT 'm2',
  ADD COLUMN sem_quadra TINYINT(1) NOT NULL DEFAULT 0,
  ADD COLUMN sem_lote TINYINT(1) NOT NULL DEFAULT 0;

-- +migrate Down
ALTER TABLE properties DROP COLUMN sem_lote;
ALTER TABLE properties DROP COLUMN sem_quadra;
ALTER TABLE properties DROP COLUMN area_construida_unidade;
