-- ============================================================
-- Schema Extensions: Add columns to existing tables
-- Uses IF NOT EXISTS / idempotent — safe to run on every startup
-- ============================================================

-- connections: expose display fields without decrypting credentials
ALTER TABLE connections ADD COLUMN IF NOT EXISTS host           VARCHAR(256);
ALTER TABLE connections ADD COLUMN IF NOT EXISTS port           INTEGER;
ALTER TABLE connections ADD COLUMN IF NOT EXISTS database_name  VARCHAR(128);
ALTER TABLE connections ADD COLUMN IF NOT EXISTS auth_type      VARCHAR(128);
ALTER TABLE connections ADD COLUMN IF NOT EXISTS is_demo        BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE connections ADD COLUMN IF NOT EXISTS table_count    INTEGER DEFAULT 0;

-- data_dictionary: rename logical status field + internal flag
ALTER TABLE data_dictionary ADD COLUMN IF NOT EXISTS steward_status VARCHAR(16) DEFAULT 'pending';
ALTER TABLE data_dictionary ADD COLUMN IF NOT EXISTS is_internal    BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE data_dictionary ADD COLUMN IF NOT EXISTS business_description TEXT;

-- profiling_reports: split schema/table for easier querying
ALTER TABLE profiling_reports ADD COLUMN IF NOT EXISTS run_id       VARCHAR(36);
ALTER TABLE profiling_reports ADD COLUMN IF NOT EXISTS schema_name  VARCHAR(128);
ALTER TABLE profiling_reports ADD COLUMN IF NOT EXISTS table_name   VARCHAR(128);

-- anomaly_log: structured explanation fields + metric tracking
ALTER TABLE anomaly_log ADD COLUMN IF NOT EXISTS explanation     TEXT;
ALTER TABLE anomaly_log ADD COLUMN IF NOT EXISTS metric_name     VARCHAR(128);
ALTER TABLE anomaly_log ADD COLUMN IF NOT EXISTS metric_value    DECIMAL(20,6);
ALTER TABLE anomaly_log ADD COLUMN IF NOT EXISTS baseline_value  DECIMAL(20,6);
ALTER TABLE anomaly_log ADD COLUMN IF NOT EXISTS deviation_pct   DECIMAL(10,2);
ALTER TABLE anomaly_log ADD COLUMN IF NOT EXISTS ack_note        TEXT;
ALTER TABLE anomaly_log ADD COLUMN IF NOT EXISTS history_values  JSONB;

-- audit_trail: normalize entity display name
ALTER TABLE audit_trail ADD COLUMN IF NOT EXISTS entity_name  VARCHAR(256);
ALTER TABLE audit_trail ADD COLUMN IF NOT EXISTS user_email   VARCHAR(256);
ALTER TABLE audit_trail ADD COLUMN IF NOT EXISTS ip_address   VARCHAR(64);

-- dq_rules: track NL source text and rule origin
ALTER TABLE dq_rules ADD COLUMN IF NOT EXISTS table_name  VARCHAR(128);
ALTER TABLE dq_rules ADD COLUMN IF NOT EXISTS column_name VARCHAR(128);

-- dq_run_results: track rule name for display without join
ALTER TABLE dq_run_results ADD COLUMN IF NOT EXISTS rule_name VARCHAR(256);
