import sys, os, uuid
sys.path.insert(0, "/app"); os.chdir("/app")

from app.core.metadata_db import engine
from sqlalchemy import text
from datetime import datetime, timezone, timedelta

CONN_ID = "6d657fd4-d8f8-4bee-bd89-666e1abf74c1"
NOW     = datetime.now(timezone.utc)
MARKER  = "anomaly_seed_v1"

TABLES = {
    "BronzeDB.br_customers": {
        "layer": "BRONZE", "schema_name": "BronzeDB", "table_name": "br_customers",
        "baseline_rows": 27, "injected_rows": 500,
        "columns": {
            "Email":       {"null_base": 3.70, "mean_base": None,   "null_post": 42.0, "mean_post": None},
            "CountryCode": {"null_base": 3.70, "mean_base": None,   "null_post": 0.37, "mean_post": None},
            "FirstName":   {"null_base": 0.0,  "mean_base": None,   "null_post": 0.0,  "mean_post": None},
        }
    },
    "BronzeDB.br_payments": {
        "layer": "BRONZE", "schema_name": "BronzeDB", "table_name": "br_payments",
        "baseline_rows": 3804, "injected_rows": 400,
        "columns": {
            "AmountPaid":    {"null_base": 0.0, "mean_base": 2200.0, "null_post": 0.0, "mean_post": 1040.0},
            "PaymentStatus": {"null_base": 0.0, "mean_base": None,   "null_post": 0.0, "mean_post": None},
        }
    },
    "BronzeDB.br_order_items": {
        "layer": "BRONZE", "schema_name": "BronzeDB", "table_name": "br_order_items",
        "baseline_rows": 9004, "injected_rows": 600,
        "columns": {
            "Quantity":  {"null_base": 0.0, "mean_base": 3.0,   "null_post": 0.0, "mean_post": 1.84},
            "LineTotal": {"null_base": 0.0, "mean_base": 5800.0,"null_post": 0.0, "mean_post": 3480.0},
        }
    },
    "BronzeDB.br_orders": {
        "layer": "BRONZE", "schema_name": "BronzeDB", "table_name": "br_orders",
        "baseline_rows": 4006, "injected_rows": 280,
        "columns": {
            "NetPayable":  {"null_base": 0.0, "mean_base": 2100.0, "null_post": 0.0, "mean_post": 2120.0},
            "GrossAmount": {"null_base": 0.0, "mean_base": 2400.0, "null_post": 0.0, "mean_post": 2380.0},
        }
    },
}

COL_INSERT = text("""
    INSERT INTO column_stats
        (stat_id, report_id, connection_id, table_fqn, column_name,
         data_type, null_pct, mean_value, note, created_at, is_cde, is_pii)
    VALUES (:sid, :rid, :conn, :table, :col,
            :dtype, :null_pct, :mean_val, :marker, NOW(), false, false)
""")

RPT_INSERT = text("""
    INSERT INTO profiling_reports
        (report_id, connection_id, table_fqn, layer, schema_name, table_name,
         run_at, row_count, quality_score, triggered_by)
    VALUES (:rid, :conn, :table, :layer, :schema, :tbl,
            :run_at, :rows, :score, :marker)
""")

with engine.begin() as conn:
    conn.execute(text("DELETE FROM column_stats WHERE note = :m"), {"m": MARKER})
    conn.execute(text("DELETE FROM profiling_reports WHERE triggered_by = :m"), {"m": MARKER})
    print("Cleaned previous seed.")

    for table_fqn, cfg in TABLES.items():
        print(f"\nSeeding {table_fqn}...")

        # 7 baseline runs (days -7 to -1)
        for day_offset in range(7, 0, -1):
            rid = str(uuid.uuid4())
            variation = int(cfg["baseline_rows"] * (1 + (day_offset % 3 - 1) * 0.02))
            conn.execute(RPT_INSERT, {"rid": rid, "conn": CONN_ID, "table": table_fqn,
                   "layer": cfg["layer"], "schema": cfg["schema_name"], "tbl": cfg["table_name"],
                   "run_at": NOW - timedelta(days=day_offset),
                   "rows": variation, "score": 97.5, "marker": MARKER})
            for col, stats in cfg["columns"].items():
                conn.execute(COL_INSERT, {"sid": str(uuid.uuid4()), "rid": rid, "conn": CONN_ID,
                       "table": table_fqn, "col": col, "dtype": "varchar",
                       "null_pct": stats["null_base"], "mean_val": stats["mean_base"],
                       "marker": MARKER})

        # 1 post-injection run (today, anomalous)
        post_rid = str(uuid.uuid4())
        post_rows = cfg["baseline_rows"] + cfg["injected_rows"]
        conn.execute(RPT_INSERT, {"rid": post_rid, "conn": CONN_ID, "table": table_fqn,
               "layer": cfg["layer"], "schema": cfg["schema_name"], "tbl": cfg["table_name"],
               "run_at": NOW,
               "rows": post_rows, "score": 65.0, "marker": MARKER})
        for col, stats in cfg["columns"].items():
            conn.execute(COL_INSERT, {"sid": str(uuid.uuid4()), "rid": post_rid, "conn": CONN_ID,
                   "table": table_fqn, "col": col, "dtype": "varchar",
                   "null_pct": stats["null_post"], "mean_val": stats["mean_post"],
                   "marker": MARKER})

        print(f"  7 baseline runs + 1 post-injection ({post_rows} rows)")
        for col, stats in cfg["columns"].items():
            if stats["null_post"] != stats["null_base"]:
                print(f"  ANOMALY {col}: null_pct {stats[null_base]}% -> {stats[null_post]}%")
            if stats.get("mean_post") and stats["mean_post"] != stats["mean_base"]:
                print(f"  ANOMALY {col}: mean {stats[mean_base]} -> {stats[mean_post]}")

print("\n=== Seed complete ===")
