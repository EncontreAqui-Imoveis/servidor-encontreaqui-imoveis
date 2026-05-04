-- +migrate Up
ALTER TABLE properties
  MODIFY area_construida DECIMAL(12, 2) NULL,
  MODIFY area_terreno DECIMAL(12, 2) NULL;

-- +migrate Down
ALTER TABLE properties
  MODIFY area_construida DECIMAL(10, 2) NULL,
  MODIFY area_terreno DECIMAL(10, 2) NULL;
