-- ============================================================
-- Column-level profiling statistics (normalized from JSONB)
-- Enables per-column queries, CDE tracking, health history
-- ============================================================

CREATE TABLE IF NOT EXISTS column_stats (
    stat_id          VARCHAR(36)    PRIMARY KEY DEFAULT gen_random_uuid()::VARCHAR,
    report_id        VARCHAR(36)    NOT NULL REFERENCES profiling_reports(report_id) ON DELETE CASCADE,
    connection_id    VARCHAR(36)    REFERENCES connections(id) ON DELETE CASCADE,
    table_fqn        VARCHAR(256)   NOT NULL,
    column_name      VARCHAR(128)   NOT NULL,
    data_type        VARCHAR(64),
    null_pct         DECIMAL(5,2)   DEFAULT 0,
    distinct_count   BIGINT,
    min_value        TEXT,
    max_value        TEXT,
    mean_value       DECIMAL(20,6),
    std_dev          DECIMAL(20,6),
    detected_format  VARCHAR(128),
    is_cde           BOOLEAN        NOT NULL DEFAULT FALSE,
    is_pii           BOOLEAN        NOT NULL DEFAULT FALSE,
    pii_type         VARCHAR(64),                             -- PII | Financial | Operational
    quality_score    DECIMAL(5,2),
    health           VARCHAR(16)    DEFAULT 'HEALTHY',        -- HEALTHY | WARN | CRIT | OK
    note             TEXT,
    sample_values    JSONB,
    created_at       TIMESTAMPTZ    NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_col_stats_report     ON column_stats(report_id);
CREATE INDEX IF NOT EXISTS idx_col_stats_table      ON column_stats(table_fqn);
CREATE INDEX IF NOT EXISTS idx_col_stats_connection ON column_stats(connection_id);
CREATE INDEX IF NOT EXISTS idx_col_stats_cde        ON column_stats(is_cde) WHERE is_cde = TRUE;

-- ============================================================
-- Profiling risk flags (normalized from JSONB in profiling_reports)
-- One row per risk per profiling run
-- ============================================================

CREATE TABLE IF NOT EXISTS profiling_risks (
    risk_id             VARCHAR(36)   PRIMARY KEY DEFAULT gen_random_uuid()::VARCHAR,
    report_id           VARCHAR(36)   NOT NULL REFERENCES profiling_reports(report_id) ON DELETE CASCADE,
    connection_id       VARCHAR(36)   REFERENCES connections(id) ON DELETE CASCADE,
    risk_code           VARCHAR(16)   NOT NULL,           -- R1, R2, R3 …
    severity            VARCHAR(16)   NOT NULL,           -- CRITICAL | HIGH | MEDIUM | LOW
    title               VARCHAR(512)  NOT NULL,
    description         TEXT,
    column_name         VARCHAR(128),
    risk_type           VARCHAR(64),                      -- NULL_RATE | VOLUME_DROP | FORMAT | FK | DUPLICATE
    is_suppressed       BOOLEAN       NOT NULL DEFAULT FALSE,
    suppressed_by       VARCHAR(128),
    suppression_reason  TEXT,
    note                TEXT,
    created_at          TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_prof_risks_report     ON profiling_risks(report_id);
CREATE INDEX IF NOT EXISTS idx_prof_risks_connection ON profiling_risks(connection_id);
CREATE INDEX IF NOT EXISTS idx_prof_risks_severity   ON profiling_risks(severity);
