-- +migrate Up
CREATE TABLE IF NOT EXISTS sre_metrics_history (
    id INT PRIMARY KEY AUTO_INCREMENT,
    metric_name VARCHAR(50) NOT NULL,
    value DOUBLE NOT NULL,
    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_metric_time (metric_name, timestamp)
);

-- +migrate Down
DROP TABLE IF EXISTS sre_metrics_history;
