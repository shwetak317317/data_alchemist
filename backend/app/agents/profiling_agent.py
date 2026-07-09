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

import re

from app.connectors.base import BaseConnector
from app.services.profiling_service import (
    get_row_count, get_column_null_stats, get_column_distinct_counts,
    get_top_values, get_numeric_stats, detect_format_pattern,
    get_sample_rows, detect_key_duplicates, check_orphans,
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
    key_duplicate: dict | None       # {column, duplicate_group_count, duplicate_row_count, sample_key_values}
    referential_checks: list[dict]   # [{fk_column, parent_table_fqn, parent_column, orphan_count, orphan_pct, source}]
    fk_like_columns: set             # columns confirmed to point at another table — excluded from key-duplicate candidacy
    column_health: list[ColumnStats]
    risks: list[ProfilingRisk]
    scores: dict
    summary_text: str
    events: list[ProfilingProgressEvent]   # progress events emitted so far
    partition_column: str | None     # requested column to window on — validated against real columns in fetch_schema
    window_from: datetime | None
    window_to: datetime | None
    where_sql: str | None            # built once in fetch_schema; None means full-table scan (unchanged behavior)
    is_partial_scan: bool


def _emit(state: ProfilingState, step: str, detail: str, pct: int) -> ProfilingProgressEvent:
    ev = ProfilingProgressEvent(step=step, status="done", detail=detail, progress_pct=pct)
    state["events"].append(ev)
    return ev


# ── Graph nodes ──────────────────────────────────────────────────────────────

def fetch_schema(state: ProfilingState) -> ProfilingState:
    connector = state["connector"]
    schema = state["schema_name"]
    table = state["table_name"]
    table_schema = connector.describe_table(schema, table)
    if not table_schema.columns:
        raise ValueError(
            f"Table not found or has no columns: {schema}.{table}"
        )
    state["columns"] = table_schema.columns
    state["row_count"] = table_schema.row_count

    # Partition-aware / incremental scan: only activates when partition_column
    # names a REAL column on this table (validated here, not trusted from the
    # request) and at least one bound is given. An unmatched column name is a
    # silent no-op fallback to a full-table scan, never an error — a stale
    # picker selection (e.g. a column dropped since last run) shouldn't break
    # profiling, it should just profile everything.
    where_sql: str | None = None
    is_partial = False
    partition_column = state.get("partition_column")
    window_from = state.get("window_from")
    window_to = state.get("window_to")
    if partition_column and (window_from or window_to):
        real_cols = {c["name"].lower(): c["name"] for c in table_schema.columns}
        actual = real_cols.get(partition_column.lower())
        if actual:
            q = connector.quote_ident(actual)
            bounds = []
            if window_from:
                bounds.append(f"{q} >= '{window_from.isoformat()}'")
            if window_to:
                bounds.append(f"{q} < '{window_to.isoformat()}'")
            where_sql = " AND ".join(bounds)
            is_partial = True
        else:
            logger.warning(
                "Partition column %r not found on %s.%s — falling back to full-table scan",
                partition_column, schema, table,
            )
    state["where_sql"] = where_sql
    state["is_partial_scan"] = is_partial

    # row_count from describe_table() is always the FULL table — recompute it
    # scoped to the window so every downstream ratio (null %, uniqueness, etc.)
    # is consistent with the same slice of data, not full-table-count-divided-
    # into-windowed-stats.
    if where_sql:
        state["row_count"] = get_row_count(connector, schema, table, where_sql)

    detail = f"{len(table_schema.columns)} columns detected"
    if is_partial:
        detail += f" · partial scan on {partition_column}"
    _emit(state, "Schema validation", detail, 10)
    return state


def compute_null_stats(state: ProfilingState) -> ProfilingState:
    null_counts = get_column_null_stats(
        state["connector"], state["schema_name"], state["table_name"], state["columns"],
        where_sql=state.get("where_sql"),
    )
    total = max(state["row_count"], 1)
    state["null_stats"] = {k: round(v / total * 100, 2) for k, v in null_counts.items()}
    flagged = sum(1 for v in state["null_stats"].values() if v > 5)
    _emit(state, "Null analysis per column", f"{flagged} column(s) flagged", 25)
    return state


def compute_distinct(state: ProfilingState) -> ProfilingState:
    total = max(state["row_count"], 1)
    counts = get_column_distinct_counts(
        state["connector"], state["schema_name"], state["table_name"], state["columns"],
        where_sql=state.get("where_sql"),
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


_FK_SUFFIX_RE = re.compile(r"^(.*?)[_]?(id|key)$", re.IGNORECASE)


_ID_LIKE_RE = re.compile(r"(^id$|_id$|id$|_key$|key$)", re.IGNORECASE)


def check_key_duplicates(state: ProfilingState) -> ProfilingState:
    """Duplicate detection on a CANDIDATE KEY column — not the whole row.

    detect_duplicates() (below) only ever catches a row that duplicates in
    EVERY column; two rows sharing an order_id but differing in one
    timestamp — the actual common case (retry-storm inserts, late-arriving
    upserts) — pass that check clean. This looks for the highest-cardinality
    column(s) (candidate keys) and checks THOSE for duplication instead.

    Threshold is name-aware, not just a flat cardinality cutoff: a column
    named order_id with a 0.86 ratio (proven live: 7 rows, 1 real duplicate,
    ratio = 6/7 = 0.857) is obviously an intended key that's currently
    violated — a flat >=0.9 floor would silently skip exactly the case this
    check exists to catch, especially on small tables where a single
    duplicate swings the ratio hard. A column with NO id-like name still
    needs genuinely high cardinality (>=0.9) before being treated as a key,
    to avoid flagging an arbitrary high-cardinality text column as one.
    """
    total = max(state["row_count"], 1)
    fk_like = state.get("fk_like_columns", set())
    scored = []
    for name, info in state["distinct_stats"].items():
        if name.lower() in fk_like:
            continue   # a real/inferred FK to another table is SUPPOSED to repeat — not a duplicate-key violation
        ratio = info.get("ratio", 0)
        id_like = bool(_ID_LIKE_RE.search(name))
        if (id_like and ratio >= 0.6) or ratio >= 0.9:
            scored.append((name, ratio, id_like))
    scored.sort(key=lambda x: (-x[2], -x[1]))
    candidates = [name for name, _, _ in scored][:3] if total > 1 else []
    state["key_duplicate"] = None
    if candidates:
        try:
            state["key_duplicate"] = detect_key_duplicates(
                state["connector"], state["schema_name"], state["table_name"], candidates,
                where_sql=state.get("where_sql"),
            )
        except Exception as e:
            logger.warning("check_key_duplicates failed: %s", e)
    if state["key_duplicate"]:
        _emit(state, "Key-based duplicate check",
              f"{state['key_duplicate']['duplicate_row_count']} row(s) share a duplicated "
              f"{state['key_duplicate']['column']} value", 45)
    else:
        _emit(state, "Key-based duplicate check", "no candidate-key duplication found", 45)
    return state


def check_referential_integrity(state: ProfilingState) -> ProfilingState:
    """Orphan-record check against this table's foreign keys — declared FKs
    first (real ground truth), naming-convention inference as a fallback
    (most analytical warehouses don't declare FKs at all, which is exactly
    why this table's own profiling report never had this signal before).

    Runs BEFORE check_key_duplicates: every column identified here as FK-like
    (points at a real sibling table) — whether or not it currently has
    orphans — is recorded in state["fk_like_columns"] so the duplicate-key
    check downstream never flags a legitimate foreign key as a broken
    candidate key. Proven live: line_items.order_id (many line items per
    order, correctly repeating) was misflagged as a duplicate-key violation
    before this exclusion existed — the column matches an _id naming pattern
    but is a FK to orders, not this table's own key.
    """
    connector = state["connector"]
    schema, table = state["schema_name"], state["table_name"]
    checks: list[dict] = []
    checked_columns: set[str] = set()
    fk_like_columns: set[str] = set()

    try:
        fks = connector.list_foreign_keys(schema)
    except Exception as e:
        logger.warning("check_referential_integrity: list_foreign_keys failed: %s", e)
        fks = []

    for fk in fks:
        if not (fk.target_table == table or fk.target_table.endswith(f".{table}")):
            continue
        for child_col, parent_col in zip(fk.target_columns, fk.source_columns):
            fk_like_columns.add(child_col.lower())
            result = check_orphans(connector, schema, table, child_col,
                                   fk.source_schema, fk.source_table, parent_col,
                                   child_window_sql=state.get("where_sql"))
            if result is None:
                continue
            checked_columns.add(child_col.lower())
            total = max(state["row_count"], 1)
            checks.append({
                "fk_column": child_col,
                "parent_table_fqn": f"{fk.source_schema}.{fk.source_table.split('.')[-1]}",
                "parent_column": parent_col,
                "orphan_count": result["orphan_count"],
                "orphan_pct": round(result["orphan_count"] / total * 100, 2),
                "sample_values": result["sample_values"],
                "source": "declared_fk",
            })

    # Naming-convention fallback — only for FK-shaped columns not already
    # covered by a declared FK above, and only when it doesn't look like this
    # table's OWN key (e.g. skip "order_id" on the "orders" table itself).
    try:
        siblings = connector.list_tables(schema)
    except Exception:
        siblings = []
    sibling_names = {t.table_name.split(".")[-1].lower(): t.table_name for t in siblings}
    table_base = table.rstrip("sS").lower()

    for col in state["columns"]:
        name = col["name"]
        if name.lower() in checked_columns:
            continue
        m = _FK_SUFFIX_RE.match(name)
        if not m or not m.group(1):
            continue
        base = m.group(1).strip("_").lower()
        if not base or base == table_base or base == table.lower():
            continue
        candidates = [base, base + "s", base + "es"]
        parent_sibling = next((sibling_names[c] for c in candidates if c in sibling_names), None)
        if not parent_sibling:
            continue
        try:
            parent_schema_obj = connector.describe_table(schema, parent_sibling)
        except Exception:
            continue
        parent_col_names = {c["name"].lower() for c in parent_schema_obj.columns}
        parent_col = name if name.lower() in parent_col_names else ("id" if "id" in parent_col_names else None)
        if not parent_col:
            continue
        # Matched a real sibling table + a plausible key column on it — this IS
        # an FK-like column regardless of whether it currently has orphans.
        fk_like_columns.add(name.lower())
        result = check_orphans(connector, schema, table, name, schema, parent_sibling, parent_col,
                               child_window_sql=state.get("where_sql"))
        if result is None or result["orphan_count"] == 0:
            continue   # inference is a guess — only surface a RISK when it actually finds something real
        total = max(state["row_count"], 1)
        checks.append({
            "fk_column": name,
            "parent_table_fqn": f"{schema}.{parent_sibling}",
            "parent_column": parent_col,
            "orphan_count": result["orphan_count"],
            "orphan_pct": round(result["orphan_count"] / total * 100, 2),
            "sample_values": result["sample_values"],
            "source": "inferred_naming",
        })

    state["referential_checks"] = checks
    state["fk_like_columns"] = fk_like_columns
    orphan_total = sum(c["orphan_count"] for c in checks)
    _emit(state, "Referential integrity check",
          f"{len(checks)} relationship(s) checked, {orphan_total} orphan row(s) found" if checks
          else "no FK relationships found to check", 50)
    return state


def compute_formats(state: ProfilingState) -> ProfilingState:
    formats = {}
    for col in state["columns"]:
        if col["type"].lower() in ("varchar", "nvarchar", "text", "string", "char"):
            top = get_top_values(
                state["connector"], state["schema_name"], state["table_name"], col["name"],
                where_sql=state.get("where_sql"),
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
                    state["connector"], state["schema_name"], state["table_name"], col["name"],
                    where_sql=state.get("where_sql"),
                )
            except Exception as e:
                logger.warning("Numeric stats failed for %s: %s", col["name"], e)
    state["numeric_stats"] = num_stats
    _emit(state, "Statistical distribution", "completed", 65)
    return state


def detect_duplicates(state: ProfilingState) -> ProfilingState:
    """Whole-ROW exact duplicate check — every column must match. This does
    NOT catch the common real-world case (two rows sharing a business key
    like order_id but differing in one timestamp column); that's what
    check_key_duplicates() above is for. Keep both: whole-row dupes indicate
    a literal re-insert (retry with no new data at all), key-based dupes
    indicate the same logical record was captured twice with drift."""
    schema, table = state["schema_name"], state["table_name"]
    connector = state["connector"]
    try:
        tref = connector.table_ref(schema, table)
        where_sql = state.get("where_sql")
        inner = f"SELECT DISTINCT * FROM {tref}" + (f" WHERE {where_sql}" if where_sql else "")
        result = connector.query(f"SELECT COUNT(*) FROM ({inner}) _d")
        distinct_count = int(result.rows[0][0]) if result.rows else state["row_count"]
        state["duplicate_count"] = max(0, state["row_count"] - distinct_count)
    except Exception:
        state["duplicate_count"] = 0
    _emit(state, "Duplicate detection (whole row)", f"{state['duplicate_count']} exact duplicate row(s)", 72)
    return state


def score_table(state: ProfilingState) -> ProfilingState:
    total = max(state["row_count"], 1)
    null_stats = state["null_stats"]

    # Completeness: avg non-null % across all columns
    avg_null = sum(null_stats.values()) / max(len(null_stats), 1)
    completeness = max(0, 100 - avg_null)

    # Uniqueness: whole-row duplicate ratio AND key-based duplicate ratio —
    # a table can score 100% on whole-row uniqueness while having thousands
    # of rows sharing a business key with drifted non-key columns, which the
    # whole-row check structurally cannot see.
    dup_ratio = state["duplicate_count"] / total * 100
    key_dup = state.get("key_duplicate")
    key_dup_ratio = (key_dup["duplicate_row_count"] / total * 100) if key_dup else 0
    uniqueness = max(0, 100 - dup_ratio - key_dup_ratio)

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
    connector = state["connector"]
    schema, table = state["schema_name"], state["table_name"]

    # Build column health objects
    col_health: list[ColumnStats] = []
    for col in state["columns"]:
        name = col["name"]
        null_pct = null_stats.get(name, 0)
        distinct_info = state["distinct_stats"].get(name, {})
        fmt = format_stats.get(name, "UNKNOWN")
        num = state["numeric_stats"].get(name, {})
        top = get_top_values(state["connector"], state["schema_name"],
                             state["table_name"], name, 10, where_sql=state.get("where_sql"))

        health = "HEALTHY"
        reasons = []
        if null_pct > 20:
            health = "CRIT"
            reasons.append(f"{null_pct:.1f}% nulls (critical threshold)")
            sample = get_sample_rows(connector, schema, table, f"{connector.quote_ident(name)} IS NULL", 10,
                                     window_where=state.get("where_sql"))
            risks.append(ProfilingRisk(column=name, risk_type="NULL_HIGH", severity="CRITICAL",
                                       description=f"{name} has {null_pct:.1f}% nulls", sample_failed_records=sample))
        elif null_pct > 5:
            health = "WARN"
            reasons.append(f"{null_pct:.1f}% nulls")
            sample = get_sample_rows(connector, schema, table, f"{connector.quote_ident(name)} IS NULL", 10,
                                     window_where=state.get("where_sql"))
            risks.append(ProfilingRisk(column=name, risk_type="NULL_MODERATE", severity="HIGH",
                                       description=f"{name} has {null_pct:.1f}% nulls", sample_failed_records=sample))

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

    # Key-based duplicate risk (P0 — see check_key_duplicates)
    kd = state.get("key_duplicate")
    if kd:
        total = max(state["row_count"], 1)
        dup_pct = round(kd["duplicate_row_count"] / total * 100, 2)
        severity = "CRITICAL" if dup_pct >= 1 else "HIGH"
        sample = [{kd["column"]: v} for v in kd["sample_key_values"]]
        risks.append(ProfilingRisk(
            column=kd["column"], risk_type="DUPLICATE_KEY", severity=severity,
            description=(f"{kd['duplicate_row_count']} row(s) ({dup_pct}%) share a duplicated "
                         f"{kd['column']} value across {kd['duplicate_group_count']} group(s) — "
                         f"a whole-row check would miss this if any other column differs"),
            sample_failed_records=sample,
        ))

    # Referential integrity / orphan risks (P0 — see check_referential_integrity)
    for chk in state.get("referential_checks", []):
        if chk["orphan_count"] == 0:
            continue
        severity = "CRITICAL" if chk["orphan_pct"] >= 5 else "HIGH" if chk["orphan_pct"] >= 1 else "MEDIUM"
        confidence_note = "" if chk["source"] == "declared_fk" else " (inferred from naming, not a declared FK — verify before treating as certain)"
        sample = [{chk["fk_column"]: v} for v in chk["sample_values"]]
        risks.append(ProfilingRisk(
            column=chk["fk_column"], risk_type="REFERENTIAL_ORPHAN", severity=severity,
            description=(f"{chk['orphan_count']} row(s) ({chk['orphan_pct']}%) have a {chk['fk_column']} value "
                         f"with no matching record in {chk['parent_table_fqn']}.{chk['parent_column']}{confidence_note}"),
            sample_failed_records=sample,
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

    if state.get("is_partial_scan"):
        wf = state.get("window_from")
        wt = state.get("window_to")
        bounds = f"{wf.date() if wf else '…'} to {wt.date() if wt else 'now'}"
        scan_scope = f"PARTIAL — windowed on {state.get('partition_column')}, {bounds}. A low or zero row count reflects this window, not necessarily the whole table."
    else:
        scan_scope = "Full table"

    prompt = build_profiling_summary_prompt(schema, table, state["row_count"], scores, risks, scan_scope=scan_scope)
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
                 check_referential_integrity, check_key_duplicates,
                 compute_formats, compute_numerics, detect_duplicates,
                 score_table, identify_risks, generate_summary]:
        g.add_node(node.__name__, node)

    order = ["fetch_schema", "compute_null_stats", "compute_distinct",
             "check_referential_integrity", "check_key_duplicates",
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
    partition_column: str | None = None,
    window_from: datetime | None = None,
    window_to: datetime | None = None,
) -> Generator[ProfilingProgressEvent | ProfilingReport, None, None]:
    """
    Stream profiling progress events, then yield the final ProfilingReport.
    layer_override: if provided (e.g. from the wizard layer_map), used directly;
                    otherwise falls back to schema-name heuristic.
    partition_column/window_from/window_to: optional incremental-scan window —
    validated against the table's real columns in fetch_schema(); an invalid
    or absent column silently falls back to a full-table scan.
    """
    state: ProfilingState = {
        "connection_id": connection_id,
        "schema_name": schema_name,
        "table_name": table_name,
        "connector": connector,
        "columns": [], "row_count": 0,
        "null_stats": {}, "distinct_stats": {}, "format_stats": {},
        "numeric_stats": {}, "duplicate_count": 0,
        "key_duplicate": None, "referential_checks": [], "fk_like_columns": set(),
        "column_health": [], "risks": [], "scores": {},
        "summary_text": "", "events": [],
        "partition_column": partition_column, "window_from": window_from, "window_to": window_to,
        "where_sql": None, "is_partial_scan": False,
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
        partition_column=state.get("partition_column") if state.get("is_partial_scan") else None,
        window_from=state.get("window_from") if state.get("is_partial_scan") else None,
        window_to=state.get("window_to") if state.get("is_partial_scan") else None,
        is_partial_scan=state.get("is_partial_scan", False),
    )
