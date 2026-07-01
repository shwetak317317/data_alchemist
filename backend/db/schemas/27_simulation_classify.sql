-- ============================================================
-- Add classification metadata columns to simulation_runs.
-- Safe to re-run on every container restart (IF NOT EXISTS).
-- ============================================================

ALTER TABLE simulation_runs
    ADD COLUMN IF NOT EXISTS classified_as          VARCHAR(20),
    ADD COLUMN IF NOT EXISTS classification_method  VARCHAR(10),
    ADD COLUMN IF NOT EXISTS classification_conf    FLOAT;

COMMENT ON COLUMN simulation_runs.classified_as         IS 'Scenario key assigned by classifier: segment|nullcol|volume|whitelist|source|unknown';
COMMENT ON COLUMN simulation_runs.classification_method IS 'llm or regex';
COMMENT ON COLUMN simulation_runs.classification_conf   IS 'Confidence score 0–1 from ClassifyResult';
