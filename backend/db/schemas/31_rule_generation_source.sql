-- ============================================================
-- Migration 31: Structured rule provenance
--
-- Until now the ONLY record of a rule being cross-table was a
-- "[Cross-table: <table>]" prose prefix stamped into rule_description —
-- and the ⚠️ warning prefixes prepended in rule_agent.py push it off
-- position 0, breaking every LIKE '[Cross-table:%' consumer (the two
-- regenerate-cleanup DELETEs in api/rules.py and the frontend badge
-- regex). Self-reference rules from the cross-table button had no
-- marker at all, so the single-table regenerate deleted them and the
-- cross-table regenerate duplicated them.
--
-- Adds:
--   • generation_source — which flow created the rule:
--       'single_table' | 'cross_table' | 'nl' | 'manual'
--     (cross-table-button self-references are 'cross_table' even though
--      they reference no other table — regenerate scoping follows the
--      BUTTON that owns the suggestion, not the SQL's shape)
--   • related_table_fqn — the other table a cross-table rule checks
--     against (NULL for self-references and all non-cross-table rules)
--   • Backfills both from existing description prefixes / created_by
-- ============================================================

ALTER TABLE dq_rules ADD COLUMN IF NOT EXISTS generation_source VARCHAR(20);
ALTER TABLE dq_rules ADD COLUMN IF NOT EXISTS related_table_fqn VARCHAR(256);

-- Backfill cross-table rules: the tag may not be at position 0 (⚠️ warning
-- prefixes get prepended before it), so match anywhere in the description.
UPDATE dq_rules
SET generation_source = 'cross_table',
    related_table_fqn = NULLIF(TRIM(substring(rule_description FROM '\[Cross-table:\s*([^\]]+)\]')), '')
WHERE generation_source IS NULL
  AND rule_description LIKE '%[Cross-table:%';

-- Cross-table-button self-references: FK-typed AI rules without the tag whose
-- description carries the self-reference wording stamped by rule_agent.py.
UPDATE dq_rules
SET generation_source = 'cross_table'
WHERE generation_source IS NULL
  AND created_by = 'AI_AGENT' AND rule_type = 'FK'
  AND (rule_description ILIKE '%self-referenc%' OR rule_description ILIKE '%same table%'
       OR rule_description ILIKE '%same br_%');

UPDATE dq_rules SET generation_source = 'nl'
WHERE generation_source IS NULL AND nl_source IS NOT NULL;

UPDATE dq_rules SET generation_source = 'single_table'
WHERE generation_source IS NULL AND created_by = 'AI_AGENT';

UPDATE dq_rules SET generation_source = 'manual'
WHERE generation_source IS NULL;
