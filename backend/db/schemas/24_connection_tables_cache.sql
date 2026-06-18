-- Connection topology cache: schemas and tables discovered per connection
CREATE TABLE IF NOT EXISTS connection_schemas (
    id            VARCHAR(36)  PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
    connection_id VARCHAR(36)  NOT NULL REFERENCES connections(id) ON DELETE CASCADE,
    schema_name   VARCHAR(256) NOT NULL,
    layer         VARCHAR(64)  NOT NULL DEFAULT 'UNKNOWN',
    discovered_at TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    UNIQUE(connection_id, schema_name)
);

CREATE TABLE IF NOT EXISTS connection_tables (
    id            VARCHAR(36)  PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
    connection_id VARCHAR(36)  NOT NULL REFERENCES connections(id) ON DELETE CASCADE,
    schema_id     VARCHAR(36)  REFERENCES connection_schemas(id) ON DELETE CASCADE,
    schema_name   VARCHAR(256) NOT NULL,
    table_name    VARCHAR(256) NOT NULL,
    table_fqn     VARCHAR(512) NOT NULL,
    layer         VARCHAR(64)  NOT NULL DEFAULT 'UNKNOWN',
    row_count     BIGINT,
    discovered_at TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    UNIQUE(connection_id, table_fqn)
);

CREATE INDEX IF NOT EXISTS idx_conn_schemas_conn ON connection_schemas(connection_id);
CREATE INDEX IF NOT EXISTS idx_conn_tables_conn  ON connection_tables(connection_id);
CREATE INDEX IF NOT EXISTS idx_conn_tables_fqn   ON connection_tables(connection_id, table_fqn);
