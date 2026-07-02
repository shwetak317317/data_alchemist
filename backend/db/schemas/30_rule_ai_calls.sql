-- Persists every LLM call made by the rule agent (recommend_rules, nl_to_rule)
-- so a bad AI-generated rule can be traced back to the exact prompt/response
-- that produced it.
CREATE TABLE IF NOT EXISTS rule_ai_calls (
    call_id       TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
    connection_id VARCHAR(36) REFERENCES connections(id) ON DELETE CASCADE,
    call_type     VARCHAR(32) NOT NULL,   -- RECOMMEND | NL_CONVERT
    table_fqn     VARCHAR(256),
    model         VARCHAR(128),
    prompt        TEXT        NOT NULL,
    raw_response  TEXT,
    status        VARCHAR(16) NOT NULL DEFAULT 'success',  -- success|error
    error_message TEXT,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_rule_ai_calls_conn    ON rule_ai_calls(connection_id);
CREATE INDEX IF NOT EXISTS idx_rule_ai_calls_created ON rule_ai_calls(created_at DESC);
