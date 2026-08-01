-- +migrate Up
SET @has_sre_metrics_source_column := (
  SELECT COUNT(*)
  FROM information_schema.columns
  WHERE table_schema = DATABASE()
    AND table_name = 'sre_metrics_history'
    AND column_name = 'source'
);
SET @add_sre_metrics_source_column_sql := IF(
  @has_sre_metrics_source_column = 0,
  'ALTER TABLE sre_metrics_history ADD COLUMN source VARCHAR(32) NOT NULL DEFAULT ''backend'' AFTER value',
  'SELECT 1'
);
PREPARE stmt FROM @add_sre_metrics_source_column_sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @has_sre_metrics_source_index := (
  SELECT COUNT(*)
  FROM information_schema.statistics
  WHERE table_schema = DATABASE()
    AND table_name = 'sre_metrics_history'
    AND index_name = 'idx_sre_metrics_source_time'
);
SET @add_sre_metrics_source_index_sql := IF(
  @has_sre_metrics_source_index = 0,
  'ALTER TABLE sre_metrics_history ADD INDEX idx_sre_metrics_source_time (source, metric_name, timestamp)',
  'SELECT 1'
);
PREPARE stmt FROM @add_sre_metrics_source_index_sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @has_sre_release_version_index := (
  SELECT COUNT(*)
  FROM information_schema.statistics
  WHERE table_schema = DATABASE()
    AND table_name = 'sre_releases'
    AND index_name = 'idx_sre_releases_platform_repo_version'
);
SET @add_sre_release_version_index_sql := IF(
  @has_sre_release_version_index = 0,
  'ALTER TABLE sre_releases ADD INDEX idx_sre_releases_platform_repo_version (platform, repo, version)',
  'SELECT 1'
);
PREPARE stmt FROM @add_sre_release_version_index_sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- +migrate Down
SET @has_sre_metrics_source_index := (
  SELECT COUNT(*)
  FROM information_schema.statistics
  WHERE table_schema = DATABASE()
    AND table_name = 'sre_metrics_history'
    AND index_name = 'idx_sre_metrics_source_time'
);
SET @drop_sre_metrics_source_index_sql := IF(
  @has_sre_metrics_source_index > 0,
  'ALTER TABLE sre_metrics_history DROP INDEX idx_sre_metrics_source_time',
  'SELECT 1'
);
PREPARE stmt FROM @drop_sre_metrics_source_index_sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @has_sre_metrics_source_column := (
  SELECT COUNT(*)
  FROM information_schema.columns
  WHERE table_schema = DATABASE()
    AND table_name = 'sre_metrics_history'
    AND column_name = 'source'
);
SET @drop_sre_metrics_source_column_sql := IF(
  @has_sre_metrics_source_column > 0,
  'ALTER TABLE sre_metrics_history DROP COLUMN source',
  'SELECT 1'
);
PREPARE stmt FROM @drop_sre_metrics_source_column_sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @has_sre_release_version_index := (
  SELECT COUNT(*)
  FROM information_schema.statistics
  WHERE table_schema = DATABASE()
    AND table_name = 'sre_releases'
    AND index_name = 'idx_sre_releases_platform_repo_version'
);
SET @drop_sre_release_version_index_sql := IF(
  @has_sre_release_version_index > 0,
  'ALTER TABLE sre_releases DROP INDEX idx_sre_releases_platform_repo_version',
  'SELECT 1'
);
PREPARE stmt FROM @drop_sre_release_version_index_sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
