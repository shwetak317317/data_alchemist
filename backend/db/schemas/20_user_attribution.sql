-- ============================================================
-- Migration 20: User Attribution + Cascade Consistency
--
-- Adds:
--   • triggered_by / triggered_by_user on run tables
--   • updated_by on mutable tables
--   • Fixes missing ON DELETE CASCADE on 4 tables
--   • Fixes dq_run_results.rule_id → SET NULL on rule delete
-- ============================================================

-- ── profiling_reports: who triggered the scan ────────────────────────────────
ALTER TABLE profiling_reports ADD COLUMN IF NOT EXISTS triggered_by TEXT;

-- ── dq_runs: which user triggered the run ────────────────────────────────────
ALTER TABLE dq_runs ADD COLUMN IF NOT EXISTS triggered_by_user TEXT;

-- ── simulation_runs: who triggered the simulation ────────────────────────────
ALTER TABLE simulation_runs ADD COLUMN IF NOT EXISTS triggered_by TEXT;
ALTER TABLE simulation_runs ADD COLUMN IF NOT EXISTS approved_by  TEXT;

-- ── updated_by on mutable tables ─────────────────────────────────────────────
ALTER TABLE dq_rules        ADD COLUMN IF NOT EXISTS updated_by TEXT;
ALTER TABLE data_dictionary ADD COLUMN IF NOT EXISTS updated_by TEXT;
ALTER TABLE task_board      ADD COLUMN IF NOT EXISTS updated_by TEXT;

-- ── Fix cascades: dq_run_results → connections (no cascade → cascade) ────────
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE constraint_name = 'dq_run_results_connection_id_fkey'
    ) THEN
        ALTER TABLE dq_run_results DROP CONSTRAINT dq_run_results_connection_id_fkey;
    END IF;
END$$;
ALTER TABLE dq_run_results ADD CONSTRAINT dq_run_results_connection_id_fkey
    FOREIGN KEY (connection_id) REFERENCES connections(id) ON DELETE CASCADE;

-- ── Fix cascades: anomaly_log → connections ───────────────────────────────────
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE constraint_name = 'anomaly_log_connection_id_fkey'
    ) THEN
        ALTER TABLE anomaly_log DROP CONSTRAINT anomaly_log_connection_id_fkey;
    END IF;
END$$;
ALTER TABLE anomaly_log ADD CONSTRAINT anomaly_log_connection_id_fkey
    FOREIGN KEY (connection_id) REFERENCES connections(id) ON DELETE CASCADE;

-- ── Fix cascades: audit_trail → connections ───────────────────────────────────
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE constraint_name = 'audit_trail_connection_id_fkey'
    ) THEN
        ALTER TABLE audit_trail DROP CONSTRAINT audit_trail_connection_id_fkey;
    END IF;
END$$;
ALTER TABLE audit_trail ADD CONSTRAINT audit_trail_connection_id_fkey
    FOREIGN KEY (connection_id) REFERENCES connections(id) ON DELETE CASCADE;

-- ── Fix cascades: task_board → connections ────────────────────────────────────
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE constraint_name = 'task_board_connection_id_fkey'
    ) THEN
        ALTER TABLE task_board DROP CONSTRAINT task_board_connection_id_fkey;
    END IF;
END$$;
ALTER TABLE task_board ADD CONSTRAINT task_board_connection_id_fkey
    FOREIGN KEY (connection_id) REFERENCES connections(id) ON DELETE CASCADE;

-- ── Fix dq_run_results.rule_id: no cascade → SET NULL (keep history) ─────────
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE constraint_name = 'dq_run_results_rule_id_fkey'
    ) THEN
        ALTER TABLE dq_run_results DROP CONSTRAINT dq_run_results_rule_id_fkey;
    END IF;
END$$;
ALTER TABLE dq_run_results ADD CONSTRAINT dq_run_results_rule_id_fkey
    FOREIGN KEY (rule_id) REFERENCES dq_rules(rule_id) ON DELETE SET NULL;
