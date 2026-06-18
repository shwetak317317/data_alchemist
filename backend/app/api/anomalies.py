"""Anomaly API — scan, inbox, acknowledge, explain."""
import uuid
import logging
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import text

from app.core.metadata_db import get_db
from app.core.auth_deps import get_current_user, CurrentUser
from app.models.anomaly import AnomalyRecord, AnomalyAcknowledgeRequest, AnomalyExplanationResponse, AnomalyScanRequest
from app.agents.explainability_agent import explain_anomaly
from app.services.audit_service import log_event

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/anomalies", tags=["anomalies"])


def _row_to_anomaly(row) -> AnomalyRecord:
    return AnomalyRecord(
        anomaly_id=row[0], connection_id=row[1],
        detected_at=row[2], layer=row[3], table_fqn=row[4],
        column_name=row[5], anomaly_type=row[6], description=row[7],
        severity=row[8], metric_value=float(row[9]) if row[9] else None,
        baseline_value=float(row[10]) if row[10] else None,
        deviation_pct=float(row[11]) if row[11] else None,
        business_explanation=row[12], status=row[13],
    )


@router.get("/inbox", response_model=list[AnomalyRecord])
def get_inbox(connection_id: str | None = None, db: Session = Depends(get_db),
              current_user: CurrentUser = Depends(get_current_user)):
    """Return all open anomalies, newest first."""
    filters, params = ["status='open'"], {}
    if connection_id:
        filters.append("connection_id=:conn")
        params["conn"] = connection_id
    where = "WHERE " + " AND ".join(filters)
    rows = db.execute(text(
        f"SELECT anomaly_id, connection_id, detected_at, layer, table_fqn, column_name, "
        f"anomaly_type, description, severity, metric_value, baseline_value, deviation_pct, "
        f"business_explanation, status, history_values "
        f"FROM anomaly_log {where} ORDER BY detected_at DESC"
    ), params).fetchall()

    result = []
    for r in rows:
        a = _row_to_anomaly(r)
        if len(r) > 14 and r[14] is not None:
            hv = r[14]
            if isinstance(hv, list):
                a.history_values = hv
            elif isinstance(hv, str):
                import json
                try:
                    a.history_values = json.loads(hv)
                except Exception:
                    pass
        result.append(a)
    return result


@router.post("/scan")
def scan_anomalies(req: AnomalyScanRequest, db: Session = Depends(get_db),
                   current_user: CurrentUser = Depends(get_current_user)):
    """
    Trigger an anomaly scan for a connection.
    Compares current profiling run stats against the last 7 days of history.
    Returns the anomaly IDs created.
    """
    from app.api.connections import get_active_connector
    from app.services.anomaly_service import detect_volume_anomaly

    connector = get_active_connector(req.connection_id, db)
    detected_ids = []

    # Get last 7 profiling reports for each table to build baseline
    tables_to_scan = req.tables or _get_active_tables(req.connection_id, db)
    for table_fqn in tables_to_scan:
        rows = db.execute(text(
            "SELECT row_count, run_at FROM profiling_reports "
            "WHERE connection_id=:conn AND table_fqn=:table "
            "ORDER BY run_at DESC LIMIT 8"
        ), {"conn": req.connection_id, "table": table_fqn}).fetchall()

        if len(rows) < 2:
            continue

        counts = [r[0] for r in rows]
        current, baseline = counts[0], counts[1:]
        layer = table_fqn.split(".")[0].upper() if "." in table_fqn else "UNKNOWN"

        anomaly = detect_volume_anomaly(
            connector=connector,
            connection_id=req.connection_id,
            table_fqn=table_fqn,
            layer=layer,
            baseline_counts=baseline,
            current_count=current,
        )
        if anomaly:
            _save_anomaly(db, anomaly)
            detected_ids.append(anomaly.anomaly_id)

    connector.close()
    return {"detected": len(detected_ids), "anomaly_ids": detected_ids}


@router.post("/{anomaly_id}/acknowledge")
def acknowledge(anomaly_id: str, req: AnomalyAcknowledgeRequest, db: Session = Depends(get_db),
                current_user: CurrentUser = Depends(get_current_user)):
    row = db.execute(text("SELECT anomaly_id, connection_id FROM anomaly_log WHERE anomaly_id=:id"),
                     {"id": anomaly_id}).fetchone()
    if not row:
        raise HTTPException(404, "Anomaly not found")

    db.execute(text(
        "UPDATE anomaly_log SET status='acknowledged', acknowledged_by=:by, "
        "acknowledged_at=NOW(), ack_note=:note WHERE anomaly_id=:id"
    ), {"by": current_user.email, "note": req.note, "id": anomaly_id})
    db.commit()

    log_event(db, user_email=current_user.email, event_type="ACK",
              entity_type="ANOMALY", entity_id=anomaly_id,
              new_value={"note": req.note}, connection_id=row[1])
    db.commit()
    return {"status": "acknowledged"}


@router.post("/{anomaly_id}/explain", response_model=AnomalyExplanationResponse)
def get_explanation(anomaly_id: str, db: Session = Depends(get_db),
                    current_user: CurrentUser = Depends(get_current_user)):
    row = db.execute(text(
        "SELECT anomaly_id, connection_id, detected_at, layer, table_fqn, column_name, "
        "anomaly_type, description, severity, metric_value, baseline_value, deviation_pct, "
        "business_explanation, status "
        "FROM anomaly_log WHERE anomaly_id=:id"
    ), {"id": anomaly_id}).fetchone()

    if not row:
        raise HTTPException(404, "Anomaly not found")

    anomaly = _row_to_anomaly(row)
    explanation = explain_anomaly(anomaly)

    # Persist explanation back to the record
    db.execute(text(
        "UPDATE anomaly_log SET business_explanation=:exp WHERE anomaly_id=:id"
    ), {"exp": explanation.why_it_matters, "id": anomaly_id})
    db.commit()

    return explanation


def _save_anomaly(db: Session, anomaly: AnomalyRecord) -> None:
    db.execute(text("""
        INSERT INTO anomaly_log
            (anomaly_id, connection_id, detected_at, layer, table_fqn, column_name,
             anomaly_type, description, severity, metric_value, baseline_value,
             deviation_pct, status, created_at)
        VALUES
            (:id, :conn, :detected, :layer, :table_fqn, :col,
             :type, :desc, :sev, :metric, :baseline,
             :dev_pct, 'open', NOW())
    """), {
        "id": anomaly.anomaly_id, "conn": anomaly.connection_id,
        "detected": anomaly.detected_at, "layer": anomaly.layer,
        "table_fqn": anomaly.table_fqn, "col": anomaly.column_name,
        "type": anomaly.anomaly_type, "desc": anomaly.description,
        "sev": anomaly.severity, "metric": anomaly.metric_value,
        "baseline": anomaly.baseline_value, "dev_pct": anomaly.deviation_pct,
    })
    db.commit()


@router.get("/fingerprints")
def get_fingerprints(connection_id: str | None = None, db: Session = Depends(get_db),
                     current_user: CurrentUser = Depends(get_current_user)):
    """Return anomaly fingerprints (past incident matches) for a connection."""
    params: dict = {}
    where = ""
    if connection_id:
        where = "WHERE connection_id=:conn"
        params["conn"] = connection_id
    rows = db.execute(text(
        f"SELECT similarity_pct, incident_date, incident_day, root_cause, "
        f"resolution, resolution_time, resolved_by, related_table "
        f"FROM anomaly_fingerprints {where} ORDER BY similarity_pct DESC"
    ), params).fetchall()
    return [
        {"sim": r[0], "date": str(r[1])[:10] if r[1] else "—", "day": r[2] or "—",
         "cause": r[3] or "", "resolution": r[4] or "", "time": r[5] or "—",
         "by": r[6] or "—", "table": r[7] or ""}
        for r in rows
    ]


def _get_active_tables(connection_id: str, db: Session) -> list[str]:
    rows = db.execute(text(
        "SELECT DISTINCT table_fqn FROM profiling_reports WHERE connection_id=:conn"
    ), {"conn": connection_id}).fetchall()
    return [r[0] for r in rows]
