-- ============================================================
-- Daily summary narratives: one LLM-composed end-of-day report
-- per connection per date, cached so the summary screen doesn't
-- re-pay LLM latency on every view.
-- ============================================================

CREATE TABLE IF NOT EXISTS daily_summaries (
    summary_id     VARCHAR(36)  PRIMARY KEY DEFAULT gen_random_uuid()::VARCHAR,
    connection_id  VARCHAR(36)  REFERENCES connections(id) ON DELETE CASCADE,
    summary_date   DATE         NOT NULL,
    narrative      TEXT,
    watch_items    JSONB,                              -- ["...", "..."] — what to watch tomorrow
    generated_by   VARCHAR(16)  DEFAULT 'ai',          -- ai | heuristic
    generated_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    UNIQUE (connection_id, summary_date)
);

CREATE INDEX IF NOT EXISTS idx_daily_summaries_conn_date ON daily_summaries(connection_id, summary_date DESC);
