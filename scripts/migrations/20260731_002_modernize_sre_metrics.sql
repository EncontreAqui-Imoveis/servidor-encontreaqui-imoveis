-- +migrate Up
-- Native idempotent DDL avoids TiDB's disabled multi-statement PREPARE mode.
ALTER TABLE sre_metrics_history
  ADD COLUMN IF NOT EXISTS source VARCHAR(32) NOT NULL DEFAULT 'backend' AFTER value;

CREATE INDEX IF NOT EXISTS idx_sre_metrics_source_time
  ON sre_metrics_history (source, metric_name, timestamp);

CREATE INDEX IF NOT EXISTS idx_sre_releases_platform_repo_version
  ON sre_releases (platform, repo, version);

-- +migrate Down
DROP INDEX IF EXISTS idx_sre_metrics_source_time ON sre_metrics_history;
ALTER TABLE sre_metrics_history DROP COLUMN IF EXISTS source;
DROP INDEX IF EXISTS idx_sre_releases_platform_repo_version ON sre_releases;
