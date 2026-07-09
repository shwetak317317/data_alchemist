--
-- PostgreSQL database dump
--

\restrict GSL5usgRhmTAw2C9a4Wq4LF20h8CnnZuPq5WwwwmpQ55S0S0U94xT32h2e3FfcD

-- Dumped from database version 16.14
-- Dumped by pg_dump version 16.14

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: ai_usage_log; Type: TABLE; Schema: public; Owner: datatrust
--

CREATE TABLE public.ai_usage_log (
    log_id character varying(36) DEFAULT (gen_random_uuid())::character varying NOT NULL,
    connection_id character varying(36),
    feature character varying(48) NOT NULL,
    model character varying(128),
    input_tokens integer,
    output_tokens integer,
    latency_ms integer,
    status character varying(16) DEFAULT 'ai'::character varying NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.ai_usage_log OWNER TO datatrust;

--
-- Name: anomaly_fingerprints; Type: TABLE; Schema: public; Owner: datatrust
--

CREATE TABLE public.anomaly_fingerprints (
    fingerprint_id text DEFAULT (gen_random_uuid())::character varying NOT NULL,
    connection_id text,
    similarity_pct integer,
    incident_date date,
    incident_day character varying(16),
    root_cause text,
    resolution text,
    resolution_time character varying(64),
    resolved_by character varying(128),
    related_table character varying(256),
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.anomaly_fingerprints OWNER TO datatrust;

--
-- Name: anomaly_log; Type: TABLE; Schema: public; Owner: datatrust
--

CREATE TABLE public.anomaly_log (
    anomaly_id text DEFAULT (gen_random_uuid())::character varying NOT NULL,
    connection_id text,
    detected_at timestamp without time zone DEFAULT now() NOT NULL,
    layer character varying(16),
    table_fqn character varying(256),
    column_name character varying(128),
    anomaly_type character varying(32) NOT NULL,
    description text NOT NULL,
    severity character varying(16) DEFAULT 'MEDIUM'::character varying NOT NULL,
    metric_value numeric(18,4),
    baseline_value numeric(18,4),
    deviation_pct numeric(8,2),
    business_explanation text,
    status character varying(16) DEFAULT 'open'::character varying NOT NULL,
    resolved_by character varying(128),
    resolved_at timestamp without time zone,
    acknowledged_by character varying(128),
    acknowledged_at timestamp without time zone,
    ack_note text,
    run_id text,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    explanation text,
    metric_name character varying(128),
    history_values jsonb
);


ALTER TABLE public.anomaly_log OWNER TO datatrust;

--
-- Name: anomaly_thresholds; Type: TABLE; Schema: public; Owner: datatrust
--

CREATE TABLE public.anomaly_thresholds (
    connection_id text NOT NULL,
    vol_pct numeric(8,2) DEFAULT 30.0 NOT NULL,
    dist_pct numeric(8,2) DEFAULT 20.0 NOT NULL,
    freshness_hours numeric(8,2) DEFAULT 24.0 NOT NULL,
    updated_by character varying(128),
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.anomaly_thresholds OWNER TO datatrust;

--
-- Name: audit_trail; Type: TABLE; Schema: public; Owner: datatrust
--

CREATE TABLE public.audit_trail (
    event_id text DEFAULT (gen_random_uuid())::character varying NOT NULL,
    event_timestamp timestamp without time zone DEFAULT now() NOT NULL,
    user_name character varying(128) NOT NULL,
    event_type character varying(32) NOT NULL,
    entity_type character varying(32) NOT NULL,
    entity_id character varying(256) NOT NULL,
    old_value jsonb,
    new_value jsonb,
    reason text,
    connection_id text,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    entity_name character varying(256),
    user_email character varying(256),
    ip_address character varying(64),
    org_id text,
    retention_days integer DEFAULT 2555
);


ALTER TABLE public.audit_trail OWNER TO datatrust;

--
-- Name: cde_registry; Type: TABLE; Schema: public; Owner: datatrust
--

CREATE TABLE public.cde_registry (
    cde_id text DEFAULT (gen_random_uuid())::character varying NOT NULL,
    connection_id text,
    column_name character varying(128) NOT NULL,
    table_fqn character varying(256) NOT NULL,
    business_name character varying(256),
    cde_score numeric(5,2),
    health character varying(16) DEFAULT 'PASS'::character varying,
    last_validated_at timestamp with time zone,
    promoted_by character varying(128),
    promoted_at timestamp with time zone DEFAULT now() NOT NULL,
    rule_count integer DEFAULT 0,
    notes text
);


ALTER TABLE public.cde_registry OWNER TO datatrust;

--
-- Name: column_stats; Type: TABLE; Schema: public; Owner: datatrust
--

CREATE TABLE public.column_stats (
    stat_id text DEFAULT (gen_random_uuid())::character varying NOT NULL,
    report_id text NOT NULL,
    connection_id text,
    table_fqn character varying(256) NOT NULL,
    column_name character varying(128) NOT NULL,
    data_type character varying(64),
    null_pct numeric(5,2) DEFAULT 0,
    distinct_count bigint,
    min_value text,
    max_value text,
    mean_value numeric(20,6),
    std_dev numeric(20,6),
    detected_format character varying(128),
    is_cde boolean DEFAULT false NOT NULL,
    is_pii boolean DEFAULT false NOT NULL,
    pii_type character varying(64),
    quality_score numeric(5,2),
    health character varying(16) DEFAULT 'HEALTHY'::character varying,
    note text,
    sample_values jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    table_id character varying(36)
);


ALTER TABLE public.column_stats OWNER TO datatrust;

--
-- Name: connection_schemas; Type: TABLE; Schema: public; Owner: datatrust
--

CREATE TABLE public.connection_schemas (
    id character varying(36) DEFAULT (gen_random_uuid())::text NOT NULL,
    connection_id character varying(36) NOT NULL,
    schema_name character varying(256) NOT NULL,
    layer character varying(64) DEFAULT 'UNKNOWN'::character varying NOT NULL,
    discovered_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.connection_schemas OWNER TO datatrust;

--
-- Name: connection_tables; Type: TABLE; Schema: public; Owner: datatrust
--

CREATE TABLE public.connection_tables (
    id character varying(36) DEFAULT (gen_random_uuid())::text NOT NULL,
    connection_id character varying(36) NOT NULL,
    schema_id character varying(36),
    schema_name character varying(256) NOT NULL,
    table_name character varying(256) NOT NULL,
    table_fqn character varying(512) NOT NULL,
    layer character varying(64) DEFAULT 'UNKNOWN'::character varying NOT NULL,
    row_count bigint,
    discovered_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.connection_tables OWNER TO datatrust;

--
-- Name: connections; Type: TABLE; Schema: public; Owner: datatrust
--

CREATE TABLE public.connections (
    id text DEFAULT (gen_random_uuid())::character varying NOT NULL,
    name character varying(128) NOT NULL,
    platform character varying(32) NOT NULL,
    environment character varying(32) DEFAULT 'production'::character varying NOT NULL,
    config_encrypted text NOT NULL,
    status character varying(16) DEFAULT 'active'::character varying NOT NULL,
    error_message text,
    schemas_scope text[],
    last_tested_at timestamp without time zone,
    last_sync_at timestamp without time zone,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    host character varying(256),
    port integer,
    database_name character varying(128),
    auth_type character varying(128),
    is_demo boolean DEFAULT false NOT NULL,
    table_count integer DEFAULT 0,
    layer_map jsonb,
    org_id text DEFAULT 'default'::text NOT NULL,
    deleted_at timestamp with time zone,
    deleted_by text
);


ALTER TABLE public.connections OWNER TO datatrust;

--
-- Name: daily_summaries; Type: TABLE; Schema: public; Owner: datatrust
--

CREATE TABLE public.daily_summaries (
    summary_id character varying(36) DEFAULT (gen_random_uuid())::character varying NOT NULL,
    connection_id character varying(36),
    summary_date date NOT NULL,
    narrative text,
    watch_items jsonb,
    generated_by character varying(16) DEFAULT 'ai'::character varying,
    generated_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.daily_summaries OWNER TO datatrust;

--
-- Name: data_dictionary; Type: TABLE; Schema: public; Owner: datatrust
--

CREATE TABLE public.data_dictionary (
    column_id character varying(512) NOT NULL,
    connection_id text,
    table_fqn character varying(256) NOT NULL,
    schema_name character varying(128),
    table_name character varying(128),
    layer character varying(16),
    column_name character varying(128),
    business_name character varying(256),
    description text,
    data_type character varying(64),
    format_standard character varying(128),
    is_pii boolean DEFAULT false NOT NULL,
    is_cde boolean DEFAULT false NOT NULL,
    cde_score numeric(5,2),
    business_owner character varying(128),
    sensitivity_tag character varying(64),
    ai_suggested boolean DEFAULT true NOT NULL,
    status character varying(16) DEFAULT 'draft'::character varying NOT NULL,
    approved_by character varying(128),
    approved_at timestamp without time zone,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    steward_status character varying(16) DEFAULT 'pending'::character varying,
    is_internal boolean DEFAULT false NOT NULL,
    business_description text,
    updated_by text,
    table_id character varying(36)
);


ALTER TABLE public.data_dictionary OWNER TO datatrust;

--
-- Name: dq_rules; Type: TABLE; Schema: public; Owner: datatrust
--

CREATE TABLE public.dq_rules (
    rule_id text DEFAULT (gen_random_uuid())::character varying NOT NULL,
    connection_id text,
    rule_name character varying(256) NOT NULL,
    rule_description text,
    table_fqn character varying(256) NOT NULL,
    layer character varying(16),
    column_name character varying(128),
    rule_expression text NOT NULL,
    rule_type character varying(32) NOT NULL,
    severity character varying(16) DEFAULT 'MEDIUM'::character varying NOT NULL,
    is_cde_rule boolean DEFAULT false NOT NULL,
    status character varying(16) DEFAULT 'draft'::character varying NOT NULL,
    approved_by character varying(128),
    approved_at timestamp without time zone,
    snooze_until timestamp without time zone,
    created_by character varying(128),
    nl_source text,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    table_name character varying(128),
    updated_by text,
    table_id character varying(36),
    generation_source character varying(20),
    related_table_fqn character varying(256)
);


ALTER TABLE public.dq_rules OWNER TO datatrust;

--
-- Name: dq_run_results; Type: TABLE; Schema: public; Owner: datatrust
--

CREATE TABLE public.dq_run_results (
    result_id text DEFAULT (gen_random_uuid())::character varying NOT NULL,
    run_id text NOT NULL,
    run_timestamp timestamp without time zone DEFAULT now() NOT NULL,
    connection_id text,
    rule_id text,
    table_fqn character varying(256) NOT NULL,
    layer character varying(16),
    status character varying(16) NOT NULL,
    total_records bigint,
    failed_records bigint DEFAULT 0,
    fail_pct numeric(5,2) DEFAULT 0,
    quality_score numeric(5,2),
    severity character varying(16),
    sample_failed_records jsonb,
    remediation_suggestion text,
    acknowledged_by character varying(128),
    acknowledged_at timestamp without time zone,
    is_expected_failure boolean DEFAULT false,
    expected_failure_reason text,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    rule_name character varying(256)
);


ALTER TABLE public.dq_run_results OWNER TO datatrust;

--
-- Name: dq_runs; Type: TABLE; Schema: public; Owner: datatrust
--

CREATE TABLE public.dq_runs (
    run_id text DEFAULT (gen_random_uuid())::character varying NOT NULL,
    connection_id text,
    triggered_by character varying(64) DEFAULT 'MANUAL'::character varying,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    completed_at timestamp with time zone,
    status character varying(16) DEFAULT 'running'::character varying,
    total_rules integer DEFAULT 0,
    passed_rules integer DEFAULT 0,
    failed_rules integer DEFAULT 0,
    error_rules integer DEFAULT 0,
    overall_quality_score numeric(5,2),
    error_message text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    triggered_by_user text
);


ALTER TABLE public.dq_runs OWNER TO datatrust;

--
-- Name: intel_advisories; Type: TABLE; Schema: public; Owner: datatrust
--

CREATE TABLE public.intel_advisories (
    advisory_id text DEFAULT (gen_random_uuid())::character varying NOT NULL,
    connection_id text,
    predicted_score numeric(5,2),
    risk_reasons jsonb,
    recommendation text,
    pipeline_name character varying(128) DEFAULT 'main'::character varying,
    advisory_time character varying(32),
    generated_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.intel_advisories OWNER TO datatrust;

--
-- Name: intel_receipts; Type: TABLE; Schema: public; Owner: datatrust
--

CREATE TABLE public.intel_receipts (
    receipt_id text DEFAULT (gen_random_uuid())::character varying NOT NULL,
    connection_id text,
    query_text text,
    table_fqn character varying(256),
    executed_at timestamp with time zone DEFAULT now() NOT NULL,
    executed_by character varying(128),
    row_count bigint,
    trust_score numeric(5,2),
    fields jsonb,
    recommendation text,
    last_clean_snapshot date,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.intel_receipts OWNER TO datatrust;

--
-- Name: lineage_column_edges; Type: TABLE; Schema: public; Owner: datatrust
--

CREATE TABLE public.lineage_column_edges (
    id text DEFAULT (gen_random_uuid())::text NOT NULL,
    connection_id text,
    source_fqn character varying(256) NOT NULL,
    source_column character varying(128) NOT NULL,
    target_fqn character varying(256) NOT NULL,
    target_column character varying(128) NOT NULL,
    discovered_via character varying(32) DEFAULT 'query_log'::character varying NOT NULL,
    evidence text,
    created_at timestamp without time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.lineage_column_edges OWNER TO datatrust;

--
-- Name: lineage_edges; Type: TABLE; Schema: public; Owner: datatrust
--

CREATE TABLE public.lineage_edges (
    edge_id text DEFAULT (gen_random_uuid())::character varying NOT NULL,
    connection_id text,
    source_node_id text NOT NULL,
    target_node_id text NOT NULL,
    edge_type character varying(64) DEFAULT 'FEEDS'::character varying,
    discovered_via character varying(16) DEFAULT 'manual'::character varying NOT NULL,
    status character varying(16) DEFAULT 'confirmed'::character varying NOT NULL,
    confidence double precision,
    evidence text,
    discovered_at timestamp with time zone,
    reviewed_by character varying(256),
    reviewed_at timestamp with time zone
);


ALTER TABLE public.lineage_edges OWNER TO datatrust;

--
-- Name: COLUMN lineage_edges.discovered_via; Type: COMMENT; Schema: public; Owner: datatrust
--

COMMENT ON COLUMN public.lineage_edges.discovered_via IS 'manual | fk | query_log | dbt';


--
-- Name: COLUMN lineage_edges.status; Type: COMMENT; Schema: public; Owner: datatrust
--

COMMENT ON COLUMN public.lineage_edges.status IS 'confirmed | suggested | rejected — only confirmed edges appear in the main graph';


--
-- Name: COLUMN lineage_edges.confidence; Type: COMMENT; Schema: public; Owner: datatrust
--

COMMENT ON COLUMN public.lineage_edges.confidence IS 'Discovery confidence 0-1. NULL for manual/fk/dbt (deterministic, not scored).';


--
-- Name: COLUMN lineage_edges.evidence; Type: COMMENT; Schema: public; Owner: datatrust
--

COMMENT ON COLUMN public.lineage_edges.evidence IS 'Short human-readable justification: FK constraint name, matched query text excerpt, or dbt model name.';


--
-- Name: lineage_nodes; Type: TABLE; Schema: public; Owner: datatrust
--

CREATE TABLE public.lineage_nodes (
    node_id text DEFAULT (gen_random_uuid())::character varying NOT NULL,
    connection_id text,
    external_id character varying(256) NOT NULL,
    label character varying(256) NOT NULL,
    sub_label text,
    layer character varying(16),
    node_type character varying(64),
    tier_label character varying(64),
    health_status character varying(16) DEFAULT 'ok'::character varying,
    note text,
    position_order integer DEFAULT 0,
    is_source boolean DEFAULT false,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    discovered_via character varying(16) DEFAULT 'manual'::character varying NOT NULL
);


ALTER TABLE public.lineage_nodes OWNER TO datatrust;

--
-- Name: COLUMN lineage_nodes.discovered_via; Type: COMMENT; Schema: public; Owner: datatrust
--

COMMENT ON COLUMN public.lineage_nodes.discovered_via IS 'manual | seed | fk | query_log | dbt';


--
-- Name: profiling_reports; Type: TABLE; Schema: public; Owner: datatrust
--

CREATE TABLE public.profiling_reports (
    report_id text DEFAULT (gen_random_uuid())::character varying NOT NULL,
    connection_id text,
    table_fqn character varying(256) NOT NULL,
    layer character varying(16),
    run_at timestamp without time zone DEFAULT now() NOT NULL,
    row_count bigint,
    quality_score numeric(5,2),
    completeness_score numeric(5,2),
    uniqueness_score numeric(5,2),
    consistency_score numeric(5,2),
    freshness_score numeric(5,2),
    risks_flagged jsonb,
    column_stats jsonb,
    summary_text text,
    run_id text,
    schema_name character varying(128),
    table_name character varying(128),
    triggered_by text,
    table_id character varying(36),
    schema_id character varying(36)
);


ALTER TABLE public.profiling_reports OWNER TO datatrust;

--
-- Name: profiling_risks; Type: TABLE; Schema: public; Owner: datatrust
--

CREATE TABLE public.profiling_risks (
    risk_id text DEFAULT (gen_random_uuid())::character varying NOT NULL,
    report_id text NOT NULL,
    connection_id text,
    risk_code character varying(16) NOT NULL,
    severity character varying(16) NOT NULL,
    title character varying(512) NOT NULL,
    description text,
    column_name character varying(128),
    risk_type character varying(64),
    is_suppressed boolean DEFAULT false NOT NULL,
    suppressed_by character varying(128),
    suppression_reason text,
    note text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.profiling_risks OWNER TO datatrust;

--
-- Name: rule_ai_calls; Type: TABLE; Schema: public; Owner: datatrust
--

CREATE TABLE public.rule_ai_calls (
    call_id text DEFAULT (gen_random_uuid())::text NOT NULL,
    connection_id character varying(36),
    call_type character varying(32) NOT NULL,
    table_fqn character varying(256),
    model character varying(128),
    prompt text NOT NULL,
    raw_response text,
    status character varying(16) DEFAULT 'success'::character varying NOT NULL,
    error_message text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    input_tokens integer,
    output_tokens integer,
    latency_ms integer
);


ALTER TABLE public.rule_ai_calls OWNER TO datatrust;

--
-- Name: rule_fail_history; Type: TABLE; Schema: public; Owner: datatrust
--

CREATE TABLE public.rule_fail_history (
    fail_id text DEFAULT (gen_random_uuid())::character varying NOT NULL,
    connection_id text,
    fail_date date NOT NULL,
    fail_count integer DEFAULT 0,
    recorded_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.rule_fail_history OWNER TO datatrust;

--
-- Name: simulation_runs; Type: TABLE; Schema: public; Owner: datatrust
--

CREATE TABLE public.simulation_runs (
    sim_run_id text DEFAULT (gen_random_uuid())::character varying NOT NULL,
    connection_id text,
    scenario_id text,
    scenario_text text,
    status character varying(16) DEFAULT 'running'::character varying,
    events jsonb,
    inject_sql text,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    completed_at timestamp with time zone,
    triggered_by text,
    approved_by text,
    classified_as character varying(20),
    classification_method character varying(10),
    classification_conf double precision,
    classify_prompt_ver character varying(20),
    narrative_prompt_ver character varying(20),
    has_real_metrics boolean DEFAULT false
);


ALTER TABLE public.simulation_runs OWNER TO datatrust;

--
-- Name: COLUMN simulation_runs.classified_as; Type: COMMENT; Schema: public; Owner: datatrust
--

COMMENT ON COLUMN public.simulation_runs.classified_as IS 'Scenario key assigned by classifier: segment|nullcol|volume|whitelist|source|unknown';


--
-- Name: COLUMN simulation_runs.classification_method; Type: COMMENT; Schema: public; Owner: datatrust
--

COMMENT ON COLUMN public.simulation_runs.classification_method IS 'llm or regex';


--
-- Name: COLUMN simulation_runs.classification_conf; Type: COMMENT; Schema: public; Owner: datatrust
--

COMMENT ON COLUMN public.simulation_runs.classification_conf IS 'Confidence score 0–1 from ClassifyResult';


--
-- Name: COLUMN simulation_runs.classify_prompt_ver; Type: COMMENT; Schema: public; Owner: datatrust
--

COMMENT ON COLUMN public.simulation_runs.classify_prompt_ver IS 'Prompt version used for classification (e.g. classify-v1.0)';


--
-- Name: COLUMN simulation_runs.narrative_prompt_ver; Type: COMMENT; Schema: public; Owner: datatrust
--

COMMENT ON COLUMN public.simulation_runs.narrative_prompt_ver IS 'Prompt version used for narrative generation (e.g. narrative-v1.0)';


--
-- Name: COLUMN simulation_runs.has_real_metrics; Type: COMMENT; Schema: public; Owner: datatrust
--

COMMENT ON COLUMN public.simulation_runs.has_real_metrics IS 'True when the narrative was grounded in real profiling data, not static template values';


--
-- Name: simulation_scenarios; Type: TABLE; Schema: public; Owner: datatrust
--

CREATE TABLE public.simulation_scenarios (
    scenario_id text DEFAULT (gen_random_uuid())::character varying NOT NULL,
    title text NOT NULL,
    scenario_type character varying(64),
    description text,
    is_builtin boolean DEFAULT true,
    position_order integer DEFAULT 0,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    org_id text,
    created_by text
);


ALTER TABLE public.simulation_scenarios OWNER TO datatrust;

--
-- Name: task_board; Type: TABLE; Schema: public; Owner: datatrust
--

CREATE TABLE public.task_board (
    task_id text DEFAULT (gen_random_uuid())::character varying NOT NULL,
    title text NOT NULL,
    description text,
    priority character varying(16) DEFAULT 'MEDIUM'::character varying NOT NULL,
    phase character varying(32),
    owner character varying(128),
    status character varying(16) DEFAULT 'open'::character varying NOT NULL,
    related_entity_type character varying(32),
    related_entity_id character varying(256),
    due_date date,
    completed_at timestamp without time zone,
    connection_id text,
    created_by character varying(128),
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_by text
);


ALTER TABLE public.task_board OWNER TO datatrust;

--
-- Name: trust_score_history; Type: TABLE; Schema: public; Owner: datatrust
--

CREATE TABLE public.trust_score_history (
    history_id text DEFAULT (gen_random_uuid())::character varying NOT NULL,
    connection_id text,
    score_date date NOT NULL,
    overall_score numeric(5,2),
    raw_score numeric(5,2),
    bronze_score numeric(5,2),
    silver_score numeric(5,2),
    gold_score numeric(5,2),
    rules_total integer DEFAULT 0,
    rules_passed integer DEFAULT 0,
    rules_failed integer DEFAULT 0,
    anomaly_count integer DEFAULT 0,
    recorded_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.trust_score_history OWNER TO datatrust;

--
-- Name: user_connection_roles; Type: TABLE; Schema: public; Owner: datatrust
--

CREATE TABLE public.user_connection_roles (
    id text DEFAULT (gen_random_uuid())::text NOT NULL,
    user_email text NOT NULL,
    connection_id text,
    org_id text NOT NULL,
    role character varying(32) NOT NULL,
    granted_by text,
    granted_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.user_connection_roles OWNER TO datatrust;

--
-- Name: users; Type: TABLE; Schema: public; Owner: datatrust
--

CREATE TABLE public.users (
    id integer NOT NULL,
    email character varying(255) NOT NULL,
    name character varying(255) NOT NULL,
    password_hash character varying(255) NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    last_login timestamp with time zone,
    org_id text DEFAULT 'default'::text NOT NULL,
    role character varying(32) DEFAULT 'viewer'::character varying NOT NULL,
    uuid text
);


ALTER TABLE public.users OWNER TO datatrust;

--
-- Name: users_id_seq; Type: SEQUENCE; Schema: public; Owner: datatrust
--

CREATE SEQUENCE public.users_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.users_id_seq OWNER TO datatrust;

--
-- Name: users_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: datatrust
--

ALTER SEQUENCE public.users_id_seq OWNED BY public.users.id;


--
-- Name: users id; Type: DEFAULT; Schema: public; Owner: datatrust
--

ALTER TABLE ONLY public.users ALTER COLUMN id SET DEFAULT nextval('public.users_id_seq'::regclass);


--
-- Name: ai_usage_log ai_usage_log_pkey; Type: CONSTRAINT; Schema: public; Owner: datatrust
--

ALTER TABLE ONLY public.ai_usage_log
    ADD CONSTRAINT ai_usage_log_pkey PRIMARY KEY (log_id);


--
-- Name: anomaly_fingerprints anomaly_fingerprints_pkey; Type: CONSTRAINT; Schema: public; Owner: datatrust
--

ALTER TABLE ONLY public.anomaly_fingerprints
    ADD CONSTRAINT anomaly_fingerprints_pkey PRIMARY KEY (fingerprint_id);


--
-- Name: anomaly_log anomaly_log_pkey; Type: CONSTRAINT; Schema: public; Owner: datatrust
--

ALTER TABLE ONLY public.anomaly_log
    ADD CONSTRAINT anomaly_log_pkey PRIMARY KEY (anomaly_id);


--
-- Name: anomaly_thresholds anomaly_thresholds_pkey; Type: CONSTRAINT; Schema: public; Owner: datatrust
--

ALTER TABLE ONLY public.anomaly_thresholds
    ADD CONSTRAINT anomaly_thresholds_pkey PRIMARY KEY (connection_id);


--
-- Name: audit_trail audit_trail_pkey; Type: CONSTRAINT; Schema: public; Owner: datatrust
--

ALTER TABLE ONLY public.audit_trail
    ADD CONSTRAINT audit_trail_pkey PRIMARY KEY (event_id);


--
-- Name: cde_registry cde_registry_connection_id_table_fqn_column_name_key; Type: CONSTRAINT; Schema: public; Owner: datatrust
--

ALTER TABLE ONLY public.cde_registry
    ADD CONSTRAINT cde_registry_connection_id_table_fqn_column_name_key UNIQUE (connection_id, table_fqn, column_name);


--
-- Name: cde_registry cde_registry_pkey; Type: CONSTRAINT; Schema: public; Owner: datatrust
--

ALTER TABLE ONLY public.cde_registry
    ADD CONSTRAINT cde_registry_pkey PRIMARY KEY (cde_id);


--
-- Name: column_stats column_stats_pkey; Type: CONSTRAINT; Schema: public; Owner: datatrust
--

ALTER TABLE ONLY public.column_stats
    ADD CONSTRAINT column_stats_pkey PRIMARY KEY (stat_id);


--
-- Name: connection_schemas connection_schemas_connection_id_schema_name_key; Type: CONSTRAINT; Schema: public; Owner: datatrust
--

ALTER TABLE ONLY public.connection_schemas
    ADD CONSTRAINT connection_schemas_connection_id_schema_name_key UNIQUE (connection_id, schema_name);


--
-- Name: connection_schemas connection_schemas_pkey; Type: CONSTRAINT; Schema: public; Owner: datatrust
--

ALTER TABLE ONLY public.connection_schemas
    ADD CONSTRAINT connection_schemas_pkey PRIMARY KEY (id);


--
-- Name: connection_tables connection_tables_connection_id_table_fqn_key; Type: CONSTRAINT; Schema: public; Owner: datatrust
--

ALTER TABLE ONLY public.connection_tables
    ADD CONSTRAINT connection_tables_connection_id_table_fqn_key UNIQUE (connection_id, table_fqn);


--
-- Name: connection_tables connection_tables_pkey; Type: CONSTRAINT; Schema: public; Owner: datatrust
--

ALTER TABLE ONLY public.connection_tables
    ADD CONSTRAINT connection_tables_pkey PRIMARY KEY (id);


--
-- Name: connections connections_pkey; Type: CONSTRAINT; Schema: public; Owner: datatrust
--

ALTER TABLE ONLY public.connections
    ADD CONSTRAINT connections_pkey PRIMARY KEY (id);


--
-- Name: daily_summaries daily_summaries_connection_id_summary_date_key; Type: CONSTRAINT; Schema: public; Owner: datatrust
--

ALTER TABLE ONLY public.daily_summaries
    ADD CONSTRAINT daily_summaries_connection_id_summary_date_key UNIQUE (connection_id, summary_date);


--
-- Name: daily_summaries daily_summaries_pkey; Type: CONSTRAINT; Schema: public; Owner: datatrust
--

ALTER TABLE ONLY public.daily_summaries
    ADD CONSTRAINT daily_summaries_pkey PRIMARY KEY (summary_id);


--
-- Name: data_dictionary data_dictionary_pkey; Type: CONSTRAINT; Schema: public; Owner: datatrust
--

ALTER TABLE ONLY public.data_dictionary
    ADD CONSTRAINT data_dictionary_pkey PRIMARY KEY (column_id);


--
-- Name: dq_rules dq_rules_pkey; Type: CONSTRAINT; Schema: public; Owner: datatrust
--

ALTER TABLE ONLY public.dq_rules
    ADD CONSTRAINT dq_rules_pkey PRIMARY KEY (rule_id);


--
-- Name: dq_run_results dq_run_results_pkey; Type: CONSTRAINT; Schema: public; Owner: datatrust
--

ALTER TABLE ONLY public.dq_run_results
    ADD CONSTRAINT dq_run_results_pkey PRIMARY KEY (result_id);


--
-- Name: dq_runs dq_runs_pkey; Type: CONSTRAINT; Schema: public; Owner: datatrust
--

ALTER TABLE ONLY public.dq_runs
    ADD CONSTRAINT dq_runs_pkey PRIMARY KEY (run_id);


--
-- Name: intel_advisories intel_advisories_pkey; Type: CONSTRAINT; Schema: public; Owner: datatrust
--

ALTER TABLE ONLY public.intel_advisories
    ADD CONSTRAINT intel_advisories_pkey PRIMARY KEY (advisory_id);


--
-- Name: intel_receipts intel_receipts_pkey; Type: CONSTRAINT; Schema: public; Owner: datatrust
--

ALTER TABLE ONLY public.intel_receipts
    ADD CONSTRAINT intel_receipts_pkey PRIMARY KEY (receipt_id);


--
-- Name: lineage_column_edges lineage_column_edges_connection_id_source_fqn_source_column_key; Type: CONSTRAINT; Schema: public; Owner: datatrust
--

ALTER TABLE ONLY public.lineage_column_edges
    ADD CONSTRAINT lineage_column_edges_connection_id_source_fqn_source_column_key UNIQUE (connection_id, source_fqn, source_column, target_fqn, target_column);


--
-- Name: lineage_column_edges lineage_column_edges_pkey; Type: CONSTRAINT; Schema: public; Owner: datatrust
--

ALTER TABLE ONLY public.lineage_column_edges
    ADD CONSTRAINT lineage_column_edges_pkey PRIMARY KEY (id);


--
-- Name: lineage_edges lineage_edges_connection_id_source_node_id_target_node_id_key; Type: CONSTRAINT; Schema: public; Owner: datatrust
--

ALTER TABLE ONLY public.lineage_edges
    ADD CONSTRAINT lineage_edges_connection_id_source_node_id_target_node_id_key UNIQUE (connection_id, source_node_id, target_node_id);


--
-- Name: lineage_edges lineage_edges_pkey; Type: CONSTRAINT; Schema: public; Owner: datatrust
--

ALTER TABLE ONLY public.lineage_edges
    ADD CONSTRAINT lineage_edges_pkey PRIMARY KEY (edge_id);


--
-- Name: lineage_nodes lineage_nodes_connection_id_external_id_key; Type: CONSTRAINT; Schema: public; Owner: datatrust
--

ALTER TABLE ONLY public.lineage_nodes
    ADD CONSTRAINT lineage_nodes_connection_id_external_id_key UNIQUE (connection_id, external_id);


--
-- Name: lineage_nodes lineage_nodes_pkey; Type: CONSTRAINT; Schema: public; Owner: datatrust
--

ALTER TABLE ONLY public.lineage_nodes
    ADD CONSTRAINT lineage_nodes_pkey PRIMARY KEY (node_id);


--
-- Name: profiling_reports profiling_reports_pkey; Type: CONSTRAINT; Schema: public; Owner: datatrust
--

ALTER TABLE ONLY public.profiling_reports
    ADD CONSTRAINT profiling_reports_pkey PRIMARY KEY (report_id);


--
-- Name: profiling_risks profiling_risks_pkey; Type: CONSTRAINT; Schema: public; Owner: datatrust
--

ALTER TABLE ONLY public.profiling_risks
    ADD CONSTRAINT profiling_risks_pkey PRIMARY KEY (risk_id);


--
-- Name: rule_ai_calls rule_ai_calls_pkey; Type: CONSTRAINT; Schema: public; Owner: datatrust
--

ALTER TABLE ONLY public.rule_ai_calls
    ADD CONSTRAINT rule_ai_calls_pkey PRIMARY KEY (call_id);


--
-- Name: rule_fail_history rule_fail_history_connection_id_fail_date_key; Type: CONSTRAINT; Schema: public; Owner: datatrust
--

ALTER TABLE ONLY public.rule_fail_history
    ADD CONSTRAINT rule_fail_history_connection_id_fail_date_key UNIQUE (connection_id, fail_date);


--
-- Name: rule_fail_history rule_fail_history_pkey; Type: CONSTRAINT; Schema: public; Owner: datatrust
--

ALTER TABLE ONLY public.rule_fail_history
    ADD CONSTRAINT rule_fail_history_pkey PRIMARY KEY (fail_id);


--
-- Name: simulation_runs simulation_runs_pkey; Type: CONSTRAINT; Schema: public; Owner: datatrust
--

ALTER TABLE ONLY public.simulation_runs
    ADD CONSTRAINT simulation_runs_pkey PRIMARY KEY (sim_run_id);


--
-- Name: simulation_scenarios simulation_scenarios_pkey; Type: CONSTRAINT; Schema: public; Owner: datatrust
--

ALTER TABLE ONLY public.simulation_scenarios
    ADD CONSTRAINT simulation_scenarios_pkey PRIMARY KEY (scenario_id);


--
-- Name: task_board task_board_pkey; Type: CONSTRAINT; Schema: public; Owner: datatrust
--

ALTER TABLE ONLY public.task_board
    ADD CONSTRAINT task_board_pkey PRIMARY KEY (task_id);


--
-- Name: trust_score_history trust_score_history_connection_id_score_date_key; Type: CONSTRAINT; Schema: public; Owner: datatrust
--

ALTER TABLE ONLY public.trust_score_history
    ADD CONSTRAINT trust_score_history_connection_id_score_date_key UNIQUE (connection_id, score_date);


--
-- Name: trust_score_history trust_score_history_pkey; Type: CONSTRAINT; Schema: public; Owner: datatrust
--

ALTER TABLE ONLY public.trust_score_history
    ADD CONSTRAINT trust_score_history_pkey PRIMARY KEY (history_id);


--
-- Name: user_connection_roles user_connection_roles_pkey; Type: CONSTRAINT; Schema: public; Owner: datatrust
--

ALTER TABLE ONLY public.user_connection_roles
    ADD CONSTRAINT user_connection_roles_pkey PRIMARY KEY (id);


--
-- Name: user_connection_roles user_connection_roles_user_email_connection_id_key; Type: CONSTRAINT; Schema: public; Owner: datatrust
--

ALTER TABLE ONLY public.user_connection_roles
    ADD CONSTRAINT user_connection_roles_user_email_connection_id_key UNIQUE (user_email, connection_id);


--
-- Name: users users_email_key; Type: CONSTRAINT; Schema: public; Owner: datatrust
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_email_key UNIQUE (email);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: datatrust
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- Name: idx_ai_usage_conn; Type: INDEX; Schema: public; Owner: datatrust
--

CREATE INDEX idx_ai_usage_conn ON public.ai_usage_log USING btree (connection_id);


--
-- Name: idx_ai_usage_created; Type: INDEX; Schema: public; Owner: datatrust
--

CREATE INDEX idx_ai_usage_created ON public.ai_usage_log USING btree (created_at DESC);


--
-- Name: idx_ai_usage_feature; Type: INDEX; Schema: public; Owner: datatrust
--

CREATE INDEX idx_ai_usage_feature ON public.ai_usage_log USING btree (feature);


--
-- Name: idx_anomaly_conn_status; Type: INDEX; Schema: public; Owner: datatrust
--

CREATE INDEX idx_anomaly_conn_status ON public.anomaly_log USING btree (connection_id, status);


--
-- Name: idx_anomaly_conn_table; Type: INDEX; Schema: public; Owner: datatrust
--

CREATE INDEX idx_anomaly_conn_table ON public.anomaly_log USING btree (connection_id, table_fqn) WHERE (table_fqn IS NOT NULL);


--
-- Name: idx_anomaly_detected; Type: INDEX; Schema: public; Owner: datatrust
--

CREATE INDEX idx_anomaly_detected ON public.anomaly_log USING btree (detected_at DESC);


--
-- Name: idx_anomaly_severity; Type: INDEX; Schema: public; Owner: datatrust
--

CREATE INDEX idx_anomaly_severity ON public.anomaly_log USING btree (severity);


--
-- Name: idx_anomaly_status; Type: INDEX; Schema: public; Owner: datatrust
--

CREATE INDEX idx_anomaly_status ON public.anomaly_log USING btree (status);


--
-- Name: idx_anomaly_table; Type: INDEX; Schema: public; Owner: datatrust
--

CREATE INDEX idx_anomaly_table ON public.anomaly_log USING btree (table_fqn);


--
-- Name: idx_audit_entity; Type: INDEX; Schema: public; Owner: datatrust
--

CREATE INDEX idx_audit_entity ON public.audit_trail USING btree (entity_type, entity_id);


--
-- Name: idx_audit_org_ts; Type: INDEX; Schema: public; Owner: datatrust
--

CREATE INDEX idx_audit_org_ts ON public.audit_trail USING btree (org_id, event_timestamp DESC);


--
-- Name: idx_audit_trail_org_ts; Type: INDEX; Schema: public; Owner: datatrust
--

CREATE INDEX idx_audit_trail_org_ts ON public.audit_trail USING btree (org_id, event_timestamp DESC);


--
-- Name: idx_audit_ts; Type: INDEX; Schema: public; Owner: datatrust
--

CREATE INDEX idx_audit_ts ON public.audit_trail USING btree (event_timestamp DESC);


--
-- Name: idx_audit_user; Type: INDEX; Schema: public; Owner: datatrust
--

CREATE INDEX idx_audit_user ON public.audit_trail USING btree (user_name);


--
-- Name: idx_cde_registry_connection; Type: INDEX; Schema: public; Owner: datatrust
--

CREATE INDEX idx_cde_registry_connection ON public.cde_registry USING btree (connection_id);


--
-- Name: idx_cde_registry_health; Type: INDEX; Schema: public; Owner: datatrust
--

CREATE INDEX idx_cde_registry_health ON public.cde_registry USING btree (health);


--
-- Name: idx_cde_registry_table; Type: INDEX; Schema: public; Owner: datatrust
--

CREATE INDEX idx_cde_registry_table ON public.cde_registry USING btree (table_fqn);


--
-- Name: idx_col_stats_cde; Type: INDEX; Schema: public; Owner: datatrust
--

CREATE INDEX idx_col_stats_cde ON public.column_stats USING btree (is_cde) WHERE (is_cde = true);


--
-- Name: idx_col_stats_connection; Type: INDEX; Schema: public; Owner: datatrust
--

CREATE INDEX idx_col_stats_connection ON public.column_stats USING btree (connection_id);


--
-- Name: idx_col_stats_report; Type: INDEX; Schema: public; Owner: datatrust
--

CREATE INDEX idx_col_stats_report ON public.column_stats USING btree (report_id);


--
-- Name: idx_col_stats_table; Type: INDEX; Schema: public; Owner: datatrust
--

CREATE INDEX idx_col_stats_table ON public.column_stats USING btree (table_fqn);


--
-- Name: idx_column_stats_table_id; Type: INDEX; Schema: public; Owner: datatrust
--

CREATE INDEX idx_column_stats_table_id ON public.column_stats USING btree (table_id) WHERE (table_id IS NOT NULL);


--
-- Name: idx_conn_schemas_conn; Type: INDEX; Schema: public; Owner: datatrust
--

CREATE INDEX idx_conn_schemas_conn ON public.connection_schemas USING btree (connection_id);


--
-- Name: idx_conn_tables_conn; Type: INDEX; Schema: public; Owner: datatrust
--

CREATE INDEX idx_conn_tables_conn ON public.connection_tables USING btree (connection_id);


--
-- Name: idx_conn_tables_fqn; Type: INDEX; Schema: public; Owner: datatrust
--

CREATE INDEX idx_conn_tables_fqn ON public.connection_tables USING btree (connection_id, table_fqn);


--
-- Name: idx_connections_org; Type: INDEX; Schema: public; Owner: datatrust
--

CREATE INDEX idx_connections_org ON public.connections USING btree (org_id);


--
-- Name: idx_connections_platform; Type: INDEX; Schema: public; Owner: datatrust
--

CREATE INDEX idx_connections_platform ON public.connections USING btree (platform);


--
-- Name: idx_connections_status; Type: INDEX; Schema: public; Owner: datatrust
--

CREATE INDEX idx_connections_status ON public.connections USING btree (status);


--
-- Name: idx_daily_summaries_conn_date; Type: INDEX; Schema: public; Owner: datatrust
--

CREATE INDEX idx_daily_summaries_conn_date ON public.daily_summaries USING btree (connection_id, summary_date DESC);


--
-- Name: idx_data_dict_conn_table; Type: INDEX; Schema: public; Owner: datatrust
--

CREATE INDEX idx_data_dict_conn_table ON public.data_dictionary USING btree (connection_id, table_fqn);


--
-- Name: idx_data_dict_table_id; Type: INDEX; Schema: public; Owner: datatrust
--

CREATE INDEX idx_data_dict_table_id ON public.data_dictionary USING btree (table_id) WHERE (table_id IS NOT NULL);


--
-- Name: idx_dict_connection; Type: INDEX; Schema: public; Owner: datatrust
--

CREATE INDEX idx_dict_connection ON public.data_dictionary USING btree (connection_id);


--
-- Name: idx_dict_is_cde; Type: INDEX; Schema: public; Owner: datatrust
--

CREATE INDEX idx_dict_is_cde ON public.data_dictionary USING btree (is_cde);


--
-- Name: idx_dict_table_fqn; Type: INDEX; Schema: public; Owner: datatrust
--

CREATE INDEX idx_dict_table_fqn ON public.data_dictionary USING btree (table_fqn);


--
-- Name: idx_dq_rules_conn_status; Type: INDEX; Schema: public; Owner: datatrust
--

CREATE INDEX idx_dq_rules_conn_status ON public.dq_rules USING btree (connection_id, status);


--
-- Name: idx_dq_rules_conn_table; Type: INDEX; Schema: public; Owner: datatrust
--

CREATE INDEX idx_dq_rules_conn_table ON public.dq_rules USING btree (connection_id, table_fqn);


--
-- Name: idx_dq_rules_no_dup; Type: INDEX; Schema: public; Owner: datatrust
--

CREATE UNIQUE INDEX idx_dq_rules_no_dup ON public.dq_rules USING btree (connection_id, table_fqn, rule_name);


--
-- Name: idx_dq_rules_table_id; Type: INDEX; Schema: public; Owner: datatrust
--

CREATE INDEX idx_dq_rules_table_id ON public.dq_rules USING btree (table_id) WHERE (table_id IS NOT NULL);


--
-- Name: idx_dq_runs_conn_started; Type: INDEX; Schema: public; Owner: datatrust
--

CREATE INDEX idx_dq_runs_conn_started ON public.dq_runs USING btree (connection_id, started_at DESC);


--
-- Name: idx_dq_runs_connection; Type: INDEX; Schema: public; Owner: datatrust
--

CREATE INDEX idx_dq_runs_connection ON public.dq_runs USING btree (connection_id);


--
-- Name: idx_dq_runs_started; Type: INDEX; Schema: public; Owner: datatrust
--

CREATE INDEX idx_dq_runs_started ON public.dq_runs USING btree (started_at DESC);


--
-- Name: idx_dq_runs_status; Type: INDEX; Schema: public; Owner: datatrust
--

CREATE INDEX idx_dq_runs_status ON public.dq_runs USING btree (status);


--
-- Name: idx_fingerprints_connection; Type: INDEX; Schema: public; Owner: datatrust
--

CREATE INDEX idx_fingerprints_connection ON public.anomaly_fingerprints USING btree (connection_id);


--
-- Name: idx_intel_advisories_connection; Type: INDEX; Schema: public; Owner: datatrust
--

CREATE INDEX idx_intel_advisories_connection ON public.intel_advisories USING btree (connection_id);


--
-- Name: idx_intel_advisories_generated; Type: INDEX; Schema: public; Owner: datatrust
--

CREATE INDEX idx_intel_advisories_generated ON public.intel_advisories USING btree (generated_at DESC);


--
-- Name: idx_intel_receipts_connection; Type: INDEX; Schema: public; Owner: datatrust
--

CREATE INDEX idx_intel_receipts_connection ON public.intel_receipts USING btree (connection_id);


--
-- Name: idx_intel_receipts_executed; Type: INDEX; Schema: public; Owner: datatrust
--

CREATE INDEX idx_intel_receipts_executed ON public.intel_receipts USING btree (executed_at DESC);


--
-- Name: idx_intel_receipts_table; Type: INDEX; Schema: public; Owner: datatrust
--

CREATE INDEX idx_intel_receipts_table ON public.intel_receipts USING btree (table_fqn);


--
-- Name: idx_lce_source; Type: INDEX; Schema: public; Owner: datatrust
--

CREATE INDEX idx_lce_source ON public.lineage_column_edges USING btree (connection_id, source_fqn);


--
-- Name: idx_lce_target; Type: INDEX; Schema: public; Owner: datatrust
--

CREATE INDEX idx_lce_target ON public.lineage_column_edges USING btree (connection_id, target_fqn);


--
-- Name: idx_lineage_edges_connection; Type: INDEX; Schema: public; Owner: datatrust
--

CREATE INDEX idx_lineage_edges_connection ON public.lineage_edges USING btree (connection_id);


--
-- Name: idx_lineage_edges_source; Type: INDEX; Schema: public; Owner: datatrust
--

CREATE INDEX idx_lineage_edges_source ON public.lineage_edges USING btree (source_node_id);


--
-- Name: idx_lineage_edges_status; Type: INDEX; Schema: public; Owner: datatrust
--

CREATE INDEX idx_lineage_edges_status ON public.lineage_edges USING btree (connection_id, status);


--
-- Name: idx_lineage_edges_target; Type: INDEX; Schema: public; Owner: datatrust
--

CREATE INDEX idx_lineage_edges_target ON public.lineage_edges USING btree (target_node_id);


--
-- Name: idx_lineage_nodes_connection; Type: INDEX; Schema: public; Owner: datatrust
--

CREATE INDEX idx_lineage_nodes_connection ON public.lineage_nodes USING btree (connection_id);


--
-- Name: idx_lineage_nodes_layer; Type: INDEX; Schema: public; Owner: datatrust
--

CREATE INDEX idx_lineage_nodes_layer ON public.lineage_nodes USING btree (layer);


--
-- Name: idx_prof_risks_connection; Type: INDEX; Schema: public; Owner: datatrust
--

CREATE INDEX idx_prof_risks_connection ON public.profiling_risks USING btree (connection_id);


--
-- Name: idx_prof_risks_report; Type: INDEX; Schema: public; Owner: datatrust
--

CREATE INDEX idx_prof_risks_report ON public.profiling_risks USING btree (report_id);


--
-- Name: idx_prof_risks_severity; Type: INDEX; Schema: public; Owner: datatrust
--

CREATE INDEX idx_prof_risks_severity ON public.profiling_risks USING btree (severity);


--
-- Name: idx_profiling_conn_table; Type: INDEX; Schema: public; Owner: datatrust
--

CREATE INDEX idx_profiling_conn_table ON public.profiling_reports USING btree (connection_id, table_fqn);


--
-- Name: idx_profiling_run_at; Type: INDEX; Schema: public; Owner: datatrust
--

CREATE INDEX idx_profiling_run_at ON public.profiling_reports USING btree (run_at DESC);


--
-- Name: idx_profiling_table; Type: INDEX; Schema: public; Owner: datatrust
--

CREATE INDEX idx_profiling_table ON public.profiling_reports USING btree (table_fqn);


--
-- Name: idx_profiling_table_id; Type: INDEX; Schema: public; Owner: datatrust
--

CREATE INDEX idx_profiling_table_id ON public.profiling_reports USING btree (table_id) WHERE (table_id IS NOT NULL);


--
-- Name: idx_rule_ai_calls_conn; Type: INDEX; Schema: public; Owner: datatrust
--

CREATE INDEX idx_rule_ai_calls_conn ON public.rule_ai_calls USING btree (connection_id);


--
-- Name: idx_rule_ai_calls_created; Type: INDEX; Schema: public; Owner: datatrust
--

CREATE INDEX idx_rule_ai_calls_created ON public.rule_ai_calls USING btree (created_at DESC);


--
-- Name: idx_rule_fail_connection; Type: INDEX; Schema: public; Owner: datatrust
--

CREATE INDEX idx_rule_fail_connection ON public.rule_fail_history USING btree (connection_id);


--
-- Name: idx_rule_fail_date; Type: INDEX; Schema: public; Owner: datatrust
--

CREATE INDEX idx_rule_fail_date ON public.rule_fail_history USING btree (fail_date DESC);


--
-- Name: idx_rules_severity; Type: INDEX; Schema: public; Owner: datatrust
--

CREATE INDEX idx_rules_severity ON public.dq_rules USING btree (severity);


--
-- Name: idx_rules_status; Type: INDEX; Schema: public; Owner: datatrust
--

CREATE INDEX idx_rules_status ON public.dq_rules USING btree (status);


--
-- Name: idx_rules_table_fqn; Type: INDEX; Schema: public; Owner: datatrust
--

CREATE INDEX idx_rules_table_fqn ON public.dq_rules USING btree (table_fqn);


--
-- Name: idx_run_results_conn_ts; Type: INDEX; Schema: public; Owner: datatrust
--

CREATE INDEX idx_run_results_conn_ts ON public.dq_run_results USING btree (connection_id, run_timestamp DESC);


--
-- Name: idx_run_results_run_id; Type: INDEX; Schema: public; Owner: datatrust
--

CREATE INDEX idx_run_results_run_id ON public.dq_run_results USING btree (run_id);


--
-- Name: idx_run_results_status; Type: INDEX; Schema: public; Owner: datatrust
--

CREATE INDEX idx_run_results_status ON public.dq_run_results USING btree (status);


--
-- Name: idx_run_results_table; Type: INDEX; Schema: public; Owner: datatrust
--

CREATE INDEX idx_run_results_table ON public.dq_run_results USING btree (table_fqn);


--
-- Name: idx_run_results_ts; Type: INDEX; Schema: public; Owner: datatrust
--

CREATE INDEX idx_run_results_ts ON public.dq_run_results USING btree (run_timestamp DESC);


--
-- Name: idx_sim_runs_connection; Type: INDEX; Schema: public; Owner: datatrust
--

CREATE INDEX idx_sim_runs_connection ON public.simulation_runs USING btree (connection_id);


--
-- Name: idx_sim_runs_started; Type: INDEX; Schema: public; Owner: datatrust
--

CREATE INDEX idx_sim_runs_started ON public.simulation_runs USING btree (started_at DESC);


--
-- Name: idx_sim_scenarios_type; Type: INDEX; Schema: public; Owner: datatrust
--

CREATE INDEX idx_sim_scenarios_type ON public.simulation_scenarios USING btree (scenario_type);


--
-- Name: idx_task_owner; Type: INDEX; Schema: public; Owner: datatrust
--

CREATE INDEX idx_task_owner ON public.task_board USING btree (owner);


--
-- Name: idx_task_priority; Type: INDEX; Schema: public; Owner: datatrust
--

CREATE INDEX idx_task_priority ON public.task_board USING btree (priority);


--
-- Name: idx_task_status; Type: INDEX; Schema: public; Owner: datatrust
--

CREATE INDEX idx_task_status ON public.task_board USING btree (status);


--
-- Name: idx_tasks_conn_status; Type: INDEX; Schema: public; Owner: datatrust
--

CREATE INDEX idx_tasks_conn_status ON public.task_board USING btree (connection_id, status);


--
-- Name: idx_trust_history_connection; Type: INDEX; Schema: public; Owner: datatrust
--

CREATE INDEX idx_trust_history_connection ON public.trust_score_history USING btree (connection_id);


--
-- Name: idx_trust_history_date; Type: INDEX; Schema: public; Owner: datatrust
--

CREATE INDEX idx_trust_history_date ON public.trust_score_history USING btree (score_date DESC);


--
-- Name: idx_ucr_conn; Type: INDEX; Schema: public; Owner: datatrust
--

CREATE INDEX idx_ucr_conn ON public.user_connection_roles USING btree (connection_id);


--
-- Name: idx_ucr_email; Type: INDEX; Schema: public; Owner: datatrust
--

CREATE INDEX idx_ucr_email ON public.user_connection_roles USING btree (user_email);


--
-- Name: idx_ucr_org; Type: INDEX; Schema: public; Owner: datatrust
--

CREATE INDEX idx_ucr_org ON public.user_connection_roles USING btree (org_id);


--
-- Name: idx_users_email; Type: INDEX; Schema: public; Owner: datatrust
--

CREATE INDEX idx_users_email ON public.users USING btree (email);


--
-- Name: idx_users_org_id; Type: INDEX; Schema: public; Owner: datatrust
--

CREATE INDEX idx_users_org_id ON public.users USING btree (org_id);


--
-- Name: ai_usage_log ai_usage_log_connection_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: datatrust
--

ALTER TABLE ONLY public.ai_usage_log
    ADD CONSTRAINT ai_usage_log_connection_id_fkey FOREIGN KEY (connection_id) REFERENCES public.connections(id) ON DELETE CASCADE;


--
-- Name: anomaly_fingerprints anomaly_fingerprints_connection_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: datatrust
--

ALTER TABLE ONLY public.anomaly_fingerprints
    ADD CONSTRAINT anomaly_fingerprints_connection_id_fkey FOREIGN KEY (connection_id) REFERENCES public.connections(id) ON DELETE CASCADE;


--
-- Name: anomaly_log anomaly_log_connection_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: datatrust
--

ALTER TABLE ONLY public.anomaly_log
    ADD CONSTRAINT anomaly_log_connection_id_fkey FOREIGN KEY (connection_id) REFERENCES public.connections(id) ON DELETE CASCADE;


--
-- Name: anomaly_thresholds anomaly_thresholds_connection_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: datatrust
--

ALTER TABLE ONLY public.anomaly_thresholds
    ADD CONSTRAINT anomaly_thresholds_connection_id_fkey FOREIGN KEY (connection_id) REFERENCES public.connections(id) ON DELETE CASCADE;


--
-- Name: audit_trail audit_trail_connection_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: datatrust
--

ALTER TABLE ONLY public.audit_trail
    ADD CONSTRAINT audit_trail_connection_id_fkey FOREIGN KEY (connection_id) REFERENCES public.connections(id) ON DELETE CASCADE;


--
-- Name: cde_registry cde_registry_connection_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: datatrust
--

ALTER TABLE ONLY public.cde_registry
    ADD CONSTRAINT cde_registry_connection_id_fkey FOREIGN KEY (connection_id) REFERENCES public.connections(id) ON DELETE CASCADE;


--
-- Name: column_stats column_stats_connection_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: datatrust
--

ALTER TABLE ONLY public.column_stats
    ADD CONSTRAINT column_stats_connection_id_fkey FOREIGN KEY (connection_id) REFERENCES public.connections(id) ON DELETE CASCADE;


--
-- Name: column_stats column_stats_report_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: datatrust
--

ALTER TABLE ONLY public.column_stats
    ADD CONSTRAINT column_stats_report_id_fkey FOREIGN KEY (report_id) REFERENCES public.profiling_reports(report_id) ON DELETE CASCADE;


--
-- Name: column_stats column_stats_table_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: datatrust
--

ALTER TABLE ONLY public.column_stats
    ADD CONSTRAINT column_stats_table_id_fkey FOREIGN KEY (table_id) REFERENCES public.connection_tables(id) ON DELETE SET NULL;


--
-- Name: connection_schemas connection_schemas_connection_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: datatrust
--

ALTER TABLE ONLY public.connection_schemas
    ADD CONSTRAINT connection_schemas_connection_id_fkey FOREIGN KEY (connection_id) REFERENCES public.connections(id) ON DELETE CASCADE;


--
-- Name: connection_tables connection_tables_connection_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: datatrust
--

ALTER TABLE ONLY public.connection_tables
    ADD CONSTRAINT connection_tables_connection_id_fkey FOREIGN KEY (connection_id) REFERENCES public.connections(id) ON DELETE CASCADE;


--
-- Name: connection_tables connection_tables_schema_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: datatrust
--

ALTER TABLE ONLY public.connection_tables
    ADD CONSTRAINT connection_tables_schema_id_fkey FOREIGN KEY (schema_id) REFERENCES public.connection_schemas(id) ON DELETE CASCADE;


--
-- Name: daily_summaries daily_summaries_connection_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: datatrust
--

ALTER TABLE ONLY public.daily_summaries
    ADD CONSTRAINT daily_summaries_connection_id_fkey FOREIGN KEY (connection_id) REFERENCES public.connections(id) ON DELETE CASCADE;


--
-- Name: data_dictionary data_dictionary_connection_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: datatrust
--

ALTER TABLE ONLY public.data_dictionary
    ADD CONSTRAINT data_dictionary_connection_id_fkey FOREIGN KEY (connection_id) REFERENCES public.connections(id) ON DELETE CASCADE;


--
-- Name: data_dictionary data_dictionary_table_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: datatrust
--

ALTER TABLE ONLY public.data_dictionary
    ADD CONSTRAINT data_dictionary_table_id_fkey FOREIGN KEY (table_id) REFERENCES public.connection_tables(id) ON DELETE SET NULL;


--
-- Name: dq_rules dq_rules_connection_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: datatrust
--

ALTER TABLE ONLY public.dq_rules
    ADD CONSTRAINT dq_rules_connection_id_fkey FOREIGN KEY (connection_id) REFERENCES public.connections(id) ON DELETE CASCADE;


--
-- Name: dq_rules dq_rules_table_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: datatrust
--

ALTER TABLE ONLY public.dq_rules
    ADD CONSTRAINT dq_rules_table_id_fkey FOREIGN KEY (table_id) REFERENCES public.connection_tables(id) ON DELETE SET NULL;


--
-- Name: dq_run_results dq_run_results_connection_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: datatrust
--

ALTER TABLE ONLY public.dq_run_results
    ADD CONSTRAINT dq_run_results_connection_id_fkey FOREIGN KEY (connection_id) REFERENCES public.connections(id) ON DELETE CASCADE;


--
-- Name: dq_run_results dq_run_results_rule_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: datatrust
--

ALTER TABLE ONLY public.dq_run_results
    ADD CONSTRAINT dq_run_results_rule_id_fkey FOREIGN KEY (rule_id) REFERENCES public.dq_rules(rule_id) ON DELETE SET NULL;


--
-- Name: dq_runs dq_runs_connection_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: datatrust
--

ALTER TABLE ONLY public.dq_runs
    ADD CONSTRAINT dq_runs_connection_id_fkey FOREIGN KEY (connection_id) REFERENCES public.connections(id) ON DELETE CASCADE;


--
-- Name: intel_advisories intel_advisories_connection_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: datatrust
--

ALTER TABLE ONLY public.intel_advisories
    ADD CONSTRAINT intel_advisories_connection_id_fkey FOREIGN KEY (connection_id) REFERENCES public.connections(id) ON DELETE CASCADE;


--
-- Name: intel_receipts intel_receipts_connection_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: datatrust
--

ALTER TABLE ONLY public.intel_receipts
    ADD CONSTRAINT intel_receipts_connection_id_fkey FOREIGN KEY (connection_id) REFERENCES public.connections(id) ON DELETE CASCADE;


--
-- Name: lineage_column_edges lineage_column_edges_connection_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: datatrust
--

ALTER TABLE ONLY public.lineage_column_edges
    ADD CONSTRAINT lineage_column_edges_connection_id_fkey FOREIGN KEY (connection_id) REFERENCES public.connections(id) ON DELETE CASCADE;


--
-- Name: lineage_edges lineage_edges_connection_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: datatrust
--

ALTER TABLE ONLY public.lineage_edges
    ADD CONSTRAINT lineage_edges_connection_id_fkey FOREIGN KEY (connection_id) REFERENCES public.connections(id) ON DELETE CASCADE;


--
-- Name: lineage_edges lineage_edges_source_node_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: datatrust
--

ALTER TABLE ONLY public.lineage_edges
    ADD CONSTRAINT lineage_edges_source_node_id_fkey FOREIGN KEY (source_node_id) REFERENCES public.lineage_nodes(node_id) ON DELETE CASCADE;


--
-- Name: lineage_edges lineage_edges_target_node_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: datatrust
--

ALTER TABLE ONLY public.lineage_edges
    ADD CONSTRAINT lineage_edges_target_node_id_fkey FOREIGN KEY (target_node_id) REFERENCES public.lineage_nodes(node_id) ON DELETE CASCADE;


--
-- Name: lineage_nodes lineage_nodes_connection_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: datatrust
--

ALTER TABLE ONLY public.lineage_nodes
    ADD CONSTRAINT lineage_nodes_connection_id_fkey FOREIGN KEY (connection_id) REFERENCES public.connections(id) ON DELETE CASCADE;


--
-- Name: profiling_reports profiling_reports_connection_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: datatrust
--

ALTER TABLE ONLY public.profiling_reports
    ADD CONSTRAINT profiling_reports_connection_id_fkey FOREIGN KEY (connection_id) REFERENCES public.connections(id) ON DELETE CASCADE;


--
-- Name: profiling_reports profiling_reports_schema_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: datatrust
--

ALTER TABLE ONLY public.profiling_reports
    ADD CONSTRAINT profiling_reports_schema_id_fkey FOREIGN KEY (schema_id) REFERENCES public.connection_schemas(id) ON DELETE SET NULL;


--
-- Name: profiling_reports profiling_reports_table_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: datatrust
--

ALTER TABLE ONLY public.profiling_reports
    ADD CONSTRAINT profiling_reports_table_id_fkey FOREIGN KEY (table_id) REFERENCES public.connection_tables(id) ON DELETE SET NULL;


--
-- Name: profiling_risks profiling_risks_connection_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: datatrust
--

ALTER TABLE ONLY public.profiling_risks
    ADD CONSTRAINT profiling_risks_connection_id_fkey FOREIGN KEY (connection_id) REFERENCES public.connections(id) ON DELETE CASCADE;


--
-- Name: profiling_risks profiling_risks_report_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: datatrust
--

ALTER TABLE ONLY public.profiling_risks
    ADD CONSTRAINT profiling_risks_report_id_fkey FOREIGN KEY (report_id) REFERENCES public.profiling_reports(report_id) ON DELETE CASCADE;


--
-- Name: rule_ai_calls rule_ai_calls_connection_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: datatrust
--

ALTER TABLE ONLY public.rule_ai_calls
    ADD CONSTRAINT rule_ai_calls_connection_id_fkey FOREIGN KEY (connection_id) REFERENCES public.connections(id) ON DELETE CASCADE;


--
-- Name: rule_fail_history rule_fail_history_connection_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: datatrust
--

ALTER TABLE ONLY public.rule_fail_history
    ADD CONSTRAINT rule_fail_history_connection_id_fkey FOREIGN KEY (connection_id) REFERENCES public.connections(id) ON DELETE CASCADE;


--
-- Name: simulation_runs simulation_runs_connection_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: datatrust
--

ALTER TABLE ONLY public.simulation_runs
    ADD CONSTRAINT simulation_runs_connection_id_fkey FOREIGN KEY (connection_id) REFERENCES public.connections(id) ON DELETE CASCADE;


--
-- Name: simulation_runs simulation_runs_scenario_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: datatrust
--

ALTER TABLE ONLY public.simulation_runs
    ADD CONSTRAINT simulation_runs_scenario_id_fkey FOREIGN KEY (scenario_id) REFERENCES public.simulation_scenarios(scenario_id) ON DELETE SET NULL;


--
-- Name: task_board task_board_connection_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: datatrust
--

ALTER TABLE ONLY public.task_board
    ADD CONSTRAINT task_board_connection_id_fkey FOREIGN KEY (connection_id) REFERENCES public.connections(id) ON DELETE CASCADE;


--
-- Name: trust_score_history trust_score_history_connection_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: datatrust
--

ALTER TABLE ONLY public.trust_score_history
    ADD CONSTRAINT trust_score_history_connection_id_fkey FOREIGN KEY (connection_id) REFERENCES public.connections(id) ON DELETE CASCADE;


--
-- Name: user_connection_roles user_connection_roles_connection_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: datatrust
--

ALTER TABLE ONLY public.user_connection_roles
    ADD CONSTRAINT user_connection_roles_connection_id_fkey FOREIGN KEY (connection_id) REFERENCES public.connections(id) ON DELETE CASCADE;


--
-- PostgreSQL database dump complete
--

\unrestrict GSL5usgRhmTAw2C9a4Wq4LF20h8CnnZuPq5WwwwmpQ55S0S0U94xT32h2e3FfcD

