-- ============================================================
-- Pre-run advisory: predicted trust score before pipeline runs
-- ============================================================

CREATE TABLE IF NOT EXISTS intel_advisories (
    advisory_id      VARCHAR(36)   PRIMARY KEY DEFAULT gen_random_uuid()::VARCHAR,
    connection_id    VARCHAR(36)   REFERENCES connections(id) ON DELETE CASCADE,
    predicted_score  DECIMAL(5,2),
    risk_reasons     JSONB,                                -- [{risk: "high"|"med", text: "..."}]
    recommendation   TEXT,
    pipeline_name    VARCHAR(128)  DEFAULT 'main',
    advisory_time    VARCHAR(32),                          -- human-readable, e.g. "05:20 AM"
    generated_at     TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_intel_advisories_connection ON intel_advisories(connection_id);
CREATE INDEX IF NOT EXISTS idx_intel_advisories_generated  ON intel_advisories(generated_at DESC);

-- ============================================================
-- Trust receipts: per-query data quality nutrition label
-- ============================================================

CREATE TABLE IF NOT EXISTS intel_receipts (
    receipt_id          VARCHAR(36)   PRIMARY KEY DEFAULT gen_random_uuid()::VARCHAR,
    connection_id       VARCHAR(36)   REFERENCES connections(id) ON DELETE CASCADE,
    query_text          TEXT,
    table_fqn           VARCHAR(256),
    executed_at         TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    executed_by         VARCHAR(128),
    row_count           BIGINT,
    trust_score         DECIMAL(5,2),
    fields              JSONB,                             -- [{name, status: "ok"|"warn"|"fail", note}]
    recommendation      TEXT,
    last_clean_snapshot DATE,
    created_at          TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_intel_receipts_connection ON intel_receipts(connection_id);
CREATE INDEX IF NOT EXISTS idx_intel_receipts_table      ON intel_receipts(table_fqn);
CREATE INDEX IF NOT EXISTS idx_intel_receipts_executed   ON intel_receipts(executed_at DESC);

-- ============================================================
-- Anomaly fingerprint library (historical incident patterns)
-- ============================================================

CREATE TABLE IF NOT EXISTS anomaly_fingerprints (
    fingerprint_id   VARCHAR(36)   PRIMARY KEY DEFAULT gen_random_uuid()::VARCHAR,
    connection_id    VARCHAR(36)   REFERENCES connections(id) ON DELETE CASCADE,
    similarity_pct   INTEGER,
    incident_date    DATE,
    incident_day     VARCHAR(16),
    root_cause       TEXT,
    resolution       TEXT,
    resolution_time  VARCHAR(64),
    resolved_by      VARCHAR(128),
    related_table    VARCHAR(256),
    created_at       TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_fingerprints_connection ON anomaly_fingerprints(connection_id);
