"""
Profiling Agent — LangGraph graph that profiles a table and produces a structured report.
Emits progress events so the frontend can show a live progress bar via SSE.

Graph nodes:
  1. fetch_schema       → get column definitions from the connector
  2. compute_null_stats → null % per column
  3. compute_distinct   → cardinality per column
  4. compute_formats    → format pattern detection
  5. compute_numerics   → min/max/mean/stddev for numeric columns
  6. detect_duplicates  → PK/key-based duplicate check
  7. score_table        → compute quality sub-scores
  8. identify_risks     → flag high-risk columns
  9. generate_summary   → LiteLLM narrative summary
"""
import json
import uuid
import logging
from datetime import datetime, timezone
from typing import TypedDict, Generator

from langgraph.graph import StateGraph, END

from app.connectors.base import BaseConnector
from app.services.profiling_service import (
    get_row_count, get_column_null_stats, get_column_distinct_counts,
    get_top_values, get_numeric_stats, detect_format_pattern,
)
from app.core.llm import chat
from app.models.profiling import ProfilingReport, ColumnStats, ProfilingRisk, ProfilingProgressEvent
from app.prompts.profiling import build_profiling_summary_prompt

logger = logging.getLogger(__name__)

NUMERIC_TYPES = {"int", "bigint", "smallint", "decimal", "numeric", "float", "real",
                 "double", "number", "money", "double precision"}


class ProfilingState(TypedDict):
    connection_id: str
    schema_name: str
    table_name: str
    connector: BaseConnector
    columns: list[dict]
    row_count: int
    null_stats: dict
    distinct_stats: dict
    format_stats: dict
    numeric_stats: dict
    duplicate_count: int
    column_health: list[ColumnStats]
    risks: list[ProfilingRisk]
    scores: dict
    summary_text: str
    events: list[ProfilingProgressEvent]   # progress events emitted so far


def _emit(state: ProfilingState, step: str, detail: str, pct: int) -> ProfilingProgressEvent:
    ev = ProfilingProgressEvent(step=step, status="done", detail=detail, progress_pct=pct)
    state["events"].append(ev)
    return ev


# ── Graph nodes ──────────────────────────────────────────────────────────────

def fetch_schema(state: ProfilingState) -> ProfilingState:
    connector = state["connector"]
    schema = state["schema_name"]
    table_schema = connector.describe_table(schema, state["table_name"])
    if not table_schema.columns:
        raise ValueError(
            f"Table not found or has no columns: {schema}.{state['table_name']}"
        )
    state["columns"] = table_schema.columns
    state["row_count"] = table_schema.row_count
    _emit(state, "Schema validation", f"{len(table_schema.columns)} columns detected", 10)
    return state


def compute_null_stats(state: ProfilingState) -> ProfilingState:
    null_counts = get_column_null_stats(
        state["connector"], state["schema_name"], state["table_name"], state["columns"]
    )
    total = max(state["row_count"], 1)
    state["null_stats"] = {k: round(v / total * 100, 2) for k, v in null_counts.items()}
    flagged = sum(1 for v in state["null_stats"].values() if v > 5)
    _emit(state, "Null analysis per column", f"{flagged} column(s) flagged", 25)
    return state


def compute_distinct(state: ProfilingState) -> ProfilingState:
    total = max(state["row_count"], 1)
    counts = get_column_distinct_counts(
        state["connector"], state["schema_name"], state["table_name"], state["columns"]
    )
    distinct = {
        col["name"]: {
            "count": counts.get(col["name"], 0),
            "ratio": round(counts.get(col["name"], 0) / total, 4),
        }
        for col in state["columns"]
    }
    state["distinct_stats"] = distinct
    _emit(state, "Cardinality & distinct analysis", "completed", 40)
    return state


def compute_formats(state: ProfilingState) -> ProfilingState:
    formats = {}
    for col in state["columns"]:
        if col["type"].lower() in ("varchar", "nvarchar", "text", "string", "char"):
            top = get_top_values(
                state["connector"], state["schema_name"], state["table_name"], col["name"]
            )
            formats[col["name"]] = detect_format_pattern(top)
        else:
            formats[col["name"]] = col["type"].upper()
    mixed_count = sum(1 for v in formats.values() if v == "MIXED")
    state["format_stats"] = formats
    _emit(state, "Format pattern detection",
          f"{mixed_count} column(s) with mixed formats", 55)
    return state


def compute_numerics(state: ProfilingState) -> ProfilingState:
    num_stats = {}
    for col in state["columns"]:
        if col["type"].lower() in NUMERIC_TYPES:
            try:
                num_stats[col["name"]] = get_numeric_stats(
                    state["connector"], state["schema_name"], state["table_name"], col["name"]
                )
            except Exception as e:
                logger.warning("Numeric stats failed for %s: %s", col["name"], e)
    state["numeric_stats"] = num_stats
    _emit(state, "Statistical distribution", "completed", 65)
    return state


def detect_duplicates(state: ProfilingState) -> ProfilingState:
    schema, table = state["schema_name"], state["table_name"]
    connector = state["connector"]
    try:
        tref = connector.table_ref(schema, table)
        result = connector.query(
            f"SELECT COUNT(*) FROM (SELECT DISTINCT * FROM {tref}) _d"
        )
        distinct_count = int(result.rows[0][0]) if result.rows else state["row_count"]
        state["duplicate_count"] = max(0, state["row_count"] - distinct_count)
    except Exception:
        state["duplicate_count"] = 0
    _emit(state, "Duplicate detection", f"{state['duplicate_count']} duplicate row(s)", 72)
    return state


def score_table(state: ProfilingState) -> ProfilingState:
    total = max(state["row_count"], 1)
    null_stats = state["null_stats"]

    # Completeness: avg non-null % across all columns
    avg_null = sum(null_stats.values()) / max(len(null_stats), 1)
    completeness = max(0, 100 - avg_null)

    # Uniqueness: based on duplicate ratio
    dup_ratio = state["duplicate_count"] / total * 100
    uniqueness = max(0, 100 - dup_ratio)

    # Consistency: % of columns with a known (non-MIXED, non-UNKNOWN) format
    format_stats = state["format_stats"]
    known = sum(1 for v in format_stats.values() if v not in ("MIXED", "UNKNOWN", ""))
    consistency = round(known / max(len(format_stats), 1) * 100, 1)

    # Freshness: placeholder (would check last_updated vs SLA)
    freshness = 100.0

    overall = round((completeness * 0.35 + uniqueness * 0.25 + consistency * 0.25 + freshness * 0.15), 1)
    state["scores"] = {
        "overall": overall, "completeness": round(completeness, 1),
        "uniqueness": round(uniqueness, 1), "consistency": consistency,
        "freshness": freshness,
    }
    _emit(state, "Risk scoring", f"Overall quality score: {overall}/100", 80)
    return state


def identify_risks(state: ProfilingState) -> ProfilingState:
    risks: list[ProfilingRisk] = []
    null_stats = state["null_stats"]
    format_stats = state["format_stats"]

    # Build column health objects
    col_health: list[ColumnStats] = []
    for col in state["columns"]:
        name = col["name"]
        null_pct = null_stats.get(name, 0)
        distinct_info = state["distinct_stats"].get(name, {})
        fmt = format_stats.get(name, "UNKNOWN")
        num = state["numeric_stats"].get(name, {})
        top = get_top_values(state["connector"], state["schema_name"],
                             state["table_name"], name, 10)

        health = "HEALTHY"
        reasons = []
        if null_pct > 20:
            health = "CRIT"
            reasons.append(f"{null_pct:.1f}% nulls (critical threshold)")
            risks.append(ProfilingRisk(column=name, risk_type="NULL_HIGH",
                                       severity="CRITICAL", description=f"{name} has {null_pct:.1f}% nulls"))
        elif null_pct > 5:
            health = "WARN"
            reasons.append(f"{null_pct:.1f}% nulls")
            risks.append(ProfilingRisk(column=name, risk_type="NULL_MODERATE",
                                       severity="HIGH", description=f"{name} has {null_pct:.1f}% nulls"))

        if fmt == "MIXED":
            health = max(health, "WARN", key=lambda h: {"HEALTHY": 0, "WARN": 1, "CRIT": 2}[h])
            reasons.append("Mixed format detected")
            risks.append(ProfilingRisk(column=name, risk_type="FORMAT_MIXED",
                                       severity="HIGH", description=f"{name} has mixed format values"))

        col_health.append(ColumnStats(
            name=name, data_type=col["type"], null_pct=null_pct,
            distinct_count=distinct_info.get("count", 0),
            cardinality_ratio=distinct_info.get("ratio", 0),
            min_val=num.get("min"), max_val=num.get("max"),
            mean_val=num.get("mean"), std_dev=num.get("std_dev"),
            top_values=top, format_pattern=fmt,
            health=health, health_reasons=reasons,
        ))

    state["column_health"] = col_health
    state["risks"] = risks
    _emit(state, "Column risk identification", f"{len(risks)} risk(s) found", 88)
    return state


def generate_summary(state: ProfilingState) -> ProfilingState:
    schema = state["schema_name"]
    table = state["table_name"]
    scores = state["scores"]
    risks = state["risks"][:5]  # top 5 for prompt

    prompt = build_profiling_summary_prompt(schema, table, state["row_count"], scores, risks)
    try:
        state["summary_text"] = chat(prompt, max_tokens=300)
    except Exception as e:
        logger.warning("LLM summary failed: %s", e)
        state["summary_text"] = f"Profiling complete. Overall score: {scores['overall']}/100."

    _emit(state, "Report generation", "Complete", 100)
    return state


# ── Build the graph ──────────────────────────────────────────────────────────

def _build_graph():
    g = StateGraph(ProfilingState)
    for node in [fetch_schema, compute_null_stats, compute_distinct,
                 compute_formats, compute_numerics, detect_duplicates,
                 score_table, identify_risks, generate_summary]:
        g.add_node(node.__name__, node)

    order = ["fetch_schema", "compute_null_stats", "compute_distinct",
             "compute_formats", "compute_numerics", "detect_duplicates",
             "score_table", "identify_risks", "generate_summary"]
    for i, node in enumerate(order[:-1]):
        g.add_edge(node, order[i + 1])
    g.add_edge(order[-1], END)
    g.set_entry_point(order[0])
    return g.compile()


_graph = _build_graph()


def run_profiling(
    connector: BaseConnector,
    connection_id: str,
    schema_name: str,
    table_name: str,
    layer_override: str | None = None,
) -> Generator[ProfilingProgressEvent | ProfilingReport, None, None]:
    """
    Stream profiling progress events, then yield the final ProfilingReport.
    layer_override: if provided (e.g. from the wizard layer_map), used directly;
                    otherwise falls back to schema-name heuristic.
    """
    state: ProfilingState = {
        "connection_id": connection_id,
        "schema_name": schema_name,
        "table_name": table_name,
        "connector": connector,
        "columns": [], "row_count": 0,
        "null_stats": {}, "distinct_stats": {}, "format_stats": {},
        "numeric_stats": {}, "duplicate_count": 0,
        "column_health": [], "risks": [], "scores": {},
        "summary_text": "", "events": [],
    }

    seen_events = 0
    for chunk in _graph.stream(state):
        for node_name, node_state in chunk.items():
            events: list[ProfilingProgressEvent] = node_state.get("events", [])
            for ev in events[seen_events:]:
                seen_events += 1
                yield ev
            state = node_state

    report_id = str(uuid.uuid4())
    scores = state.get("scores", {})
    _LAYER_NAMES = {"RAW", "BRONZE", "SILVER", "GOLD"}
    if layer_override and layer_override.upper() in _LAYER_NAMES:
        detected_layer = layer_override.upper()
    else:
        detected_layer = schema_name.upper() if schema_name.upper() in _LAYER_NAMES else "UNKNOWN"
    yield ProfilingReport(
        report_id=report_id,
        connection_id=connection_id,
        table_fqn=f"{schema_name}.{table_name}",
        layer=detected_layer,
        run_at=datetime.now(timezone.utc),
        row_count=state.get("row_count", 0),
        quality_score=scores.get("overall", 0),
        completeness_score=scores.get("completeness", 0),
        uniqueness_score=scores.get("uniqueness", 0),
        consistency_score=scores.get("consistency", 0),
        freshness_score=scores.get("freshness", 100),
        columns=state.get("column_health", []),
        risks=state.get("risks", []),
        summary_text=state.get("summary_text", ""),
    )
