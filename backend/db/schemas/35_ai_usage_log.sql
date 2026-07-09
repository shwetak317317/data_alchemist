-- ============================================================
-- Unified AI usage ledger: every LLM call NOT already covered by
-- rule_ai_calls (recommend/NL-convert) writes one row here —
-- classification, narratives, advisory, receipt, daily summary.
-- Powers the Cost & Governance transparency panel on the Trust
-- Dashboard: token spend, latency, and AI-vs-fallback rate are
-- judge-visible facts, not backend-only log lines.
-- ============================================================

CREATE TABLE IF NOT EXISTS ai_usage_log (
    log_id         VARCHAR(36)  PRIMARY KEY DEFAULT gen_random_uuid()::VARCHAR,
    connection_id  VARCHAR(36)  REFERENCES connections(id) ON DELETE CASCADE,
    feature        VARCHAR(48)  NOT NULL,   -- e.g. sim_classify, sim_narrative, lineage_narrative,
                                             -- anomaly_explain, advisory, receipt, daily_summary
    model          VARCHAR(128),
    input_tokens   INTEGER,
    output_tokens  INTEGER,
    latency_ms     INTEGER,
    status         VARCHAR(16)  NOT NULL DEFAULT 'ai',   -- ai | fallback | error
    created_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ai_usage_conn    ON ai_usage_log(connection_id);
CREATE INDEX IF NOT EXISTS idx_ai_usage_feature ON ai_usage_log(feature);
CREATE INDEX IF NOT EXISTS idx_ai_usage_created ON ai_usage_log(created_at DESC);
