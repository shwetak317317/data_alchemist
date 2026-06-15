-- DQ rule definitions
CREATE TABLE IF NOT EXISTS dq_rules (
    rule_id         VARCHAR(36)     PRIMARY KEY DEFAULT gen_random_uuid()::VARCHAR,
    connection_id   VARCHAR(36)     REFERENCES connections(id) ON DELETE CASCADE,
    rule_name       VARCHAR(256)    NOT NULL,
    rule_description TEXT,
    table_fqn       VARCHAR(256)    NOT NULL,
    layer           VARCHAR(16),
    column_name     VARCHAR(128),
    rule_expression TEXT            NOT NULL,     -- SQL expression returning TRUE=pass
    rule_type       VARCHAR(32)     NOT NULL,     -- NULL_CHECK|RANGE|FORMAT|FK|VOLUME|CUSTOM|ANOMALY
    severity        VARCHAR(16)     NOT NULL DEFAULT 'MEDIUM',  -- CRITICAL|HIGH|MEDIUM|LOW
    is_cde_rule     BOOLEAN         NOT NULL DEFAULT FALSE,
    status          VARCHAR(16)     NOT NULL DEFAULT 'draft',   -- draft|approved|active|snoozed|retired
    approved_by     VARCHAR(128),
    approved_at     TIMESTAMP,
    snooze_until    TIMESTAMP,
    created_by      VARCHAR(128),                -- 'AI_AGENT' or username
    nl_source       TEXT,                        -- original natural language if NL→DQ
    created_at      TIMESTAMP       NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMP       NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_rules_table_fqn ON dq_rules(table_fqn);
CREATE INDEX IF NOT EXISTS idx_rules_status ON dq_rules(status);
CREATE INDEX IF NOT EXISTS idx_rules_severity ON dq_rules(severity);
