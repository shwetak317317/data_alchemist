-- ============================================================
-- Lineage edge discovery metadata.
-- Safe to re-run on every container restart (IF NOT EXISTS).
--
-- discovered_via / confidence / evidence let a steward see WHY an edge exists
-- and how much to trust it. status separates deterministic ground-truth edges
-- (FK constraints, dbt manifest — auto-confirmed) from heuristic ones (SQL
-- query-log parsing — always start as 'suggested' and require human approval;
-- a wrong edge actively misdirects incident response, which is worse than a
-- missing one).
-- ============================================================

ALTER TABLE lineage_edges
    ADD COLUMN IF NOT EXISTS discovered_via VARCHAR(16) NOT NULL DEFAULT 'manual',
    ADD COLUMN IF NOT EXISTS status         VARCHAR(16) NOT NULL DEFAULT 'confirmed',
    ADD COLUMN IF NOT EXISTS confidence     FLOAT,
    ADD COLUMN IF NOT EXISTS evidence       TEXT,
    ADD COLUMN IF NOT EXISTS discovered_at  TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS reviewed_by    VARCHAR(256),
    ADD COLUMN IF NOT EXISTS reviewed_at    TIMESTAMPTZ;

COMMENT ON COLUMN lineage_edges.discovered_via IS 'manual | fk | query_log | dbt';
COMMENT ON COLUMN lineage_edges.status         IS 'confirmed | suggested | rejected — only confirmed edges appear in the main graph';
COMMENT ON COLUMN lineage_edges.confidence     IS 'Discovery confidence 0-1. NULL for manual/fk/dbt (deterministic, not scored).';
COMMENT ON COLUMN lineage_edges.evidence       IS 'Short human-readable justification: FK constraint name, matched query text excerpt, or dbt model name.';

-- Suggested edges need fast lookup per connection for the review queue.
CREATE INDEX IF NOT EXISTS idx_lineage_edges_status
    ON lineage_edges(connection_id, status);

-- lineage_nodes also needs a discovered_via marker so auto-created nodes (from
-- FK/dbt discovery, on tables that exist in connection_tables but were never
-- explicitly seeded/profiled) are distinguishable from steward-curated ones.
ALTER TABLE lineage_nodes
    ADD COLUMN IF NOT EXISTS discovered_via VARCHAR(16) NOT NULL DEFAULT 'manual';

COMMENT ON COLUMN lineage_nodes.discovered_via IS 'manual | seed | fk | query_log | dbt';
