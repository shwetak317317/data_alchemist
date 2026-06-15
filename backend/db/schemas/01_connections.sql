-- Data platform connection registry
CREATE TABLE IF NOT EXISTS connections (
    id              VARCHAR(36)     PRIMARY KEY DEFAULT gen_random_uuid()::VARCHAR,
    name            VARCHAR(128)    NOT NULL,
    platform        VARCHAR(32)     NOT NULL,   -- sqlserver | snowflake | databricks | postgres | duckdb
    environment     VARCHAR(32)     NOT NULL DEFAULT 'production',  -- production | staging | dev
    config_encrypted TEXT           NOT NULL,   -- Fernet-encrypted JSON of credentials
    status          VARCHAR(16)     NOT NULL DEFAULT 'active',  -- active | inactive | error
    error_message   TEXT,
    schemas_scope   TEXT[],                     -- selected schemas for this connection
    last_tested_at  TIMESTAMP,
    last_sync_at    TIMESTAMP,
    created_at      TIMESTAMP       NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMP       NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_connections_platform ON connections(platform);
CREATE INDEX IF NOT EXISTS idx_connections_status ON connections(status);
