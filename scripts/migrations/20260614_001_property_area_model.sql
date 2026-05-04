-- +migrate Up
ALTER TABLE properties
  ADD COLUMN area_construida_valor DECIMAL(18, 4) NULL,
  ADD COLUMN area_construida_m2 DECIMAL(18, 2) NULL,
  ADD COLUMN area_construida_unidade VARCHAR(20) NOT NULL DEFAULT 'm2',
  ADD COLUMN area_terreno_valor DECIMAL(18, 4) NULL,
  ADD COLUMN area_terreno_unidade VARCHAR(20) NOT NULL DEFAULT 'm2',
  ADD COLUMN area_terreno_m2 DECIMAL(18, 2) NULL;

UPDATE properties
SET
  area_construida_valor = CASE
    WHEN area_construida_valor IS NULL AND area_construida IS NOT NULL THEN area_construida
    ELSE area_construida_valor
  END,
  area_construida_m2 = CASE
    WHEN area_construida_m2 IS NULL AND area_construida IS NOT NULL THEN area_construida
    ELSE area_construida_m2
  END,
  area_terreno_valor = CASE
    WHEN area_terreno_valor IS NULL AND area_terreno IS NOT NULL THEN area_terreno
    ELSE area_terreno_valor
  END,
  area_terreno_m2 = CASE
    WHEN area_terreno_m2 IS NULL AND area_terreno IS NOT NULL THEN area_terreno
    ELSE area_terreno_m2
  END
WHERE
  area_construida_valor IS NULL OR area_construida_m2 IS NULL OR area_terreno_valor IS NULL OR area_terreno_m2 IS NULL;

-- +migrate Down
ALTER TABLE properties
  DROP COLUMN area_terreno_m2,
  DROP COLUMN area_terreno_unidade,
  DROP COLUMN area_terreno_valor,
  DROP COLUMN area_construida_unidade,
  DROP COLUMN area_construida_m2,
  DROP COLUMN area_construida_valor;
