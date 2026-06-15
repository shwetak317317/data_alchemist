-- ============================================================
-- Scenario simulator: scenario library + run history
-- ============================================================

CREATE TABLE IF NOT EXISTS simulation_scenarios (
    scenario_id    VARCHAR(36)   PRIMARY KEY DEFAULT gen_random_uuid()::VARCHAR,
    title          TEXT          NOT NULL,
    scenario_type  VARCHAR(64),                            -- Segment loss | Column NULL | Volume drop | Whitelist breach | Source non-arrival
    description    TEXT,
    is_builtin     BOOLEAN       DEFAULT TRUE,
    position_order INTEGER       DEFAULT 0,
    created_at     TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sim_scenarios_type ON simulation_scenarios(scenario_type);

CREATE TABLE IF NOT EXISTS simulation_runs (
    sim_run_id     VARCHAR(36)   PRIMARY KEY DEFAULT gen_random_uuid()::VARCHAR,
    connection_id  VARCHAR(36)   REFERENCES connections(id) ON DELETE CASCADE,
    scenario_id    VARCHAR(36)   REFERENCES simulation_scenarios(scenario_id) ON DELETE SET NULL,
    scenario_text  TEXT,
    status         VARCHAR(16)   DEFAULT 'running',        -- running | completed | failed
    events         JSONB,                                  -- [{at, kind, title, detail}, ...]
    inject_sql     TEXT,
    started_at     TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    completed_at   TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_sim_runs_connection ON simulation_runs(connection_id);
CREATE INDEX IF NOT EXISTS idx_sim_runs_started    ON simulation_runs(started_at DESC);
