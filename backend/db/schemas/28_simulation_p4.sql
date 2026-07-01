-- ============================================================
-- P4: Add prompt-version tracking and real-metrics flag to simulation_runs.
-- Safe to re-run on every container restart (IF NOT EXISTS / idempotent).
-- ============================================================

ALTER TABLE simulation_runs
    ADD COLUMN IF NOT EXISTS classify_prompt_ver  VARCHAR(20),
    ADD COLUMN IF NOT EXISTS narrative_prompt_ver VARCHAR(20),
    ADD COLUMN IF NOT EXISTS has_real_metrics     BOOLEAN DEFAULT FALSE;

COMMENT ON COLUMN simulation_runs.classify_prompt_ver  IS 'Prompt version used for classification (e.g. classify-v1.0)';
COMMENT ON COLUMN simulation_runs.narrative_prompt_ver IS 'Prompt version used for narrative generation (e.g. narrative-v1.0)';
COMMENT ON COLUMN simulation_runs.has_real_metrics     IS 'True when the narrative was grounded in real profiling data, not static template values';
