-- Human task board (persistent across all phases)
CREATE TABLE IF NOT EXISTS task_board (
    task_id         VARCHAR(36)     PRIMARY KEY DEFAULT gen_random_uuid()::VARCHAR,
    title           TEXT            NOT NULL,
    description     TEXT,
    priority        VARCHAR(16)     NOT NULL DEFAULT 'MEDIUM',  -- CRITICAL|HIGH|MEDIUM|LOW
    phase           VARCHAR(32),                -- Phase 1 | Phase 2 | ... | Cross-phase
    owner           VARCHAR(128),
    status          VARCHAR(16)     NOT NULL DEFAULT 'open',  -- open | in_progress | done | cancelled
    related_entity_type VARCHAR(32),            -- RULE|ANOMALY|TABLE|CDE
    related_entity_id   VARCHAR(256),
    due_date        DATE,
    completed_at    TIMESTAMP,
    connection_id   VARCHAR(36)     REFERENCES connections(id),
    created_by      VARCHAR(128),
    created_at      TIMESTAMP       NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMP       NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_task_status ON task_board(status);
CREATE INDEX IF NOT EXISTS idx_task_priority ON task_board(priority);
CREATE INDEX IF NOT EXISTS idx_task_owner ON task_board(owner);
