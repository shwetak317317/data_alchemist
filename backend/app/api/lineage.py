"""Lineage API — serve and manage node/edge graph from PostgreSQL lineage_nodes + lineage_edges."""
import logging
from collections import deque
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session
from sqlalchemy import text

from app.core.metadata_db import get_db
from app.core.auth_deps import get_current_user, CurrentUser

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/lineage", tags=["lineage"])

_LAYER_ORDER = {"RAW": 0, "BRONZE": 1, "SILVER": 2, "GOLD": 3, "REPORT": 4, "MODEL": 4}


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


# ── Shared helpers ────────────────────────────────────────────────────────────

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
        SELECT node_id, external_id, label, sub_label, layer, node_type,
               tier_label, health_status, note, position_order, is_source
        FROM lineage_nodes
        WHERE node_id IN ({placeholders})
        ORDER BY position_order, tier_label
    """), id_params).fetchall()

    edge_rows = db.execute(text(f"""
        SELECT edge_id, source_node_id, target_node_id, edge_type
        FROM lineage_edges
        WHERE source_node_id IN ({placeholders}) AND target_node_id IN ({placeholders})
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
    node_rows = db.execute(text("""
        SELECT node_id, external_id, label, sub_label, layer, node_type,
               tier_label, health_status, note, position_order, is_source
        FROM lineage_nodes
        WHERE connection_id = :conn
        ORDER BY position_order, tier_label
    """), {"conn": connection_id}).fetchall()

    edge_rows = db.execute(text("""
        SELECT e.edge_id, e.source_node_id, e.target_node_id, e.edge_type
        FROM lineage_edges e
        WHERE e.connection_id = :conn
    """), {"conn": connection_id}).fetchall()

    return _rows_to_graph(connection_id, node_rows, edge_rows)


@router.post("/seed/{connection_id}")
def seed_lineage(connection_id: str, db: Session = Depends(get_db),
                 current_user: CurrentUser = Depends(get_current_user)):
    """Auto-seed lineage nodes from profiling reports for a connection. Idempotent."""
    reports = db.execute(text("""
        SELECT DISTINCT ON (table_fqn) table_fqn, layer, quality_score
        FROM profiling_reports
        WHERE connection_id = :conn
        ORDER BY table_fqn, run_at DESC
    """), {"conn": connection_id}).fetchall()

    if not reports:
        raise HTTPException(404, "No profiling reports found. Profile a table first.")

    sorted_reports = sorted(reports, key=lambda r: _LAYER_ORDER.get(r[1] or "", 99))
    min_pos = min(_LAYER_ORDER.get(r[1] or "", 99) for r in sorted_reports)

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
                 :tier, :health, :pos, :is_src)
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
            "is_src": pos == min_pos,
        })
        created += 1

    db.commit()
    return {"seeded": created, "connection_id": connection_id}


@router.post("/propagate/{connection_id}")
def propagate_health(connection_id: str, db: Session = Depends(get_db),
                     current_user: CurrentUser = Depends(get_current_user)):
    """Update lineage node health_status from latest DQ execution results."""
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

    row = db.execute(text("""
        SELECT node_id, external_id, label, sub_label, layer, node_type,
               tier_label, health_status, note, position_order, is_source
        FROM lineage_nodes WHERE node_id = :node_id
    """), {"node_id": node_id}).fetchone()
    if not row:
        raise HTTPException(404, "Node not found")
    return LineageNode(
        node_id=row[0], external_id=row[1], label=row[2], sub_label=row[3],
        layer=row[4], node_type=row[5] or "table", tier_label=row[6],
        health_status=row[7] or "ok", note=row[8],
        position_order=row[9] or 0, is_source=bool(row[10]),
    )


@router.delete("/nodes/{node_id}")
def delete_node(node_id: str, db: Session = Depends(get_db),
                current_user: CurrentUser = Depends(get_current_user)):
    """Delete a lineage node and all its edges (cascade)."""
    res = db.execute(text("DELETE FROM lineage_nodes WHERE node_id = :id"), {"id": node_id})
    db.commit()
    if res.rowcount == 0:
        raise HTTPException(404, "Node not found")
    return {"deleted": node_id}


@router.post("/edges", response_model=LineageEdge)
def create_edge(req: CreateEdgeRequest, db: Session = Depends(get_db),
                current_user: CurrentUser = Depends(get_current_user)):
    """Create a lineage edge between two nodes identified by external_id."""
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

    row = db.execute(text("""
        INSERT INTO lineage_edges (connection_id, source_node_id, target_node_id, edge_type)
        VALUES (:conn, :src, :tgt, :etype)
        ON CONFLICT (connection_id, source_node_id, target_node_id) DO NOTHING
        RETURNING edge_id
    """), {"conn": req.connection_id, "src": src[0], "tgt": tgt[0],
           "etype": req.edge_type}).fetchone()
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
    res = db.execute(text("DELETE FROM lineage_edges WHERE edge_id = :id"), {"id": edge_id})
    db.commit()
    if res.rowcount == 0:
        raise HTTPException(404, "Edge not found")
    return {"deleted": edge_id}


@router.get("/{table_fqn:path}", response_model=LineageGraph)
def get_lineage(table_fqn: str, connection_id: Optional[str] = None,
                db: Session = Depends(get_db),
                current_user: CurrentUser = Depends(get_current_user)):
    """Return the downstream lineage graph rooted at the given table (BFS from root node)."""
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
        # No root found — return full graph for the connection as fallback
        node_rows = db.execute(text(f"""
            SELECT node_id, external_id, label, sub_label, layer, node_type,
                   tier_label, health_status, note, position_order, is_source
            FROM lineage_nodes n WHERE 1=1 {conn_filter}
            ORDER BY position_order, tier_label
        """), params).fetchall()
        edge_rows = db.execute(text(f"""
            SELECT e.edge_id, e.source_node_id, e.target_node_id, e.edge_type
            FROM lineage_edges e WHERE 1=1
            {conn_filter.replace('connection_id', 'e.connection_id')}
        """), params).fetchall()
        return _rows_to_graph(table_fqn, node_rows, edge_rows)

    # BFS downstream from root
    visited: set = {root[0]}
    queue: deque = deque([root[0]])
    while queue:
        current = queue.popleft()
        for (nid,) in db.execute(text(
            "SELECT target_node_id FROM lineage_edges WHERE source_node_id = :src"
        ), {"src": current}).fetchall():
            if nid not in visited:
                visited.add(nid)
                queue.append(nid)

    node_rows, edge_rows = _fetch_nodes_by_ids(db, list(visited))
    return _rows_to_graph(table_fqn, node_rows, edge_rows)
