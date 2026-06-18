-- ============================================================
-- Migration 23: Connection-scoped data_dictionary primary keys
--
-- Root cause fixed: column_id was "{table_fqn}.{col_name}" (global).
-- Two connections pointing at the same physical database share
-- identical column_ids, so enriching via the second connection
-- overwrote connection_id on existing rows, making all previously
-- enriched columns appear automatically in the new connection.
--
-- Fix: column_id is now "{connection_id}:{table_fqn}.{col_name}".
-- Each connection owns its own dictionary rows — no cross-connection
-- conflicts are possible.
--
-- This migration converts all legacy rows that lack the prefix.
-- ============================================================

-- Widen the PK column to hold the longer connection-scoped key
-- (connection UUID = 36 chars; existing max was 256; raise to 512)
ALTER TABLE data_dictionary ALTER COLUMN column_id TYPE VARCHAR(512);

-- Convert legacy rows: prepend connection_id so the key becomes
-- "{connection_id}:{table_fqn}.{col_name}".
-- Guard: only rows whose column_id does NOT already contain ':'
-- (UUIDs use '-', never ':'; legacy keys are "schema.table.col").
UPDATE data_dictionary
SET    column_id = connection_id || ':' || column_id
WHERE  connection_id IS NOT NULL
  AND  column_id NOT LIKE '%:%';

-- Delete orphaned rows with no connection_id (demo seed artefacts
-- that were never associated with a real connection).
DELETE FROM data_dictionary WHERE connection_id IS NULL;
