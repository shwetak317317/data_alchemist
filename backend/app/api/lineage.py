"""Lineage API — serve and manage node/edge graph from PostgreSQL lineage_nodes + lineage_edges."""
import json
import logging
from collections import deque
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session
from sqlalchemy import text

from app.core.metadata_db import get_db
from app.core.auth_deps import get_current_user, assert_connection_access, CurrentUser
from app.services.lineage_discovery import run_discovery, would_create_cycle, recompute_is_source

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/lineage", tags=["lineage"])

_LAYER_ORDER = {"RAW": 0, "BRONZE": 1, "SILVER": 2, "GOLD": 3, "REPORT": 4, "MODEL": 4}

# Shared column list + join for every node SELECT — keeps last_profiled_at (the
# staleness indicator) consistent everywhere a lineage_node is read, instead of
# some call sites having it and others silently missing it.
_NODE_COLUMNS = """
    n.node_id, n.external_id, n.label, n.sub_label, n.layer, n.node_type,
    n.tier_label, n.health_status, n.note, n.position_order, n.is_source,
    prof.last_profiled_at
"""
_NODE_PROFILING_JOIN = """
    LEFT JOIN LATERAL (
        SELECT MAX(run_at) AS last_profiled_at
        FROM profiling_reports p
        WHERE p.connection_id = n.connection_id AND p.table_fqn = n.external_id
    ) prof ON TRUE
"""


# ── Pydantic Models ───────────────────────────────────────────────────────────

class LineageNode(BaseModel):
    node_id: str
    external_id: str
    label: str
    sub_label: Optional[str] = None
    layer: Optional[str] = None
    node_type: str
    tier_label: Optional[str] = None
    health_status: str
    note: Optional[str] = None
    position_order: int
    is_source: bool
    last_profiled_at: Optional[str] = None  # None = never profiled (or unprofilable, e.g. a report/model node)


class LineageEdge(BaseModel):
    edge_id: Optional[str] = None
    source_ext_id: str
    target_ext_id: str
    edge_type: str


class LineageGraph(BaseModel):
    source_table: str
    nodes: list[LineageNode]
    edges: list[LineageEdge]


class CreateNodeRequest(BaseModel):
    connection_id: str
    external_id: str
    label: str
    sub_label: Optional[str] = None
    layer: Optional[str] = None
    node_type: str = "table"
    tier_label: Optional[str] = None
    health_status: str = "ok"
    note: Optional[str] = None
    position_order: int = 0
    is_source: bool = False


class UpdateNodeRequest(BaseModel):
    label: Optional[str] = None
    sub_label: Optional[str] = None
    health_status: Optional[str] = None
    note: Optional[str] = None
    tier_label: Optional[str] = None
    position_order: Optional[int] = None
    is_source: Optional[bool] = None


class CreateEdgeRequest(BaseModel):
    connection_id: str
    source_ext_id: str
    target_ext_id: str
    edge_type: str = "FEEDS"


class DiscoverRequest(BaseModel):
    include_fk: bool = True
    include_query_log: bool = True
    query_log_hours: int = 168
    dbt_manifest: Optional[dict[str, Any]] = None
    # Off by default — this is the one option in /discover that spends LLM
    # tokens. Only applies to query-log statements the deterministic SQL
    # parser genuinely couldn't parse at all (dynamic SQL, stored procs);
    # extracted edges are capped at low confidence and always land as
    # 'suggested', same review gate as every other heuristic edge.
    include_llm_fallback: bool = False


class DiscoverResponse(BaseModel):
    fk_enabled: bool
    fk_schemas_scanned: list[str]
    fk_edges_found: int
    fk_error: Optional[str] = None

    query_log_enabled: bool
    query_log_supported: bool
    query_log_unsupported_reason: Optional[str] = None
    query_log_statements_scanned: int
    query_log_parse_failures: int
    query_log_edges_found: int

    llm_fallback_enabled: bool
    llm_fallback_attempted: int
    llm_fallback_skipped: int
    llm_fallback_edges_found: int
    llm_fallback_error: Optional[str] = None

    dbt_provided: bool
    dbt_models_scanned: int
    dbt_edges_found: int

    nodes_created: int
    edges_confirmed: int
    edges_suggested: int
    edges_already_existed: int
    edges_cycle_rejected: int


class SuggestedEdge(BaseModel):
    edge_id: str
    source_label: str
    target_label: str
    edge_type: str
    discovered_via: str
    confidence: Optional[float] = None
    evidence: Optional[str] = None
    discovered_at: Optional[str] = None


class NarrativeResponse(BaseModel):
    node_found: bool
    bullets: list[str] = []
    severity: str = "low"
    generated_via: str = "none"  # llm | template | none
    downstream_count: int = 0


class RootCause(BaseModel):
    node_id: str
    external_id: str
    label: str
    health_status: str
    layer: Optional[str] = None
    downstream_impact_count: int


class LineageHealth(BaseModel):
    total_known_tables: int
    tables_with_edges: int
    completeness_pct: float
    edges_by_discovered_via: dict[str, int]
    suggested_pending: int
    suggested_approved: int
    suggested_rejected: int


# ── Shared helpers ────────────────────────────────────────────────────────────

def _assert_connection_org(connection_id: str, db: Session, current_user: CurrentUser) -> None:
    """403 if the connection belongs to another org; 404 if it doesn't exist.
    Every lineage route enforces this — previously any authenticated user could
    read, seed, or DELETE another organisation's lineage by guessing ids."""
    row = db.execute(text(
        "SELECT org_id FROM connections WHERE id=:id AND deleted_at IS NULL"
    ), {"id": connection_id}).fetchone()
    if not row:
        raise HTTPException(404, "Connection not found")
    assert_connection_access(row[0], current_user)


def _assert_node_org(node_id: str, db: Session, current_user: CurrentUser) -> str:
    """Org-check a node via its connection; returns the connection_id."""
    row = db.execute(text(
        "SELECT n.connection_id, c.org_id FROM lineage_nodes n "
        "LEFT JOIN connections c ON c.id = n.connection_id WHERE n.node_id=:id"
    ), {"id": node_id}).fetchone()
    if not row:
        raise HTTPException(404, "Node not found")
    assert_connection_access(row[1], current_user)
    return row[0]


def _assert_edge_org(edge_id: str, db: Session, current_user: CurrentUser) -> str:
    """Org-check an edge via its connection; returns the connection_id."""
    row = db.execute(text(
        "SELECT e.connection_id, c.org_id FROM lineage_edges e "
        "LEFT JOIN connections c ON c.id = e.connection_id WHERE e.edge_id=:id"
    ), {"id": edge_id}).fetchone()
    if not row:
        raise HTTPException(404, "Edge not found")
    assert_connection_access(row[1], current_user)
    return row[0]


def _rows_to_graph(source_table: str, node_rows, edge_rows) -> LineageGraph:
    if not node_rows:
        return LineageGraph(source_table=source_table, nodes=[], edges=[])

    node_map = {r[0]: r[1] for r in node_rows}  # node_id → external_id
    nodes = [
        LineageNode(
            node_id=r[0], external_id=r[1], label=r[2], sub_label=r[3],
            layer=r[4], node_type=r[5] or "table", tier_label=r[6],
            health_status=r[7] or "ok", note=r[8],
            position_order=r[9] or 0, is_source=bool(r[10]),
            last_profiled_at=r[11].isoformat() if len(r) > 11 and r[11] else None,
        )
        for r in node_rows
    ]
    edges = [
        LineageEdge(
            edge_id=r[0],
            source_ext_id=node_map.get(r[1], r[1]),
            target_ext_id=node_map.get(r[2], r[2]),
            edge_type=r[3] or "FEEDS",
        )
        for r in edge_rows
        if r[1] in node_map and r[2] in node_map
    ]
    return LineageGraph(source_table=source_table, nodes=nodes, edges=edges)


def _fetch_nodes_by_ids(db: Session, ids_list: list) -> tuple:
    """Fetch nodes and edges for a specific set of node_ids."""
    if not ids_list:
        return [], []
    placeholders = ", ".join(f":id_{i}" for i in range(len(ids_list)))
    id_params = {f"id_{i}": v for i, v in enumerate(ids_list)}

    node_rows = db.execute(text(f"""
        SELECT {_NODE_COLUMNS}
        FROM lineage_nodes n
        {_NODE_PROFILING_JOIN}
        WHERE n.node_id IN ({placeholders})
        ORDER BY n.position_order, n.tier_label
    """), id_params).fetchall()

    edge_rows = db.execute(text(f"""
        SELECT edge_id, source_node_id, target_node_id, edge_type
        FROM lineage_edges
        WHERE source_node_id IN ({placeholders}) AND target_node_id IN ({placeholders})
          AND status = 'confirmed'
    """), id_params).fetchall()

    return node_rows, edge_rows


def propagate_lineage_health_sync(db: Session, connection_id: str, run_id: str) -> int:
    """Update lineage node health_status from a completed DQ run. Non-raising — safe to call fire-and-forget."""
    try:
        results = db.execute(text("""
            SELECT table_fqn,
                   COUNT(*) FILTER (WHERE status = 'FAIL') AS fails
            FROM dq_run_results
            WHERE run_id = :run_id AND connection_id = :conn
            GROUP BY table_fqn
        """), {"run_id": run_id, "conn": connection_id}).fetchall()

        updated = 0
        for table_fqn, fails in results:
            health = "fail" if (fails or 0) > 0 else "ok"
            res = db.execute(text("""
                UPDATE lineage_nodes
                SET health_status = :health
                WHERE connection_id = :conn AND external_id = :ext_id
            """), {"health": health, "conn": connection_id, "ext_id": table_fqn})
            updated += res.rowcount

        return updated
    except Exception as exc:
        logger.warning("propagate_lineage_health_sync failed: %s", exc)
        return 0


# ── Routes — specific paths MUST be declared before the catch-all /{table_fqn:path} ──

@router.get("/graph/{connection_id}", response_model=LineageGraph)
def get_full_graph(connection_id: str, db: Session = Depends(get_db),
                   current_user: CurrentUser = Depends(get_current_user)):
    """Return the full lineage graph for a connection (all nodes + edges)."""
    _assert_connection_org(connection_id, db, current_user)
    node_rows = db.execute(text(f"""
        SELECT {_NODE_COLUMNS}
        FROM lineage_nodes n
        {_NODE_PROFILING_JOIN}
        WHERE n.connection_id = :conn
        ORDER BY n.position_order, n.tier_label
    """), {"conn": connection_id}).fetchall()

    edge_rows = db.execute(text("""
        SELECT e.edge_id, e.source_node_id, e.target_node_id, e.edge_type
        FROM lineage_edges e
        WHERE e.connection_id = :conn AND e.status = 'confirmed'
    """), {"conn": connection_id}).fetchall()

    return _rows_to_graph(connection_id, node_rows, edge_rows)


@router.post("/seed/{connection_id}")
def seed_lineage(connection_id: str, db: Session = Depends(get_db),
                 current_user: CurrentUser = Depends(get_current_user)):
    """Auto-seed lineage nodes from profiling reports for a connection. Idempotent."""
    _assert_connection_org(connection_id, db, current_user)
    reports = db.execute(text("""
        SELECT DISTINCT ON (table_fqn) table_fqn, layer, quality_score
        FROM profiling_reports
        WHERE connection_id = :conn
        ORDER BY table_fqn, run_at DESC
    """), {"conn": connection_id}).fetchall()

    if not reports:
        raise HTTPException(404, "No profiling reports found. Profile a table first.")

    sorted_reports = sorted(reports, key=lambda r: _LAYER_ORDER.get(r[1] or "", 99))

    created = 0
    for table_fqn, layer, score in sorted_reports:
        health = "ok" if (score or 0) >= 80 else ("warn" if (score or 0) >= 60 else "fail")
        pos = _LAYER_ORDER.get(layer or "", 99)
        db.execute(text("""
            INSERT INTO lineage_nodes
                (connection_id, external_id, label, layer, node_type,
                 tier_label, health_status, position_order, is_source)
            VALUES
                (:conn, :ext_id, :label, :layer, 'table',
                 :tier, :health, :pos, TRUE)
            ON CONFLICT (connection_id, external_id) DO UPDATE
                SET health_status = EXCLUDED.health_status,
                    layer = EXCLUDED.layer,
                    position_order = EXCLUDED.position_order
        """), {
            "conn": connection_id,
            "ext_id": table_fqn,
            "label": table_fqn,
            "layer": layer or "UNKNOWN",
            "tier": layer or "UNKNOWN",
            "health": health,
            "pos": pos,
        })
        created += 1

    # New nodes default to is_source=TRUE (honest: nothing is known to feed
    # into them yet). recompute_is_source then corrects this from real edge
    # topology in one pass — matters when re-seeding a connection that already
    # has discovered edges, and replaces the old "lowest profiled layer = source"
    # heuristic, which couldn't tell "genuinely a source" from "just not yet
    # profiled at a lower layer" (e.g. medallion architectures spanning
    # separate per-layer databases, where most tables sit at one profiled
    # layer with no FK/lineage evidence either way).
    recompute_is_source(db, connection_id)
    db.commit()
    return {"seeded": created, "connection_id": connection_id}


@router.post("/propagate/{connection_id}")
def propagate_health(connection_id: str, db: Session = Depends(get_db),
                     current_user: CurrentUser = Depends(get_current_user)):
    """Update lineage node health_status from latest DQ execution results."""
    _assert_connection_org(connection_id, db, current_user)
    latest = db.execute(text("""
        SELECT run_id FROM dq_run_results
        WHERE connection_id = :conn
        ORDER BY run_timestamp DESC LIMIT 1
    """), {"conn": connection_id}).fetchone()

    if not latest:
        raise HTTPException(404, "No execution results found. Run DQ execution first.")

    updated = propagate_lineage_health_sync(db, connection_id, latest[0])
    db.commit()
    return {"updated": updated, "run_id": latest[0]}


@router.post("/nodes", response_model=LineageNode)
def create_node(req: CreateNodeRequest, db: Session = Depends(get_db),
                current_user: CurrentUser = Depends(get_current_user)):
    """Create a new lineage node."""
    _assert_connection_org(req.connection_id, db, current_user)
    row = db.execute(text("""
        INSERT INTO lineage_nodes
            (connection_id, external_id, label, sub_label, layer, node_type,
             tier_label, health_status, note, position_order, is_source)
        VALUES
            (:conn, :ext_id, :label, :sub, :layer, :ntype,
             :tier, :health, :note, :pos, :is_src)
        RETURNING node_id
    """), {
        "conn": req.connection_id, "ext_id": req.external_id,
        "label": req.label, "sub": req.sub_label, "layer": req.layer,
        "ntype": req.node_type, "tier": req.tier_label or req.layer,
        "health": req.health_status, "note": req.note,
        "pos": req.position_order, "is_src": req.is_source,
    }).fetchone()
    db.commit()
    return LineageNode(
        node_id=row[0], external_id=req.external_id, label=req.label,
        sub_label=req.sub_label, layer=req.layer, node_type=req.node_type,
        tier_label=req.tier_label or req.layer, health_status=req.health_status,
        note=req.note, position_order=req.position_order, is_source=req.is_source,
    )


@router.patch("/nodes/{node_id}", response_model=LineageNode)
def update_node(node_id: str, req: UpdateNodeRequest, db: Session = Depends(get_db),
                current_user: CurrentUser = Depends(get_current_user)):
    """Update a lineage node's metadata or health status."""
    _assert_node_org(node_id, db, current_user)
    fields = [
        ("label", "label"), ("sub_label", "sub_label"),
        ("health_status", "health_status"), ("note", "note"),
        ("tier_label", "tier_label"), ("position_order", "position_order"),
        ("is_source", "is_source"),
    ]
    sets, params = [], {"node_id": node_id}
    for attr, col in fields:
        val = getattr(req, attr)
        if val is not None:
            sets.append(f"{col} = :{attr}")
            params[attr] = val
    if not sets:
        raise HTTPException(400, "No fields to update")

    db.execute(text(f"UPDATE lineage_nodes SET {', '.join(sets)} WHERE node_id = :node_id"), params)
    db.commit()

    row = db.execute(text(f"""
        SELECT {_NODE_COLUMNS}
        FROM lineage_nodes n
        {_NODE_PROFILING_JOIN}
        WHERE n.node_id = :node_id
    """), {"node_id": node_id}).fetchone()
    if not row:
        raise HTTPException(404, "Node not found")
    return LineageNode(
        node_id=row[0], external_id=row[1], label=row[2], sub_label=row[3],
        layer=row[4], node_type=row[5] or "table", tier_label=row[6],
        health_status=row[7] or "ok", note=row[8],
        position_order=row[9] or 0, is_source=bool(row[10]),
        last_profiled_at=row[11].isoformat() if row[11] else None,
    )


@router.delete("/nodes/{node_id}")
def delete_node(node_id: str, db: Session = Depends(get_db),
                current_user: CurrentUser = Depends(get_current_user)):
    """Delete a lineage node and all its edges (cascade)."""
    connection_id = _assert_node_org(node_id, db, current_user)
    res = db.execute(text("DELETE FROM lineage_nodes WHERE node_id = :id"), {"id": node_id})
    if res.rowcount == 0:
        db.rollback()
        raise HTTPException(404, "Node not found")
    # The cascade may have removed the only incoming edge of downstream nodes —
    # without this their is_source flags go stale (every other edge-mutating
    # route already recomputes; this one was the gap).
    if connection_id:
        recompute_is_source(db, connection_id)
    db.commit()
    return {"deleted": node_id}


@router.post("/edges", response_model=LineageEdge)
def create_edge(req: CreateEdgeRequest, db: Session = Depends(get_db),
                current_user: CurrentUser = Depends(get_current_user)):
    """Create a lineage edge between two nodes identified by external_id.
    Manually-curated edges are ground truth (same as FK/dbt discovery) and are
    always status='confirmed' — but still checked for cycles, since a human
    can fat-finger a reversed edge just as easily as a parser can."""
    _assert_connection_org(req.connection_id, db, current_user)
    src = db.execute(text(
        "SELECT node_id FROM lineage_nodes WHERE connection_id = :conn AND external_id = :ext"
    ), {"conn": req.connection_id, "ext": req.source_ext_id}).fetchone()
    tgt = db.execute(text(
        "SELECT node_id FROM lineage_nodes WHERE connection_id = :conn AND external_id = :ext"
    ), {"conn": req.connection_id, "ext": req.target_ext_id}).fetchone()
    if not src:
        raise HTTPException(404, f"Source node not found: {req.source_ext_id}")
    if not tgt:
        raise HTTPException(404, f"Target node not found: {req.target_ext_id}")

    if would_create_cycle(db, src[0], tgt[0]):
        raise HTTPException(
            400,
            f"Cannot add {req.source_ext_id} -> {req.target_ext_id}: "
            f"{req.target_ext_id} already has a confirmed path back to {req.source_ext_id}, "
            "so this would create a cycle.",
        )

    row = db.execute(text("""
        INSERT INTO lineage_edges (connection_id, source_node_id, target_node_id, edge_type, discovered_via, status)
        VALUES (:conn, :src, :tgt, :etype, 'manual', 'confirmed')
        ON CONFLICT (connection_id, source_node_id, target_node_id) DO NOTHING
        RETURNING edge_id
    """), {"conn": req.connection_id, "src": src[0], "tgt": tgt[0],
           "etype": req.edge_type}).fetchone()
    recompute_is_source(db, req.connection_id)
    db.commit()
    return LineageEdge(
        edge_id=row[0] if row else None,
        source_ext_id=req.source_ext_id,
        target_ext_id=req.target_ext_id,
        edge_type=req.edge_type,
    )


@router.delete("/edges/{edge_id}")
def delete_edge(edge_id: str, db: Session = Depends(get_db),
                current_user: CurrentUser = Depends(get_current_user)):
    """Delete a lineage edge."""
    connection_id = _assert_edge_org(edge_id, db, current_user)
    db.execute(text("DELETE FROM lineage_edges WHERE edge_id = :id"), {"id": edge_id})
    recompute_is_source(db, connection_id)
    db.commit()
    return {"deleted": edge_id}


@router.post("/discover/{connection_id}", response_model=DiscoverResponse)
def discover_lineage(
    connection_id: str,
    req: DiscoverRequest = DiscoverRequest(),
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user),
):
    """Deterministic lineage edge discovery — no LLM anywhere in this path.

    FK constraints and a supplied dbt manifest are ground truth and auto-confirmed
    straight into the graph. SQL query-log parsing is heuristic and always lands as
    'suggested' — see GET /suggested/{connection_id} and /edges/{edge_id}/approve —
    because a wrong edge actively misdirects incident response, which is worse than
    a missing one.
    """
    from app.api.connections import get_active_connector

    _assert_connection_org(connection_id, db, current_user)
    row = db.execute(text(
        "SELECT platform, schemas_scope FROM connections WHERE id = :id AND deleted_at IS NULL"
    ), {"id": connection_id}).fetchone()
    if not row:
        raise HTTPException(404, f"Connection {connection_id} not found")
    platform, schemas_scope = row[0], list(row[1] or [])

    connector = get_active_connector(connection_id, db)
    try:
        report = run_discovery(
            db=db,
            connection_id=connection_id,
            connector=connector,
            platform=platform,
            schemas=schemas_scope,
            include_fk=req.include_fk,
            include_query_log=req.include_query_log,
            query_log_hours=req.query_log_hours,
            dbt_manifest=req.dbt_manifest,
            include_llm_fallback=req.include_llm_fallback,
        )
    finally:
        connector.close()

    logger.info(json.dumps({
        "event": "lineage.discover",
        "connection_id": connection_id,
        "user": current_user.email,
        "fk_edges_found": report.fk_edges_found,
        "query_log_edges_found": report.query_log_edges_found,
        "llm_fallback_edges_found": report.llm_fallback_edges_found,
        "dbt_edges_found": report.dbt_edges_found,
        "nodes_created": report.nodes_created,
        "edges_confirmed": report.edges_confirmed,
        "edges_suggested": report.edges_suggested,
    }))

    return DiscoverResponse(
        fk_enabled=report.fk_enabled,
        fk_schemas_scanned=report.fk_schemas_scanned,
        fk_edges_found=report.fk_edges_found,
        fk_error=report.fk_error,
        query_log_enabled=report.query_log_enabled,
        query_log_supported=report.query_log_supported,
        query_log_unsupported_reason=report.query_log_unsupported_reason,
        query_log_statements_scanned=report.query_log_statements_scanned,
        query_log_parse_failures=report.query_log_parse_failures,
        query_log_edges_found=report.query_log_edges_found,
        llm_fallback_enabled=report.llm_fallback_enabled,
        llm_fallback_attempted=report.llm_fallback_attempted,
        llm_fallback_skipped=report.llm_fallback_skipped,
        llm_fallback_edges_found=report.llm_fallback_edges_found,
        llm_fallback_error=report.llm_fallback_error,
        dbt_provided=report.dbt_provided,
        dbt_models_scanned=report.dbt_models_scanned,
        dbt_edges_found=report.dbt_edges_found,
        nodes_created=report.nodes_created,
        edges_confirmed=report.edges_confirmed,
        edges_suggested=report.edges_suggested,
        edges_already_existed=report.edges_already_existed,
        edges_cycle_rejected=report.edges_cycle_rejected,
    )


@router.get("/suggested/{connection_id}", response_model=list[SuggestedEdge])
def list_suggested_edges(connection_id: str, db: Session = Depends(get_db),
                         current_user: CurrentUser = Depends(get_current_user)):
    """Pending query-log-discovered edges awaiting human approval."""
    _assert_connection_org(connection_id, db, current_user)
    rows = db.execute(text("""
        SELECT e.edge_id, src.label, tgt.label, e.edge_type,
               e.discovered_via, e.confidence, e.evidence, e.discovered_at
        FROM lineage_edges e
        JOIN lineage_nodes src ON src.node_id = e.source_node_id
        JOIN lineage_nodes tgt ON tgt.node_id = e.target_node_id
        WHERE e.connection_id = :conn AND e.status = 'suggested'
        ORDER BY e.confidence DESC NULLS LAST, e.discovered_at DESC
    """), {"conn": connection_id}).fetchall()
    return [
        SuggestedEdge(
            edge_id=r[0], source_label=r[1], target_label=r[2], edge_type=r[3],
            discovered_via=r[4], confidence=r[5], evidence=r[6],
            discovered_at=r[7].isoformat() if r[7] else None,
        )
        for r in rows
    ]


@router.post("/edges/{edge_id}/approve", response_model=LineageEdge)
def approve_edge(edge_id: str, db: Session = Depends(get_db),
                 current_user: CurrentUser = Depends(get_current_user)):
    """Promote a suggested edge to confirmed — it now appears in the main graph
    and BFS impact traversal. Re-checked for cycles at approval time (not just
    at discovery time): the graph's confirmed topology may have changed since
    this edge was suggested, e.g. another suggestion for the reverse direction
    could have been approved first."""
    _assert_edge_org(edge_id, db, current_user)
    pending = db.execute(text("""
        SELECT connection_id, source_node_id, target_node_id, edge_type
        FROM lineage_edges WHERE edge_id = :id AND status = 'suggested'
    """), {"id": edge_id}).fetchone()
    if not pending:
        raise HTTPException(404, "Suggested edge not found (already reviewed, or doesn't exist)")
    connection_id, src_id, tgt_id, edge_type = pending

    if would_create_cycle(db, src_id, tgt_id):
        raise HTTPException(
            400,
            "Cannot approve this edge: it would create a cycle with edges confirmed since it was suggested. "
            "Reject it, or review the conflicting confirmed edge first.",
        )

    row = db.execute(text("""
        UPDATE lineage_edges
        SET status = 'confirmed', reviewed_by = :user, reviewed_at = NOW()
        WHERE edge_id = :id AND status = 'suggested'
        RETURNING source_node_id, target_node_id, edge_type
    """), {"id": edge_id, "user": current_user.email}).fetchone()
    if not row:
        db.rollback()
        raise HTTPException(409, "This suggestion was already reviewed by someone else just now — refresh and retry.")
    recompute_is_source(db, connection_id)
    db.commit()

    src = db.execute(text("SELECT external_id FROM lineage_nodes WHERE node_id = :id"), {"id": row[0]}).fetchone()
    tgt = db.execute(text("SELECT external_id FROM lineage_nodes WHERE node_id = :id"), {"id": row[1]}).fetchone()
    return LineageEdge(edge_id=edge_id, source_ext_id=src[0], target_ext_id=tgt[0], edge_type=row[2])


@router.post("/edges/{edge_id}/reject")
def reject_edge(edge_id: str, db: Session = Depends(get_db),
               current_user: CurrentUser = Depends(get_current_user)):
    """Reject a suggested edge. Kept in the table (status='rejected') as an audit
    trail rather than deleted, so re-running discovery doesn't just re-suggest the
    same edge a steward already dismissed — see run_discovery's existing-edge check."""
    _assert_edge_org(edge_id, db, current_user)
    res = db.execute(text("""
        UPDATE lineage_edges
        SET status = 'rejected', reviewed_by = :user, reviewed_at = NOW()
        WHERE edge_id = :id AND status = 'suggested'
    """), {"id": edge_id, "user": current_user.email})
    db.commit()
    if res.rowcount == 0:
        raise HTTPException(404, "Suggested edge not found (already reviewed, or doesn't exist)")
    return {"rejected": edge_id}


@router.post("/narrative/{connection_id}", response_model=NarrativeResponse)
def get_impact_narrative(
    connection_id: str,
    table_fqn: str,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user),
):
    """Generate a business-impact narrative for one table, grounded in the REAL
    downstream lineage graph (confirmed edges only — same BFS as GET
    /{table_fqn}). The only LLM-touching piece of the lineage module; see
    lineage_narrative.py for the grounding discipline and deterministic
    fallback (this endpoint never errors out to the user on an LLM failure)."""
    _assert_connection_org(connection_id, db, current_user)
    from app.services.lineage_narrative import generate_impact_narrative

    result = generate_impact_narrative(db, connection_id, table_fqn)
    return NarrativeResponse(**result)


@router.get("/root-causes/{connection_id}", response_model=list[RootCause])
def get_root_causes(connection_id: str, db: Session = Depends(get_db),
                    current_user: CurrentUser = Depends(get_current_user)):
    """Rank genuine root-cause failures (no failing ancestor via confirmed
    edges) by downstream blast radius. Multiple independent failures can
    coexist — this returns all of them, ranked, rather than picking one."""
    _assert_connection_org(connection_id, db, current_user)
    from app.services.lineage_discovery import compute_root_causes

    return [RootCause(**rc) for rc in compute_root_causes(db, connection_id)]


@router.get("/health/{connection_id}", response_model=LineageHealth)
def get_lineage_health(connection_id: str, db: Session = Depends(get_db),
                       current_user: CurrentUser = Depends(get_current_user)):
    """Completeness/precision metrics for this connection's lineage graph —
    the leading indicator of whether discovery is actually providing value,
    not just internal logs. completeness_pct in particular: a module that
    finds zero edges everywhere is a much bigger problem than any single
    discovery run's counts reveal on their own."""
    _assert_connection_org(connection_id, db, current_user)
    total_known = db.execute(text(
        "SELECT COUNT(*) FROM connection_tables WHERE connection_id = :conn"
    ), {"conn": connection_id}).scalar() or 0

    with_edges = db.execute(text("""
        SELECT COUNT(DISTINCT n.external_id)
        FROM lineage_nodes n
        JOIN lineage_edges e ON (e.source_node_id = n.node_id OR e.target_node_id = n.node_id)
        WHERE n.connection_id = :conn AND e.status = 'confirmed'
    """), {"conn": connection_id}).scalar() or 0

    via_rows = db.execute(text("""
        SELECT discovered_via, COUNT(*) FROM lineage_edges
        WHERE connection_id = :conn AND status = 'confirmed'
        GROUP BY discovered_via
    """), {"conn": connection_id}).fetchall()

    suggested_counts = dict(db.execute(text("""
        SELECT status, COUNT(*) FROM lineage_edges
        WHERE connection_id = :conn AND discovered_via IN ('query_log', 'query_log_llm')
        GROUP BY status
    """), {"conn": connection_id}).fetchall())

    return LineageHealth(
        total_known_tables=total_known,
        tables_with_edges=with_edges,
        completeness_pct=round(100.0 * with_edges / total_known, 1) if total_known else 0.0,
        edges_by_discovered_via={r[0]: r[1] for r in via_rows},
        suggested_pending=suggested_counts.get("suggested", 0),
        suggested_approved=suggested_counts.get("confirmed", 0),
        suggested_rejected=suggested_counts.get("rejected", 0),
    )


@router.get("/{table_fqn:path}", response_model=LineageGraph)
def get_lineage(table_fqn: str, connection_id: Optional[str] = None,
                db: Session = Depends(get_db),
                current_user: CurrentUser = Depends(get_current_user)):
    """Return the downstream lineage graph rooted at the given table (BFS from root node)."""
    if connection_id:
        _assert_connection_org(connection_id, db, current_user)
    params: dict = {"fqn": table_fqn}
    conn_filter = "AND connection_id = :conn" if connection_id else ""
    if connection_id:
        params["conn"] = connection_id

    root = db.execute(text(f"""
        SELECT node_id FROM lineage_nodes
        WHERE external_id = :fqn {conn_filter}
        LIMIT 1
    """), params).fetchone()

    if not root:
        # The table has no lineage node — say so honestly with an empty graph.
        # The old fallback returned the ENTIRE connection graph, which read as
        # "this table impacts everything": a false blast radius is the one
        # thing an impact endpoint must never produce.
        return LineageGraph(source_table=table_fqn, nodes=[], edges=[])

    # BFS downstream from root — only follow confirmed edges; a 'suggested' edge
    # awaiting review must not silently expand what impact analysis reports.
    visited: set = {root[0]}
    queue: deque = deque([root[0]])
    while queue:
        current = queue.popleft()
        for (nid,) in db.execute(text(
            "SELECT target_node_id FROM lineage_edges WHERE source_node_id = :src AND status = 'confirmed'"
        ), {"src": current}).fetchall():
            if nid not in visited:
                visited.add(nid)
                queue.append(nid)

    node_rows, edge_rows = _fetch_nodes_by_ids(db, list(visited))
    return _rows_to_graph(table_fqn, node_rows, edge_rows)
