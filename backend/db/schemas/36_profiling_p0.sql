-- ============================================================
-- Profiling P0 gap-closure: schema drift, key-based duplicates,
-- referential/orphan checks, and sample failing records.
-- ============================================================

-- Schema drift: added/dropped/type-changed columns vs the previous run for
-- this table_fqn, computed once per run and cached (never recomputed on read).
ALTER TABLE profiling_reports ADD COLUMN IF NOT EXISTS schema_drift JSONB;

-- Partition-aware profiling: which date column (if any) scoped this run, and
-- the window applied. is_partial_scan=false means "full table scan" (today's
-- only behavior); true means row_count/stats reflect ONLY the windowed rows,
-- not the whole table — every consumer of row_count must check this flag
-- before treating it as the table's total size.
ALTER TABLE profiling_reports ADD COLUMN IF NOT EXISTS partition_column VARCHAR(128);
ALTER TABLE profiling_reports ADD COLUMN IF NOT EXISTS window_from TIMESTAMPTZ;
ALTER TABLE profiling_reports ADD COLUMN IF NOT EXISTS window_to TIMESTAMPTZ;
ALTER TABLE profiling_reports ADD COLUMN IF NOT EXISTS is_partial_scan BOOLEAN NOT NULL DEFAULT FALSE;

-- Sample failing records per risk (mirrors dq_run_results.sample_failed_records,
-- which already does this for RULE failures — profiling risks never had the
-- equivalent, so "12% null" had no way to show the actual 12%).
ALTER TABLE profiling_risks ADD COLUMN IF NOT EXISTS sample_failed_records JSONB;
