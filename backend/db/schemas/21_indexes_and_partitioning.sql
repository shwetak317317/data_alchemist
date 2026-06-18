-- ============================================================
-- Migration 21: Composite Indexes + Governance Columns
--
-- Adds composite indexes for common multi-tenant query patterns.
-- Adds retention policy and simulation attribution columns.
-- ============================================================

-- ── Composite indexes for connection-scoped queries ───────────────────────────
CREATE INDEX IF NOT EXISTS idx_dq_rules_conn_status
    ON dq_rules(connection_id, status);

CREATE INDEX IF NOT EXISTS idx_run_results_conn_ts
    ON dq_run_results(connection_id, run_timestamp DESC);

CREATE INDEX IF NOT EXISTS idx_anomaly_conn_status
    ON anomaly_log(connection_id, status);

CREATE INDEX IF NOT EXISTS idx_profiling_conn_table
    ON profiling_reports(connection_id, table_fqn);

CREATE INDEX IF NOT EXISTS idx_tasks_conn_status
    ON task_board(connection_id, status);

CREATE INDEX IF NOT EXISTS idx_dq_runs_conn_started
    ON dq_runs(connection_id, started_at DESC);

-- ── Org-scoped audit index (for compliance exports) ───────────────────────────
CREATE INDEX IF NOT EXISTS idx_audit_trail_org_ts
    ON audit_trail(org_id, event_timestamp DESC);

-- ── Retention policy on audit trail (7-year default for compliance) ──────────
ALTER TABLE audit_trail ADD COLUMN IF NOT EXISTS retention_days INTEGER DEFAULT 2555;

-- ── simulation_scenarios: per-org custom scenarios ───────────────────────────
ALTER TABLE simulation_scenarios ADD COLUMN IF NOT EXISTS org_id     TEXT;
ALTER TABLE simulation_scenarios ADD COLUMN IF NOT EXISTS created_by TEXT;
-- NULL org_id = global builtin scenario visible to all orgs
