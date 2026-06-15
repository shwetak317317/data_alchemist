-- ============================================================
-- Data lineage / impact graph
-- Nodes: tables, reports, models, sources
-- Edges: FEEDS, TRANSFORMS, AGGREGATES
-- ============================================================

CREATE TABLE IF NOT EXISTS lineage_nodes (
    node_id          VARCHAR(36)   PRIMARY KEY DEFAULT gen_random_uuid()::VARCHAR,
    connection_id    VARCHAR(36)   REFERENCES connections(id) ON DELETE CASCADE,
    external_id      VARCHAR(256)  NOT NULL,               -- user-visible ID (e.g. "silver.orders_enriched")
    label            VARCHAR(256)  NOT NULL,
    sub_label        TEXT,                                  -- secondary info shown under label
    layer            VARCHAR(16),                          -- RAW | BRONZE | SILVER | GOLD | REPORT | MODEL
    node_type        VARCHAR(64),                          -- table | report | model | source
    tier_label       VARCHAR(64),                          -- grouping label for the tier column
    health_status    VARCHAR(16)   DEFAULT 'ok',           -- ok | warn | fail
    note             TEXT,
    position_order   INTEGER       DEFAULT 0,              -- sort order within tier
    is_source        BOOLEAN       DEFAULT FALSE,
    created_at       TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    UNIQUE(connection_id, external_id)
);

CREATE INDEX IF NOT EXISTS idx_lineage_nodes_connection ON lineage_nodes(connection_id);
CREATE INDEX IF NOT EXISTS idx_lineage_nodes_layer      ON lineage_nodes(layer);

CREATE TABLE IF NOT EXISTS lineage_edges (
    edge_id          VARCHAR(36)   PRIMARY KEY DEFAULT gen_random_uuid()::VARCHAR,
    connection_id    VARCHAR(36)   REFERENCES connections(id) ON DELETE CASCADE,
    source_node_id   VARCHAR(36)   NOT NULL REFERENCES lineage_nodes(node_id) ON DELETE CASCADE,
    target_node_id   VARCHAR(36)   NOT NULL REFERENCES lineage_nodes(node_id) ON DELETE CASCADE,
    edge_type        VARCHAR(64)   DEFAULT 'FEEDS',        -- FEEDS | TRANSFORMS | AGGREGATES
    UNIQUE(connection_id, source_node_id, target_node_id)
);

CREATE INDEX IF NOT EXISTS idx_lineage_edges_connection ON lineage_edges(connection_id);
CREATE INDEX IF NOT EXISTS idx_lineage_edges_source     ON lineage_edges(source_node_id);
CREATE INDEX IF NOT EXISTS idx_lineage_edges_target     ON lineage_edges(target_node_id);
