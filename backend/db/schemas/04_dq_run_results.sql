-- DQ execution results per rule per run
CREATE TABLE IF NOT EXISTS dq_run_results (
    result_id               VARCHAR(36)     PRIMARY KEY DEFAULT gen_random_uuid()::VARCHAR,
    run_id                  VARCHAR(36)     NOT NULL,
    run_timestamp           TIMESTAMP       NOT NULL DEFAULT NOW(),
    connection_id           VARCHAR(36)     REFERENCES connections(id),
    rule_id                 VARCHAR(36)     REFERENCES dq_rules(rule_id),
    table_fqn               VARCHAR(256)    NOT NULL,
    layer                   VARCHAR(16),
    status                  VARCHAR(16)     NOT NULL,   -- PASS | FAIL | ERROR
    total_records           BIGINT,
    failed_records          BIGINT          DEFAULT 0,
    fail_pct                DECIMAL(5,2)    DEFAULT 0,
    quality_score           DECIMAL(5,2),              -- 0–100 for this rule
    severity                VARCHAR(16),
    sample_failed_records   JSONB,                     -- top 20 failed rows
    remediation_suggestion  TEXT,
    acknowledged_by         VARCHAR(128),
    acknowledged_at         TIMESTAMP,
    is_expected_failure     BOOLEAN         DEFAULT FALSE,
    expected_failure_reason TEXT,
    created_at              TIMESTAMP       NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_run_results_run_id ON dq_run_results(run_id);
CREATE INDEX IF NOT EXISTS idx_run_results_table ON dq_run_results(table_fqn);
CREATE INDEX IF NOT EXISTS idx_run_results_status ON dq_run_results(status);
CREATE INDEX IF NOT EXISTS idx_run_results_ts ON dq_run_results(run_timestamp DESC);
