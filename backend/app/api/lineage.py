"""Lineage API — serve node/edge graph from PostgreSQL lineage_nodes + lineage_edges."""
import logging
from typing import Optional

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.orm import Session
from sqlalchemy import text

from app.core.metadata_db import get_db

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/lineage", tags=["lineage"])


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
    source_ext_id: str
    target_ext_id: str
    edge_type: str


class LineageGraph(BaseModel):
    source_table: str
    nodes: list[LineageNode]
    edges: list[LineageEdge]


@router.get("/{table_fqn:path}", response_model=LineageGraph)
def get_lineage(table_fqn: str, connection_id: Optional[str] = None, db: Session = Depends(get_db)):
    """Return the lineage graph rooted at the given table for a connection."""
    params: dict = {}
    conn_filter = "AND n.connection_id=:conn" if connection_id else ""
    if connection_id:
        params["conn"] = connection_id

    node_rows = db.execute(text(f"""
        SELECT node_id, external_id, label, sub_label, layer, node_type,
               tier_label, health_status, note, position_order, is_source
        FROM lineage_nodes n
        WHERE 1=1 {conn_filter}
        ORDER BY position_order, tier_label
    """), params).fetchall()

    if not node_rows:
        return LineageGraph(source_table=table_fqn, nodes=[], edges=[])

    node_map = {r[0]: r[1] for r in node_rows}  # node_id → external_id

    edge_rows = db.execute(text(f"""
        SELECT e.source_node_id, e.target_node_id, e.edge_type
        FROM lineage_edges e
        WHERE 1=1 {conn_filter.replace('n.connection_id', 'e.connection_id')}
    """), params).fetchall()

    nodes = [
        LineageNode(
            node_id=r[0], external_id=r[1], label=r[2], sub_label=r[3],
            layer=r[4], node_type=r[5], tier_label=r[6],
            health_status=r[7] or "ok", note=r[8],
            position_order=r[9] or 0, is_source=bool(r[10]),
        )
        for r in node_rows
    ]

    edges = [
        LineageEdge(
            source_ext_id=node_map.get(r[0], r[0]),
            target_ext_id=node_map.get(r[1], r[1]),
            edge_type=r[2] or "FEEDS",
        )
        for r in edge_rows
        if r[0] in node_map and r[1] in node_map
    ]

    return LineageGraph(source_table=table_fqn, nodes=nodes, edges=edges)
