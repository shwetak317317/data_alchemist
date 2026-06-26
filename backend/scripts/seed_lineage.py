"""
Seed script — inserts the RetailCo demo lineage graph into the DB.

Usage:
    cd backend
    python scripts/seed_lineage.py [connection_id]

If connection_id is omitted, the script uses the first connection in the DB.
Re-running is safe — uses ON CONFLICT DO NOTHING.
"""
import sys
import os

# Allow running from the backend/ directory
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy import create_engine, text

DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://postgres:postgres@localhost:5432/datatrust")

# ── Demo lineage definition (matches window.DT.impact in app/data.js) ──────

NODES = [
    # (external_id, label, sub_label, layer, node_type, tier_label, health_status, position_order, is_source)
    ("silver.orders_enriched",        "silver.orders_enriched",        "net_revenue · 11.2% NULL", "SILVER", "table",  "SOURCE",           "fail", 0, True),
    ("gold.daily_revenue_summary",    "gold.daily_revenue_summary",    None,                       "GOLD",   "table",  "GOLD",             "fail", 0, False),
    ("gold.customer_segments",        "gold.customer_segments",        None,                       "GOLD",   "table",  "GOLD",             "warn", 1, False),
    ("Finance Dashboard",             "Finance Dashboard",             "DO NOT PUBLISH",           "REPORT", "report", "REPORTS / MODELS", "fail", 0, False),
    ("CFO Weekly Report",             "CFO Weekly Report",             "Queued — hold",            "REPORT", "report", "REPORTS / MODELS", "warn", 1, False),
    ("ml.revenue_forecast_v3",        "ml.revenue_forecast_v3",       "Training data incomplete", "MODEL",  "model",  "REPORTS / MODELS", "fail", 2, False),
    ("ml.churn_predictor_v2",         "ml.churn_predictor_v2",        "Feature incomplete",       "MODEL",  "model",  "REPORTS / MODELS", "warn", 3, False),
    ("ops.fulfilment_sla",            "ops.fulfilment_sla",           "Revenue SLA threshold wrong", "MODEL", "model", "REPORTS / MODELS", "warn", 4, False),
]

EDGES = [
    # (source_ext_id, target_ext_id, edge_type)
    ("silver.orders_enriched",     "gold.daily_revenue_summary", "FEEDS"),
    ("silver.orders_enriched",     "gold.customer_segments",     "FEEDS"),
    ("gold.daily_revenue_summary", "Finance Dashboard",           "FEEDS"),
    ("gold.daily_revenue_summary", "CFO Weekly Report",           "FEEDS"),
    ("gold.daily_revenue_summary", "ml.revenue_forecast_v3",     "FEEDS"),
    ("gold.daily_revenue_summary", "ops.fulfilment_sla",         "FEEDS"),
    ("gold.customer_segments",     "ml.churn_predictor_v2",      "FEEDS"),
]


def seed(connection_id: str):
    engine = create_engine(DATABASE_URL)
    ext_id_to_node_id = {}

    with engine.begin() as conn:
        # Upsert nodes
        for ext_id, label, sub_label, layer, node_type, tier_label, health, pos, is_src in NODES:
            row = conn.execute(text("""
                INSERT INTO lineage_nodes
                    (connection_id, external_id, label, sub_label, layer, node_type,
                     tier_label, health_status, position_order, is_source)
                VALUES
                    (:conn, :ext, :label, :sub, :layer, :ntype,
                     :tier, :health, :pos, :is_src)
                ON CONFLICT (connection_id, external_id) DO UPDATE
                    SET health_status = EXCLUDED.health_status
                RETURNING node_id
            """), {
                "conn": connection_id, "ext": ext_id, "label": label,
                "sub": sub_label, "layer": layer, "ntype": node_type,
                "tier": tier_label, "health": health, "pos": pos, "is_src": is_src,
            }).fetchone()
            ext_id_to_node_id[ext_id] = row[0]
            print(f"  node: {ext_id} → {row[0]}")

        # Upsert edges
        for src_ext, tgt_ext, etype in EDGES:
            src_id = ext_id_to_node_id.get(src_ext)
            tgt_id = ext_id_to_node_id.get(tgt_ext)
            if not src_id or not tgt_id:
                print(f"  SKIP edge {src_ext} → {tgt_ext} (node not found)")
                continue
            conn.execute(text("""
                INSERT INTO lineage_edges (connection_id, source_node_id, target_node_id, edge_type)
                VALUES (:conn, :src, :tgt, :etype)
                ON CONFLICT (connection_id, source_node_id, target_node_id) DO NOTHING
            """), {"conn": connection_id, "src": src_id, "tgt": tgt_id, "etype": etype})
            print(f"  edge: {src_ext} → {tgt_ext} [{etype}]")

    print(f"\nSeeded {len(NODES)} nodes and {len(EDGES)} edges for connection {connection_id}")


def main():
    engine = create_engine(DATABASE_URL)
    with engine.connect() as conn:
        if len(sys.argv) > 1:
            connection_id = sys.argv[1]
        else:
            row = conn.execute(text("SELECT id, name FROM connections LIMIT 1")).fetchone()
            if not row:
                print("ERROR: No connections found in DB. Create a connection first.")
                sys.exit(1)
            connection_id = row[0]
            print(f"Using connection: {row[1]} ({connection_id})")

    print(f"\nSeeding RetailCo lineage for connection_id={connection_id}\n")
    seed(connection_id)


if __name__ == "__main__":
    main()
