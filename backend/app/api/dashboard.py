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
    date: str = ""          # ISO date (YYYY-MM-DD) — lets consumers scope to "today"
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

    # Per-layer open failures + rules executed (latest run)
    layer_fail_counts: dict = {}
    layer_rule_counts: dict = {}
    if latest_run_id:
        lf_rows = db.execute(text("""
            SELECT layer, COUNT(*) FROM dq_run_results
            WHERE run_id=:run_id AND status='FAIL'
            GROUP BY layer
        """), {"run_id": latest_run_id}).fetchall()
        layer_fail_counts = {r[0]: int(r[1]) for r in lf_rows if r[0]}
        lr_rows = db.execute(text("""
            SELECT layer, COUNT(*) FROM dq_run_results
            WHERE run_id=:run_id
            GROUP BY layer
        """), {"run_id": latest_run_id}).fetchall()
        layer_rule_counts = {r[0]: int(r[1]) for r in lr_rows if r[0]}

    # Per-layer trend: latest profiling score per table vs the previous profiling
    # of the SAME table, averaged per layer. None when a layer has no repeat
    # profilings to compare — the UI shows "—" honestly in that case.
    layer_trend_deltas: dict = {}
    trend_rows = db.execute(text(f"""
        SELECT layer, table_fqn, quality_score,
               ROW_NUMBER() OVER (PARTITION BY table_fqn ORDER BY run_at DESC) AS rn
        FROM profiling_reports {conn_where}
    """), params).fetchall()
    _cur: dict = {}
    _prev: dict = {}
    for r in trend_rows:
        if r[3] == 1:
            _cur[r[1]] = (r[0] or "UNKNOWN", float(r[2] or 0))
        elif r[3] == 2:
            _prev[r[1]] = float(r[2] or 0)
    _deltas_by_layer: dict = {}
    for tbl, (layer, cur_score) in _cur.items():
        if tbl in _prev:
            _deltas_by_layer.setdefault(layer, []).append(cur_score - _prev[tbl])
    layer_trend_deltas = {
        layer: round(sum(ds) / len(ds), 1) for layer, ds in _deltas_by_layer.items()
    }

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
            rule_count=layer_rule_counts.get(layer, 0),
            trend_delta=layer_trend_deltas.get(layer),
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


_SEV_RANK = {"CRITICAL": 0, "HIGH": 1, "MEDIUM": 2, "LOW": 3}


@router.get("/attention")
def get_attention(connection_id: str | None = None, db: Session = Depends(get_db),
                  current_user: CurrentUser = Depends(get_current_user)):
    """The 7:45am queue: everything that needs a human, ranked — open critical/high
    anomalies, failing rules from the latest run, overdue tasks, and stale layers —
    plus a since-yesterday delta strip and per-layer freshness."""
    conn_filter = "AND connection_id=:conn" if connection_id else ""
    conn_where = "WHERE connection_id=:conn" if connection_id else ""
    params: dict = {"conn": connection_id} if connection_id else {}

    items: list[dict] = []

    # ── Open anomalies (CRITICAL/HIGH float to the top; cap to keep it a queue) ──
    anom_rows = db.execute(text(f"""
        SELECT anomaly_id, description, table_fqn, severity, anomaly_type, detected_at, layer
        FROM anomaly_log
        WHERE status='open' {conn_filter}
        ORDER BY CASE severity WHEN 'CRITICAL' THEN 0 WHEN 'HIGH' THEN 1 WHEN 'MEDIUM' THEN 2 ELSE 3 END,
                 detected_at DESC
        LIMIT 10
    """), params).fetchall()
    for r in anom_rows:
        items.append({
            "kind": "anomaly", "entity_id": r[0],
            "severity": r[3] or "MEDIUM",
            "title": (r[1] or "Anomaly").replace("[SIM] ", ""),
            "detail": f"{r[4] or 'anomaly'} · {r[2] or 'unknown table'}",
            "table_fqn": r[2], "layer": r[6],
            "ts": str(r[5]) if r[5] else None,
            "action": "anomalies",
        })

    # ── Failing rules from the latest run ────────────────────────────────────
    latest_run_id = db.execute(text(f"""
        SELECT run_id FROM dq_run_results {conn_where}
        ORDER BY run_timestamp DESC LIMIT 1
    """), params).scalar()
    if latest_run_id:
        fail_rows = db.execute(text("""
            SELECT COALESCE(NULLIF(rr.rule_name, ''), NULLIF(dr.rule_name, ''), 'unnamed rule') AS rule_name,
                   rr.table_fqn, rr.severity, rr.fail_pct, rr.failed_records, rr.run_timestamp
            FROM dq_run_results rr
            LEFT JOIN dq_rules dr ON dr.rule_id = rr.rule_id
            WHERE rr.run_id=:run_id AND rr.status='FAIL'
              AND COALESCE(rr.is_expected_failure, FALSE) = FALSE
            ORDER BY CASE rr.severity WHEN 'CRITICAL' THEN 0 WHEN 'HIGH' THEN 1 WHEN 'MEDIUM' THEN 2 ELSE 3 END,
                     rr.fail_pct DESC
            LIMIT 8
        """), {"run_id": latest_run_id}).fetchall()
        for r in fail_rows:
            items.append({
                "kind": "rule", "entity_id": r[0],
                "severity": r[2] or "MEDIUM",
                "title": f"Rule failing: {r[0]}",
                "detail": f"{r[1]} · {int(r[4] or 0):,} rows ({float(r[3] or 0)}%) failing in the latest run",
                "table_fqn": r[1], "layer": None,
                "ts": str(r[5]) if r[5] else None,
                "action": "execution",
            })

    # ── Overdue open tasks ────────────────────────────────────────────────────
    task_rows = db.execute(text(f"""
        SELECT task_id, title, priority, owner, due_date
        FROM task_board
        WHERE status IN ('open','in_progress') AND due_date IS NOT NULL AND due_date < CURRENT_DATE
        {conn_filter}
        ORDER BY due_date ASC LIMIT 5
    """), params).fetchall()
    for r in task_rows:
        days_over = db.execute(text("SELECT (CURRENT_DATE - CAST(:d AS DATE))"), {"d": str(r[4])}).scalar()
        items.append({
            "kind": "task", "entity_id": r[0],
            "severity": r[2] or "MEDIUM",
            "title": f"Overdue task: {r[1]}",
            "detail": f"due {r[4]} ({int(days_over)} day{'s' if int(days_over) != 1 else ''} ago) · owner {r[3] or 'unassigned'}",
            "table_fqn": None, "layer": None, "ts": None,
            "action": "tasks",
        })

    items.sort(key=lambda i: (_SEV_RANK.get(i["severity"], 9), i["ts"] is None, str(i.get("ts") or "")))

    # ── Since-yesterday strip ─────────────────────────────────────────────────
    new_anoms = int(db.execute(text(f"""
        SELECT COUNT(*) FROM anomaly_log
        WHERE detected_at > NOW() - INTERVAL '24 hours' {conn_filter}
    """), params).scalar() or 0)
    hist = db.execute(text(f"""
        SELECT overall_score, score_date FROM trust_score_history {conn_where}
        ORDER BY score_date DESC LIMIT 2
    """), params).fetchall()
    trust_now = float(hist[0][0]) if hist else None
    trust_prev = float(hist[1][0]) if len(hist) > 1 else None
    trust_date = str(hist[0][1]) if hist else None  # lets the UI suppress stale history

    # Newly failing rules: FAIL in the latest run but not in the previous run.
    newly_failing: list[str] = []
    if latest_run_id:
        prev_run_id = db.execute(text(f"""
            SELECT run_id FROM (
                SELECT DISTINCT run_id, MAX(run_timestamp) AS ts FROM dq_run_results {conn_where}
                GROUP BY run_id ORDER BY ts DESC LIMIT 2
            ) t ORDER BY ts ASC LIMIT 1
        """), params).scalar()
        if prev_run_id and prev_run_id != latest_run_id:
            nf_rows = db.execute(text("""
                SELECT DISTINCT cur.rule_name FROM dq_run_results cur
                WHERE cur.run_id=:cur AND cur.status='FAIL'
                  AND NOT EXISTS (
                      SELECT 1 FROM dq_run_results prev
                      WHERE prev.run_id=:prev AND prev.rule_name=cur.rule_name AND prev.status='FAIL'
                  )
            """), {"cur": latest_run_id, "prev": prev_run_id}).fetchall()
            newly_failing = [r[0] for r in nf_rows if r[0]]

    # ── Per-layer freshness (last profiling or execution touch) ───────────────
    fresh_rows = db.execute(text(f"""
        SELECT layer, MAX(run_at) FROM profiling_reports {conn_where} GROUP BY layer
    """), params).fetchall()
    exec_rows = db.execute(text(f"""
        SELECT layer, MAX(run_timestamp) FROM dq_run_results {conn_where} GROUP BY layer
    """), params).fetchall()
    last_touch: dict = {}
    for r in list(fresh_rows) + list(exec_rows):
        if r[0] and r[1] and (r[0] not in last_touch or r[1] > last_touch[r[0]]):
            last_touch[r[0]] = r[1]
    freshness = []
    from datetime import datetime as _dtt
    for layer in _LAYER_ORDER:
        ts = last_touch.get(layer)
        if ts is None:
            freshness.append({"layer": layer, "last_checked": None, "age_hours": None, "state": "never"})
        else:
            age_h = round((_dtt.utcnow() - ts).total_seconds() / 3600, 1)
            state = "fresh" if age_h <= 24 else ("aging" if age_h <= 72 else "stale")
            freshness.append({"layer": layer, "last_checked": str(ts), "age_hours": age_h, "state": state})

    return {
        "items": items[:10],
        "since": {
            "window_hours": 24,
            "new_anomalies": new_anoms,
            "newly_failing_rules": newly_failing[:5],
            "trust_now": trust_now,
            "trust_prev": trust_prev,
            "trust_date": trust_date,
        },
        "freshness": freshness,
    }


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
            SELECT cs->>'name' AS column_name, AVG((cs->>'null_pct')::float) as null_avg
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
            date=str(r[0])[:10] if r[0] else "",
            user=r[1] or "System",
            action=r[2] or "—",
            entity=r[3] or "—",
        )
        for r in rows
    ]


# ── AI Usage & Cost — governance transparency panel ─────────────────────────
# Every AI call in this app is already logged at its call site (rule_ai_calls
# for RECOMMEND/NL_CONVERT/ANOMALY_EXPLAIN/REMEDIATION; ai_usage_log for
# sim_classify/sim_narrative/lineage_narrative/advisory/receipt/daily_summary).
# This endpoint is the union of both — one number, not scattered log lines.

# Approximate list-price $/1K tokens (input, output). Local/open-weight models
# served via the Ollama proxy cost $0 in this deployment. Unknown models fall
# back to a conservative mid-tier estimate rather than silently reporting $0,
# which would understate spend for anyone who swaps in an unlisted provider.
_MODEL_PRICE_PER_1K = {
    "claude-sonnet-4-6": (0.003, 0.015), "claude-opus": (0.015, 0.075),
    "claude-haiku": (0.0008, 0.004),
    "gpt-4o": (0.0025, 0.01), "gpt-4o-mini": (0.00015, 0.0006),
    "gemini-1.5-pro": (0.00125, 0.005), "gemini-2.0-flash": (0.0001, 0.0004),
    "gemini": (0.0001, 0.0004),
    "azure/gpt-4o": (0.0025, 0.01),
}
_LOCAL_MODEL_PREFIXES = ("openai/", "ollama/")   # LiteLLM-proxied local models — free to run


def _estimate_cost(model: str | None, input_tokens: int, output_tokens: int) -> float | None:
    if not model:
        return None
    if model.startswith(_LOCAL_MODEL_PREFIXES):
        return 0.0
    for key, (in_price, out_price) in _MODEL_PRICE_PER_1K.items():
        if key in model:
            return round(input_tokens / 1000 * in_price + output_tokens / 1000 * out_price, 4)
    # Unknown cloud model — conservative mid-tier estimate so cost is never
    # silently reported as zero for a real paid call.
    return round(input_tokens / 1000 * 0.003 + output_tokens / 1000 * 0.012, 4)


@router.get("/ai-usage")
def get_ai_usage(connection_id: str | None = None, days: int = 30, db: Session = Depends(get_db),
                 current_user: CurrentUser = Depends(get_current_user)):
    """Aggregate AI cost, token spend, latency, and AI-vs-fallback rate across
    every LLM call site in the app — the evidence trail for 'does the AI usage
    justify the value', not a claim without a number behind it."""
    conn_filter_a = "AND connection_id=:conn" if connection_id else ""
    conn_filter_b = "AND connection_id=:conn" if connection_id else ""
    params: dict = {"days": days}
    if connection_id:
        params["conn"] = connection_id

    rule_rows = db.execute(text(f"""
        SELECT call_type AS feature, model, status,
               COUNT(*), COALESCE(SUM(input_tokens),0), COALESCE(SUM(output_tokens),0),
               COALESCE(AVG(latency_ms),0)
        FROM rule_ai_calls
        WHERE created_at > NOW() - (CAST(:days AS INTEGER) * INTERVAL '1 day') {conn_filter_a}
        GROUP BY call_type, model, status
    """), params).fetchall()

    usage_rows = db.execute(text(f"""
        SELECT feature, model, status,
               COUNT(*), COALESCE(SUM(input_tokens),0), COALESCE(SUM(output_tokens),0),
               COALESCE(AVG(latency_ms),0)
        FROM ai_usage_log
        WHERE created_at > NOW() - (CAST(:days AS INTEGER) * INTERVAL '1 day') {conn_filter_b}
        GROUP BY feature, model, status
    """), params).fetchall()

    by_feature: dict = {}
    total_calls = total_in = total_out = 0
    total_latency_weighted = 0.0
    ai_calls = fallback_calls = error_calls = 0
    total_cost = 0.0
    cost_known = True

    for feature, model, status, cnt, in_tok, out_tok, avg_lat in list(rule_rows) + list(usage_rows):
        cnt, in_tok, out_tok, avg_lat = int(cnt), int(in_tok), int(out_tok), float(avg_lat)
        entry = by_feature.setdefault(feature, {
            "feature": feature, "calls": 0, "input_tokens": 0, "output_tokens": 0,
            "latency_weighted": 0.0, "ai": 0, "fallback": 0, "error": 0, "cost": 0.0,
        })
        entry["calls"] += cnt
        entry["input_tokens"] += in_tok
        entry["output_tokens"] += out_tok
        entry["latency_weighted"] += avg_lat * cnt
        # rule_ai_calls uses status success|error; ai_usage_log uses ai|fallback|error
        norm_status = "ai" if status == "success" else status
        entry[norm_status if norm_status in ("ai", "fallback", "error") else "ai"] += cnt

        cost = _estimate_cost(model, in_tok, out_tok)
        if cost is None:
            cost_known = False
        else:
            entry["cost"] += cost
            total_cost += cost

        total_calls += cnt
        total_in += in_tok
        total_out += out_tok
        total_latency_weighted += avg_lat * cnt
        if norm_status == "fallback":
            fallback_calls += cnt
        elif norm_status == "error":
            error_calls += cnt
        else:
            ai_calls += cnt

    feature_list = []
    for f in by_feature.values():
        feature_list.append({
            "feature": f["feature"], "calls": f["calls"],
            "input_tokens": f["input_tokens"], "output_tokens": f["output_tokens"],
            "avg_latency_ms": round(f["latency_weighted"] / f["calls"], 0) if f["calls"] else 0,
            "ai_calls": f["ai"], "fallback_calls": f["fallback"], "error_calls": f["error"],
            "estimated_cost_usd": round(f["cost"], 4),
        })
    feature_list.sort(key=lambda f: -f["calls"])

    return {
        "window_days": days,
        "total_calls": total_calls,
        "total_input_tokens": total_in,
        "total_output_tokens": total_out,
        "avg_latency_ms": round(total_latency_weighted / total_calls, 0) if total_calls else 0,
        "ai_success_rate": round(ai_calls / total_calls * 100, 1) if total_calls else None,
        "fallback_rate": round(fallback_calls / total_calls * 100, 1) if total_calls else None,
        "error_rate": round(error_calls / total_calls * 100, 1) if total_calls else None,
        "estimated_cost_usd": round(total_cost, 2),
        "cost_fully_known": cost_known,
        "by_feature": feature_list,
    }
