-- ============================================================
-- Critical Data Element (CDE) registry
-- Separate from data_dictionary for independent lifecycle management
-- ============================================================

CREATE TABLE IF NOT EXISTS cde_registry (
    cde_id            VARCHAR(36)    PRIMARY KEY DEFAULT gen_random_uuid()::VARCHAR,
    connection_id     VARCHAR(36)    REFERENCES connections(id) ON DELETE CASCADE,
    column_name       VARCHAR(128)   NOT NULL,
    table_fqn         VARCHAR(256)   NOT NULL,
    business_name     VARCHAR(256),
    cde_score         DECIMAL(5,2),
    health            VARCHAR(16)    DEFAULT 'PASS',       -- PASS | WARN | FAIL
    last_validated_at TIMESTAMPTZ,
    promoted_by       VARCHAR(128),
    promoted_at       TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
    rule_count        INTEGER        DEFAULT 0,
    notes             TEXT,
    UNIQUE(connection_id, table_fqn, column_name)
);

CREATE INDEX IF NOT EXISTS idx_cde_registry_connection ON cde_registry(connection_id);
CREATE INDEX IF NOT EXISTS idx_cde_registry_table      ON cde_registry(table_fqn);
CREATE INDEX IF NOT EXISTS idx_cde_registry_health     ON cde_registry(health);
