-- ============================================================
-- Migration 33: Column-level lineage
--
-- Table-level edges say br_orders feeds fact_sales; column edges say
-- fact_sales.OrderDateKey is derived from br_orders.OrderDate. Extracted
-- deterministically from the same query-history INSERT...SELECT statements
-- table discovery already parses (positional column-list pairing + FROM/JOIN
-- alias resolution) — never guessed: ambiguous references are skipped.
-- ============================================================

CREATE TABLE IF NOT EXISTS lineage_column_edges (
    id             TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
    connection_id  TEXT REFERENCES connections(id) ON DELETE CASCADE,
    source_fqn     VARCHAR(256) NOT NULL,
    source_column  VARCHAR(128) NOT NULL,
    target_fqn     VARCHAR(256) NOT NULL,
    target_column  VARCHAR(128) NOT NULL,
    discovered_via VARCHAR(32)  NOT NULL DEFAULT 'query_log',
    evidence       TEXT,
    created_at     TIMESTAMP NOT NULL DEFAULT NOW(),
    UNIQUE (connection_id, source_fqn, source_column, target_fqn, target_column)
);

CREATE INDEX IF NOT EXISTS idx_lce_target ON lineage_column_edges (connection_id, target_fqn);
CREATE INDEX IF NOT EXISTS idx_lce_source ON lineage_column_edges (connection_id, source_fqn);
