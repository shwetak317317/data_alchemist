-- ============================================================
-- Seed built-in simulation scenarios so quick-pick chips work
-- on first run (before any user-created scenarios exist).
-- title = the NL question shown in quick-pick chips
-- scenario_type = the category label shown as the chip badge
--
-- Idempotent: only inserts if no built-in scenarios exist yet,
-- so safe to re-run on every container restart.
-- ============================================================

INSERT INTO simulation_scenarios
    (scenario_id, title, scenario_type, description, is_builtin, position_order)
SELECT * FROM (VALUES
    ('sim-builtin-segment'::VARCHAR,
     'What if the Northeast region stops sending order data entirely?',
     'Segment loss',
     'Simulates 100% regional data loss: Northeast orders missing from silver.orders_enriched. Triggers volume anomaly, cross-segment imbalance, and revenue rule failure.',
     TRUE, 1),

    ('sim-builtin-nullcol'::VARCHAR,
     'Imagine revenue data was not loaded for today''s orders.',
     'Column NULL',
     'Simulates net_revenue NULLed for today''s partition. Triggers revenue_not_null rule failure and null-rate anomaly (0.8% to 12.4%).',
     TRUE, 2),

    ('sim-builtin-volume'::VARCHAR,
     'Orders dropped 60% overnight.',
     'Volume drop',
     'Simulates a 60% row-count drop in bronze.orders. Triggers volume anomaly (2-sigma breach) and downstream cascade to Silver.',
     TRUE, 3),

    ('sim-builtin-whitelist'::VARCHAR,
     'A new invalid status code GHOST appeared.',
     'Whitelist breach',
     'Simulates 5,000 rows with status=GHOST inserted into silver.orders_enriched. Triggers whitelist rule failure and segment-concentration anomaly.',
     TRUE, 4),

    ('sim-builtin-source'::VARCHAR,
     'The CRM feed stopped arriving today.',
     'Source non-arrival',
     'Simulates CRM customer extract SLA breach. Triggers source non-arrival alert and downstream freshness risk for Bronze + Silver joins.',
     TRUE, 5)
) AS v(scenario_id, title, scenario_type, description, is_builtin, position_order)
WHERE NOT EXISTS (
    SELECT 1 FROM simulation_scenarios WHERE is_builtin = TRUE
);
