-- Profiling run reports and column-level stats
CREATE TABLE IF NOT EXISTS profiling_reports (
    report_id       VARCHAR(36)     PRIMARY KEY DEFAULT gen_random_uuid()::VARCHAR,
    connection_id   VARCHAR(36)     REFERENCES connections(id) ON DELETE CASCADE,
    table_fqn       VARCHAR(256)    NOT NULL,
    layer           VARCHAR(16),
    run_at          TIMESTAMP       NOT NULL DEFAULT NOW(),
    row_count       BIGINT,
    quality_score   DECIMAL(5,2),
    completeness_score DECIMAL(5,2),
    uniqueness_score   DECIMAL(5,2),
    consistency_score  DECIMAL(5,2),
    freshness_score    DECIMAL(5,2),
    risks_flagged   JSONB,          -- array of risk objects
    column_stats    JSONB,          -- array of per-column stat objects
    summary_text    TEXT            -- AI-generated narrative summary
);

CREATE INDEX IF NOT EXISTS idx_profiling_table ON profiling_reports(table_fqn);
CREATE INDEX IF NOT EXISTS idx_profiling_run_at ON profiling_reports(run_at DESC);
