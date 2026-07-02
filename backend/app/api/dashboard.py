"""Dashboard API — trust scores, layer health, trend lines, CDE status, audit trail."""
import logging
from typing import Optional
from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.orm import Session
from sqlalchemy import text

from app.core.metadata_db import get_db
from app.core.auth_deps import get_current_user, CurrentUser
from app.models.dashboard import TrustSummary, LayerHealth, TrendPoint, CDEStatus
from app.agents.execution_agent import SEVERITY_WEIGHT


class AuditEntry(BaseModel):
    time: str
    user: str
    action: str
    entity: str

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/dashboard", tags=["dashboard"])

_LAYER_ORDER = ["RAW", "BRONZE", "SILVER", "GOLD"]


_ANOMALY_TYPE_LABELS = {
    "VOLUME":       ("Volume drop",       "danger"),
    "VOLUME_DROP":  ("Volume drop",       "danger"),
    "DISTRIBUTION": ("Segment / drift",   "warning"),
    "SEGMENT":      ("Segment / drift",   "warning"),
    "SOURCE":       ("Source late",       "warning"),
    "SOURCE_LATE":  ("Source late",       "warning"),
    "THRESHOLD":    ("Threshold breach",  "warning"),
    "FRESHNESS":    ("Freshness gap",     "warning"),
    "DUPLICATE":    ("Duplicate surge",   "danger"),
}


@router.get("/summary", response_model=TrustSummary)
def get_summary(connection_id: str | None = None, db: Session = Depends(get_db),
                current_user: CurrentUser = Depends(get_current_user)):
    """Return the overall trust summary for the home screen."""
    conn_filter = "AND connection_id=:conn" if connection_id else ""
    conn_where  = "WHERE connection_id=:conn" if connection_id else ""
    params: dict = {}
    if connection_id:
        params["conn"] = connection_id

    # ── Latest profiling report per table (DISTINCT ON) ───────────────────────
    latest_rows = db.execute(text(f"""
        SELECT DISTINCT ON (table_fqn) layer, quality_score, run_at
        FROM profiling_reports {conn_where}
        ORDER BY table_fqn, run_at DESC
    """), params).fetchall()

    layer_score_lists: dict = {}
    for r in latest_rows:
        layer = r[0] or "UNKNOWN"
        layer_score_lists.setdefault(layer, []).append(float(r[1] or 0))

    layer_averages: dict = {
        layer: sum(scores) / len(scores)
        for layer, scores in layer_score_lists.items()
    }
    profiled_table_count = len(latest_rows)

    # Latest profiling run_at
    last_profiling = db.execute(text(f"""
        SELECT MAX(run_at) FROM profiling_reports {conn_where}
    """), params).scalar()

    # ── Open issues from dq_run_results (latest run only) ────────────────────
    latest_run_id = db.execute(text(f"""
        SELECT run_id FROM dq_run_results {conn_where}
        ORDER BY run_timestamp DESC LIMIT 1
    """), params).scalar()

    issues_by_sev: dict = {}
    last_execution_ts = None
    execution_runs = 0
    execution_error_count = 0
    execution_quality_score = None
    if latest_run_id:
        run_params = {**params, "run_id": latest_run_id}
        issue_rows = db.execute(text("""
            SELECT severity, COUNT(*) FROM dq_run_results
            WHERE run_id=:run_id AND status='FAIL'
            GROUP BY severity
        """), run_params).fetchall()
        issues_by_sev = {r[0]: int(r[1]) for r in issue_rows}
        last_execution_ts = db.execute(text("""
            SELECT MAX(run_timestamp) FROM dq_run_results WHERE run_id=:run_id
        """), run_params).scalar()

        # Latest run's own health — same weighted-score definition used by the
        # DQ Execution screen, so this dashboard never reports "Healthy" for a
        # connection whose most recent run couldn't even reach the source.
        run_rows = db.execute(text("""
            SELECT quality_score, severity, status FROM dq_run_results WHERE run_id=:run_id
        """), {"run_id": latest_run_id}).fetchall()
        execution_error_count = sum(1 for r in run_rows if r[2] == "ERROR")
        if run_rows:
            total_weight = sum(SEVERITY_WEIGHT.get(r[1], 1) for r in run_rows) or 1
            weighted_sum = sum(float(r[0] or 0) * SEVERITY_WEIGHT.get(r[1], 1) for r in run_rows)
            execution_quality_score = round(weighted_sum / total_weight, 1)

    execution_runs = int(db.execute(text(f"""
        SELECT COUNT(DISTINCT run_id) FROM dq_run_results {conn_where}
    """), params).scalar() or 0)

    # Per-layer open failures (latest run)
    layer_fail_counts: dict = {}
    if latest_run_id:
        lf_rows = db.execute(text("""
            SELECT layer, COUNT(*) FROM dq_run_results
            WHERE run_id=:run_id AND status='FAIL'
            GROUP BY layer
        """), {"run_id": latest_run_id}).fetchall()
        layer_fail_counts = {r[0]: int(r[1]) for r in lf_rows if r[0]}

    # ── Active anomalies ──────────────────────────────────────────────────────
    anomaly_count = int(db.execute(text(f"""
        SELECT COUNT(*) FROM anomaly_log
        WHERE status='open' {conn_filter}
    """), params).scalar() or 0)

    # Anomaly breakdown by type
    anomaly_type_rows = db.execute(text(f"""
        SELECT anomaly_type, COUNT(*) FROM anomaly_log
        WHERE status='open' {conn_filter}
        GROUP BY anomaly_type ORDER BY COUNT(*) DESC
    """), params).fetchall()
    anomaly_breakdown = [
        {
            "type": r[0],
            "label": _ANOMALY_TYPE_LABELS.get(r[0], (r[0].replace("_", " ").title(), "warning"))[0],
            "intent": _ANOMALY_TYPE_LABELS.get(r[0], ("", "warning"))[1],
            "count": int(r[1]),
        }
        for r in anomaly_type_rows
    ]

    # Per-layer anomaly counts
    layer_anomaly_rows = db.execute(text(f"""
        SELECT layer, COUNT(*) FROM anomaly_log
        WHERE status='open' {conn_filter} AND layer IS NOT NULL
        GROUP BY layer
    """), params).fetchall()
    layer_anomaly_counts = {r[0]: int(r[1]) for r in layer_anomaly_rows}

    # ── CDE health ────────────────────────────────────────────────────────────
    cde_healthy = int(db.execute(text(f"""
        SELECT COUNT(*) FROM cde_registry
        WHERE health IN ('PASS','HEALTHY') {conn_filter}
    """), params).scalar() or 0)
    cde_total = int(db.execute(text(f"""
        SELECT COUNT(*) FROM cde_registry {conn_where}
    """), params).scalar() or 0)
    cde_health_pct = round((cde_healthy / cde_total) * 100, 1) if cde_total else 100.0

    # ── Score delta vs yesterday ──────────────────────────────────────────────
    history_rows = db.execute(text(f"""
        SELECT overall_score FROM trust_score_history {conn_where}
        ORDER BY score_date DESC LIMIT 2
    """), params).fetchall()
    delta = 0.0
    yesterday_score = None
    if len(history_rows) >= 2:
        yesterday_score = round(float(history_rows[1][0]), 1)
        delta = round(float(history_rows[0][0]) - yesterday_score, 1)
    elif len(history_rows) == 1:
        yesterday_score = round(float(history_rows[0][0]), 1)

    # ── Recent activity from audit_trail ─────────────────────────────────────
    activity_rows = db.execute(text(f"""
        SELECT event_timestamp, user_name, event_type,
               entity_type || ' · ' || COALESCE(entity_name, entity_id) as entity
        FROM audit_trail WHERE 1=1 {conn_filter}
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

    # ── Workflow states ───────────────────────────────────────────────────────
    dict_count = int(db.execute(text(f"""
        SELECT COUNT(*) FROM data_dictionary
        WHERE business_name IS NOT NULL AND business_name != ''
        {conn_filter}
    """), params).scalar() or 0)

    rules_any = int(db.execute(text(f"""
        SELECT COUNT(*) FROM dq_rules {conn_where}
    """), params).scalar() or 0)
    rules_approved = int(db.execute(text(f"""
        SELECT COUNT(*) FROM dq_rules
        WHERE status IN ('active','approved') {conn_filter}
    """), params).scalar() or 0)

    anomalies_explained = int(db.execute(text(f"""
        SELECT COUNT(*) FROM anomaly_log
        WHERE business_explanation IS NOT NULL AND business_explanation != ''
        {conn_filter}
    """), params).scalar() or 0)

    profiling_state  = "done"    if profiled_table_count > 0 else "active"
    metadata_state   = "done"    if dict_count > 0 else ("active" if profiled_table_count > 0 else "pending")
    rules_state      = "done"    if rules_approved > 0 else ("active" if rules_any > 0 else "pending")
    execution_state  = "done"    if (execution_runs > 0 and not issues_by_sev) else ("active" if execution_runs > 0 else "pending")
    anomaly_state    = "done"    if anomalies_explained > 0 else ("active" if execution_runs > 0 else "pending")
    trust_state      = "active"  if execution_runs > 0 else "pending"

    workflow_states = {
        "profiling":  profiling_state,
        "metadata":   metadata_state,
        "rules":      rules_state,
        "execution":  execution_state,
        "anomalies":  anomaly_state,
        "dashboard":  trust_state,
    }

    # ── Layer health objects ──────────────────────────────────────────────────
    layers = []
    for layer in _LAYER_ORDER:
        score = layer_averages.get(layer, 0)
        status = "HEALTHY" if score >= 85 else ("WARN" if score >= 65 else "ISSUES")
        layers.append(LayerHealth(
            layer=layer, score=round(score, 1), status=status,
            open_issues=layer_fail_counts.get(layer, 0),
            critical_count=0, high_count=0,
        ))

    # Prefer the latest execution run's own health over historical profiling
    # stats — profiling scores go stale the moment the source becomes
    # unreachable, which previously let this dashboard report "Healthy" while
    # every rule in the latest run errored out.
    overall = execution_quality_score if execution_quality_score is not None else (
        round(sum(layer_averages.values()) / max(len(layer_averages), 1), 1) if layer_averages else 0
    )

    pipeline_status = "ISSUES" if (issues_by_sev.get("CRITICAL", 0) > 0 or execution_error_count > 0) else (
        "RECOVERING" if issues_by_sev.get("HIGH", 0) > 0 else "HEALTHY"
    )

    # Most recent activity across profiling + execution
    import datetime as _dt
    last_run_at = None
    candidates = [ts for ts in [last_profiling, last_execution_ts] if ts is not None]
    if candidates:
        last_run_at = max(candidates)

    return TrustSummary(
        overall_score=overall, score_delta=delta, yesterday_score=yesterday_score,
        pipeline_status=pipeline_status, layers=layers,
        open_critical=issues_by_sev.get("CRITICAL", 0),
        open_high=issues_by_sev.get("HIGH", 0),
        open_medium=issues_by_sev.get("MEDIUM", 0),
        open_errors=execution_error_count,
        active_anomalies=anomaly_count,
        cde_health_pct=cde_health_pct,
        last_run_at=last_run_at,
        recent_activity=recent_activity,
        anomaly_breakdown=anomaly_breakdown,
        workflow_states=workflow_states,
        profiled_table_count=profiled_table_count,
        layer_anomaly_counts=layer_anomaly_counts,
    )


@router.get("/trends", response_model=list[TrendPoint])
def get_trends(connection_id: str | None = None, days: int = 14, db: Session = Depends(get_db),
               current_user: CurrentUser = Depends(get_current_user)):
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
def get_rule_fail_trend(connection_id: str | None = None, days: int = 7, db: Session = Depends(get_db),
                        current_user: CurrentUser = Depends(get_current_user)):
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
def get_cde_status(connection_id: str | None = None, db: Session = Depends(get_db),
                   current_user: CurrentUser = Depends(get_current_user)):
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
def get_audit_trail(connection_id: Optional[str] = None, limit: int = 20, db: Session = Depends(get_db),
                    current_user: CurrentUser = Depends(get_current_user)):
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
