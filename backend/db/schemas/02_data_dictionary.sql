-- Data dictionary: column-level metadata enriched by the Metadata Agent
CREATE TABLE IF NOT EXISTS data_dictionary (
    column_id       VARCHAR(256)    PRIMARY KEY,  -- "{schema}.{table}.{column}"
    connection_id   VARCHAR(36)     REFERENCES connections(id) ON DELETE CASCADE,
    table_fqn       VARCHAR(256)    NOT NULL,     -- "{schema}.{table}"
    schema_name     VARCHAR(128),
    table_name      VARCHAR(128),
    layer           VARCHAR(16),                  -- RAW / BRONZE / SILVER / GOLD
    column_name     VARCHAR(128),
    business_name   VARCHAR(256),
    description     TEXT,
    data_type       VARCHAR(64),
    format_standard VARCHAR(128),                 -- e.g. 'YYYY-MM-DD', 'EMAIL', 'UUID'
    is_pii          BOOLEAN         NOT NULL DEFAULT FALSE,
    is_cde          BOOLEAN         NOT NULL DEFAULT FALSE,
    cde_score       DECIMAL(5,2),
    business_owner  VARCHAR(128),
    sensitivity_tag VARCHAR(64),                  -- PII | FINANCIAL | OPERATIONAL
    ai_suggested    BOOLEAN         NOT NULL DEFAULT TRUE,
    status          VARCHAR(16)     NOT NULL DEFAULT 'draft',  -- draft | approved | rejected
    approved_by     VARCHAR(128),
    approved_at     TIMESTAMP,
    created_at      TIMESTAMP       NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMP       NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_dict_table_fqn ON data_dictionary(table_fqn);
CREATE INDEX IF NOT EXISTS idx_dict_is_cde ON data_dictionary(is_cde);
CREATE INDEX IF NOT EXISTS idx_dict_connection ON data_dictionary(connection_id);
