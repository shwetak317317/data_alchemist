"""Dashboard API — trust scores, layer health, trend lines, CDE status, audit trail."""
import logging
from typing import Optional
from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.orm import Session
from sqlalchemy import text

from app.core.metadata_db import get_db
from app.models.dashboard import TrustSummary, LayerHealth, TrendPoint, CDEStatus


class AuditEntry(BaseModel):
    time: str
    user: str
    action: str
    entity: str

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/dashboard", tags=["dashboard"])

_LAYER_ORDER = ["RAW", "BRONZE", "SILVER", "GOLD"]


@router.get("/summary", response_model=TrustSummary)
def get_summary(connection_id: str | None = None, db: Session = Depends(get_db)):
    """Return the overall trust summary for the home screen."""
    # Latest profiling scores per layer
    filters, params = [], {}
    if connection_id:
        filters.append("connection_id=:conn")
        params["conn"] = connection_id
    where = "WHERE " + " AND ".join(filters) if filters else ""

    layer_rows = db.execute(text(f"""
        SELECT layer, AVG(quality_score) as score
        FROM profiling_reports {where}
        GROUP BY layer
    """), params).fetchall()
    layer_scores = {r[0]: float(r[1]) for r in layer_rows}

    # Open issues from latest execution run
    issue_rows = db.execute(text(f"""
        SELECT severity, COUNT(*) FROM dq_run_results
        WHERE status='FAIL' {('AND connection_id=:conn' if connection_id else '')}
        GROUP BY severity
    """), params).fetchall()
    issues_by_sev = {r[0]: r[1] for r in issue_rows}

    # Active anomalies
    anomaly_count = db.execute(text(f"""
        SELECT COUNT(*) FROM anomaly_log
        WHERE status='open' {('AND connection_id=:conn' if connection_id else '')}
    """), params).scalar() or 0

    # Latest run timestamp
    last_run = db.execute(text(f"""
        SELECT MAX(run_timestamp) FROM dq_run_results
        {('WHERE connection_id=:conn' if connection_id else '')}
    """), params).scalar()

    # Overall score: average of layer scores (or 0 if no data)
    overall = round(sum(layer_scores.values()) / max(len(layer_scores), 1), 1) if layer_scores else 0

    # CDE health — from cde_registry health field
    cde_healthy = db.execute(text(f"""
        SELECT COUNT(*) FROM cde_registry
        WHERE health IN ('PASS','HEALTHY') {('AND connection_id=:conn' if connection_id else '')}
    """), params).scalar() or 0
    cde_total = db.execute(text(f"""
        SELECT COUNT(*) FROM cde_registry
        {('WHERE connection_id=:conn' if connection_id else '')}
    """), params).scalar() or 0
    cde_health_pct = round((cde_healthy / cde_total) * 100, 1) if cde_total else 100.0

    # Score delta vs previous day in trust_score_history
    history_rows = db.execute(text(f"""
        SELECT overall_score FROM trust_score_history
        {('WHERE connection_id=:conn' if connection_id else '')}
        ORDER BY score_date DESC LIMIT 2
    """), params).fetchall()
    delta = 0.0
    if len(history_rows) >= 2:
        delta = round(float(history_rows[0][0]) - float(history_rows[1][0]), 1)

    # Recent activity from audit_trail
    activity_rows = db.execute(text(f"""
        SELECT event_timestamp, user_name, event_type,
               entity_type || ' · ' || COALESCE(entity_name, entity_id) as entity
        FROM audit_trail
        WHERE 1=1 {('AND connection_id=:conn' if connection_id else '')}
        ORDER BY event_timestamp DESC LIMIT 8
    """), params).fetchall()
    recent_activity = [
        {
            "time": str(r[0])[:16].replace("T", " ")[-5:] if r[0] else "—",
            "user": r[1] or "System",
            "action": r[2] or "—",
            "entity": r[3] or "—",
        }
        for r in activity_rows
    ]

    layers = []
    for layer in _LAYER_ORDER:
        score = layer_scores.get(layer, 0)
        status = "HEALTHY" if score >= 85 else ("WARN" if score >= 65 else "ISSUES")
        layers.append(LayerHealth(
            layer=layer, score=score, status=status,
            open_issues=0, critical_count=0, high_count=0,
        ))

    pipeline_status = "ISSUES" if issues_by_sev.get("CRITICAL", 0) > 0 else (
        "RECOVERING" if issues_by_sev.get("HIGH", 0) > 0 else "HEALTHY"
    )

    return TrustSummary(
        overall_score=overall, score_delta=delta,
        pipeline_status=pipeline_status, layers=layers,
        open_critical=issues_by_sev.get("CRITICAL", 0),
        open_high=issues_by_sev.get("HIGH", 0),
        open_medium=issues_by_sev.get("MEDIUM", 0),
        active_anomalies=int(anomaly_count),
        cde_health_pct=cde_health_pct,
        last_run_at=last_run,
        recent_activity=recent_activity,
    )


@router.get("/trends", response_model=list[TrendPoint])
def get_trends(connection_id: str | None = None, days: int = 14, db: Session = Depends(get_db)):
    """Return daily trust score trend from trust_score_history for the last N days."""
    params: dict = {"days": days}
    conn_filter = "AND connection_id=:conn" if connection_id else ""
    if connection_id:
        params["conn"] = connection_id

    rows = db.execute(text(f"""
        SELECT score_date, overall_score
        FROM trust_score_history
        WHERE score_date >= CURRENT_DATE - (CAST(:days AS INTEGER) * INTERVAL '1 day')
        {conn_filter}
        ORDER BY score_date
    """), params).fetchall()

    return [TrendPoint(date=str(r[0]), score=round(float(r[1]), 1)) for r in rows]


@router.get("/rule-fail-trend")
def get_rule_fail_trend(connection_id: str | None = None, days: int = 7, db: Session = Depends(get_db)):
    """Return daily rule failure counts for the bar chart."""
    params: dict = {"days": days}
    conn_filter = "AND connection_id=:conn" if connection_id else ""
    if connection_id:
        params["conn"] = connection_id

    rows = db.execute(text(f"""
        SELECT fail_date, fail_count
        FROM rule_fail_history
        WHERE fail_date >= CURRENT_DATE - (CAST(:days AS INTEGER) * INTERVAL '1 day')
        {conn_filter}
        ORDER BY fail_date
    """), params).fetchall()

    return [{"label": str(r[0])[5:], "value": r[1]} for r in rows]


@router.get("/cdes", response_model=list[CDEStatus])
def get_cde_status(connection_id: str | None = None, db: Session = Depends(get_db)):
    filters, params = ["d.is_cde=TRUE"], {}
    if connection_id:
        filters.append("d.connection_id=:conn")
        params["conn"] = connection_id
    where = "WHERE " + " AND ".join(filters)

    rows = db.execute(text(f"""
        SELECT d.column_id, d.table_fqn, d.column_name, d.business_name, d.cde_score,
               COALESCE(p.null_avg, 0) as last_null_pct,
               COALESCE(r.rule_count, 0) as rule_coverage
        FROM data_dictionary d
        LEFT JOIN (
            SELECT table_fqn FROM profiling_reports GROUP BY table_fqn
        ) pr ON d.table_fqn=pr.table_fqn
        LEFT JOIN (
            SELECT column_name, AVG((cs->>'null_pct')::float) as null_avg
            FROM profiling_reports, jsonb_array_elements(column_stats) cs
            GROUP BY cs->>'name'
        ) p ON d.column_name=p.column_name
        LEFT JOIN (
            SELECT column_name, COUNT(*) as rule_count
            FROM dq_rules WHERE status IN ('approved','active')
            GROUP BY column_name
        ) r ON d.column_name=r.column_name
        {where}
        ORDER BY d.cde_score DESC NULLS LAST
    """), params).fetchall()

    result = []
    for row in rows:
        null_pct = float(row[5])
        health = "HEALTHY" if null_pct < 1 else ("WARN" if null_pct < 5 else "CRIT")
        result.append(CDEStatus(
            column_id=row[0], table_fqn=row[1], column_name=row[2],
            business_name=row[3], cde_score=float(row[4] or 0),
            last_null_pct=null_pct, rule_coverage=row[6] or 0, health=health,
        ))
    return result


@router.get("/audit", response_model=list[AuditEntry])
def get_audit_trail(connection_id: Optional[str] = None, limit: int = 20, db: Session = Depends(get_db)):
    """Return the most recent audit trail entries for the given connection."""
    params: dict = {"limit": limit}
    conn_filter = "AND connection_id=:conn" if connection_id else ""
    if connection_id:
        params["conn"] = connection_id

    rows = db.execute(text(f"""
        SELECT event_timestamp, user_name, event_type,
               entity_type || ' · ' || COALESCE(entity_name, entity_id) as entity
        FROM audit_trail
        WHERE 1=1 {conn_filter}
        ORDER BY event_timestamp DESC
        LIMIT :limit
    """), params).fetchall()

    return [
        AuditEntry(
            time=str(r[0])[:16].replace("T", " ")[-5:] if r[0] else "—",
            user=r[1] or "System",
            action=r[2] or "—",
            entity=r[3] or "—",
        )
        for r in rows
    ]
