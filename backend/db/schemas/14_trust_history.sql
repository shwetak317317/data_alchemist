-- ============================================================
-- Daily trust score snapshots (drives the 14-day trend chart)
-- One row per connection per day, updated after each execution run
-- ============================================================

CREATE TABLE IF NOT EXISTS trust_score_history (
    history_id      VARCHAR(36)   PRIMARY KEY DEFAULT gen_random_uuid()::VARCHAR,
    connection_id   VARCHAR(36)   REFERENCES connections(id) ON DELETE CASCADE,
    score_date      DATE          NOT NULL,
    overall_score   DECIMAL(5,2),
    raw_score       DECIMAL(5,2),
    bronze_score    DECIMAL(5,2),
    silver_score    DECIMAL(5,2),
    gold_score      DECIMAL(5,2),
    rules_total     INTEGER       DEFAULT 0,
    rules_passed    INTEGER       DEFAULT 0,
    rules_failed    INTEGER       DEFAULT 0,
    anomaly_count   INTEGER       DEFAULT 0,
    recorded_at     TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    UNIQUE(connection_id, score_date)
);

CREATE INDEX IF NOT EXISTS idx_trust_history_connection ON trust_score_history(connection_id);
CREATE INDEX IF NOT EXISTS idx_trust_history_date       ON trust_score_history(score_date DESC);

-- ============================================================
-- Daily rule failure counts (drives the rule failure bar chart)
-- ============================================================

CREATE TABLE IF NOT EXISTS rule_fail_history (
    fail_id        VARCHAR(36)   PRIMARY KEY DEFAULT gen_random_uuid()::VARCHAR,
    connection_id  VARCHAR(36)   REFERENCES connections(id) ON DELETE CASCADE,
    fail_date      DATE          NOT NULL,
    fail_count     INTEGER       DEFAULT 0,
    recorded_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    UNIQUE(connection_id, fail_date)
);

CREATE INDEX IF NOT EXISTS idx_rule_fail_connection ON rule_fail_history(connection_id);
CREATE INDEX IF NOT EXISTS idx_rule_fail_date       ON rule_fail_history(fail_date DESC);
