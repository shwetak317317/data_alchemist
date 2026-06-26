"""Simulation API — scenario inject + SSE event stream."""
import asyncio
import json
import logging
import uuid as _uuid
from typing import AsyncGenerator

from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy import text as sqlt
from sqlalchemy.orm import Session

from app.core.metadata_db import get_db, db_session
from app.core.auth_deps import get_current_user, CurrentUser
from app.services.audit_service import log_event

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/simulation", tags=["simulation"])


class InjectRequest(BaseModel):
    scenario_text: str
    connection_id: str | None = None


class RemediateRequest(BaseModel):
    run_id: str
    connection_id: str | None = None


# ── Scenario library ───────────────────────────────────────────────────────────

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

# Natural-language questions for quick-pick chips
_SCENARIO_TITLES = {
    "segment":   "What if the Northeast region stops sending order data entirely?",
    "nullcol":   "Imagine revenue data was not loaded for today's orders.",
    "volume":    "Orders dropped 60% overnight.",
    "whitelist": "A new invalid status code 'GHOST' appeared.",
    "source":    "The CRM feed stopped arriving today.",
}

# Anomaly type + table per scenario
_ANOMALY_TYPE_MAP = {
    "segment":   "SEGMENT",
    "nullcol":   "DISTRIBUTION",
    "volume":    "VOLUME",
    "whitelist": "THRESHOLD",
    "source":    "FRESHNESS",
}

_SCENARIO_TABLES = {
    "segment":   [("silver.orders_enriched", "SILVER"), ("gold.daily_revenue_summary", "GOLD")],
    "nullcol":   [("silver.orders_enriched", "SILVER")],
    "volume":    [("bronze.orders", "BRONZE"), ("silver.orders_enriched", "SILVER")],
    "whitelist": [("silver.orders_enriched", "SILVER")],
    "source":    [("raw.crm_customers", "RAW")],
}


# ── Classification ─────────────────────────────────────────────────────────────

def _classify_regex(text: str) -> str:
    """Regex-based fallback classifier."""
    t = text.lower()
    if "northeast" in t or "region" in t or "segment" in t or "partition" in t or any(
        loc in t for loc in ["chicago", "southeast", "northwest", "southwest", "west coast", "east coast"]
    ):
        return "segment"
    if "revenue" in t or ("not" in t and "load" in t) or "null" in t or "missing" in t:
        return "nullcol"
    if "drop" in t or "60%" in t or "overnight" in t or "volume" in t or "batch" in t or "warehouse" in t:
        return "volume"
    if "ghost" in t or "status" in t or "invalid" in t or "code" in t or "whitelist" in t:
        return "whitelist"
    if "crm" in t or "feed" in t or "arriv" in t or "source" in t or "file" in t or "offline" in t or "stop" in t:
        return "source"
    return "nullcol"


async def _classify_with_llm(text: str) -> str:
    """LLM-powered classification with regex fallback on any error or timeout."""
    try:
        from app.core.llm import achat
        # Hard wall-clock limit: 6s regardless of LiteLLM retry policy
        response = await asyncio.wait_for(
            achat(
                [
                    {
                        "role": "system",
                        "content": (
                            "You are a data quality expert. Classify the data quality scenario into exactly "
                            "one of these five categories and return ONLY the category key, nothing else:\n"
                            "- segment: loss of data for a specific region, channel, location, or partition\n"
                            "- nullcol: a column has unexpected NULL or missing values\n"
                            "- volume: overall row count dropped significantly (not limited to one region)\n"
                            "- whitelist: invalid or unexpected categorical values appeared in data\n"
                            "- source: a source feed, file, or system did not arrive or is unavailable\n"
                            "Return ONLY the key word (segment / nullcol / volume / whitelist / source)."
                        ),
                    },
                    {"role": "user", "content": f"Classify this scenario: {text}"},
                ],
                temperature=0,
                max_tokens=10,
                num_retries=0,
                request_timeout=4,
            ),
            timeout=5.0,
        )
        key = response.strip().lower().split()[0] if response.strip() else ""
        if key in _SCENARIOS:
            logger.info(f"LLM classified '{text[:60]}' -> '{key}'")
            return key
    except Exception as exc:
        logger.warning(f"LLM classification failed, using regex fallback: {exc}")
    return _classify_regex(text)


# ── Anomaly creation ───────────────────────────────────────────────────────────

def _create_simulation_anomaly(db, run_id: str, connection_id: str, scn_key: str, event: dict) -> str:
    """Insert an anomaly_log record for a simulation fail event. Returns anomaly_id."""
    scn = _SCENARIOS[scn_key]
    tables = _SCENARIO_TABLES.get(scn_key, [("silver.orders_enriched", "SILVER")])

    # Choose table based on event title keywords
    table_fqn, layer = tables[0]
    title_lower = event["title"].lower()
    for t, l in tables:
        schema = t.split(".")[0]
        if schema in title_lower:
            table_fqn, layer = t, l
            break

    anomaly_type = _ANOMALY_TYPE_MAP.get(scn_key, "VOLUME")
    severity = "CRITICAL" if scn["drop"] >= 50 else "HIGH"
    aid = str(_uuid.uuid4())

    db.execute(sqlt("""
        INSERT INTO anomaly_log
            (anomaly_id, connection_id, detected_at, layer, table_fqn,
             anomaly_type, description, severity, metric_value, baseline_value,
             deviation_pct, status, created_at)
        VALUES
            (:id, :conn, NOW(), :layer, :table_fqn,
             :type, :desc, :sev, :metric, :baseline, :dev_pct, 'open', NOW())
    """), {
        "id": aid,
        "conn": connection_id,
        "layer": layer,
        "table_fqn": table_fqn,
        "type": anomaly_type,
        "desc": f"[SIM] {event['detail']}",
        "sev": severity,
        "metric": float(scn["drop"]) * 1000.0,
        "baseline": 100000.0,
        "dev_pct": -float(scn["drop"]),
    })
    return aid


# ── SSE event generator ────────────────────────────────────────────────────────

async def _event_generator(
    scn_key: str,
    scenario_text: str,
    run_id: str,
    connection_id: str | None,
) -> AsyncGenerator[str, None]:
    scn = _SCENARIOS[scn_key]

    # 1. Emit scenario metadata (includes run_id so frontend can reference it)
    _meta_payload = {
        "type": "meta",
        "data": {
            "key": scn_key, "run_id": run_id,
            "scenario_type": scn["type"], "drop": scn["drop"], "undercount": scn["undercount"],
            "inject_sql": scn["inject_sql"], "title": scn["title"], "body": scn["body"],
        },
    }
    yield f"data: {json.dumps(_meta_payload)}\n\n"

    # 2. Emit AI classification confirmation event
    _classify_evt = {"type": "event", "data": {"at": 0, "kind": "classify", "title": "AI classified scenario", "detail": f"Identified as: {scn['type']}"}}
    yield f"data: {json.dumps(_classify_evt)}\n\n"

    # 3. Stream scenario events with realistic timing
    events = scn["events"]
    prev_ms = 0
    all_events: list[dict] = []
    fail_events: list[dict] = []

    for at_ms, kind, title, detail in events:
        delay_s = (at_ms - prev_ms) / 1000.0
        if delay_s > 0:
            await asyncio.sleep(delay_s)
        prev_ms = at_ms
        event_data = {"at": at_ms, "kind": kind, "title": title, "detail": detail}
        all_events.append(event_data)
        if kind == "fail":
            fail_events.append(event_data)
        payload = json.dumps({"type": "event", "data": event_data})
        yield f"data: {payload}\n\n"

    # 4. Generate LLM business narrative (non-blocking — failure falls back to static body)
    try:
        from app.core.llm import achat
        # Hard wall-clock limit: 8s regardless of LiteLLM retry policy
        narrative = await asyncio.wait_for(
            achat(
                [
                    {
                        "role": "system",
                        "content": (
                            "You are a data steward writing a 3-4 bullet business explanation of a data quality incident. "
                            "Be concise, factual, and impact-focused. Write in plain English for non-technical stakeholders. "
                            "Format: each bullet on its own line starting with a dash and space (- )."
                        ),
                    },
                    {
                        "role": "user",
                        "content": (
                            f"Scenario type: {scn['type']}\n"
                            f"What happened: {scn['body'][0]}\n"
                            f"Trust score impact: dropped to {scn['drop']} (from ~69)\n"
                            f"Revenue at risk: {scn['undercount']}\n"
                            f"User description: {scenario_text}\n\n"
                            "Generate a 3-4 bullet business explanation."
                        ),
                    },
                ],
                temperature=0.2,
                max_tokens=350,
                num_retries=0,
                request_timeout=6,
            ),
            timeout=8.0,
        )
        if narrative and narrative.strip():
            yield f"data: {json.dumps({'type': 'narrative', 'data': {'text': narrative.strip()}})}\n\n"
    except Exception as exc:
        logger.warning(f"LLM narrative generation failed: {exc}")

    # 5. Signal stream end
    yield f"data: {json.dumps({'type': 'done', 'data': {}})}\n\n"

    # 6. Post-stream: persist run + create anomaly records using a fresh DB session
    try:
        with db_session() as post_db:
            post_db.execute(sqlt("""
                UPDATE simulation_runs
                SET status='completed', completed_at=NOW(), events=:events
                WHERE sim_run_id=:run_id
            """), {"events": json.dumps(all_events), "run_id": run_id})

            if connection_id and fail_events:
                for fe in fail_events:
                    _create_simulation_anomaly(post_db, run_id, connection_id, scn_key, fe)
    except Exception as exc:
        logger.error(f"Post-stream DB update failed for run {run_id}: {exc}")


# ── Endpoints ──────────────────────────────────────────────────────────────────

@router.post("/inject")
async def inject_scenario(
    req: InjectRequest,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user),
):
    """
    Classify (LLM-first, regex fallback) and stream simulation events.
    Returns SSE: meta -> classify -> event x N -> narrative? -> done.
    Post-stream: saves simulation_runs record and creates anomaly_log entries.
    """
    scn_key = await _classify_with_llm(req.scenario_text)
    scn = _SCENARIOS[scn_key]

    # Insert simulation run record before streaming starts
    run_id = str(_uuid.uuid4())
    try:
        db.execute(sqlt("""
            INSERT INTO simulation_runs
                (sim_run_id, connection_id, scenario_id, scenario_text, inject_sql, status, started_at)
            VALUES
                (:run_id, :conn, NULL, :text, :sql, 'running', NOW())
        """), {
            "run_id": run_id,
            "conn": req.connection_id,
            "text": req.scenario_text[:500],
            "sql": scn["inject_sql"],
        })
        db.commit()
    except Exception as exc:
        logger.warning(f"Failed to insert simulation_run: {exc}")

    try:
        log_event(
            db,
            user_email=current_user.email,
            event_type="simulation.inject",
            entity_type="scenario",
            entity_id=scn_key,
            new_value={"scenario_text": req.scenario_text[:200], "classified": scn_key, "run_id": run_id},
            reason=f"Scenario '{scn['type']}' injected via simulator",
            connection_id=req.connection_id,
        )
        db.commit()
    except Exception:
        pass

    return StreamingResponse(
        _event_generator(scn_key, req.scenario_text, run_id, req.connection_id),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )


@router.post("/remediate")
def remediate_simulation(
    req: RemediateRequest,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user),
):
    """
    Mark a simulation run as remediated.
    - Updates simulation_runs.status to 'remediated'
    - Acknowledges all [SIM] anomalies for the connection
    - Upserts trust_score_history with score=91
    """
    try:
        db.execute(sqlt(
            "UPDATE simulation_runs SET status='remediated' WHERE sim_run_id=:id"
        ), {"id": req.run_id})

        if req.connection_id:
            db.execute(sqlt("""
                UPDATE anomaly_log
                SET status='acknowledged', acknowledged_by=:by, acknowledged_at=NOW()
                WHERE description LIKE '[SIM]%'
                  AND connection_id=:conn
                  AND status='open'
            """), {"by": current_user.email, "conn": req.connection_id})

            db.execute(sqlt("""
                INSERT INTO trust_score_history
                    (history_id, connection_id, score_date, overall_score, recorded_at)
                VALUES
                    (:id, :conn, NOW()::DATE, 91.0, NOW())
                ON CONFLICT (connection_id, score_date)
                DO UPDATE SET overall_score = 91.0, recorded_at = NOW()
            """), {"id": str(_uuid.uuid4()), "conn": req.connection_id})

        log_event(
            db,
            user_email=current_user.email,
            event_type="simulation.remediate",
            entity_type="simulation_run",
            entity_id=req.run_id,
            connection_id=req.connection_id,
        )
        db.commit()
    except Exception as exc:
        logger.warning(f"Remediate update failed: {exc}")
        try:
            db.rollback()
        except Exception:
            pass

    return {"status": "remediated", "trust_score": 91}


@router.get("/history")
def get_simulation_history(
    connection_id: str | None = None,
    limit: int = 10,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user),
):
    """Return recent simulation runs, newest first."""
    params: dict = {"limit": limit}
    where_parts = []
    if connection_id:
        where_parts.append("connection_id=:conn")
        params["conn"] = connection_id
    where = ("WHERE " + " AND ".join(where_parts)) if where_parts else ""

    rows = db.execute(sqlt(f"""
        SELECT sim_run_id, connection_id, scenario_text, inject_sql, status,
               started_at, completed_at,
               COALESCE(jsonb_array_length(events), 0) AS event_count
        FROM simulation_runs
        {where}
        ORDER BY started_at DESC
        LIMIT :limit
    """), params).fetchall()

    return [
        {
            "run_id": r[0],
            "connection_id": r[1],
            "scenario_text": r[2] or "",
            "inject_sql": r[3] or "",
            "status": r[4] or "unknown",
            "started_at": r[5].isoformat() if r[5] else None,
            "completed_at": r[6].isoformat() if r[6] else None,
            "event_count": r[7] or 0,
        }
        for r in rows
    ]


@router.get("/scenarios")
def list_scenarios(
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user),
):
    """Return available scenario templates, preferring DB-stored scenarios."""
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

    # Fallback with proper NL titles so quick-pick chips populate the input correctly
    return [
        {
            "key": k,
            "title": _SCENARIO_TITLES[k],
            "scenario_type": v["type"],
            "drop": v["drop"],
            "undercount": v["undercount"],
        }
        for k, v in _SCENARIOS.items()
    ]
