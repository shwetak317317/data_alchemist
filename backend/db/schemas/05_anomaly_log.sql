-- Anomaly detection log
CREATE TABLE IF NOT EXISTS anomaly_log (
    anomaly_id          VARCHAR(36)     PRIMARY KEY DEFAULT gen_random_uuid()::VARCHAR,
    connection_id       VARCHAR(36)     REFERENCES connections(id),
    detected_at         TIMESTAMP       NOT NULL DEFAULT NOW(),
    layer               VARCHAR(16),
    table_fqn           VARCHAR(256),
    column_name         VARCHAR(128),
    anomaly_type        VARCHAR(32)     NOT NULL,   -- VOLUME|DISTRIBUTION|SEGMENT|SOURCE|THRESHOLD|FRESHNESS
    description         TEXT            NOT NULL,
    severity            VARCHAR(16)     NOT NULL DEFAULT 'MEDIUM',
    metric_value        DECIMAL(18,4),
    baseline_value      DECIMAL(18,4),
    deviation_pct       DECIMAL(8,2),
    business_explanation TEXT,
    status              VARCHAR(16)     NOT NULL DEFAULT 'open',  -- open | acknowledged | resolved
    resolved_by         VARCHAR(128),
    resolved_at         TIMESTAMP,
    acknowledged_by     VARCHAR(128),
    acknowledged_at     TIMESTAMP,
    ack_note            TEXT,
    run_id              VARCHAR(36),                -- DQ run that triggered this
    created_at          TIMESTAMP       NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_anomaly_status ON anomaly_log(status);
CREATE INDEX IF NOT EXISTS idx_anomaly_table ON anomaly_log(table_fqn);
CREATE INDEX IF NOT EXISTS idx_anomaly_detected ON anomaly_log(detected_at DESC);
CREATE INDEX IF NOT EXISTS idx_anomaly_severity ON anomaly_log(severity);
