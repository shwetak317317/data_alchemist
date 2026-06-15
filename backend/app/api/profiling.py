"""
Profiling API — streams agent progress via SSE, returns report as final event.
"""
import json
import uuid
import logging
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session
from sqlalchemy import text

from app.core.metadata_db import get_db
from app.api.connections import get_active_connector
from app.agents.profiling_agent import run_profiling
from app.models.profiling import ProfilingRunRequest, ProfilingReport, ProfilingProgressEvent

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/profiling", tags=["profiling"])


@router.get("/datasets")
def list_datasets(connection_id: str, db: Session = Depends(get_db)):
    """List all tables visible through a connection, grouped by layer/schema."""
    # For demo connection or when connector is unavailable, serve from profiling_reports
    conn_row = db.execute(
        text("SELECT platform, is_demo FROM connections WHERE id=:id"),
        {"id": connection_id},
    ).fetchone()
    is_demo = conn_row and (conn_row[0] == "demo" or conn_row[1])

    if is_demo:
        rows = db.execute(text("""
            SELECT table_fqn, layer, schema_name, table_name, row_count, quality_score, run_at
            FROM profiling_reports
            WHERE connection_id=:conn
            ORDER BY layer, table_fqn
        """), {"conn": connection_id}).fetchall()
        grouped = {}
        for r in rows:
            layer = (r[1] or r[2] or "UNKNOWN").upper()
            if layer not in grouped:
                grouped[layer] = {"layer": layer, "tables": []}
            score = float(r[5] or 0)
            grouped[layer]["tables"].append({
                "name": r[0], "layer": layer, "rows": r[4] or 0,
                "score": round(score), "profiled": str(r[6])[:10] if r[6] else "—",
                "hot": score < 70,
            })
        return list(grouped.values())

    try:
        connector = get_active_connector(connection_id, db)
        schemas = connector.list_schemas()
        result = []
        for schema in schemas:
            tables = connector.list_tables(schema)
            result.append({
                "schema": schema,
                "layer": tables[0].layer if tables else "UNKNOWN",
                "tables": [
                    {"name": t.table_name, "layer": t.layer, "row_count": t.row_count}
                    for t in tables
                ],
            })
        connector.close()
        return result
    except Exception as exc:
        logger.warning("list_datasets fallback to DB: %s", exc)
        # Fallback — return whatever is in profiling_reports
        rows = db.execute(text("""
            SELECT table_fqn, layer, row_count, quality_score, run_at
            FROM profiling_reports WHERE connection_id=:conn ORDER BY layer, table_fqn
        """), {"conn": connection_id}).fetchall()
        grouped: dict = {}
        for r in rows:
            layer = (r[1] or "UNKNOWN").upper()
            if layer not in grouped:
                grouped[layer] = {"layer": layer, "tables": []}
            grouped[layer]["tables"].append({
                "name": r[0], "layer": layer, "rows": r[2] or 0,
                "score": round(float(r[3] or 0)), "profiled": str(r[4])[:10] if r[4] else "—", "hot": False,
            })
        return list(grouped.values())


@router.get("/report/by-table/{table_fqn:path}")
def get_report_by_table(table_fqn: str, connection_id: str | None = None, db: Session = Depends(get_db)):
    """Return the latest profiling report for a given table_fqn, using field names the frontend expects."""
    params: dict = {"table": table_fqn}
    conn_filter = "AND connection_id=:conn" if connection_id else ""
    if connection_id:
        params["conn"] = connection_id

    row = db.execute(text(f"""
        SELECT report_id, connection_id, table_fqn, layer, run_at, row_count,
               quality_score, completeness_score, uniqueness_score, consistency_score,
               freshness_score, summary_text
        FROM profiling_reports
        WHERE table_fqn=:table {conn_filter}
        ORDER BY run_at DESC LIMIT 1
    """), params).fetchone()

    if not row:
        raise HTTPException(404, f"No report found for {table_fqn}")

    rid = row[0]
    quality_score = float(row[6] or 0)
    completeness = float(row[7] or 0)
    uniqueness = float(row[8] or 0)
    consistency = float(row[9] or 0)
    freshness = float(row[10] or 100)

    # Always use normalized tables for consistent field names (column_name, title, etc.)
    cs_rows = db.execute(text("""
        SELECT column_name, data_type, null_pct, distinct_count, detected_format,
               is_cde, is_pii, quality_score, health
        FROM column_stats WHERE report_id=:rid ORDER BY column_name
    """), {"rid": rid}).fetchall()
    column_stats = [
        {"column_name": r[0], "data_type": r[1] or "TEXT",
         "null_pct": float(r[2] or 0), "distinct_count": r[3] or 0,
         "detected_format": r[4] or "—", "is_cde": bool(r[5]),
         "is_pii": bool(r[6]), "quality_score": float(r[7] or 0),
         "health": r[8] or "HEALTHY"}
        for r in cs_rows
    ]

    risk_rows = db.execute(text("""
        SELECT risk_code, severity, title, description, column_name, risk_type
        FROM profiling_risks WHERE report_id=:rid
        ORDER BY CASE severity WHEN 'CRITICAL' THEN 1 WHEN 'HIGH' THEN 2 WHEN 'MEDIUM' THEN 3 ELSE 4 END
    """), {"rid": rid}).fetchall()
    risks_flagged = [
        {"risk_code": r[0], "severity": r[1], "title": r[2] or r[5] or "Risk",
         "description": r[3] or "", "column_name": r[4] or "—", "risk_type": r[5] or ""}
        for r in risk_rows
    ]

    row_count = row[5] or 0
    summary_stats = {
        "quality_score": round(quality_score),
        "completeness": f"{round(completeness)}%",
        "uniqueness": f"{round(uniqueness)}%",
        "consistency": f"{round(consistency)}%",
        "freshness": f"{round(freshness)}%",
        "total_columns": len(column_stats),
        "row_count": f"{row_count:,}",
    }

    return {
        "report_id": row[0], "connection_id": row[1], "table_fqn": row[2],
        "layer": row[3] or "UNKNOWN", "run_at": row[4].isoformat() if row[4] else None,
        "row_count": row_count, "quality_score": quality_score,
        "completeness_score": completeness, "uniqueness_score": uniqueness,
        "consistency_score": consistency, "freshness_score": freshness,
        "summary_text": row[11], "summary_stats": summary_stats,
        "column_stats": column_stats, "risks_flagged": risks_flagged,
    }


@router.post("/run")
def run_profiling_stream(req: ProfilingRunRequest, db: Session = Depends(get_db)):
    """
    Stream profiling progress as Server-Sent Events.
    Each event is JSON: {"type": "progress", "data": {...}} or {"type": "report", "data": {...}}
    """
    connector = get_active_connector(req.connection_id, db)

    def event_stream():
        try:
            for item in run_profiling(
                connector=connector,
                connection_id=req.connection_id,
                schema_name=req.schema_name,
                table_name=req.table_name,
            ):
                if isinstance(item, ProfilingProgressEvent):
                    payload = json.dumps({"type": "progress", "data": item.model_dump()})
                elif isinstance(item, ProfilingReport):
                    # Persist report to DB
                    _save_report(db, item)
                    payload = json.dumps({"type": "report", "data": item.model_dump(mode="json")})
                else:
                    continue
                yield f"data: {payload}\n\n"
        except Exception as e:
            logger.exception("Profiling stream error")
            yield f"data: {json.dumps({'type': 'error', 'message': str(e)})}\n\n"
        finally:
            connector.close()

    return StreamingResponse(event_stream(), media_type="text/event-stream")


@router.get("/report/{report_id}", response_model=ProfilingReport)
def get_report(report_id: str, db: Session = Depends(get_db)):
    row = db.execute(text(
        "SELECT report_id, connection_id, table_fqn, layer, run_at, row_count, "
        "quality_score, completeness_score, uniqueness_score, consistency_score, "
        "freshness_score, risks_flagged, column_stats, summary_text "
        "FROM profiling_reports WHERE report_id=:id"
    ), {"id": report_id}).fetchone()

    if not row:
        raise HTTPException(404, "Report not found")

    return ProfilingReport(
        report_id=row[0], connection_id=row[1], table_fqn=row[2],
        layer=row[3] or "UNKNOWN", run_at=row[4],
        row_count=row[5] or 0, quality_score=row[6] or 0,
        completeness_score=row[7] or 0, uniqueness_score=row[8] or 0,
        consistency_score=row[9] or 0, freshness_score=row[10] or 100,
        risks=row[11] or [], columns=row[12] or [], summary_text=row[13],
    )


def _save_report(db: Session, report: ProfilingReport) -> None:
    try:
        db.execute(text("""
            INSERT INTO profiling_reports
                (report_id, connection_id, table_fqn, layer, run_at, row_count,
                 quality_score, completeness_score, uniqueness_score,
                 consistency_score, freshness_score, risks_flagged,
                 column_stats, summary_text)
            VALUES
                (:report_id, :connection_id, :table_fqn, :layer, :run_at, :row_count,
                 :quality_score, :completeness_score, :uniqueness_score,
                 :consistency_score, :freshness_score, :risks_flagged::jsonb,
                 :column_stats::jsonb, :summary_text)
        """), {
            "report_id": report.report_id,
            "connection_id": report.connection_id,
            "table_fqn": report.table_fqn,
            "layer": report.layer,
            "run_at": report.run_at,
            "row_count": report.row_count,
            "quality_score": report.quality_score,
            "completeness_score": report.completeness_score,
            "uniqueness_score": report.uniqueness_score,
            "consistency_score": report.consistency_score,
            "freshness_score": report.freshness_score,
            "risks_flagged": json.dumps([r.model_dump() for r in report.risks]),
            "column_stats": json.dumps([c.model_dump() for c in report.columns]),
            "summary_text": report.summary_text,
        })
        db.commit()
    except Exception as e:
        logger.warning("Failed to save profiling report: %s", e)
        db.rollback()
