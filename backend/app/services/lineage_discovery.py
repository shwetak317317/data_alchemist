"""Lineage edge discovery — deterministic sources only, no LLM.

Three independent discovery methods, each validated against the connection's
real cached schema (connection_tables) so an edge never points at a table that
doesn't exist:

  - FK constraints  -> confidence 1.0, auto-confirmed. Ground truth from the
                       database's own declared constraints.
  - dbt manifest    -> confidence 1.0, auto-confirmed. Ground truth from the
                       customer's own pipeline definition (depends_on graph).
  - SQL query-log   -> heuristic (SQL-parsed INSERT/MERGE/CTAS/SELECT-INTO).
                       ALWAYS status='suggested', never auto-confirmed — a wrong
                       edge actively misdirects incident response, which is a
                       worse failure mode than a missing edge, so this always
                       requires a human to approve before it affects the graph.

Every edge, regardless of source, must resolve both endpoints against a table
this connection is actually known to have (connection_tables, or newly proven
to exist by the FK/dbt discovery itself) — never a string a parser guessed at.
"""
from __future__ import annotations

import logging
import uuid as _uuid
from collections import deque
from dataclasses import dataclass, field

from pydantic import BaseModel, Field
from sqlalchemy import text as sqlt
from sqlalchemy.orm import Session

from app.connectors.base import BaseConnector

logger = logging.getLogger(__name__)

_DIALECT_BY_PLATFORM = {
    "sqlserver": "tsql",
    "postgres": "postgres",
    "snowflake": "snowflake",
    "databricks": "databricks",
    "duckdb": "duckdb",
}


@dataclass
class DiscoveredEdge:
    source_fqn: str
    target_fqn: str
    edge_type: str
    discovered_via: str          # fk | query_log | dbt
    confidence: float | None     # None for deterministic sources (fk / dbt)
    evidence: str
    status: str                  # confirmed | suggested


@dataclass
class DiscoveryReport:
    fk_enabled: bool = True
    fk_schemas_scanned: list[str] = field(default_factory=list)
    fk_edges_found: int = 0

    query_log_enabled: bool = True
    query_log_supported: bool = False
    query_log_unsupported_reason: str | None = None
    query_log_statements_scanned: int = 0
    query_log_parse_failures: int = 0
    query_log_edges_found: int = 0

    llm_fallback_enabled: bool = False
    llm_fallback_attempted: int = 0
    llm_fallback_skipped: int = 0     # parse failures beyond the per-run cap — never silently dropped
    llm_fallback_edges_found: int = 0
    llm_fallback_error: str | None = None

    dbt_provided: bool = False
    dbt_models_scanned: int = 0
    dbt_edges_found: int = 0

    nodes_created: int = 0
    edges_confirmed: int = 0
    edges_suggested: int = 0
    edges_already_existed: int = 0
    edges_cycle_rejected: int = 0


# ── Shared helpers ───────────────────────────────────────────────────────────

def _known_tables(db: Session, connection_id: str) -> dict[str, str]:
    """table_fqn -> layer, from every table this connection has ever had cached
    while browsing (connection_tables) — broader than just profiled tables, and
    the authoritative registry of 'this table really exists here'."""
    rows = db.execute(sqlt(
        "SELECT table_fqn, layer FROM connection_tables WHERE connection_id = :conn"
    ), {"conn": connection_id}).fetchall()
    return {r[0]: (r[1] or "UNKNOWN") for r in rows}


def _existing_node_ids(db: Session, connection_id: str) -> dict[str, str]:
    rows = db.execute(sqlt(
        "SELECT external_id, node_id FROM lineage_nodes WHERE connection_id = :conn"
    ), {"conn": connection_id}).fetchall()
    return {r[0]: r[1] for r in rows}


def _profiling_health(db: Session, connection_id: str, table_fqn: str) -> str:
    row = db.execute(sqlt("""
        SELECT quality_score FROM profiling_reports
        WHERE connection_id = :conn AND table_fqn = :fqn
        ORDER BY run_at DESC LIMIT 1
    """), {"conn": connection_id, "fqn": table_fqn}).fetchone()
    if not row or row[0] is None:
        return "ok"  # not yet profiled — neutral default, not a failure signal
    score = float(row[0])
    return "ok" if score >= 80 else "warn" if score >= 60 else "fail"


def _ensure_node(
    db: Session, connection_id: str, table_fqn: str, layer: str,
    discovered_via: str, node_cache: dict[str, str],
) -> str:
    """Return node_id for table_fqn, creating a lineage_node if none exists yet."""
    if table_fqn in node_cache:
        return node_cache[table_fqn]
    health = _profiling_health(db, connection_id, table_fqn)
    new_id = str(_uuid.uuid4())
    db.execute(sqlt("""
        INSERT INTO lineage_nodes
            (node_id, connection_id, external_id, label, layer, node_type,
             tier_label, health_status, position_order, is_source, discovered_via)
        VALUES (:id, :conn, :ext, :ext, :layer, 'table', :layer, :health, 0, FALSE, :via)
        ON CONFLICT (connection_id, external_id) DO NOTHING
    """), {
        "id": new_id, "conn": connection_id, "ext": table_fqn,
        "layer": layer, "health": health, "via": discovered_via,
    })
    row = db.execute(sqlt(
        "SELECT node_id FROM lineage_nodes WHERE connection_id = :conn AND external_id = :ext"
    ), {"conn": connection_id, "ext": table_fqn}).fetchone()
    node_cache[table_fqn] = row[0]
    return row[0]


# ── Cycle prevention + is_source (Phase 0 foundation fixes) ─────────────────

def would_create_cycle(db: Session, source_node_id: str, target_node_id: str) -> bool:
    """True if adding a CONFIRMED source_node_id -> target_node_id edge would
    close a cycle, i.e. target_node_id can already reach source_node_id via
    existing confirmed edges. Self-loops (source == target, e.g. a
    self-referencing FK like employees.manager_id -> employees.id) count as a
    cycle too — they're not meaningful lineage and the BFS/DFS traversals that
    read this graph don't need to handle them as a special case if they're
    simply never allowed in.

    Only confirmed edges are considered: a pending 'suggested' edge doesn't
    yet describe the graph's real topology, so it can't create a real cycle
    until it's approved (at which point this check runs again, see approve_edge).
    """
    if source_node_id == target_node_id:
        return True
    visited = {target_node_id}
    queue = deque([target_node_id])
    while queue:
        current = queue.popleft()
        if current == source_node_id:
            return True
        for (nid,) in db.execute(sqlt(
            "SELECT target_node_id FROM lineage_edges WHERE source_node_id = :src AND status = 'confirmed'"
        ), {"src": current}).fetchall():
            if nid not in visited:
                visited.add(nid)
                queue.append(nid)
    return False


def recompute_is_source(db: Session, connection_id: str) -> None:
    """is_source = has no incoming CONFIRMED edge. Computed fresh from real
    edge topology rather than the old 'lowest profiled layer' heuristic, which
    marked every table in a connection's shallowest profiled layer as a
    source regardless of whether anything actually fed into it — with medallion
    architectures spanning separate databases per layer, that heuristic
    couldn't distinguish 'genuinely a source' from 'just not profiled yet at a
    lower layer'. Call this after anything that changes confirmed edges
    (discovery commit, manual create/delete, suggested-edge approve) so it
    never goes stale."""
    db.execute(sqlt("""
        UPDATE lineage_nodes
        SET is_source = NOT EXISTS (
            SELECT 1 FROM lineage_edges e
            WHERE e.target_node_id = lineage_nodes.node_id AND e.status = 'confirmed'
        )
        WHERE connection_id = :conn
    """), {"conn": connection_id})


def compute_root_causes(db: Session, connection_id: str) -> list[dict]:
    """Rank genuine root-cause failures by downstream blast radius.

    A failing node is a root cause only if NONE of its ancestors (via
    confirmed edges) are also failing — if an ancestor is failing, this node's
    failure is more likely a downstream symptom of that, not independent.
    This is deliberately NOT the same check as is_source: is_source asks 'does
    anything feed into this at all', but a node can have healthy upstream
    dependencies and still be failing for its own independent reason — that's
    still a real root cause, just not a source node. The old frontend
    heuristic (first failing node where is_source=True, else first failing
    node at all) missed this distinction and could report a downstream
    symptom as "the" root cause while missing an independent second failure
    entirely, since it only ever returned one result.
    """
    nodes = db.execute(sqlt("""
        SELECT node_id, external_id, label, health_status, layer
        FROM lineage_nodes WHERE connection_id = :conn
    """), {"conn": connection_id}).fetchall()
    node_by_id = {
        r[0]: {"node_id": r[0], "external_id": r[1], "label": r[2],
               "health_status": r[3] or "ok", "layer": r[4]}
        for r in nodes
    }

    edges = db.execute(sqlt("""
        SELECT source_node_id, target_node_id FROM lineage_edges
        WHERE connection_id = :conn AND status = 'confirmed'
    """), {"conn": connection_id}).fetchall()

    forward: dict[str, list[str]] = {}
    backward: dict[str, list[str]] = {}
    for src, tgt in edges:
        forward.setdefault(src, []).append(tgt)
        backward.setdefault(tgt, []).append(src)

    failing_ids = {nid for nid, n in node_by_id.items() if n["health_status"] == "fail"}

    def has_failing_ancestor(start: str) -> bool:
        visited = {start}
        queue = deque(backward.get(start, []))
        while queue:
            cur = queue.popleft()
            if cur in visited:
                continue
            visited.add(cur)
            if cur in failing_ids:
                return True
            queue.extend(backward.get(cur, []))
        return False

    def count_downstream(start: str) -> int:
        visited: set = set()
        queue = deque(forward.get(start, []))
        while queue:
            cur = queue.popleft()
            if cur in visited:
                continue
            visited.add(cur)
            queue.extend(forward.get(cur, []))
        return len(visited)

    root_causes = [
        {**node_by_id[nid], "downstream_impact_count": count_downstream(nid)}
        for nid in failing_ids
        if not has_failing_ancestor(nid)
    ]
    root_causes.sort(key=lambda r: -r["downstream_impact_count"])
    return root_causes


def _persist_edge(
    db: Session, connection_id: str, edge: DiscoveredEdge,
    node_cache: dict[str, str], known_tables: dict[str, str], report: DiscoveryReport,
) -> None:
    src_id = _ensure_node(db, connection_id, edge.source_fqn,
                           known_tables.get(edge.source_fqn, "UNKNOWN"), edge.discovered_via, node_cache)
    tgt_id = _ensure_node(db, connection_id, edge.target_fqn,
                           known_tables.get(edge.target_fqn, "UNKNOWN"), edge.discovered_via, node_cache)

    existing = db.execute(sqlt("""
        SELECT edge_id FROM lineage_edges
        WHERE connection_id = :conn AND source_node_id = :src AND target_node_id = :tgt
    """), {"conn": connection_id, "src": src_id, "tgt": tgt_id}).fetchone()
    if existing:
        report.edges_already_existed += 1
        return

    # Only confirmed edges affect real topology — a suggested edge doesn't
    # create a cycle until/unless it's approved (approve_edge re-checks then).
    if edge.status == "confirmed" and would_create_cycle(db, src_id, tgt_id):
        report.edges_cycle_rejected += 1
        logger.warning(
            "Skipping %s -> %s (discovered_via=%s): would create a cycle with existing confirmed edges",
            edge.source_fqn, edge.target_fqn, edge.discovered_via,
        )
        return

    db.execute(sqlt("""
        INSERT INTO lineage_edges
            (connection_id, source_node_id, target_node_id, edge_type,
             discovered_via, status, confidence, evidence, discovered_at)
        VALUES (:conn, :src, :tgt, :etype, :via, :status, :conf, :evidence, NOW())
    """), {
        "conn": connection_id, "src": src_id, "tgt": tgt_id, "etype": edge.edge_type,
        "via": edge.discovered_via, "status": edge.status, "conf": edge.confidence,
        "evidence": (edge.evidence or "")[:500],
    })
    if edge.status == "confirmed":
        report.edges_confirmed += 1
    else:
        report.edges_suggested += 1


# ── FK discovery ─────────────────────────────────────────────────────────────

def _discover_fk_edges(
    db: Session, connection_id: str, connector: BaseConnector, schemas: list[str],
    known_tables: dict[str, str], node_cache: dict[str, str], report: DiscoveryReport,
) -> None:
    for schema in schemas:
        try:
            fks = connector.list_foreign_keys(schema)
        except Exception as exc:
            logger.warning("FK discovery failed for schema=%s: %s", schema, exc)
            continue
        report.fk_schemas_scanned.append(schema)
        for fk in fks:
            source_fqn = f"{fk.source_schema}.{fk.source_table}"
            target_fqn = f"{fk.target_schema}.{fk.target_table}"
            if source_fqn == target_fqn:
                continue
            report.fk_edges_found += 1
            edge = DiscoveredEdge(
                source_fqn=source_fqn, target_fqn=target_fqn, edge_type="FEEDS",
                discovered_via="fk", confidence=None,
                evidence=(
                    f"FK constraint {fk.constraint_name}: "
                    f"{target_fqn}({','.join(fk.target_columns)}) -> {source_fqn}({','.join(fk.source_columns)})"
                ),
                status="confirmed",
            )
            _persist_edge(db, connection_id, edge, node_cache, known_tables, report)


# ── Query-log discovery (SQL parsing, never LLM) ────────────────────────────

def _table_fqn_from_node(t) -> str | None:
    """Map a sqlglot Table node to OUR table_fqn convention: database.table for
    dbo/default-schema tables, database.schema.table otherwise. A bare table name
    with no database/catalog context is unresolvable and returns None — we never
    guess which database an unqualified reference belongs to."""
    from sqlglot import exp
    if not isinstance(t, exp.Table) or not t.name:
        return None
    catalog = t.args.get("catalog")
    db_part = t.args.get("db")
    catalog_name = catalog.name if catalog else None
    db_name = db_part.name if db_part else None

    parts: list[str] = []
    if catalog_name:
        parts.append(catalog_name)
        if db_name and db_name.lower() != "dbo":
            parts.append(db_name)
    elif db_name:
        parts.append(db_name)
    else:
        return None
    parts.append(t.name)
    return ".".join(parts)


class _SqlParseFailure(Exception):
    """Raised specifically when sqlglot itself couldn't parse the SQL at all —
    distinct from 'parsed fine but isn't a lineage-producing statement type'
    (a plain SELECT/UPDATE, which returns None below with no exception). Only
    this category is worth an LLM fallback attempt: a clean parse that simply
    isn't lineage-relevant would only waste tokens and risk a spurious guess."""


def _extract_from_statement(tree) -> tuple[str, list[str]] | None:
    """Extract (target_fqn, [source_fqns]) from a single already-parsed
    statement tree. Returns None if it isn't a recognized lineage-producing
    statement (INSERT INTO ... SELECT, MERGE, CREATE TABLE AS SELECT,
    SELECT ... INTO) — including sqlglot's own exp.Command fallback node,
    which it silently returns (no exception) for syntax it couldn't structure
    into a real statement type (dynamic SQL, EXEC, vendor extensions)."""
    from sqlglot import exp

    if isinstance(tree, exp.Command):
        return None

    target_node = None
    if isinstance(tree, (exp.Insert, exp.Merge)):
        target_node = tree.args.get("this")
    elif isinstance(tree, exp.Create):
        if not tree.args.get("expression"):
            return None  # plain CREATE TABLE DDL, no SELECT body — no lineage signal
        target_node = tree.args.get("this")
        if isinstance(target_node, exp.Schema):
            target_node = target_node.args.get("this")
    elif isinstance(tree, exp.Select):
        into = tree.args.get("into")
        if not into:
            return None
        target_node = into.args.get("this")

    if not isinstance(target_node, exp.Table):
        return None

    target_fqn = _table_fqn_from_node(target_node)
    if not target_fqn:
        return None

    source_fqns: list[str] = []
    for t in tree.find_all(exp.Table):
        if t is target_node:
            continue
        fqn = _table_fqn_from_node(t)
        if fqn and fqn != target_fqn:
            source_fqns.append(fqn)
    if not source_fqns:
        return None
    return target_fqn, list(dict.fromkeys(source_fqns))


def _extract_target_sources(sql_text: str, dialect: str | None) -> tuple[str, list[str]] | None:
    """Parse one query-log entry (which may be a multi-statement T-SQL batch —
    e.g. a session SET followed by the actual INSERT) into (target_fqn,
    [source_fqns]). Tries every statement in the batch, not just the first
    (sqlglot.parse_one only returns the first) — a batch's real data-movement
    statement is often preceded by DECLARE/SET/session-config statements.

    Returns None for a batch where every statement parsed fine but none was
    lineage-relevant. Raises _SqlParseFailure if sqlglot couldn't structurally
    parse ANY statement in the batch at all (dynamic SQL, stored procs, vendor
    syntax) AND none of the statements that DID parse yielded a usable edge —
    that combination is worth an LLM fallback attempt.
    """
    import sqlglot
    from sqlglot import exp

    try:
        statements = sqlglot.parse(sql_text, dialect=dialect)
    except Exception as exc:
        raise _SqlParseFailure(str(exc)) from exc

    had_unparseable = False
    for tree in statements:
        if tree is None:
            had_unparseable = True
            continue
        if isinstance(tree, exp.Command):
            had_unparseable = True
            continue
        result = _extract_from_statement(tree)
        if result is not None:
            return result

    if had_unparseable:
        raise _SqlParseFailure("one or more statements in the batch fell back to a generic Command node")
    return None


def _discover_query_log_edges(
    db: Session, connection_id: str, connector: BaseConnector, platform: str,
    since_hours: int, known_tables: dict[str, str], node_cache: dict[str, str],
    report: DiscoveryReport, include_llm_fallback: bool = False,
) -> None:
    report.llm_fallback_enabled = include_llm_fallback
    report.query_log_supported = connector.supports_query_log()
    if not report.query_log_supported:
        report.query_log_unsupported_reason = (
            f"Query-log lineage discovery is not yet implemented for platform '{platform}'. "
            "FK-constraint and dbt-manifest discovery still apply."
        )
        return

    try:
        entries = connector.list_recent_queries(since_hours=since_hours)
    except Exception as exc:
        logger.warning("list_recent_queries failed: %s", exc)
        report.query_log_unsupported_reason = f"Query log fetch failed: {exc}"
        return

    dialect = _DIALECT_BY_PLATFORM.get(platform)
    pair_counts: dict[tuple[str, str], int] = {}
    pair_evidence: dict[tuple[str, str], str] = {}
    unparseable_texts: list[str] = []
    seen_unparseable: set[str] = set()

    for entry in entries:
        report.query_log_statements_scanned += 1
        try:
            parsed = _extract_target_sources(entry.query_text, dialect)
        except _SqlParseFailure:
            report.query_log_parse_failures += 1
            normalized = entry.query_text.strip()
            if normalized and normalized not in seen_unparseable:
                seen_unparseable.add(normalized)
                unparseable_texts.append(entry.query_text)
            continue
        if parsed is None:
            continue  # parsed fine, just not a lineage-producing statement — no LLM needed
        target_fqn, source_fqns = parsed
        if target_fqn not in known_tables:
            continue
        for source_fqn in source_fqns:
            if source_fqn not in known_tables or source_fqn == target_fqn:
                continue
            key = (source_fqn, target_fqn)
            pair_counts[key] = pair_counts.get(key, 0) + max(1, entry.execution_count)
            pair_evidence.setdefault(key, entry.query_text.strip()[:200])

    for (source_fqn, target_fqn), count in pair_counts.items():
        confidence = 0.6 if count <= 1 else 0.75 if count <= 4 else 0.9
        report.query_log_edges_found += 1
        edge = DiscoveredEdge(
            source_fqn=source_fqn, target_fqn=target_fqn, edge_type="FEEDS",
            discovered_via="query_log", confidence=confidence,
            evidence=f"Seen in {count} executed statement(s), e.g.: {pair_evidence[(source_fqn, target_fqn)]}",
            status="suggested",  # heuristic — always requires human approval, never auto-committed
        )
        _persist_edge(db, connection_id, edge, node_cache, known_tables, report)

    if include_llm_fallback and unparseable_texts:
        _discover_query_log_llm_fallback_edges(
            db, connection_id, unparseable_texts, known_tables, node_cache, report
        )


# ── dbt manifest discovery ───────────────────────────────────────────────────

def _dbt_fqn(node_def: dict) -> str | None:
    db_name = node_def.get("database")
    schema_name = node_def.get("schema")
    table_name = node_def.get("alias") or node_def.get("identifier") or node_def.get("name")
    if not db_name or not table_name:
        return None
    if schema_name and schema_name.lower() != "dbo":
        return f"{db_name}.{schema_name}.{table_name}"
    return f"{db_name}.{table_name}"


def _discover_dbt_edges(
    db: Session, connection_id: str, manifest: dict,
    known_tables: dict[str, str], node_cache: dict[str, str], report: DiscoveryReport,
) -> None:
    report.dbt_provided = True
    nodes = manifest.get("nodes", {}) or {}
    sources = manifest.get("sources", {}) or {}

    fqn_by_id: dict[str, str | None] = {}
    for uid, d in nodes.items():
        if d.get("resource_type") in ("model", "seed", "snapshot"):
            fqn_by_id[uid] = _dbt_fqn(d)
    for uid, d in sources.items():
        fqn_by_id[uid] = _dbt_fqn(d)

    for uid, node_def in nodes.items():
        if node_def.get("resource_type") not in ("model", "seed", "snapshot"):
            continue
        report.dbt_models_scanned += 1
        target_fqn = fqn_by_id.get(uid)
        if not target_fqn:
            continue
        for upstream_uid in (node_def.get("depends_on") or {}).get("nodes", []):
            source_fqn = fqn_by_id.get(upstream_uid)
            if not source_fqn or source_fqn == target_fqn:
                continue
            report.dbt_edges_found += 1
            edge = DiscoveredEdge(
                source_fqn=source_fqn, target_fqn=target_fqn, edge_type="FEEDS",
                discovered_via="dbt", confidence=None,
                evidence=f"dbt model dependency: {node_def.get('name', uid)}",
                status="confirmed",
            )
            _persist_edge(db, connection_id, edge, node_cache, known_tables, report)


# ── LLM query-log fallback (opt-in, off by default) ─────────────────────────
# For the residual statements sqlglot genuinely could not parse (dynamic SQL,
# stored procs, vendor syntax) — never for statements that parsed fine but
# simply weren't lineage-relevant. Every extracted edge is STILL validated
# against known_tables like every other method, capped at low confidence
# (doubly-heuristic: an LLM interpreting SQL a real parser already failed on),
# and always lands as 'suggested' — never auto-committed. Bounded per run so a
# noisy query log can't blow up cost/latency silently; anything beyond the cap
# is reported as skipped, not dropped without a trace.

_LLM_FALLBACK_MAX_STATEMENTS = 20
_LLM_FALLBACK_MAX_CONFIDENCE = 0.5


class _QueryExtraction(BaseModel):
    target_table: str | None = None
    source_tables: list[str] = Field(default_factory=list)
    confidence: float = Field(ge=0.0, le=1.0)


def _normalize_llm_table_fqn(raw: str) -> str:
    """Apply the same database.table / database.schema.table convention (dbo
    collapsed, brackets stripped) used everywhere else in this module to a raw
    table reference the LLM extracted verbatim from SQL text. Without this,
    'BronzeDB.dbo.br_payments' (exactly what the LLM sees and is told to quote
    faithfully) would never match known_tables' 'BronzeDB.br_payments' key,
    and every dbo-schema extraction would be silently rejected as unknown."""
    cleaned = raw.strip().replace("[", "").replace("]", "")
    parts = [p for p in cleaned.split(".") if p]
    if len(parts) == 3 and parts[1].lower() == "dbo":
        return f"{parts[0]}.{parts[2]}"
    return ".".join(parts)


def _discover_query_log_llm_fallback_edges(
    db: Session, connection_id: str, unparseable_texts: list[str],
    known_tables: dict[str, str], node_cache: dict[str, str], report: DiscoveryReport,
) -> None:
    import asyncio

    candidates = unparseable_texts[:_LLM_FALLBACK_MAX_STATEMENTS]
    if len(unparseable_texts) > _LLM_FALLBACK_MAX_STATEMENTS:
        report.llm_fallback_skipped = len(unparseable_texts) - _LLM_FALLBACK_MAX_STATEMENTS

    try:
        # _discover_query_log_llm_fallback_edges is called from run_discovery(),
        # itself called from a sync FastAPI endpoint (Starlette worker thread) —
        # no event loop already running there, so asyncio.run() is safe here.
        results = asyncio.run(_llm_extract_batch(candidates))
    except Exception as exc:
        logger.warning("LLM query-log fallback failed entirely: %s", exc)
        report.llm_fallback_error = str(exc)
        return

    report.llm_fallback_attempted = len(candidates)
    pairs_seen: set[tuple[str, str]] = set()
    for sql_text, extraction in zip(candidates, results):
        if extraction is None or not extraction.target_table:
            continue
        target_fqn = _normalize_llm_table_fqn(extraction.target_table)
        if target_fqn not in known_tables:
            continue
        for raw_source in extraction.source_tables:
            if not raw_source:
                continue
            source_fqn = _normalize_llm_table_fqn(raw_source)
            if not source_fqn or source_fqn not in known_tables or source_fqn == target_fqn:
                continue
            key = (source_fqn, target_fqn)
            if key in pairs_seen:
                continue
            pairs_seen.add(key)
            report.llm_fallback_edges_found += 1
            edge = DiscoveredEdge(
                source_fqn=source_fqn, target_fqn=target_fqn, edge_type="FEEDS",
                discovered_via="query_log_llm",
                confidence=min(extraction.confidence, _LLM_FALLBACK_MAX_CONFIDENCE),
                evidence=f"LLM-extracted from unparseable SQL: {sql_text.strip()[:200]}",
                status="suggested",
            )
            _persist_edge(db, connection_id, edge, node_cache, known_tables, report)


async def _llm_extract_batch(sql_texts: list[str]) -> list["_QueryExtraction | None"]:
    import asyncio
    return await asyncio.gather(*(_llm_extract_one(sql) for sql in sql_texts))


async def _llm_extract_one(sql_text: str) -> "_QueryExtraction | None":
    import asyncio
    import json as _json
    from app.core.llm import achat_with_usage, parse_llm_json
    from app.prompts.lineage import build_query_extraction_prompt, QUERY_EXTRACTION_PROMPT_VERSION

    try:
        messages = build_query_extraction_prompt(sql_text)
        raw, usage = await asyncio.wait_for(
            achat_with_usage(messages, temperature=0, max_tokens=250, num_retries=0, request_timeout=6),
            timeout=8.0,
        )
        data = parse_llm_json(raw)
        result = _QueryExtraction.model_validate(data)
        logger.info(_json.dumps({
            "event": "llm.query_log_extraction",
            "prompt_version": QUERY_EXTRACTION_PROMPT_VERSION,
            "model": usage.get("model") if usage else None,
            "target_table": result.target_table,
            "source_count": len(result.source_tables),
            "confidence": result.confidence,
        }))
        return result
    except Exception as exc:
        logger.warning("LLM query extraction failed for one statement: %s", exc)
        return None


# ── Orchestrator ─────────────────────────────────────────────────────────────

def run_discovery(
    db: Session,
    connection_id: str,
    connector: BaseConnector,
    platform: str,
    schemas: list[str],
    include_fk: bool = True,
    include_query_log: bool = True,
    query_log_hours: int = 168,
    dbt_manifest: dict | None = None,
    include_llm_fallback: bool = False,
) -> DiscoveryReport:
    report = DiscoveryReport(fk_enabled=include_fk, query_log_enabled=include_query_log)
    known_tables = _known_tables(db, connection_id)
    node_cache = _existing_node_ids(db, connection_id)
    nodes_before = len(node_cache)

    if include_fk:
        _discover_fk_edges(db, connection_id, connector, schemas, known_tables, node_cache, report)

    if include_query_log:
        _discover_query_log_edges(
            db, connection_id, connector, platform, query_log_hours, known_tables, node_cache, report,
            include_llm_fallback=include_llm_fallback,
        )

    if dbt_manifest:
        _discover_dbt_edges(db, connection_id, dbt_manifest, known_tables, node_cache, report)

    report.nodes_created = len(node_cache) - nodes_before
    recompute_is_source(db, connection_id)
    db.commit()
    return report
