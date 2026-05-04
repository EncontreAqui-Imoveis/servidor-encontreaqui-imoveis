-- +migrate Up
-- A criação das colunas e o backfill de modelagem de área são tratados
-- de forma idempotente no bootstrap da aplicação (src/database/migrations.ts).
-- Esse migration permanece apenas como marcador histórico.

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
-- A reversão explícita das novas colunas de área permanece na DDL inicial/controle
-- centralizado (src/database/init.ts e src/database/migrations.ts).
