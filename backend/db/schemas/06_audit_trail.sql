-- Immutable audit trail — every human action is logged here
CREATE TABLE IF NOT EXISTS audit_trail (
    event_id        VARCHAR(36)     PRIMARY KEY DEFAULT gen_random_uuid()::VARCHAR,
    event_timestamp TIMESTAMP       NOT NULL DEFAULT NOW(),
    user_name       VARCHAR(128)    NOT NULL,
    event_type      VARCHAR(32)     NOT NULL,   -- APPROVE|EDIT|REJECT|SUPPRESS|ESCALATE|PROMOTE|DEMOTE|SNOOZE|ACK
    entity_type     VARCHAR(32)     NOT NULL,   -- RULE|CDE|ANOMALY|TASK|CONNECTION|DICTIONARY
    entity_id       VARCHAR(256)    NOT NULL,
    old_value       JSONB,
    new_value       JSONB,
    reason          TEXT,
    connection_id   VARCHAR(36)     REFERENCES connections(id),
    created_at      TIMESTAMP       NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_trail(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_user ON audit_trail(user_name);
CREATE INDEX IF NOT EXISTS idx_audit_ts ON audit_trail(event_timestamp DESC);
