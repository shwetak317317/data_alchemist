"""Simulation API — scenario inject + SSE event stream."""
import asyncio
import json
import logging
import re as _re
import uuid as _uuid
from typing import AsyncGenerator

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy import text as sqlt
from sqlalchemy.orm import Session

from app.core.metadata_db import get_db, db_session
from app.core.auth_deps import get_current_user, CurrentUser
from app.services.audit_service import log_event
from app.services.simulation_classify import (
    CLASSIFY_PROMPT_VERSION,
    ClassifyResult,
    NarrativeOutput,
    UnknownScenarioShape,
    classify_with_llm,
)
from app.prompts.simulation import NARRATIVE_PROMPT_VERSION

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
            "Fulfilment SLA for Northeast appears as 100% (no orders = no breach detected — a false positive).",
            "Downstream: 4 Gold tables, 2 dashboards, 1 ML model. Recommend contacting Northeast OMS team and holding the Gold re-run.",
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
            "Likely caused by an incomplete pipeline run — the discount calculation step did not populate net_revenue.",
            "Recommend re-running the Bronze + Silver pipelines for today's partition.",
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
            "All channels and regions affected proportionally — points to an ingestion/source issue, not a business event.",
            "Downstream Gold revenue and segment tables will undercount until reloaded.",
            "Recommend verifying the source extract completeness and re-ingesting the Bronze partition.",
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
            "Order lifecycle reporting and fulfilment routing for these orders is undefined.",
            "Concentrated in a single channel — suggests a code deployment introduced the value.",
            "Recommend confirming with the OMS team whether 'GHOST' is intentional; if not, quarantine the rows.",
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
            "Customer attributes (region, loyalty tier) will be stale or missing in today's joins.",
            "3 Silver tables and downstream segmentation depend on this feed.",
            "Recommend contacting the CRM source team and holding dependent pipelines until the file lands.",
        ],
    },
    "unknown": {
        "type": "Unclassified incident",
        "drop": 55,
        "undercount": "—",
        "inject_sql": "-- Custom data quality incident — manual review required",
        "events": [
            (0,    "inject",  "Scenario received",                                      "Unclassified data quality issue — running full scan"),
            (700,  "scan",    "Monitoring agent triggered full DQ scan",                 "checking all active rules across all layers"),
            (2000, "fail",    "ANOMALY: Data quality deviation detected",                "one or more metrics outside normal range — review anomaly inbox"),
            (3200, "explain", "Business explanation generated",                          "incident analysis ready"),
        ],
        "title": "DATA QUALITY ALERT — Unclassified Incident",
        "body": [
            "An unclassified data quality incident has been reported.",
            "A full DQ scan has been triggered across all active rules.",
            "Review the anomaly inbox and profiling reports for the affected tables.",
            "If this is a recurring pattern, consider adding it as a named scenario for future detection.",
        ],
    },
}

# Natural-language questions for quick-pick chips (excludes "unknown" — not a selectable preset)
_SCENARIO_TITLES = {
    "segment":   "What if the Northeast region stops sending order data entirely?",
    "nullcol":   "Imagine revenue data was not loaded for today's orders.",
    "volume":    "Orders dropped 60% overnight.",
    "whitelist": "A new invalid status code 'GHOST' appeared.",
    "source":    "The CRM feed stopped arriving today.",
}

_ANOMALY_TYPE_MAP = {
    "segment":   "SEGMENT",
    "nullcol":   "DISTRIBUTION",
    "volume":    "VOLUME",
    "whitelist": "THRESHOLD",
    "source":    "FRESHNESS",
    "unknown":   "VOLUME",
}

_SCENARIO_TABLES = {
    "segment":   [("silver.orders_enriched", "SILVER"), ("gold.daily_revenue_summary", "GOLD")],
    "nullcol":   [("silver.orders_enriched", "SILVER")],
    "volume":    [("bronze.orders", "BRONZE"), ("silver.orders_enriched", "SILVER")],
    "whitelist": [("silver.orders_enriched", "SILVER")],
    "source":    [("raw.crm_customers", "RAW")],
    "unknown":   [("silver.orders_enriched", "SILVER")],
}

# Common source-system prefixes stripped before keyword comparison, e.g. "br_orders" -> "orders".
_TABLE_PREFIX_RE = _re.compile(r"^(br|bz|raw|stg|src|sl|gl|bronze|silver|gold)_")


# ── Real-table resolution ───────────────────────────────────────────────────────
# The scenario library above is written against a fictional demo schema
# (bronze.orders, silver.orders_enriched, raw.crm_customers, ...). A real customer
# connection is profiled under its own schema/table names (e.g. BronzeDB.br_orders),
# which never match those literals. Without resolution, _fetch_profiling_context /
# _fetch_lineage_context always return {} for real connections — the narrative is
# never actually grounded despite the code path existing. This resolves the
# scenario's canonical table against whatever the connection was really profiled as.

def _table_tokens(name: str) -> tuple:
    """Normalize a table reference into comparable keyword tokens: drop schema prefix,
    drop common source-system prefixes, split on non-letters, naively singularize."""
    base = name.split(".")[-1].lower()
    base = _TABLE_PREFIX_RE.sub("", base)
    tokens = [t for t in _re.split(r"[^a-z]+", base) if t]
    tokens = [t[:-1] if t.endswith("s") and len(t) > 3 else t for t in tokens]
    return tuple(tokens)


def _score_table_match(search_tokens: tuple, candidate_tokens: tuple) -> float:
    """Higher is better. 100 = exact normalized match. 0 = no shared keyword at all —
    callers must treat 0 as 'no match' so we never fabricate an unrelated grounding."""
    if not search_tokens or not candidate_tokens:
        return 0.0
    if search_tokens == candidate_tokens:
        return 100.0
    overlap = len(set(search_tokens) & set(candidate_tokens))
    if overlap == 0:
        return 0.0
    return overlap / len(candidate_tokens)


def _resolve_grounding_table(
    connection_id: str | None, scn_key: str, table_hint: str | None = None
) -> tuple[str, str] | None:
    """Find a REAL table this connection was actually profiled on to ground a scenario.

    table_hint, when given (e.g. a table name the user mentioned or the LLM extracted),
    takes priority over the scenario's fictional default name as the search term — but
    is still matched against real profiled tables, never used verbatim, so grounding
    never points at a table that doesn't exist in this connection.

    Restricted to the scenario's canonical layer so we never cross-wire a Bronze table
    into a "Silver rule failure" narrative. Returns None (never fabricates) when the
    connection has no profiling data for that layer or nothing shares a real keyword
    with the search term.
    """
    if not connection_id:
        return None
    default_table, target_layer = _SCENARIO_TABLES.get(scn_key, [("", "SILVER")])[0]
    search_term = table_hint or default_table
    search_tokens = _table_tokens(search_term)
    if not search_tokens:
        return None

    try:
        with db_session() as db:
            rows = db.execute(sqlt("""
                SELECT DISTINCT ON (table_fqn) table_fqn, layer
                FROM profiling_reports
                WHERE connection_id = :conn AND layer = :layer
                ORDER BY table_fqn, run_at DESC
            """), {"conn": connection_id, "layer": target_layer}).fetchall()
    except Exception as exc:
        logger.warning("_resolve_grounding_table connection=%s scenario=%s: %s", connection_id, scn_key, exc)
        return None

    best: tuple[str, str] | None = None
    best_score = 0.0
    for table_fqn, layer in rows:
        score = _score_table_match(search_tokens, _table_tokens(table_fqn))
        if score > best_score:
            best, best_score = (table_fqn, layer or target_layer), score
    return best


# ── Real-data context fetchers ─────────────────────────────────────────────────

def _fetch_profiling_context(
    connection_id: str | None,
    table_fqn: str,
    column_name: str | None,
) -> dict:
    """Fetch latest profiling metrics for the narrative prompt. Returns {} on any failure."""
    if not connection_id or not table_fqn:
        return {}
    try:
        with db_session() as db:
            row = db.execute(sqlt("""
                SELECT report_id, row_count, quality_score, run_at
                FROM profiling_reports
                WHERE connection_id = :conn AND table_fqn = :fqn
                ORDER BY run_at DESC LIMIT 1
            """), {"conn": connection_id, "fqn": table_fqn}).fetchone()

            if not row:
                return {}

            ctx: dict = {
                "table_fqn": table_fqn,
                "row_count": row[1],
                "quality_score": float(row[2]) if row[2] is not None else None,
                "last_profiled": str(row[3])[:10] if row[3] else None,
            }

            if column_name and row[0]:
                col_row = db.execute(sqlt("""
                    SELECT null_pct, mean_value
                    FROM column_stats
                    WHERE report_id = :rid AND column_name = :col
                    LIMIT 1
                """), {"rid": row[0], "col": column_name}).fetchone()
                if col_row:
                    ctx["column_name"] = column_name
                    ctx["null_pct"] = float(col_row[0]) if col_row[0] is not None else None
                    ctx["mean_value"] = float(col_row[1]) if col_row[1] is not None else None

            return ctx
    except Exception as exc:
        logger.warning("_fetch_profiling_context %s: %s", table_fqn, exc)
        return {}


def _fetch_lineage_context(connection_id: str | None, table_fqn: str) -> dict:
    """Fetch immediate downstream lineage for the narrative prompt. Returns {} on any failure."""
    if not connection_id or not table_fqn:
        return {}
    try:
        with db_session() as db:
            rows = db.execute(sqlt("""
                SELECT ln.label, ln.layer, ln.node_type
                FROM lineage_edges le
                JOIN lineage_nodes src
                    ON src.node_id = le.source_node_id
                   AND src.connection_id = :conn
                   AND src.external_id = :fqn
                JOIN lineage_nodes ln
                    ON ln.node_id = le.target_node_id
                LIMIT 8
            """), {"conn": connection_id, "fqn": table_fqn}).fetchall()

            if not rows:
                return {}
            return {
                "downstream": [
                    {"label": r[0], "layer": r[1] or "", "node_type": r[2] or "table"}
                    for r in rows
                ]
            }
    except Exception as exc:
        logger.warning("_fetch_lineage_context %s: %s", table_fqn, exc)
        return {}


# ── Scenario parameterization ──────────────────────────────────────────────────

def _parameterize_scenario(
    scn_key: str, classify_result: ClassifyResult, grounded_table: tuple[str, str] | None = None
) -> dict:
    """Return a scenario dict with user-provided entities substituted for template placeholders.

    _SCENARIOS is never mutated — always returns a new dict when substitutions apply,
    or the original dict reference when there is nothing to substitute.

    Substitution is applied to: events (title + detail), inject_sql, body, title.
    Numbers and percentages are left as-is (those come from real metrics in P3).

    grounded_table, when given, is a REAL table this connection was profiled on (see
    _resolve_grounding_table) and always takes priority over raw entity text for the
    table-name placeholder — the displayed SQL/narrative then references a table that
    actually exists, and the same value is reused by the caller to ground the
    profiling/lineage context fetch, keeping the timeline and narrative consistent.
    """
    base = _SCENARIOS[scn_key]
    e = classify_result.extracted_entities

    replacements: dict[str, str] = {}

    if scn_key == "segment" and e.region:
        replacements["Northeast"] = e.region

    elif scn_key == "nullcol" and e.column:
        # Only replace the specific column placeholder — leave generic "revenue" prose alone.
        replacements["net_revenue"] = e.column

    elif scn_key == "whitelist":
        # Value first (with and without quotes), then column — order matters.
        if e.value:
            safe_value = e.value.replace("'", "''")  # escape SQL single quotes
            replacements["'GHOST'"] = f"'{safe_value}'"
            replacements["GHOST"]   = e.value
        if e.column and _re.match(r"^\w+$", e.column):
            replacements["status"] = e.column

    default_table = _SCENARIO_TABLES.get(scn_key, [(None, None)])[0][0]
    if default_table:
        if grounded_table:
            replacements[default_table] = grounded_table[0]
            if scn_key == "source":
                replacements["CRM"] = grounded_table[0].split(".")[-1].replace("_", " ").upper()
        elif scn_key in ("volume", "source") and e.table and _re.match(r"^[\w.]+$", e.table):
            # No real table matched this connection (demo mode / no connection) — still
            # personalize the displayed text with what the user typed, but this value is
            # NOT used for DB grounding (the caller only grounds on grounded_table).
            full_table = e.table if ("." in e.table or scn_key != "source") else f"raw.{e.table}"
            replacements[default_table] = full_table
            if scn_key == "source":
                replacements["CRM"] = e.table.split(".")[-1].replace("_", " ").upper()

    if not replacements:
        return base

    def _sub(text: str) -> str:
        for old, new in replacements.items():
            text = text.replace(old, new)
        return text

    return {
        **base,
        "events":     [(_at, _kind, _sub(_title), _sub(_detail))
                       for _at, _kind, _title, _detail in base["events"]],
        "inject_sql": _sub(base["inject_sql"]),
        "body":       [_sub(b) for b in base["body"]],
        "title":      _sub(base["title"]),
    }


# ── Concurrency guard ─────────────────────────────────────────────────────────

_INJECT_LOCKS: dict[str, asyncio.Lock] = {}


def _get_inject_lock(connection_id: str | None) -> asyncio.Lock:
    key = connection_id or "__no_conn__"
    if key not in _INJECT_LOCKS:
        _INJECT_LOCKS[key] = asyncio.Lock()
    return _INJECT_LOCKS[key]


# ── Unknown scenario synthesis ─────────────────────────────────────────────────

async def _synthesize_unknown_scenario(
    scenario_text: str, base_scn: dict, run_id: str | None = None
) -> dict:
    """Give 'unknown' scenarios a meaningful type label from the LLM.

    Updates type, inject_sql, alert title, and the first event detail.
    Falls back to base_scn unchanged on any failure — never raises.
    """
    import time as _time
    start = _time.monotonic()
    try:
        from app.core.llm import achat_with_usage, parse_llm_json
        from app.prompts.simulation import build_synthesize_unknown_prompt

        raw, usage = await asyncio.wait_for(
            achat_with_usage(
                build_synthesize_unknown_prompt(scenario_text),
                temperature=0,
                max_tokens=150,
                num_retries=0,
                request_timeout=4,
            ),
            timeout=5.0,
        )
        shape = UnknownScenarioShape.model_validate(parse_llm_json(raw))

        # Patch the first event's detail so the timeline reads correctly.
        patched_events = list(base_scn["events"])
        if patched_events:
            at, kind, title, _ = patched_events[0]
            patched_events[0] = (at, kind, title, shape.inject_label[:120])

        logger.info(json.dumps({
            "event": "llm.synthesize_unknown",
            "run_id": run_id,
            "model": usage.get("model") if usage else None,
            "latency_ms": round((_time.monotonic() - start) * 1000),
            "input_tokens": usage.get("input_tokens") if usage else None,
            "output_tokens": usage.get("output_tokens") if usage else None,
            "raw_response": raw[:300],
            "type": shape.type,
            "alert_title": shape.alert_title,
        }))
        return {
            **base_scn,
            "type":       shape.type,
            "inject_sql": f"-- {shape.inject_label}",
            "title":      shape.alert_title,
            "events":     patched_events,
        }
    except Exception as exc:
        logger.warning(
            "Unknown scenario synthesis failed (%s: %s) — using generic template",
            type(exc).__name__, exc,
        )
        return base_scn


# ── Anomaly creation ───────────────────────────────────────────────────────────

def _create_simulation_anomaly(
    db, run_id: str, connection_id: str, scn_key: str, event: dict
) -> str:
    scn = _SCENARIOS[scn_key]
    tables = _SCENARIO_TABLES.get(scn_key, [("silver.orders_enriched", "SILVER")])

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

async def _event_stream(
    scn_key: str,
    scenario_text: str,
    run_id: str,
    connection_id: str | None,
    classify_result: ClassifyResult,
    scn: dict,
    grounded_table: tuple[str, str] | None = None,
) -> AsyncGenerator[str, None]:
    """Core SSE stream: meta → classify → events → narrative → done → post-stream DB write.

    scn is pre-parameterized (and synthesized for 'unknown') by inject_scenario.
    grounded_table is the REAL table resolved by _resolve_grounding_table, kept in sync
    with what inject_scenario already substituted into scn — so the DB context fetched
    here always describes the same table the displayed SQL/timeline/narrative reference.
    """
    _has_real_metrics = False

    # 1. Emit scenario metadata — includes confidence and compound for the frontend.
    _meta_payload = {
        "type": "meta",
        "data": {
            "key": scn_key,
            "run_id": run_id,
            "scenario_type": scn["type"],
            "drop": scn["drop"],
            "undercount": scn["undercount"],
            "inject_sql": scn["inject_sql"],
            "title": scn["title"],
            "body": scn["body"],
            "confidence": round(classify_result.confidence, 3),
            "compound": classify_result.compound,
        },
    }
    yield f"data: {json.dumps(_meta_payload)}\n\n"

    # 2. Emit classification event with confidence context.
    conf_note = (
        f" · {classify_result.confidence:.0%} confidence"
        if classify_result.confidence < 0.80
        else ""
    )
    compound_note = " · compound issue detected" if classify_result.compound else ""
    _classify_evt = {
        "type": "event",
        "data": {
            "at": 0,
            "kind": "classify",
            "title": "AI classified scenario",
            "detail": f"Identified as: {scn['type']}{conf_note}{compound_note}",
        },
    }
    yield f"data: {json.dumps(_classify_evt)}\n\n"

    # 3. Stream scenario events with realistic timing.
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
        yield f"data: {json.dumps({'type': 'event', 'data': event_data})}\n\n"

    # 4. Generate LLM business narrative with real profiling/lineage context.
    try:
        import time as _time
        from app.core.llm import achat_with_usage, parse_llm_json
        from app.prompts.simulation import build_narrative_prompt

        # Primary affected table for grounding — the same REAL table already substituted
        # into scn's displayed SQL/events (see _resolve_grounding_table), so the fetched
        # context always matches what the user sees in the timeline. Falls back to the
        # scenario's fictional default only when no real match exists (context then
        # legitimately comes back empty — never a fabricated/mismatched grounding).
        e = classify_result.extracted_entities
        if grounded_table:
            primary_table = grounded_table[0]
        else:
            tables = _SCENARIO_TABLES.get(scn_key, [("silver.orders_enriched", "SILVER")])
            primary_table = tables[0][0]

        # Parallelize independent DB fetches — each uses its own db_session().
        loop = asyncio.get_event_loop()
        profiling_ctx, lineage_ctx = await asyncio.gather(
            loop.run_in_executor(None, _fetch_profiling_context, connection_id, primary_table, e.column),
            loop.run_in_executor(None, _fetch_lineage_context, connection_id, primary_table),
        )
        _has_real_metrics = bool(profiling_ctx)

        messages = build_narrative_prompt(
            scenario_text=scenario_text,
            scenario_type=scn["type"],
            profiling_ctx=profiling_ctx,
            lineage_ctx=lineage_ctx,
        )

        bullets: list[str] | None = None
        raw_narrative = ""
        narrative_usage: dict | None = None
        _narrative_start = _time.monotonic()

        for attempt in range(2):
            try:
                # 5 bullets x "1-2 complete sentences" (per the prompt's own rule) regularly
                # runs 350-450 content tokens once the model's actual phrasing is verbose,
                # before JSON/quoting overhead — 500 was truncating mid-bullet often enough
                # to break JSON parsing and silently fall back to the static template even
                # when real profiling/lineage grounding succeeded. 900 leaves real headroom.
                raw_narrative, narrative_usage = await asyncio.wait_for(
                    achat_with_usage(messages, temperature=0.2, max_tokens=900, num_retries=0, request_timeout=8),
                    timeout=10.0,
                )
                data = parse_llm_json(raw_narrative)
                bullets = NarrativeOutput.model_validate(data).bullets
                break
            except Exception as parse_exc:
                if attempt == 0:
                    logger.warning(
                        "Narrative parse attempt 1 failed (%s: %s) — retrying",
                        type(parse_exc).__name__, parse_exc,
                    )
                    messages.append({"role": "assistant", "content": raw_narrative})
                    messages.append({
                        "role": "user",
                        "content": (
                            'Return ONLY a JSON object with a "bullets" key containing 3–5 strings. '
                            f'Parse error from last response: {str(parse_exc)[:120]}'
                        ),
                    })
                else:
                    logger.warning("Narrative parse attempt 2 failed — using static body fallback")

        if bullets is None:
            bullets = scn["body"]
        else:
            # Drop last bullet if truncated (no sentence-ending punctuation), keeping min 3.
            if len(bullets) > 3 and bullets[-1].rstrip() and bullets[-1].rstrip()[-1] not in ".!?":
                bullets = bullets[:-1]

        logger.info(json.dumps({
            "event": "llm.narrative",
            "prompt_version": NARRATIVE_PROMPT_VERSION,
            "run_id": run_id,
            "scn_key": scn_key,
            "model": narrative_usage.get("model") if narrative_usage else None,
            "latency_ms": round((_time.monotonic() - _narrative_start) * 1000),
            "input_tokens": narrative_usage.get("input_tokens") if narrative_usage else None,
            "output_tokens": narrative_usage.get("output_tokens") if narrative_usage else None,
            "has_profiling": bool(profiling_ctx),
            "has_lineage": bool(lineage_ctx),
            "bullet_count": len(bullets),
            "raw_narrative": raw_narrative[:300],
        }))

        narrative_text = "\n".join(f"- {b}" for b in bullets)
        yield f"data: {json.dumps({'type': 'narrative', 'data': {'text': narrative_text, 'bullets': bullets}})}\n\n"

    except Exception as exc:
        logger.warning("LLM narrative generation failed: %s", exc)
        fallback_text = "\n".join(f"- {b}" for b in scn["body"])
        yield f"data: {json.dumps({'type': 'narrative', 'data': {'text': fallback_text, 'bullets': scn['body']}})}\n\n"

    # 5. Signal stream end.
    yield f"data: {json.dumps({'type': 'done', 'data': {}})}\n\n"

    # 6. Post-stream: persist run completion, tracking columns, and anomaly records.
    try:
        with db_session() as post_db:
            # Base columns — always present regardless of P4 migration state.
            post_db.execute(sqlt("""
                UPDATE simulation_runs
                SET status='completed', completed_at=NOW(), events=:events
                WHERE sim_run_id=:run_id
            """), {
                "events": json.dumps(all_events),
                "run_id": run_id,
            })
            post_db.commit()

            # P4 tracking columns — only attempt if migration has run.
            try:
                post_db.execute(sqlt("""
                    UPDATE simulation_runs
                    SET has_real_metrics=:hrm, narrative_prompt_ver=:npv
                    WHERE sim_run_id=:run_id
                """), {
                    "run_id": run_id,
                    "hrm": _has_real_metrics,
                    "npv": NARRATIVE_PROMPT_VERSION,
                })
                post_db.commit()
            except Exception as p4_exc:
                logger.warning("P4 tracking column update skipped (migration may be absent): %s", p4_exc)
                post_db.rollback()

            if connection_id and fail_events:
                for fe in fail_events:
                    _create_simulation_anomaly(post_db, run_id, connection_id, scn_key, fe)
                logger.info(json.dumps({
                    "event": "simulation.post_stream_complete",
                    "run_id": run_id,
                    "anomalies_created": len(fail_events),
                    "events_persisted": len(all_events),
                }))
    except Exception as exc:
        logger.error("Post-stream DB update failed for run %s: %s", run_id, exc)


async def _event_generator(
    scn_key: str,
    scenario_text: str,
    run_id: str,
    connection_id: str | None,
    classify_result: ClassifyResult,
    scn: dict,
    inject_lock: asyncio.Lock,
    grounded_table: tuple[str, str] | None = None,
) -> AsyncGenerator[str, None]:
    """Lock wrapper: holds the per-connection inject lock for the stream's lifetime."""
    try:
        async for chunk in _event_stream(
            scn_key, scenario_text, run_id, connection_id, classify_result, scn, grounded_table
        ):
            yield chunk
    finally:
        inject_lock.release()


# ── Endpoints ──────────────────────────────────────────────────────────────────

@router.post("/inject")
async def inject_scenario(
    req: InjectRequest,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user),
):
    """
    Classify (LLM → structured JSON, regex fallback) and stream simulation events.
    SSE stream: meta → classify → event × N → narrative? → done.
    Post-stream: saves simulation_runs record and creates anomaly_log entries.
    """
    text = req.scenario_text.strip()
    if not text:
        raise HTTPException(status_code=422, detail="scenario_text must not be empty")

    logger.info(json.dumps({
        "event": "inject.entry",
        "user": current_user.email,
        "connection_id": req.connection_id,
        "scenario_text_preview": text[:120],
    }))

    run_id = str(_uuid.uuid4())
    classify_result = await classify_with_llm(text, run_id=run_id)
    scn_key = classify_result.key

    # Resolve a REAL table this connection was actually profiled on (P5) — without this,
    # the scenario's fictional demo table names never match a real connection's schema and
    # the narrative's profiling/lineage grounding silently fails 100% of the time.
    grounded_table = await asyncio.get_event_loop().run_in_executor(
        None, _resolve_grounding_table, req.connection_id, scn_key, classify_result.extracted_entities.table
    )

    # Parameterize with extracted entities (P2) and the resolved real table, then
    # synthesize label for unknown (P4).
    scn = _parameterize_scenario(scn_key, classify_result, grounded_table)
    if scn_key == "unknown":
        scn = await _synthesize_unknown_scenario(text, scn, run_id=run_id)

    # Per-connection concurrency guard — 409 if a simulation is already streaming.
    lock = _get_inject_lock(req.connection_id)
    if lock.locked():
        raise HTTPException(
            status_code=409,
            detail="A simulation is already in progress for this connection. Please wait or reset.",
        )
    await lock.acquire()

    try:
        try:
            db.execute(sqlt("""
                INSERT INTO simulation_runs
                    (sim_run_id, connection_id, scenario_id, scenario_text, inject_sql,
                     classified_as, classification_method, classification_conf,
                     classify_prompt_ver, status, started_at)
                VALUES
                    (:run_id, :conn, NULL, :text, :sql,
                     :classified_as, :method, :conf,
                     :cpv, 'running', NOW())
            """), {
                "run_id": run_id,
                "conn": req.connection_id,
                "text": text[:500],
                "sql": scn["inject_sql"],
                "classified_as": scn_key,
                "method": classify_result.method,
                "conf": classify_result.confidence,
                "cpv": CLASSIFY_PROMPT_VERSION,
            })
            db.commit()
        except Exception as exc:
            logger.warning("Failed to insert simulation_run: %s", exc)

        try:
            log_event(
                db,
                user_email=current_user.email,
                event_type="simulation.inject",
                entity_type="scenario",
                entity_id=scn_key,
                new_value={
                    "scenario_text": text[:200],
                    "classified": scn_key,
                    "confidence": round(classify_result.confidence, 3),
                    "compound": classify_result.compound,
                    "run_id": run_id,
                },
                reason=f"Scenario '{scn['type']}' injected via simulator",
                connection_id=req.connection_id,
            )
            db.commit()
        except Exception:
            logger.warning("audit log_event failed for inject run_id=%s", run_id)

        logger.info(json.dumps({
            "event": "inject.streaming",
            "run_id": run_id,
            "scn_key": scn_key,
            "method": classify_result.method,
            "confidence": round(classify_result.confidence, 3),
        }))
        return StreamingResponse(
            _event_generator(scn_key, text, run_id, req.connection_id, classify_result, scn, lock, grounded_table),
            media_type="text/event-stream",
            headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
        )
    except Exception:
        lock.release()
        raise


@router.post("/remediate")
def remediate_simulation(
    req: RemediateRequest,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user),
):
    """Mark a simulation run as remediated and heal anomaly records.

    Returns a real recovery trust_score computed from the pre-simulation baseline
    rather than a hardcoded value.
    """
    logger.info(json.dumps({
        "event": "remediate.entry",
        "user": current_user.email,
        "run_id": req.run_id,
        "connection_id": req.connection_id,
    }))
    recovery_score = 88  # safe fallback when no history exists

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

            # Fetch the pre-simulation baseline — last score recorded before this run started.
            baseline_row = db.execute(sqlt("""
                SELECT overall_score
                FROM trust_score_history
                WHERE connection_id = :conn
                  AND recorded_at < COALESCE(
                      (SELECT started_at FROM simulation_runs WHERE sim_run_id = :run_id),
                      NOW()
                  )
                ORDER BY recorded_at DESC
                LIMIT 1
            """), {"conn": req.connection_id, "run_id": req.run_id}).fetchone()

            baseline = float(baseline_row[0]) if baseline_row and baseline_row[0] is not None else None
            # Small uplift over pre-incident baseline (remediation fixed the root cause),
            # capped at 95 — we don't claim perfection from a single simulated fix.
            recovery_score = min(95, round((baseline + 3) if baseline is not None else 88))

            db.execute(sqlt("""
                INSERT INTO trust_score_history
                    (history_id, connection_id, score_date, overall_score, recorded_at)
                VALUES
                    (:id, :conn, NOW()::DATE, :score, NOW())
                ON CONFLICT (connection_id, score_date)
                DO UPDATE SET overall_score = :score, recorded_at = NOW()
            """), {"id": str(_uuid.uuid4()), "conn": req.connection_id, "score": float(recovery_score)})

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
        logger.warning("Remediate update failed: %s", exc)
        try:
            db.rollback()
        except Exception:
            pass

    logger.info(json.dumps({
        "event": "remediate.exit",
        "run_id": req.run_id,
        "recovery_score": recovery_score,
    }))
    return {"status": "remediated", "trust_score": recovery_score}


@router.get("/accuracy")
def get_simulation_accuracy(
    connection_id: str | None = None,
    days: int = 30,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user),
):
    """Classifier health stats: confidence distribution, type breakdown, recent runs."""
    logger.info(json.dumps({
        "event": "accuracy.entry",
        "user": current_user.email,
        "connection_id": connection_id,
        "days": days,
    }))
    params: dict = {"days": days}
    conn_filter = "AND connection_id=:conn" if connection_id else ""
    if connection_id:
        params["conn"] = connection_id

    # Use make_interval() so a named bind param can be used without INTERVAL literal multiplication.
    time_filter = "started_at >= NOW() - make_interval(days => :days)"

    agg_row = db.execute(sqlt(f"""
        SELECT
            COUNT(*)                                                                AS total_runs,
            ROUND(AVG(classification_conf)::NUMERIC, 3)                            AS mean_conf,
            ROUND(AVG(CASE WHEN classification_conf < 0.8 THEN 1.0 ELSE 0.0 END)::NUMERIC, 3)
                                                                                   AS low_conf_rate,
            ROUND(AVG(CASE WHEN classified_as = 'unknown' THEN 1.0 ELSE 0.0 END)::NUMERIC, 3)
                                                                                   AS unknown_rate,
            ROUND(AVG(CASE WHEN has_real_metrics = TRUE THEN 1.0 ELSE 0.0 END)::NUMERIC, 3)
                                                                                   AS real_metrics_rate
        FROM simulation_runs
        WHERE {time_filter}
          {conn_filter}
          AND classification_conf IS NOT NULL
    """), params).fetchone()

    type_rows = db.execute(sqlt(f"""
        SELECT classified_as, COUNT(*) AS cnt
        FROM simulation_runs
        WHERE {time_filter}
          {conn_filter}
          AND classified_as IS NOT NULL
        GROUP BY classified_as
        ORDER BY cnt DESC
    """), params).fetchall()

    recent_rows = db.execute(sqlt(f"""
        SELECT sim_run_id, scenario_text, classified_as, classification_conf,
               classification_method, started_at, status
        FROM simulation_runs
        WHERE {time_filter}
          {conn_filter}
        ORDER BY started_at DESC
        LIMIT 8
    """), params).fetchall()

    total = int(agg_row[0] or 0) if agg_row else 0
    logger.info(json.dumps({"event": "accuracy.exit", "total_runs": total, "days": days}))
    return {
        "days": days,
        "total_runs": total,
        "mean_confidence": float(agg_row[1]) if agg_row and agg_row[1] is not None else None,
        "low_confidence_rate": float(agg_row[2]) if agg_row and agg_row[2] is not None else None,
        "unknown_rate": float(agg_row[3]) if agg_row and agg_row[3] is not None else None,
        "real_metrics_rate": float(agg_row[4]) if agg_row and agg_row[4] is not None else None,
        "type_breakdown": {r[0]: int(r[1]) for r in type_rows} if type_rows else {},
        "recent": [
            {
                "run_id": r[0],
                "scenario_text": (r[1] or "")[:80],
                "classified_as": r[2] or "",
                "confidence": round(float(r[3]), 2) if r[3] is not None else None,
                "method": r[4] or "llm",
                "started_at": r[5].isoformat() if r[5] else None,
                "status": r[6] or "unknown",
            }
            for r in recent_rows
        ],
    }


@router.get("/history")
def get_simulation_history(
    connection_id: str | None = None,
    limit: int = 10,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user),
):
    """Return recent simulation runs, newest first."""
    logger.info(json.dumps({
        "event": "history.entry",
        "user": current_user.email,
        "connection_id": connection_id,
        "limit": limit,
    }))
    params: dict = {"limit": limit}
    where_parts = []
    if connection_id:
        where_parts.append("connection_id=:conn")
        params["conn"] = connection_id
    where = ("WHERE " + " AND ".join(where_parts)) if where_parts else ""

    rows = db.execute(sqlt(f"""
        SELECT sim_run_id, connection_id, scenario_text, inject_sql, status,
               started_at, completed_at,
               COALESCE(jsonb_array_length(events), 0) AS event_count,
               classified_as, classification_conf
        FROM simulation_runs
        {where}
        ORDER BY started_at DESC
        LIMIT :limit
    """), params).fetchall()

    result = [
        {
            "run_id": r[0],
            "connection_id": r[1],
            "scenario_text": r[2] or "",
            "inject_sql": r[3] or "",
            "status": r[4] or "unknown",
            "started_at": r[5].isoformat() if r[5] else None,
            "completed_at": r[6].isoformat() if r[6] else None,
            "event_count": r[7] or 0,
            "classified_as": r[8] or "",
            "confidence": round(r[9], 2) if r[9] is not None else None,
        }
        for r in rows
    ]
    logger.info(json.dumps({"event": "history.exit", "count": len(result), "connection_id": connection_id}))
    return result


@router.get("/scenarios")
def list_scenarios(
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user),
):
    """Return available scenario templates, preferring DB-stored scenarios."""
    logger.info(json.dumps({"event": "scenarios.entry", "user": current_user.email}))
    rows = db.execute(sqlt("""
        SELECT scenario_id, title, scenario_type, description, is_builtin, position_order
        FROM simulation_scenarios ORDER BY position_order
    """)).fetchall()

    if rows:
        result = [
            {
                "scenario_id": r[0], "title": r[1], "scenario_type": r[2],
                "description": r[3] or "", "is_builtin": r[4], "position_order": r[5],
            }
            for r in rows
        ]
        logger.info(json.dumps({"event": "scenarios.exit", "count": len(result), "source": "db"}))
        return result

    fallback = [
        {
            "key": k,
            "title": _SCENARIO_TITLES[k],
            "scenario_type": v["type"],
            "drop": v["drop"],
            "undercount": v["undercount"],
        }
        for k, v in _SCENARIOS.items()
        if k != "unknown"
    ]
    logger.info(json.dumps({"event": "scenarios.exit", "count": len(fallback), "source": "in_memory"}))
    return fallback
