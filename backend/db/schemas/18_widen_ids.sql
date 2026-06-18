-- Widen all VARCHAR(36) ID / FK columns to TEXT.
-- VARCHAR(36) was sized for UUIDs; demo + user-defined IDs can be longer.
-- PostgreSQL allows widening VARCHAR to TEXT without dropping FK constraints.

ALTER TABLE connections            ALTER COLUMN id               TYPE TEXT;

ALTER TABLE data_dictionary        ALTER COLUMN connection_id    TYPE TEXT;

ALTER TABLE dq_rules               ALTER COLUMN rule_id          TYPE TEXT;
ALTER TABLE dq_rules               ALTER COLUMN connection_id    TYPE TEXT;

ALTER TABLE dq_run_results         ALTER COLUMN result_id        TYPE TEXT;
ALTER TABLE dq_run_results         ALTER COLUMN run_id           TYPE TEXT;
ALTER TABLE dq_run_results         ALTER COLUMN connection_id    TYPE TEXT;
ALTER TABLE dq_run_results         ALTER COLUMN rule_id          TYPE TEXT;

ALTER TABLE anomaly_log            ALTER COLUMN anomaly_id       TYPE TEXT;
ALTER TABLE anomaly_log            ALTER COLUMN connection_id    TYPE TEXT;
ALTER TABLE anomaly_log            ALTER COLUMN run_id           TYPE TEXT;

ALTER TABLE audit_trail            ALTER COLUMN event_id         TYPE TEXT;
ALTER TABLE audit_trail            ALTER COLUMN connection_id    TYPE TEXT;

ALTER TABLE profiling_reports      ALTER COLUMN report_id        TYPE TEXT;
ALTER TABLE profiling_reports      ALTER COLUMN connection_id    TYPE TEXT;
ALTER TABLE profiling_reports      ALTER COLUMN run_id           TYPE TEXT;

ALTER TABLE task_board             ALTER COLUMN task_id          TYPE TEXT;
ALTER TABLE task_board             ALTER COLUMN connection_id    TYPE TEXT;

ALTER TABLE column_stats           ALTER COLUMN stat_id          TYPE TEXT;
ALTER TABLE column_stats           ALTER COLUMN report_id        TYPE TEXT;
ALTER TABLE column_stats           ALTER COLUMN connection_id    TYPE TEXT;

ALTER TABLE profiling_risks        ALTER COLUMN risk_id          TYPE TEXT;
ALTER TABLE profiling_risks        ALTER COLUMN report_id        TYPE TEXT;
ALTER TABLE profiling_risks        ALTER COLUMN connection_id    TYPE TEXT;

ALTER TABLE cde_registry           ALTER COLUMN cde_id           TYPE TEXT;
ALTER TABLE cde_registry           ALTER COLUMN connection_id    TYPE TEXT;

ALTER TABLE dq_runs                ALTER COLUMN run_id           TYPE TEXT;
ALTER TABLE dq_runs                ALTER COLUMN connection_id    TYPE TEXT;

ALTER TABLE trust_score_history    ALTER COLUMN history_id       TYPE TEXT;
ALTER TABLE trust_score_history    ALTER COLUMN connection_id    TYPE TEXT;

ALTER TABLE rule_fail_history      ALTER COLUMN fail_id          TYPE TEXT;
ALTER TABLE rule_fail_history      ALTER COLUMN connection_id    TYPE TEXT;

ALTER TABLE lineage_nodes          ALTER COLUMN node_id          TYPE TEXT;
ALTER TABLE lineage_nodes          ALTER COLUMN connection_id    TYPE TEXT;

ALTER TABLE lineage_edges          ALTER COLUMN edge_id          TYPE TEXT;
ALTER TABLE lineage_edges          ALTER COLUMN connection_id    TYPE TEXT;
ALTER TABLE lineage_edges          ALTER COLUMN source_node_id   TYPE TEXT;
ALTER TABLE lineage_edges          ALTER COLUMN target_node_id   TYPE TEXT;

ALTER TABLE simulation_scenarios   ALTER COLUMN scenario_id      TYPE TEXT;

ALTER TABLE simulation_runs        ALTER COLUMN sim_run_id       TYPE TEXT;
ALTER TABLE simulation_runs        ALTER COLUMN connection_id    TYPE TEXT;
ALTER TABLE simulation_runs        ALTER COLUMN scenario_id      TYPE TEXT;

ALTER TABLE intel_advisories       ALTER COLUMN advisory_id      TYPE TEXT;
ALTER TABLE intel_advisories       ALTER COLUMN connection_id    TYPE TEXT;

ALTER TABLE intel_receipts         ALTER COLUMN receipt_id       TYPE TEXT;
ALTER TABLE intel_receipts         ALTER COLUMN connection_id    TYPE TEXT;

ALTER TABLE anomaly_fingerprints   ALTER COLUMN fingerprint_id   TYPE TEXT;
ALTER TABLE anomaly_fingerprints   ALTER COLUMN connection_id    TYPE TEXT;
