-- ============================================================
-- DQ execution run metadata (parent of dq_run_results)
-- One row per triggered execution run
-- ============================================================

CREATE TABLE IF NOT EXISTS dq_runs (
    run_id               VARCHAR(36)   PRIMARY KEY DEFAULT gen_random_uuid()::VARCHAR,
    connection_id        VARCHAR(36)   REFERENCES connections(id) ON DELETE CASCADE,
    triggered_by         VARCHAR(64)   DEFAULT 'MANUAL',   -- MANUAL | SCHEDULER | API
    started_at           TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    completed_at         TIMESTAMPTZ,
    status               VARCHAR(16)   DEFAULT 'running',  -- running | completed | failed
    total_rules          INTEGER       DEFAULT 0,
    passed_rules         INTEGER       DEFAULT 0,
    failed_rules         INTEGER       DEFAULT 0,
    error_rules          INTEGER       DEFAULT 0,
    overall_quality_score DECIMAL(5,2),
    error_message        TEXT,
    created_at           TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_dq_runs_connection ON dq_runs(connection_id);
CREATE INDEX IF NOT EXISTS idx_dq_runs_started    ON dq_runs(started_at DESC);
CREATE INDEX IF NOT EXISTS idx_dq_runs_status     ON dq_runs(status);
