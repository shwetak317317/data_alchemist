-- Strong FK relationships: connection_id → schema_id → table_id → column chain
-- Prevents duplication and confusion when the same connection/layer is added multiple times.

-- ── 1. Prevent duplicate rules per connection + table + name ─────────────────
-- If the same rule name already exists for this (connection, table), skip or update.
CREATE UNIQUE INDEX IF NOT EXISTS idx_dq_rules_no_dup
    ON dq_rules(connection_id, table_fqn, rule_name);

-- ── 2. Add table_id FK to dq_rules (nullable — populated on write) ────────────
ALTER TABLE dq_rules
    ADD COLUMN IF NOT EXISTS table_id VARCHAR(36)
    REFERENCES connection_tables(id) ON DELETE SET NULL;

-- ── 3. Add table_id and schema_id FKs to profiling_reports ───────────────────
ALTER TABLE profiling_reports
    ADD COLUMN IF NOT EXISTS table_id  VARCHAR(36) REFERENCES connection_tables(id) ON DELETE SET NULL;
ALTER TABLE profiling_reports
    ADD COLUMN IF NOT EXISTS schema_id VARCHAR(36) REFERENCES connection_schemas(id) ON DELETE SET NULL;

-- ── 4. Add table_id FK to data_dictionary ────────────────────────────────────
ALTER TABLE data_dictionary
    ADD COLUMN IF NOT EXISTS table_id VARCHAR(36)
    REFERENCES connection_tables(id) ON DELETE SET NULL;

-- ── 5. Add table_id FK to column_stats ───────────────────────────────────────
ALTER TABLE column_stats
    ADD COLUMN IF NOT EXISTS table_id VARCHAR(36)
    REFERENCES connection_tables(id) ON DELETE SET NULL;

-- ── 6. Backfill table_id where connection_tables already exists ───────────────
UPDATE dq_rules dr
SET    table_id = ct.id
FROM   connection_tables ct
WHERE  dr.connection_id = ct.connection_id
  AND  dr.table_fqn     = ct.table_fqn
  AND  dr.table_id IS NULL;

UPDATE profiling_reports pr
SET    table_id  = ct.id,
       schema_id = cs.id
FROM   connection_tables  ct
JOIN   connection_schemas cs ON cs.connection_id = ct.connection_id
                             AND cs.schema_name  = ct.schema_name
WHERE  pr.connection_id = ct.connection_id
  AND  pr.table_fqn     = ct.table_fqn
  AND  pr.table_id IS NULL;

UPDATE data_dictionary dd
SET    table_id = ct.id
FROM   connection_tables ct
WHERE  dd.connection_id = ct.connection_id
  AND  dd.table_fqn     = ct.table_fqn
  AND  dd.table_id IS NULL;

UPDATE column_stats cs
SET    table_id = ct.id
FROM   connection_tables ct
WHERE  cs.connection_id = ct.connection_id
  AND  cs.table_fqn     = ct.table_fqn
  AND  cs.table_id IS NULL;

-- ── 7. Compound indexes for fast connection-scoped queries ────────────────────
CREATE INDEX IF NOT EXISTS idx_dq_rules_conn_table
    ON dq_rules(connection_id, table_fqn);
CREATE INDEX IF NOT EXISTS idx_dq_rules_conn_status
    ON dq_rules(connection_id, status);
CREATE INDEX IF NOT EXISTS idx_dq_rules_table_id
    ON dq_rules(table_id) WHERE table_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_profiling_conn_table
    ON profiling_reports(connection_id, table_fqn);
CREATE INDEX IF NOT EXISTS idx_profiling_table_id
    ON profiling_reports(table_id) WHERE table_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_data_dict_conn_table
    ON data_dictionary(connection_id, table_fqn);
CREATE INDEX IF NOT EXISTS idx_data_dict_table_id
    ON data_dictionary(table_id) WHERE table_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_column_stats_table_id
    ON column_stats(table_id) WHERE table_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_anomaly_conn_table
    ON anomaly_log(connection_id, table_fqn) WHERE table_fqn IS NOT NULL;
