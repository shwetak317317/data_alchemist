"""
DataTrust demo seed — inserts the RetailCo demo scenario into every PostgreSQL table.

Called from main.py lifespan after apply_schemas().
All inserts use ON CONFLICT DO NOTHING — idempotent, safe to call on every restart.
The demo connection ID is fixed so the frontend can always reference it.
"""
import json
import logging
from datetime import date, datetime, timezone, timedelta

from sqlalchemy import text

from app.core.metadata_db import db_session

logger = logging.getLogger(__name__)

DEMO_CONN_ID   = "demo-conn-datatrust"
DEMO_REPORT_ID = "demo-report-silver-orders-enriched"
DEMO_RUN_ID    = "demo-run-001"


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def seed_demo_data() -> None:
    """Seed all demo data once if the demo connection is not yet present."""
    try:
        with db_session() as db:
            exists = db.execute(
                text("SELECT 1 FROM connections WHERE id = :id"),
                {"id": DEMO_CONN_ID},
            ).fetchone()
            if exists:
                logger.info("Demo connection present — skipping seed")
                return

        logger.info("Seeding DataTrust demo connection and data…")
        with db_session() as db:
            _seed_connection(db)
            _seed_profiling_reports(db)
            _seed_column_stats(db)
            _seed_profiling_risks(db)
            _seed_data_dictionary(db)
            _seed_cde_registry(db)
            _seed_dq_rules(db)
            _seed_dq_run(db)
            _seed_dq_run_results(db)
            _seed_anomalies(db)
            _seed_trust_history(db)
            _seed_rule_fail_history(db)
            _seed_audit_trail(db)
            _seed_tasks(db)
            _seed_lineage(db)
            _seed_simulation_scenarios(db)
            _seed_intel(db)
            _seed_fingerprints(db)
        logger.info("Demo seed complete ✓")
    except Exception as exc:
        logger.warning("Demo seed failed (non-fatal): %s", exc)


# ---------------------------------------------------------------------------
# Helper
# ---------------------------------------------------------------------------

def _q(db, sql: str, params: dict = None) -> None:
    db.execute(text(sql), params or {})


# ---------------------------------------------------------------------------
# 1. Connection
# ---------------------------------------------------------------------------

def _seed_connection(db) -> None:
    _q(db, """
        INSERT INTO connections
            (id, name, platform, environment, config_encrypted,
             status, is_demo, host, auth_type, schemas_scope,
             table_count, last_tested_at, created_at, updated_at)
        VALUES
            (:id, :name, 'demo', 'demo', '{"demo":true}',
             'active', TRUE, 'demo.datatrust.local', 'Demo mode · no credentials required',
             :schemas, 14, NOW(), NOW(), NOW())
        ON CONFLICT (id) DO NOTHING
    """, {
        "id": DEMO_CONN_ID,
        "name": "DataTrust Demo",
        "schemas": ["raw", "bronze", "silver", "gold"],
    })


# ---------------------------------------------------------------------------
# 2. Profiling reports (one per table in the browse tree)
# ---------------------------------------------------------------------------

_TABLES = [
    ("raw.crm_customers",           "RAW",    1210000, 88, "crm_customers"),
    ("raw.oms_orders",               "RAW",    4390000, 91, "oms_orders"),
    ("raw.oms_order_items",          "RAW",    9800000, 90, "oms_order_items"),
    ("raw.wms_shipments",            "RAW",    3900000, 79, "wms_shipments"),
    ("raw.erp_payments",             "RAW",    4100000, 86, "erp_payments"),
    ("raw.erp_refunds",              "RAW",     184000, 92, "erp_refunds"),
    ("bronze.customers",             "BRONZE", 1200000, 84, "customers"),
    ("bronze.orders",                "BRONZE", 4380000, 75, "orders"),
    ("bronze.order_items",           "BRONZE", 9700000, 88, "order_items"),
    ("bronze.shipments",             "BRONZE", 3800000, 81, "shipments"),
    ("bronze.payments",              "BRONZE", 4000000, 87, "payments"),
    ("silver.customers_master",      "SILVER", 1190000, 80, "customers_master"),
    ("silver.product_catalog",       "SILVER",   48200, 92, "product_catalog"),
    ("gold.daily_revenue_summary",   "GOLD",      364,  68, "daily_revenue_summary"),
    ("gold.customer_segments",       "GOLD",     2900,  85, "customer_segments"),
    ("gold.product_performance",     "GOLD",    48200,  90, "product_performance"),
]

def _seed_profiling_reports(db) -> None:
    base_ts = datetime.now(timezone.utc) - timedelta(hours=2)

    # All non-silver tables
    for table_fqn, layer, row_count, score, tname in _TABLES:
        schema = table_fqn.split(".")[0]
        rid = f"demo-report-{table_fqn.replace('.', '-')}"
        _q(db, """
            INSERT INTO profiling_reports
                (report_id, connection_id, table_fqn, layer, schema_name, table_name,
                 run_at, row_count, quality_score, completeness_score, uniqueness_score,
                 consistency_score, freshness_score, risks_flagged, column_stats, summary_text)
            VALUES
                (:rid, :conn, :table, :layer, :schema, :tname,
                 :run_at, :rows, :score, :comp, :uniq, :cons, :fresh,
                 :risks::jsonb, '[]'::jsonb, :summary)
            ON CONFLICT (report_id) DO NOTHING
        """, {
            "rid": rid, "conn": DEMO_CONN_ID, "table": table_fqn,
            "layer": layer, "schema": schema, "tname": tname,
            "run_at": base_ts, "rows": row_count, "score": score,
            "comp":  min(100.0, score + 12.0),
            "uniq":  min(100.0, score + 20.0),
            "cons":  min(100.0, score + 8.0),
            "fresh": min(100.0, score + 10.0),
            "risks": json.dumps([]),
            "summary": f"Profiling report for {table_fqn}. Quality score: {score}/100.",
        })

    # silver.orders_enriched — the main demo table with rich detail
    _q(db, """
        INSERT INTO profiling_reports
            (report_id, connection_id, table_fqn, layer, schema_name, table_name,
             run_at, row_count, quality_score, completeness_score, uniqueness_score,
             consistency_score, freshness_score, risks_flagged, column_stats, summary_text)
        VALUES
            (:rid, :conn, 'silver.orders_enriched', 'SILVER', 'silver', 'orders_enriched',
             :run_at, 1842300, 61.0, 72.0, 100.0, 84.0, 85.0,
             :risks::jsonb, :cols::jsonb, :summary)
        ON CONFLICT (report_id) DO NOTHING
    """, {
        "rid": DEMO_REPORT_ID,
        "conn": DEMO_CONN_ID,
        "run_at": base_ts,
        "risks": json.dumps([
            {"severity": "CRITICAL", "title": "net_revenue is NULL for 206,338 records (11.2%)"},
            {"severity": "CRITICAL", "title": "Row count 58% below yesterday (1.84M vs 4.39M)"},
            {"severity": "HIGH",     "title": "status column contains unknown values"},
            {"severity": "MEDIUM",   "title": "days_to_deliver null 14.8%"},
        ]),
        "cols": json.dumps([]),
        "summary": "Critical issues detected. Row count 58% below average. net_revenue 11.2% NULL (CDE). Status column contains unknown codes.",
    })


# ---------------------------------------------------------------------------
# 3. Column stats for silver.orders_enriched
# ---------------------------------------------------------------------------

_COLUMNS = [
    # (column_name,  data_type,   null_pct, distinct,  format,      is_cde, is_pii, pii_type, score, health, note)
    ("order_id",       "VARCHAR", 0.0,   1842300, "UUID",       False, False, None,        100, "HEALTHY", None),
    ("customer_id",    "VARCHAR", 0.1,    912441, "UUID",       False, False, None,         99, "HEALTHY", None),
    ("order_date",     "DATE",    0.0,       364, "DATE",       False, False, None,        100, "HEALTHY", None),
    ("status",         "VARCHAR", 0.0,         7, "WHITELIST",  True,  False, None,         94, "WARN",    None),
    ("gross_amount",   "DECIMAL", 0.0,    184221, "DEC",        True,  False, None,         98, "HEALTHY", None),
    ("discount_amount","DECIMAL", 8.2,      2341, "DEC",        False, False, None,         78, "WARN",    None),
    ("net_revenue",    "DECIMAL", 11.2,   184010, "DEC",        True,  False, None,         22, "CRIT",    None),
    ("channel",        "VARCHAR", 0.0,         3, "ENUM",       False, False, None,        100, "HEALTHY", None),
    ("region",         "VARCHAR", 3.1,         8, "ENUM",       False, False, None,         84, "WARN",    None),
    ("loyalty_tier",   "VARCHAR", 4.7,         4, "ENUM",       False, False, None,         82, "WARN",    None),
    ("has_payment",    "BOOLEAN", 0.0,         2, "BOOL",       False, False, None,        100, "HEALTHY", None),
    ("is_returned",    "BOOLEAN", 0.0,         2, "BOOL",       False, False, None,        100, "HEALTHY", None),
    ("refund_amount",  "DECIMAL", 91.3,     8441, "DEC",        False, False, None,         95, "OK",     "91.3% null is EXPECTED — most orders are not returned"),
    ("days_to_deliver","INTEGER", 14.8,       45, "INT",        False, False, None,         80, "WARN",    None),
    ("_dq_score",      "DECIMAL", 0.0,       892, "DEC",        False, False, None,        100, "HEALTHY", None),
]

def _seed_column_stats(db) -> None:
    for (col, dtype, null_pct, distinct, fmt, is_cde, is_pii, pii_type, score, health, note) in _COLUMNS:
        _q(db, """
            INSERT INTO column_stats
                (report_id, connection_id, table_fqn, column_name, data_type,
                 null_pct, distinct_count, detected_format, is_cde, is_pii, pii_type,
                 quality_score, health, note, created_at)
            VALUES
                (:report, :conn, 'silver.orders_enriched', :col, :dtype,
                 :null_pct, :distinct, :fmt, :is_cde, :is_pii, :pii_type,
                 :score, :health, :note, NOW())
            ON CONFLICT DO NOTHING
        """, {
            "report": DEMO_REPORT_ID, "conn": DEMO_CONN_ID,
            "col": col, "dtype": dtype, "null_pct": null_pct, "distinct": distinct,
            "fmt": fmt, "is_cde": is_cde, "is_pii": is_pii, "pii_type": pii_type,
            "score": score, "health": health, "note": note,
        })


# ---------------------------------------------------------------------------
# 4. Profiling risks for silver.orders_enriched
# ---------------------------------------------------------------------------

_RISKS = [
    ("R1", "CRITICAL", "net_revenue is NULL for 206,338 records (11.2%)",
     "This is a CDE. Yesterday's null rate was 0.3%. A 37× increase.", "net_revenue",    "NULL_RATE"),
    ("R2", "CRITICAL", "Row count 58% below yesterday (1.84M vs 4.39M)",
     "Possible incomplete pipeline run or source data truncation.", None,                  "VOLUME_DROP"),
    ("R3", "HIGH",     "status column contains unknown values",
     "'PEND_REVIEW' (1,204 rows), 'RTN_INIT' (882 rows) — not in approved whitelist.", "status", "FORMAT"),
    ("R4", "MEDIUM",   "days_to_deliver null 14.8% — likely unshipped orders",
     "Normal if order_date = today. Check distribution before flagging.", "days_to_deliver", "NULL_RATE"),
]

def _seed_profiling_risks(db) -> None:
    for (code, sev, title, desc, col, rtype) in _RISKS:
        _q(db, """
            INSERT INTO profiling_risks
                (report_id, connection_id, risk_code, severity, title, description, column_name, risk_type, created_at)
            VALUES
                (:report, :conn, :code, :sev, :title, :desc, :col, :rtype, NOW())
            ON CONFLICT DO NOTHING
        """, {
            "report": DEMO_REPORT_ID, "conn": DEMO_CONN_ID,
            "code": code, "sev": sev, "title": title, "desc": desc, "col": col, "rtype": rtype,
        })


# ---------------------------------------------------------------------------
# 5. Data dictionary
# ---------------------------------------------------------------------------

_DICT = [
    # (col, table_fqn, layer, dtype, desc, is_cde, cde_score, is_pii, sens, steward_status, is_internal)
    ("net_revenue",   "silver.orders_enriched", "SILVER", "DECIMAL",
     "Net order revenue after discounts and before refunds (USD). Primary metric for Finance P&L reporting.",
     True,  97.0, False, "FINANCIAL", "approved", False),
    ("gross_amount",  "silver.orders_enriched", "SILVER", "DECIMAL",
     "Total order value before any discounts are applied (USD).",
     True,  94.0, False, "FINANCIAL", "approved", False),
    ("status",        "silver.orders_enriched", "SILVER", "VARCHAR",
     "Current lifecycle state of the order. Expected: OPEN, PROCESSING, SHIPPED, DELIVERED, CANCELLED, RETURNED.",
     False, 41.0, False, None,        "needs-review", False),
    ("discount_code", "silver.orders_enriched", "SILVER", "VARCHAR",
     "Promotional voucher code applied at checkout. May be null if no promotion was used.",
     False, 28.0, False, None,        "pending", False),
    ("customer_id",   "silver.orders_enriched", "SILVER", "VARCHAR",
     "Unique customer identifier linked to the CRM master record.",
     False, 55.0, False, None,        "pending", False),
    ("region",        "silver.orders_enriched", "SILVER", "VARCHAR",
     "Customer's sales region, joined from the customer master (8 regions).",
     False, 38.0, False, None,        "pending", False),
    ("_dq_score",     "silver.orders_enriched", "SILVER", "DECIMAL",
     "Internal metadata column — no business description generated. Confirm if visible to business users.",
     False, 12.0, False, None,        "needs-review", True),
    ("email",         "silver.customers_master","SILVER", "VARCHAR",
     "Customer email address used for marketing and authentication.",
     True,  88.0, True,  "PII",       "approved", False),
    ("lifetime_revenue","silver.customers_master","SILVER","DECIMAL",
     "Total net revenue attributed to this customer across all orders.",
     True,  82.0, False, "FINANCIAL", "approved", False),
]

def _seed_data_dictionary(db) -> None:
    for (col, table_fqn, layer, dtype, desc, is_cde, cde_score, is_pii, sens, steward_status, is_internal) in _DICT:
        schema = table_fqn.split(".")[0]
        tname  = table_fqn.split(".")[1]
        col_id = f"{table_fqn}.{col}"
        _q(db, """
            INSERT INTO data_dictionary
                (column_id, connection_id, table_fqn, schema_name, table_name, layer,
                 column_name, description, business_description, data_type,
                 is_cde, cde_score, is_pii, sensitivity_tag,
                 status, steward_status, is_internal, ai_suggested, created_at, updated_at)
            VALUES
                (:col_id, :conn, :table, :schema, :tname, :layer,
                 :col, :desc, :desc, :dtype,
                 :is_cde, :cde_score, :is_pii, :sens,
                 :steward_status, :steward_status, :is_internal, TRUE, NOW(), NOW())
            ON CONFLICT (column_id) DO NOTHING
        """, {
            "col_id": col_id, "conn": DEMO_CONN_ID, "table": table_fqn,
            "schema": schema, "tname": tname, "layer": layer,
            "col": col, "desc": desc, "dtype": dtype,
            "is_cde": is_cde, "cde_score": cde_score, "is_pii": is_pii, "sens": sens,
            "steward_status": steward_status, "is_internal": is_internal,
        })


# ---------------------------------------------------------------------------
# 6. CDE registry
# ---------------------------------------------------------------------------

_CDES = [
    # (column_name, table_fqn, cde_score, health, last_validated)
    ("net_revenue",      "silver.orders_enriched",  97.0, "FAIL", "2024-11-05 08:22:00"),
    ("gross_amount",     "silver.orders_enriched",  94.0, "PASS", "2024-11-05 08:22:00"),
    ("status",           "silver.orders_enriched",  41.0, "WARN", "2024-11-05 08:22:00"),
    ("email",            "silver.customers_master", 88.0, "PASS", "2024-11-05 07:14:00"),
    ("lifetime_revenue", "silver.customers_master", 82.0, "PASS", "2024-11-05 07:30:00"),
]

def _seed_cde_registry(db) -> None:
    for (col, table_fqn, cde_score, health, last_val) in _CDES:
        _q(db, """
            INSERT INTO cde_registry
                (connection_id, column_name, table_fqn, cde_score, health,
                 last_validated_at, promoted_by, promoted_at)
            VALUES
                (:conn, :col, :table, :score, :health,
                 :last_val::timestamptz, 'Priya Sharma', NOW())
            ON CONFLICT (connection_id, table_fqn, column_name) DO NOTHING
        """, {
            "conn": DEMO_CONN_ID, "col": col, "table": table_fqn,
            "score": cde_score, "health": health, "last_val": last_val,
        })


# ---------------------------------------------------------------------------
# 7. DQ rules
# ---------------------------------------------------------------------------

_RULES = [
    # (id, name, expr, desc, table_fqn, layer, col, rule_type, sev, is_cde, status, by)
    ("demo-rule-001", "net_revenue must NOT be NULL",
     "net_revenue IS NOT NULL",
     "CDE — 11.2% null spike today. Must remediate before Gold reload.",
     "silver.orders_enriched", "SILVER", "net_revenue",  "NULL_CHECK",  "CRITICAL", True,  "pending",  "AI_AGENT"),
    ("demo-rule-002", "net_revenue must be >= 0",
     "net_revenue >= 0",
     "No negative revenue orders expected in operational data.",
     "silver.orders_enriched", "SILVER", "net_revenue",  "RANGE",       "HIGH",     True,  "pending",  "AI_AGENT"),
    ("demo-rule-003", "status must be in approved whitelist",
     "status IN ('OPEN','PROCESSING','SHIPPED','DELIVERED','CANCELLED','RETURNED','REFUNDED')",
     "OMS status codes must match the approved state machine transitions.",
     "silver.orders_enriched", "SILVER", "status",       "FORMAT",      "CRITICAL", True,  "pending",  "AI_AGENT"),
    ("demo-rule-004", "gross_amount must be > 0",
     "gross_amount > 0",
     "CDE — no zero-value orders expected in enriched layer.",
     "silver.orders_enriched", "SILVER", "gross_amount", "RANGE",       "HIGH",     True,  "pending",  "AI_AGENT"),
    ("demo-rule-005", "customer_id FK must exist in customers_master",
     "customer_id IN (SELECT customer_id FROM silver.customers_master)",
     "Referential integrity: every order must have a valid customer.",
     "silver.orders_enriched", "SILVER", "customer_id",  "FK",          "CRITICAL", False, "pending",  "AI_AGENT"),
    ("demo-rule-006", "net_revenue daily total within ±30% of 7-day avg",
     "ABS(sum(net_revenue) - avg_7d) / avg_7d <= 0.30",
     "Gold revenue aggregation must not deviate >30% from baseline.",
     "gold.daily_revenue_summary", "GOLD", "net_revenue", "VOLUME",     "HIGH",     True,  "pending",  "AI_AGENT"),
    ("demo-rule-007", "raw.oms_orders file must arrive by 05:30 AM",
     "arrival_time <= '05:30:00'",
     "SLA: source file must land before Bronze pipeline starts at 05:35 AM.",
     "raw.oms_orders", "RAW", None,                      "VOLUME",      "HIGH",     False, "pending",  "AI_AGENT"),
    ("demo-rule-008", "discount_amount null rate below 5%",
     "null_pct(discount_amount) < 0.05",
     "High null rate in discounts may indicate a promotion join failure.",
     "silver.orders_enriched", "SILVER", "discount_amount", "NULL_CHECK","MEDIUM",  False, "pending",  "AI_AGENT"),
    ("demo-rule-009", "order_date must equal a valid calendar date",
     "order_date IS NOT NULL AND order_date <= CURRENT_DATE",
     "No future-dated orders allowed in the enriched layer.",
     "silver.orders_enriched", "SILVER", "order_date",   "NULL_CHECK",  "MEDIUM",   False, "active",   "AI_AGENT"),
    ("demo-rule-010", "channel in approved values",
     "channel IN ('WEB','APP','STORE')",
     "Only 3 valid sales channels exist — others indicate a data mapping error.",
     "silver.orders_enriched", "SILVER", "channel",      "FORMAT",      "LOW",      False, "active",   "AI_AGENT"),
    ("demo-rule-011", "bronze.orders dedup on order_id",
     "count(*) = count(distinct order_id)",
     "Duplicate order_ids cause fan-out on all downstream joins.",
     "bronze.orders", "BRONZE", "order_id",              "CUSTOM",      "HIGH",     False, "active",   "AI_AGENT"),
    ("demo-rule-012", "loyalty_tier in approved tiers",
     "loyalty_tier IN ('BRONZE','SILVER','GOLD','PLATINUM')",
     "Loyalty tier must match the 4-tier program structure.",
     "silver.orders_enriched", "SILVER", "loyalty_tier", "FORMAT",      "LOW",      False, "pending",  "AI_AGENT"),
]

def _seed_dq_rules(db) -> None:
    for (rid, name, expr, desc, table_fqn, layer, col, rtype, sev, is_cde, status, by) in _RULES:
        tname = table_fqn.split(".")[-1] if table_fqn else None
        _q(db, """
            INSERT INTO dq_rules
                (rule_id, connection_id, rule_name, rule_description, table_fqn,
                 table_name, layer, column_name, rule_expression, rule_type,
                 severity, is_cde_rule, status, created_by, created_at, updated_at)
            VALUES
                (:rid, :conn, :name, :desc, :table,
                 :tname, :layer, :col, :expr, :rtype,
                 :sev, :is_cde, :status, :by, NOW(), NOW())
            ON CONFLICT (rule_id) DO NOTHING
        """, {
            "rid": rid, "conn": DEMO_CONN_ID, "name": name, "desc": desc, "table": table_fqn,
            "tname": tname, "layer": layer, "col": col, "expr": expr, "rtype": rtype,
            "sev": sev, "is_cde": is_cde, "status": status, "by": by,
        })


# ---------------------------------------------------------------------------
# 8. Execution run
# ---------------------------------------------------------------------------

def _seed_dq_run(db) -> None:
    run_ts = datetime.now(timezone.utc) - timedelta(hours=1, minutes=38)
    _q(db, """
        INSERT INTO dq_runs
            (run_id, connection_id, triggered_by, started_at, completed_at,
             status, total_rules, passed_rules, failed_rules, overall_quality_score)
        VALUES
            (:rid, :conn, 'MANUAL', :started, :completed,
             'completed', 31, 22, 9, 71.0)
        ON CONFLICT (run_id) DO NOTHING
    """, {
        "rid": DEMO_RUN_ID, "conn": DEMO_CONN_ID,
        "started": run_ts, "completed": run_ts + timedelta(minutes=2, seconds=14),
    })


# ---------------------------------------------------------------------------
# 9. DQ run results
# ---------------------------------------------------------------------------

_EXEC_RESULTS = [
    # (rule_id, rule_name, table_fqn, layer, status, total, failed, fail_pct, sev)
    ("demo-rule-001", "net_revenue IS NOT NULL",        "silver.orders_enriched", "SILVER", "FAIL", 1842300, 206338, 11.2, "CRITICAL"),
    ("demo-rule-003", "status IN whitelist",             "silver.orders_enriched", "SILVER", "FAIL", 1842300,    882,  0.05, "HIGH"),
    ("demo-rule-004", "gross_amount > 0",               "silver.orders_enriched", "SILVER", "FAIL", 1842300,    147,  0.008,"HIGH"),
    ("demo-rule-006", "net_revenue daily total ±30%",   "gold.daily_revenue_summary","GOLD","FAIL",    364,      1,  0.0,  "HIGH"),
    ("demo-rule-007", "oms_orders file arrive by 05:30","raw.oms_orders",           "RAW",  "FAIL",      1,      1,  0.0,  "HIGH"),
    ("demo-rule-011", "bronze.orders dedup order_id",   "bronze.orders",           "BRONZE","FAIL", 4380000,     23,  0.0005,"MEDIUM"),
    ("demo-rule-009", "order_date valid",               "silver.orders_enriched", "SILVER", "PASS", 1842300,      0,  0.0,  "MEDIUM"),
    ("demo-rule-010", "channel in WEB/APP/STORE",       "silver.orders_enriched", "SILVER", "PASS", 1842300,      0,  0.0,  "LOW"),
    ("demo-rule-005", "customer_id FK exists",          "silver.orders_enriched", "SILVER", "PASS", 1842300,      0,  0.0,  "CRITICAL"),
]

def _seed_dq_run_results(db) -> None:
    run_ts = datetime.now(timezone.utc) - timedelta(hours=1, minutes=36)
    for (rid, rname, table_fqn, layer, status, total, failed, fail_pct, sev) in _EXEC_RESULTS:
        score = 0.0 if status == "FAIL" else 100.0
        _q(db, """
            INSERT INTO dq_run_results
                (run_id, run_timestamp, connection_id, rule_id, rule_name,
                 table_fqn, layer, status, total_records, failed_records,
                 fail_pct, quality_score, severity, created_at)
            VALUES
                (:run, :ts, :conn, :rid, :rname,
                 :table, :layer, :status, :total, :failed,
                 :fail_pct, :score, :sev, NOW())
            ON CONFLICT DO NOTHING
        """, {
            "run": DEMO_RUN_ID, "ts": run_ts, "conn": DEMO_CONN_ID,
            "rid": rid, "rname": rname, "table": table_fqn, "layer": layer,
            "status": status, "total": total, "failed": failed,
            "fail_pct": fail_pct, "score": score, "sev": sev,
        })


# ---------------------------------------------------------------------------
# 10. Anomalies
# ---------------------------------------------------------------------------

_ANOMALIES = [
    # (id, sev, atype, table_fqn, layer, desc, metric_v, baseline_v, dev_pct, status, history)
    ("demo-anomaly-001", "CRITICAL", "VOLUME",
     "silver.orders_enriched", "SILVER",
     "Row count 1,842,300 today vs 7-day average 4,312,880 (↓ 57.3%, threshold ±25%)",
     1842300, 4312880, -57.3, "open",
     [4.4, 4.2, 4.5, 4.1, 4.3, 4.4, 1.8]),
    ("demo-anomaly-002", "HIGH", "SOURCE_LATE",
     "raw.wms_shipments", "RAW",
     "Expected by 05:30 AM — arrived 06:55 AM (85 min late). 4 downstream Silver tables affected.",
     None, None, None, "open", None),
    ("demo-anomaly-003", "MEDIUM", "SEGMENT",
     "silver.orders_enriched", "SILVER",
     "status = 'RTN_INIT' appears ONLY in region = 'Northeast' (882 rows). Other regions: 0 rows.",
     None, None, None, "open", None),
    ("demo-anomaly-004", "MEDIUM", "DISTRIBUTION",
     "gold.daily_revenue_summary", "GOLD",
     "return_rate_pct today = 8.4% vs 7-day avg = 2.1% (4× increase, IQR threshold breach).",
     8.4, 2.1, 300.0, "open", None),
]

def _seed_anomalies(db) -> None:
    base_ts = datetime.now(timezone.utc) - timedelta(hours=2)
    for (aid, sev, atype, table_fqn, layer, desc, mv, bv, dev, status, history) in _ANOMALIES:
        detected = base_ts + timedelta(minutes={"demo-anomaly-001": 3, "demo-anomaly-002": 1, "demo-anomaly-003": 5, "demo-anomaly-004": 8}.get(aid, 0))
        _q(db, """
            INSERT INTO anomaly_log
                (anomaly_id, connection_id, detected_at, layer, table_fqn, anomaly_type,
                 description, severity, metric_value, baseline_value, deviation_pct,
                 status, history_values, created_at)
            VALUES
                (:aid, :conn, :detected, :layer, :table, :atype,
                 :desc, :sev, :mv, :bv, :dev,
                 :status, :history::jsonb, NOW())
            ON CONFLICT (anomaly_id) DO NOTHING
        """, {
            "aid": aid, "conn": DEMO_CONN_ID, "detected": detected,
            "layer": layer, "table": table_fqn, "atype": atype,
            "desc": desc, "sev": sev, "mv": mv, "bv": bv, "dev": dev,
            "status": status,
            "history": json.dumps(history) if history else None,
        })


# ---------------------------------------------------------------------------
# 11. Trust score history (14 days)
# ---------------------------------------------------------------------------

_TRUST_HISTORY = [
    ("2024-10-23", 84, 91, 88, 79, 80),
    ("2024-10-25", 88, 93, 90, 84, 85),
    ("2024-10-27", 86, 90, 89, 82, 83),
    ("2024-10-29", 81, 88, 85, 76, 78),
    ("2024-10-31", 79, 85, 82, 73, 75),
    ("2024-11-01", 82, 88, 85, 77, 79),
    ("2024-11-03", 77, 84, 80, 71, 73),
    ("2024-11-05", 69, 82, 75, 61, 68),
]

def _seed_trust_history(db) -> None:
    for (dt, overall, raw, bronze, silver, gold) in _TRUST_HISTORY:
        _q(db, """
            INSERT INTO trust_score_history
                (connection_id, score_date, overall_score, raw_score, bronze_score,
                 silver_score, gold_score, rules_total, rules_passed, rules_failed, anomaly_count)
            VALUES
                (:conn, :dt::date, :overall, :raw, :bronze, :silver, :gold, 31, 22, 9, 4)
            ON CONFLICT (connection_id, score_date) DO NOTHING
        """, {
            "conn": DEMO_CONN_ID, "dt": dt,
            "overall": overall, "raw": raw, "bronze": bronze, "silver": silver, "gold": gold,
        })


# ---------------------------------------------------------------------------
# 12. Rule fail history (7 days)
# ---------------------------------------------------------------------------

_RULE_FAIL = [
    ("2024-10-30", 4), ("2024-10-31", 4), ("2024-11-01", 4),
    ("2024-11-02", 4), ("2024-11-03", 6), ("2024-11-04", 4), ("2024-11-05", 9),
]

def _seed_rule_fail_history(db) -> None:
    for (dt, cnt) in _RULE_FAIL:
        _q(db, """
            INSERT INTO rule_fail_history (connection_id, fail_date, fail_count)
            VALUES (:conn, :dt::date, :cnt)
            ON CONFLICT (connection_id, fail_date) DO NOTHING
        """, {"conn": DEMO_CONN_ID, "dt": dt, "cnt": cnt})


# ---------------------------------------------------------------------------
# 13. Audit trail
# ---------------------------------------------------------------------------

_AUDIT = [
    # (offset_minutes, user, email, event_type, entity_type, entity_id, entity_name)
    (4,  "Ravi Kumar",   "ravi.kumar@retailco.com",   "EDIT",    "RULE",       "demo-rule-003", "Rule #3 status whitelist — added PEND_REVIEW"),
    (24, "Priya Sharma", "priya.sharma@retailco.com", "PROMOTE", "CDE",        "status",        "status → CDE (score 87)"),
    (26, "Priya Sharma", "priya.sharma@retailco.com", "EDIT",    "DICTIONARY", "net_revenue",   "net_revenue description updated"),
    (46, "Ravi Kumar",   "ravi.kumar@retailco.com",   "APPROVE", "RULE",       "demo-rule-001", "Rule: net_revenue_max_threshold (NL→DQ)"),
    (54, "Ravi Kumar",   "ravi.kumar@retailco.com",   "SUPPRESS","RISK",       "R4",            "R4 days_to_deliver (today only, with reason)"),
]

def _seed_audit_trail(db) -> None:
    base_ts = datetime.now(timezone.utc) - timedelta(hours=1, minutes=30)
    for (offset, user, email, event_type, entity_type, entity_id, entity_name) in _AUDIT:
        ts = base_ts - timedelta(minutes=offset)
        _q(db, """
            INSERT INTO audit_trail
                (event_id, connection_id, event_timestamp, user_name, user_email,
                 event_type, entity_type, entity_id, entity_name)
            VALUES
                (gen_random_uuid()::VARCHAR, :conn, :ts, :user, :email,
                 :etype, :entity_type, :entity_id, :entity_name)
            ON CONFLICT DO NOTHING
        """, {
            "conn": DEMO_CONN_ID, "ts": ts, "user": user, "email": email,
            "etype": event_type, "entity_type": entity_type,
            "entity_id": entity_id, "entity_name": entity_name,
        })


# ---------------------------------------------------------------------------
# 14. Tasks
# ---------------------------------------------------------------------------

_TASKS = [
    # (title, prio, phase, desc, owner, status)
    ("Re-run Silver pipeline (net_revenue null)",   "CRITICAL", "Execution",  "Fix net_revenue NULL in Silver — ETA 10:50 AM. Block Finance Dashboard until confirmed.", "Deepa Nair",         "in_progress"),
    ("Block Finance Dashboard publish",             "CRITICAL", "Governance", "Hold until Silver re-run is confirmed healthy.",                                            "Ravi Kumar → Sunita","done"),
    ("Investigate 23 duplicate order_ids",          "HIGH",     "Bronze",     "Root cause dedup failure in bronze.orders pipeline.",                                       "Ravi Kumar",         "open"),
    ("Confirm RTN_INIT status code with OMS team",  "HIGH",     "Rule Studio","Determine if RTN_INIT should be added to the approved whitelist.",                          "Ravi Kumar",         "open"),
    ("Raise WMS feed SLA issue with infra team",    "HIGH",     "Raw",        "File arrived 85 minutes late. Agree on SLA monitoring with infra.",                        "Ravi Kumar",         "open"),
    ("Review return rate spike (8.4% vs 2.1%)",    "MEDIUM",   "Anomalies",  "Gold distribution drift — investigate if data artifact or real business signal.",           "Priya Sharma",       "open"),
    ("Add rule coverage to Raw layer (40% → 70%)",  "LOW",      "Rule Studio","Long-term improvement to expand Raw layer rule coverage.",                                  "Ravi Kumar",         "open"),
]

def _seed_tasks(db) -> None:
    for (title, prio, phase, desc, owner, status) in _TASKS:
        _q(db, """
            INSERT INTO task_board
                (task_id, connection_id, title, description, priority, phase,
                 owner, status, created_by, created_at, updated_at)
            VALUES
                (gen_random_uuid()::VARCHAR, :conn, :title, :desc, :prio, :phase,
                 :owner, :status, 'system', NOW(), NOW())
            ON CONFLICT DO NOTHING
        """, {
            "conn": DEMO_CONN_ID, "title": title, "desc": desc,
            "prio": prio, "phase": phase, "owner": owner, "status": status,
        })


# ---------------------------------------------------------------------------
# 15. Lineage nodes + edges
# ---------------------------------------------------------------------------

_LINEAGE_NODES = [
    # (ext_id, label, sub_label, layer, node_type, tier_label, health, note, order, is_source)
    ("silver.orders_enriched",      "silver.orders_enriched", "net_revenue · 11.2% NULL",
     "SILVER", "table", "SOURCE",  "fail", None, 0, True),
    ("gold.daily_revenue_summary",  "gold.daily_revenue_summary", "Revenue understated $221M",
     "GOLD",   "table", "GOLD",    "fail", "Revenue understated $221M", 0, False),
    ("gold.customer_segments",      "gold.customer_segments",     "LTV calculations affected",
     "GOLD",   "table", "GOLD",    "warn", "LTV calculations affected", 1, False),
    ("Finance Dashboard",           "Finance Dashboard",           "DO NOT PUBLISH",
     None,     "report","REPORTS", "fail", "DO NOT PUBLISH", 0, False),
    ("CFO Weekly Report",           "CFO Weekly Report",           "Queued — hold",
     None,     "report","REPORTS", "warn", "Queued — hold", 1, False),
    ("ml.revenue_forecast_v3",      "ml.revenue_forecast_v3",     "Training data incomplete",
     None,     "model", "REPORTS", "fail", "Training data incomplete", 2, False),
    ("ml.churn_predictor_v2",       "ml.churn_predictor_v2",      "Feature incomplete",
     None,     "model", "REPORTS", "warn", "Feature incomplete", 3, False),
    ("ops.fulfilment_sla",          "ops.fulfilment_sla",          "Revenue SLA threshold wrong",
     None,     "report","REPORTS", "warn", "Revenue SLA threshold wrong", 4, False),
]

_LINEAGE_EDGES = [
    # (source_ext_id, target_ext_id)
    ("silver.orders_enriched", "gold.daily_revenue_summary"),
    ("silver.orders_enriched", "gold.customer_segments"),
    ("gold.daily_revenue_summary", "Finance Dashboard"),
    ("gold.daily_revenue_summary", "CFO Weekly Report"),
    ("gold.daily_revenue_summary", "ml.revenue_forecast_v3"),
    ("gold.customer_segments",     "ml.churn_predictor_v2"),
    ("gold.daily_revenue_summary", "ops.fulfilment_sla"),
]

def _seed_lineage(db) -> None:
    # Insert nodes
    for (ext_id, label, sub_label, layer, ntype, tier, health, note, order, is_src) in _LINEAGE_NODES:
        _q(db, """
            INSERT INTO lineage_nodes
                (connection_id, external_id, label, sub_label, layer, node_type,
                 tier_label, health_status, note, position_order, is_source)
            VALUES
                (:conn, :ext_id, :label, :sub, :layer, :ntype,
                 :tier, :health, :note, :order, :is_src)
            ON CONFLICT (connection_id, external_id) DO NOTHING
        """, {
            "conn": DEMO_CONN_ID, "ext_id": ext_id, "label": label, "sub": sub_label,
            "layer": layer, "ntype": ntype, "tier": tier, "health": health,
            "note": note, "order": order, "is_src": is_src,
        })

    # Build ext_id → node_id mapping
    rows = db.execute(
        text("SELECT node_id, external_id FROM lineage_nodes WHERE connection_id = :conn"),
        {"conn": DEMO_CONN_ID},
    ).fetchall()
    node_map = {r[1]: r[0] for r in rows}

    # Insert edges
    for (src_ext, tgt_ext) in _LINEAGE_EDGES:
        src_id = node_map.get(src_ext)
        tgt_id = node_map.get(tgt_ext)
        if src_id and tgt_id:
            _q(db, """
                INSERT INTO lineage_edges (connection_id, source_node_id, target_node_id)
                VALUES (:conn, :src, :tgt)
                ON CONFLICT (connection_id, source_node_id, target_node_id) DO NOTHING
            """, {"conn": DEMO_CONN_ID, "src": src_id, "tgt": tgt_id})


# ---------------------------------------------------------------------------
# 16. Simulation scenarios
# ---------------------------------------------------------------------------

_SCENARIOS = [
    ("What if the Northeast region stops sending order data entirely?", "Segment loss",        0),
    ("Imagine revenue data was not loaded for today's orders.",         "Column NULL",          1),
    ("Orders dropped 60% overnight.",                                  "Volume drop",          2),
    ("A new invalid status code 'GHOST' appeared.",                    "Whitelist breach",     3),
    ("The CRM feed stopped arriving today.",                           "Source non-arrival",   4),
]

def _seed_simulation_scenarios(db) -> None:
    for (title, stype, order) in _SCENARIOS:
        _q(db, """
            INSERT INTO simulation_scenarios (title, scenario_type, is_builtin, position_order)
            VALUES (:title, :stype, TRUE, :order)
            ON CONFLICT DO NOTHING
        """, {"title": title, "stype": stype, "order": order})


# ---------------------------------------------------------------------------
# 17. Intel: advisory + receipt + fingerprints
# ---------------------------------------------------------------------------

def _seed_intel(db) -> None:
    # Advisory
    _q(db, """
        INSERT INTO intel_advisories
            (advisory_id, connection_id, predicted_score, risk_reasons, recommendation,
             advisory_time, generated_at)
        VALUES
            ('demo-advisory-001', :conn, 71.0, :reasons::jsonb, :rec, '05:20 AM', NOW())
        ON CONFLICT (advisory_id) DO NOTHING
    """, {
        "conn": DEMO_CONN_ID,
        "reasons": json.dumps([
            {"risk": "high", "text": "WMS shipment feed has arrived late on 3 of the last 5 Tuesdays. Today is Tuesday. File not yet seen."},
            {"risk": "med",  "text": "OMS extract is 12% smaller than yesterday (arrived 05:15). Possible partial extract. Bronze dedup may flag duplicates."},
            {"risk": "high", "text": "Historical pattern: when OMS < 95% of yesterday's size, Silver net_revenue null rate averages 8.4% (vs normal 0.3%)."},
        ]),
        "rec": "Hold Bronze pipeline 20 minutes. Wait for WMS confirmation. If OMS extract does not grow in 15 min → alert pipeline owner.",
    })

    # Receipt
    _q(db, """
        INSERT INTO intel_receipts
            (receipt_id, connection_id, query_text, table_fqn, executed_at, executed_by,
             row_count, trust_score, fields, recommendation, last_clean_snapshot)
        VALUES
            ('demo-receipt-001', :conn,
             'SELECT * FROM gold.daily_revenue_summary',
             'gold.daily_revenue_summary',
             NOW() - INTERVAL '1 hour 30 minutes',
             'Sunita Reddy', 1, 61.0, :fields::jsonb, :rec, '2024-11-04'::date)
        ON CONFLICT (receipt_id) DO NOTHING
    """, {
        "conn": DEMO_CONN_ID,
        "fields": json.dumps([
            {"name": "net_revenue",    "status": "fail", "note": "Based on 88% of today's orders. 12% missing revenue (pipeline issue, fix in progress — ETA 10:50 AM)."},
            {"name": "gross_amount",   "status": "ok",   "note": "FULLY TRUSTED (100% complete, validated)"},
            {"name": "total_orders",   "status": "ok",   "note": "FULLY TRUSTED"},
            {"name": "return_rate_pct","status": "warn", "note": "UNCERTAIN (4× above average — under investigation, may be a data artifact)"},
        ]),
        "rec": "Do not use today's net_revenue figure for executive reporting until pipeline fix is confirmed. Use gross_amount as a proxy.",
    })


def _seed_fingerprints(db) -> None:
    _FINGERPRINTS = [
        ("demo-anomaly-001", 94, "2024-09-03", "Tuesday",
         "OMS extract arrived at 06:48 AM. Bronze ran at 05:35 AM before extract completed. Discount join step had no rows to join — set net_revenue NULL for same-day orders.",
         "Re-ran Bronze + Silver pipelines.", "47 minutes", "Deepa Nair"),
        ("demo-anomaly-001", 81, "2024-07-16", "Tuesday",
         "Same pattern. Also a Tuesday. OMS file was late.",
         "Same re-run approach.", "1h 12min", "Arjun Mehta"),
    ]
    for (aid, sim_pct, incident_date, incident_day, cause, resolution, res_time, by) in _FINGERPRINTS:
        _q(db, """
            INSERT INTO anomaly_fingerprints
                (connection_id, similarity_pct, incident_date, incident_day,
                 root_cause, resolution, resolution_time, resolved_by, related_table)
            VALUES
                (:conn, :sim, :dt::date, :day,
                 :cause, :resolution, :res_time, :by, 'silver.orders_enriched')
            ON CONFLICT DO NOTHING
        """, {
            "conn": DEMO_CONN_ID, "sim": sim_pct, "dt": incident_date, "day": incident_day,
            "cause": cause, "resolution": resolution, "res_time": res_time, "by": by,
        })
