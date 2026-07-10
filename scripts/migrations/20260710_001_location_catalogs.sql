-- +migrate Up
CREATE TABLE IF NOT EXISTS location_cities (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  name VARCHAR(120) NOT NULL,
  state VARCHAR(2) NOT NULL DEFAULT '',
  normalized_name VARCHAR(120) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_location_cities_normalized_name_state (normalized_name, state),
  KEY idx_location_cities_search (normalized_name, state)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS location_neighborhoods (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  city_id INT UNSIGNED NOT NULL,
  name VARCHAR(120) NOT NULL,
  normalized_name VARCHAR(120) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_location_neighborhoods_city_normalized_name (city_id, normalized_name),
  KEY idx_location_neighborhoods_search (city_id, normalized_name),
  CONSTRAINT fk_location_neighborhoods_city
    FOREIGN KEY (city_id) REFERENCES location_cities(id)
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO location_cities (name, state, normalized_name)
SELECT
  MIN(TRIM(p.city)) AS name,
  UPPER(LEFT(TRIM(COALESCE(p.state, '')), 2)) AS state,
  LOWER(TRIM(p.city)) AS normalized_name
FROM properties p
WHERE TRIM(COALESCE(p.city, '')) <> ''
GROUP BY LOWER(TRIM(p.city)), UPPER(LEFT(TRIM(COALESCE(p.state, '')), 2))
ON DUPLICATE KEY UPDATE
  name = VALUES(name),
  updated_at = CURRENT_TIMESTAMP;

INSERT INTO location_neighborhoods (city_id, name, normalized_name)
SELECT
  c.id,
  MIN(TRIM(p.bairro)) AS name,
  LOWER(TRIM(p.bairro)) AS normalized_name
FROM properties p
INNER JOIN location_cities c
  -- The first failed run may have created catalog tables with the database default
  -- collation. Force both operands while backfilling legacy properties.
  ON c.normalized_name COLLATE utf8mb4_unicode_ci =
       LOWER(TRIM(p.city)) COLLATE utf8mb4_unicode_ci
  AND c.state COLLATE utf8mb4_unicode_ci =
       UPPER(LEFT(TRIM(COALESCE(p.state, '')), 2)) COLLATE utf8mb4_unicode_ci
WHERE TRIM(COALESCE(p.city, '')) <> ''
  AND TRIM(COALESCE(p.bairro, '')) <> ''
GROUP BY c.id, LOWER(TRIM(p.bairro))
ON DUPLICATE KEY UPDATE
  name = VALUES(name),
  updated_at = CURRENT_TIMESTAMP;

-- +migrate Down
DROP TABLE IF EXISTS location_neighborhoods;
DROP TABLE IF EXISTS location_cities;
