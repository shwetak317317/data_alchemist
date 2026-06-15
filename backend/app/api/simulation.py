"""Simulation API — scenario inject + SSE event stream."""
import asyncio
import json
import logging
from typing import AsyncGenerator

from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core.metadata_db import get_db
from app.services.audit_service import log_event

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/simulation", tags=["simulation"])


class InjectRequest(BaseModel):
    scenario_text: str
    connection_id: str | None = None


# Scenario definitions mirroring the frontend SCN map
_SCENARIOS = {
    "segment": {
        "type": "Segment loss",
        "drop": 54,
        "undercount": "$73.5M",
        "inject_sql": "DELETE FROM silver.orders_enriched WHERE region='Northeast'",
        "events": [
            (0,    "inject",  "Scenario injected",                                      "Northeast region orders removed — 841,200 rows"),
            (900,  "scan",    "Monitoring agent triggered incremental DQ scan",          "watching silver + gold"),
            (2100, "fail",    "ANOMALY: Volume — silver.orders_enriched",                "Northeast segment: 0 rows today vs avg 841,200 · 100% drop · CRITICAL"),
            (2700, "fail",    "ANOMALY: Cross-segment imbalance",                        "Northeast share 0% today vs avg 18.4% · West + Central spiking"),
            (3300, "fail",    "RULE FAILURE: gold.daily_revenue_summary",                "net_revenue 22% below 7-day avg (Northeast ≈ 21% of revenue)"),
            (3900, "explain", "Business explanation generated",                          "regional data loss narrative ready"),
        ],
        "title": "CRITICAL DATA TRUST ALERT — Regional Data Loss",
        "body": [
            "The Northeast region has sent zero orders today, vs its daily average of 841,000 — a 100% data loss for that region.",
            "Revenue undercount of approximately $73.5M.",
            "Northeast regional KPIs will show as zero; customer segmentation misses 18% of daily customers.",
            "Downstream: 4 Gold tables, 2 dashboards, 1 ML model.",
        ],
    },
    "nullcol": {
        "type": "Column NULL",
        "drop": 52,
        "undercount": "$221.9M",
        "inject_sql": "UPDATE silver.orders_enriched SET net_revenue=NULL WHERE order_date=CURRENT_DATE",
        "events": [
            (0,    "inject",  "Scenario injected",                                      "net_revenue set to NULL for today's orders"),
            (800,  "scan",    "Monitoring agent triggered DQ execution",                 "re-running Silver rule set"),
            (2000, "fail",    "CRITICAL ALERT: revenue_not_null FAILED",                 "228,445 records · 12.4% null · Silver layer"),
            (2600, "fail",    "Anomaly detected",                                        "null rate 15× above baseline (0.8% → 12.4%)"),
            (3200, "explain", "Business explanation generated",                          "Finance + ML impact narrative ready"),
        ],
        "title": "CRITICAL DATA TRUST ALERT — Revenue Data Missing",
        "body": [
            "Today's revenue data is missing for 12.4% of orders (228,445 records).",
            "Revenue undercount of approximately $221.9M.",
            "Impacts the Finance Daily Revenue Dashboard and 3 production ML models.",
        ],
    },
    "volume": {
        "type": "Volume drop",
        "drop": 50,
        "undercount": "$132M",
        "inject_sql": "DELETE FROM bronze.orders WHERE order_date=CURRENT_DATE LIMIT 60%",
        "events": [
            (0,    "inject",  "Scenario injected",                                      "60% of today's Bronze orders deleted"),
            (900,  "scan",    "Monitoring agent triggered volume scan",                  "comparing vs 7-day rolling average"),
            (2100, "fail",    "ANOMALY: Volume drop — bronze.orders",                    "row count −60% vs baseline · ±2σ breach · CRITICAL"),
            (2800, "fail",    "Cascade: silver.orders_enriched under-populated",         "downstream Gold aggregates will undercount"),
            (3400, "explain", "Business explanation generated",                          "volume anomaly narrative ready"),
        ],
        "title": "CRITICAL DATA TRUST ALERT — Volume Collapse",
        "body": [
            "Today's order volume is 60% below the 7-day rolling average.",
            "Revenue undercount of approximately $132M.",
            "All channels and regions affected proportionally — ingestion/source issue.",
        ],
    },
    "whitelist": {
        "type": "Whitelist breach",
        "drop": 63,
        "undercount": "—",
        "inject_sql": "INSERT INTO silver.orders_enriched (status) VALUES ('GHOST') -- × 5,000 rows",
        "events": [
            (0,    "inject",  "Scenario injected",                                      "5,000 rows with status='GHOST' inserted"),
            (800,  "scan",    "Monitoring agent triggered rule scan",                    "status whitelist check"),
            (1900, "fail",    "RULE FAILURE: status IN whitelist",                       "5,000 rows with unapproved value 'GHOST' · HIGH"),
            (2600, "warn",    "ANOMALY: Segment concentration",                          "GHOST appears in 1 channel only — possible deploy bug"),
            (3200, "explain", "Business explanation generated",                          "invalid code narrative ready"),
        ],
        "title": "HIGH DATA TRUST ALERT — Unapproved Status Code",
        "body": [
            "5,000 orders carry status 'GHOST', which is not in the approved whitelist.",
            "Concentrated in a single channel — suggests a code deployment introduced the value.",
        ],
    },
    "source": {
        "type": "Source non-arrival",
        "drop": 58,
        "undercount": "—",
        "inject_sql": "-- Remove raw.crm_customers arrival timestamp for today",
        "events": [
            (0,    "inject",  "Scenario injected",                                      "CRM source file removed for today"),
            (1000, "scan",    "Monitoring agent checked source arrivals",                "expected by 05:30 AM"),
            (2200, "fail",    "SOURCE NON-ARRIVAL: raw.crm_customers",                  "file not seen · SLA breached · HIGH"),
            (2900, "warn",    "Downstream freshness at risk",                            "bronze.customers + 3 Silver joins will use stale data"),
            (3500, "explain", "Business explanation generated",                          "source SLA narrative ready"),
        ],
        "title": "HIGH DATA TRUST ALERT — Source Feed Missing",
        "body": [
            "The CRM customer extract has not arrived (expected by 05:30 AM).",
            "3 Silver tables and downstream segmentation depend on this feed.",
        ],
    },
}


def _classify(text: str) -> str:
    t = text.lower()
    if "northeast" in t or ("region" in t and any(w in t for w in ["stop", "entirely", "loss"])):
        return "segment"
    if "revenue" in t or ("not" in t and "load" in t) or "null" in t:
        return "nullcol"
    if "drop" in t or "60%" in t or "overnight" in t or "volume" in t:
        return "volume"
    if "ghost" in t or "status" in t or "invalid" in t or "code" in t:
        return "whitelist"
    if "crm" in t or "feed" in t or "arriv" in t or "source" in t:
        return "source"
    return "nullcol"


async def _event_generator(scn_key: str, scenario_text: str) -> AsyncGenerator[str, None]:
    scn = _SCENARIOS[scn_key]

    # Emit scenario metadata first
    yield f"data: {json.dumps({'type': 'meta', 'data': {'key': scn_key, 'scenario_type': scn['type'], 'drop': scn['drop'], 'undercount': scn['undercount'], 'inject_sql': scn['inject_sql'], 'title': scn['title'], 'body': scn['body']}})}\n\n"

    events = scn["events"]
    prev_ms = 0
    for at_ms, kind, title, detail in events:
        delay_s = (at_ms - prev_ms) / 1000.0
        if delay_s > 0:
            await asyncio.sleep(delay_s)
        prev_ms = at_ms
        payload = json.dumps({
            "type": "event",
            "data": {"at": at_ms, "kind": kind, "title": title, "detail": detail},
        })
        yield f"data: {payload}\n\n"

    yield f"data: {json.dumps({'type': 'done', 'data': {}})}\n\n"


@router.post("/inject")
async def inject_scenario(req: InjectRequest, db: Session = Depends(get_db)):
    """
    Classify and stream simulation events for the given scenario text.
    Returns an SSE stream: meta → event × N → done.
    """
    scn_key = _classify(req.scenario_text)
    scn = _SCENARIOS[scn_key]

    try:
        log_event(
            db,
            user_name="simulator",
            event_type="simulation.inject",
            entity_type="scenario",
            entity_id=scn_key,
            new_value={"scenario_text": req.scenario_text[:200], "classified": scn_key},
            reason=f"Scenario '{scn['type']}' injected via simulator",
            connection_id=req.connection_id,
        )
        db.commit()
    except Exception:
        pass

    return StreamingResponse(
        _event_generator(scn_key, req.scenario_text),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )


@router.get("/scenarios")
def list_scenarios(db: Session = Depends(get_db)):
    """Return the list of available scenario templates, preferring DB-stored scenarios."""
    from sqlalchemy import text as sqlt
    rows = db.execute(sqlt("""
        SELECT scenario_id, title, scenario_type, description, is_builtin, position_order
        FROM simulation_scenarios ORDER BY position_order
    """)).fetchall()

    if rows:
        return [
            {
                "scenario_id": r[0], "title": r[1], "scenario_type": r[2],
                "description": r[3] or "", "is_builtin": r[4], "position_order": r[5],
            }
            for r in rows
        ]
    # Fallback to hardcoded if DB is empty
    return [
        {"key": k, "type": v["type"], "drop": v["drop"], "undercount": v["undercount"]}
        for k, v in _SCENARIOS.items()
    ]
