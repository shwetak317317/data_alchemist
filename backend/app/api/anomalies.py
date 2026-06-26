"""Anomaly API — scan, inbox, acknowledge, explain."""
import uuid
import logging
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import text

from app.core.metadata_db import get_db
from app.core.auth_deps import get_current_user, CurrentUser
from app.models.anomaly import (AnomalyRecord, AnomalyAcknowledgeRequest,
    AnomalyExplanationResponse, AnomalyScanRequest,
    AnomalyThresholdsRequest, AnomalyThresholdsResponse, AnomalyShareRequest)
from app.agents.explainability_agent import explain_anomaly
from app.services.audit_service import log_event

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/anomalies", tags=["anomalies"])

# In-memory threshold store (keyed by connection_id).
# Values survive until the backend process restarts — enough for per-session persistence.
_thresholds: dict = {}


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
    filters, params = ["al.status='open'"], {}
    if connection_id:
        filters.append("al.connection_id=:conn")
        params["conn"] = connection_id
    where = "WHERE " + " AND ".join(filters)
    rows = db.execute(text(
        f"SELECT al.anomaly_id, al.connection_id, al.detected_at, al.layer, al.table_fqn, al.column_name, "
        f"al.anomaly_type, al.description, al.severity, al.metric_value, al.baseline_value, al.deviation_pct, "
        f"al.business_explanation, al.status, "
        f"(SELECT array_agg(rc ORDER BY run_at) FROM "
        f"  (SELECT row_count::FLOAT AS rc, run_at FROM profiling_reports "
        f"   WHERE connection_id = al.connection_id AND table_fqn = al.table_fqn "
        f"   ORDER BY run_at DESC LIMIT 7) sub) AS history_values, "
        f"EXISTS(SELECT 1 FROM anomaly_fingerprints af "
        f"       WHERE af.connection_id = al.connection_id AND af.related_table = al.table_fqn) AS has_fingerprint "
        f"FROM anomaly_log al {where} ORDER BY al.detected_at DESC"
    ), params).fetchall()

    result = []
    for r in rows:
        a = _row_to_anomaly(r)
        if len(r) > 14 and r[14] is not None:
            hv = r[14]
            a.history_values = hv if isinstance(hv, list) else None
        if len(r) > 15:
            a.has_fingerprint = bool(r[15])
        result.append(a)
    return result


@router.post("/scan")
def scan_anomalies(req: AnomalyScanRequest, db: Session = Depends(get_db),
                   current_user: CurrentUser = Depends(get_current_user)):
    """
    Trigger an anomaly scan for a connection.
    Checks three anomaly types per table:
      • VOLUME      — row count deviation > 2σ from rolling baseline
      • DISTRIBUTION — null rate on key columns spikes > 2σ above baseline
      • THRESHOLD   — numeric metric (mean value) shifts > 2σ from baseline
    """
    from app.api.connections import get_active_connector
    from app.services.anomaly_service import (
        detect_volume_anomaly,
        detect_null_rate_anomaly,
        detect_metric_threshold_anomaly,
    )
    from collections import defaultdict

    connector = get_active_connector(req.connection_id, db)
    detected_ids = []

    tables_to_scan = req.tables or _get_active_tables(req.connection_id, db)
    for table_fqn in tables_to_scan:
        layer = table_fqn.split(".")[0].upper() if "." in table_fqn else "UNKNOWN"

        # ── VOLUME: compare row_count across the last 8 profiling runs ────────
        vol_rows = db.execute(text(
            "SELECT row_count FROM profiling_reports "
            "WHERE connection_id=:conn AND table_fqn=:table "
            "ORDER BY run_at DESC LIMIT 8"
        ), {"conn": req.connection_id, "table": table_fqn}).fetchall()

        if len(vol_rows) >= 2:
            counts = [r[0] for r in vol_rows]
            anomaly = detect_volume_anomaly(
                connector=connector,
                connection_id=req.connection_id,
                table_fqn=table_fqn,
                layer=layer,
                baseline_counts=counts[1:],
                current_count=counts[0],
            )
            if anomaly:
                _save_anomaly(db, anomaly)
                detected_ids.append(anomaly.anomaly_id)

        # ── DISTRIBUTION + THRESHOLD: per-column stats across last 8 runs ─────
        col_history = db.execute(text("""
            SELECT cs.column_name, cs.null_pct, cs.mean_value, pr.run_at
            FROM column_stats cs
            JOIN profiling_reports pr ON pr.report_id = cs.report_id
            WHERE cs.connection_id = :conn AND cs.table_fqn = :table
            ORDER BY pr.run_at DESC
            LIMIT 64
        """), {"conn": req.connection_id, "table": table_fqn}).fetchall()

        if col_history:
            col_null: dict[str, list[float]] = defaultdict(list)
            col_mean: dict[str, list[float]] = defaultdict(list)
            for col, null_pct, mean_val, _ in col_history:
                col_null[col].append(float(null_pct or 0))
                if mean_val is not None:
                    col_mean[col].append(float(mean_val))

            for col, null_hist in col_null.items():
                if len(null_hist) < 3:
                    continue
                anomaly = detect_null_rate_anomaly(
                    connector=connector,
                    connection_id=req.connection_id,
                    table_fqn=table_fqn,
                    layer=layer,
                    column_name=col,
                    current_null_pct=null_hist[0],
                    baseline_null_pcts=null_hist[1:],
                )
                if anomaly:
                    _save_anomaly(db, anomaly)
                    detected_ids.append(anomaly.anomaly_id)

            for col, mean_hist in col_mean.items():
                if len(mean_hist) < 3:
                    continue
                anomaly = detect_metric_threshold_anomaly(
                    connector=connector,
                    connection_id=req.connection_id,
                    table_fqn=table_fqn,
                    layer=layer,
                    column_name=col,
                    current_value=mean_hist[0],
                    baseline_values=mean_hist[1:],
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


@router.post("/test-seed")
def test_seed(connection_id: str, db: Session = Depends(get_db),
              current_user: CurrentUser = Depends(get_current_user)):
    """
    DEV/TEST ONLY — insert one synthetic anomaly per type so Playwright tests
    can exercise the explain / acknowledge / escalate / fingerprint flows
    without needing a statistical baseline from profiling history.
    Returns the list of created anomaly_ids.
    """
    from datetime import datetime, timezone
    import uuid as _uuid

    seeds = [
        {"type": "VOLUME",       "layer": "BRONZE", "sev": "CRITICAL",
         "desc": "[TEST] Row count dropped to 1,234 vs baseline 4,300 (71% drop)",
         "metric": 1234.0, "baseline": 4300.0, "dev_pct": -71.3},
        {"type": "DISTRIBUTION", "layer": "SILVER", "sev": "HIGH",
         "desc": "[TEST] email null rate is 38.2% vs baseline 2.1% (1700% above average)",
         "metric": 38.2, "baseline": 2.1,  "dev_pct": 1719.0},
        {"type": "THRESHOLD",    "layer": "GOLD",   "sev": "HIGH",
         "desc": "[TEST] net_revenue is 45% below the 7-day average (current: 1.2M, avg: 2.2M)",
         "metric": 1200000.0, "baseline": 2200000.0, "dev_pct": -45.5},
    ]

    # Get a real table_fqn for this connection if available
    table_row = db.execute(text(
        "SELECT DISTINCT table_fqn FROM profiling_reports WHERE connection_id=:conn LIMIT 1"
    ), {"conn": connection_id}).fetchone()
    table_fqn = table_row[0] if table_row else "test_schema.test_table"

    created_ids = []
    for s in seeds:
        aid = str(_uuid.uuid4())
        db.execute(text("""
            INSERT INTO anomaly_log
                (anomaly_id, connection_id, detected_at, layer, table_fqn,
                 anomaly_type, description, severity, metric_value, baseline_value,
                 deviation_pct, status, created_at)
            VALUES
                (:id, :conn, :now, :layer, :table,
                 :type, :desc, :sev, :metric, :baseline,
                 :dev_pct, 'open', NOW())
            ON CONFLICT (anomaly_id) DO NOTHING
        """), {
            "id": aid, "conn": connection_id, "now": datetime.now(timezone.utc),
            "layer": s["layer"], "table": table_fqn,
            "type": s["type"], "desc": s["desc"], "sev": s["sev"],
            "metric": s["metric"], "baseline": s["baseline"], "dev_pct": s["dev_pct"],
        })
        created_ids.append(aid)

    # Seed one fingerprint row so the "Fingerprint match" tab can be tested.
    fp_id = str(_uuid.uuid4())
    db.execute(text("""
        INSERT INTO anomaly_fingerprints
            (fingerprint_id, connection_id, similarity_pct, incident_date, incident_day,
             root_cause, resolution, resolution_time, resolved_by, related_table, created_at)
        VALUES
            (:fp_id, :conn, 94, '2024-11-05', 'Tuesday',
             '[TEST] OMS extract arrived 85 min late; Silver net_revenue step failed',
             'Re-ran Bronze + Silver pipelines after OMS backfill completed',
             '2h 14min', 'deepa.nair@pal.tech', :table, NOW())
        ON CONFLICT (fingerprint_id) DO NOTHING
    """), {"fp_id": fp_id, "conn": connection_id, "table": table_fqn})

    db.commit()
    return {"seeded": len(created_ids), "anomaly_ids": created_ids,
            "table_fqn": table_fqn, "fingerprint_seeded": True, "fingerprint_id": fp_id}


@router.delete("/test-cleanup")
def test_cleanup(connection_id: str, db: Session = Depends(get_db),
                 current_user: CurrentUser = Depends(get_current_user)):
    """DEV/TEST ONLY — delete all [TEST] anomalies and fingerprints for a connection."""
    anomaly_result = db.execute(text(
        "DELETE FROM anomaly_log WHERE connection_id=:conn AND description LIKE '[TEST]%'"
    ), {"conn": connection_id})
    fp_result = db.execute(text(
        "DELETE FROM anomaly_fingerprints WHERE connection_id=:conn AND root_cause LIKE '[TEST]%'"
    ), {"conn": connection_id})
    db.commit()
    return {"deleted": anomaly_result.rowcount, "fingerprints_deleted": fp_result.rowcount}


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


# ── Thresholds (GET / POST) ────────────────────────────────────────────────────

@router.get("/thresholds", response_model=AnomalyThresholdsResponse)
def get_thresholds(connection_id: str, db: Session = Depends(get_db),
                   current_user: CurrentUser = Depends(get_current_user)):
    """Return saved detection thresholds for a connection (defaults if none saved)."""
    saved = _thresholds.get(connection_id, {})
    return AnomalyThresholdsResponse(
        connection_id=connection_id,
        vol_pct=saved.get("vol_pct", 30.0),
        dist_pct=saved.get("dist_pct", 20.0),
        freshness_hours=saved.get("freshness_hours", 24.0),
    )


@router.post("/thresholds", response_model=AnomalyThresholdsResponse)
def save_thresholds(req: AnomalyThresholdsRequest, db: Session = Depends(get_db),
                    current_user: CurrentUser = Depends(get_current_user)):
    """Persist detection thresholds for a connection (in-memory for this session)."""
    _thresholds[req.connection_id] = {
        "vol_pct": req.vol_pct,
        "dist_pct": req.dist_pct,
        "freshness_hours": req.freshness_hours,
    }
    log_event(db, user_email=current_user.email, event_type="THRESHOLD_CHANGE",
              entity_type="CONNECTION", entity_id=req.connection_id,
              new_value=_thresholds[req.connection_id], connection_id=req.connection_id)
    db.commit()
    return AnomalyThresholdsResponse(connection_id=req.connection_id, **_thresholds[req.connection_id])


# ── Share anomaly explanation ──────────────────────────────────────────────────

@router.post("/{anomaly_id}/share")
def share_anomaly(anomaly_id: str, req: AnomalyShareRequest,
                  db: Session = Depends(get_db),
                  current_user: CurrentUser = Depends(get_current_user)):
    """Log a SHARE event to the audit trail (actual Slack delivery handled externally)."""
    row = db.execute(text("SELECT connection_id FROM anomaly_log WHERE anomaly_id=:id"),
                     {"id": anomaly_id}).fetchone()
    if not row:
        raise HTTPException(404, "Anomaly not found")
    log_event(db, user_email=current_user.email, event_type="SHARE",
              entity_type="ANOMALY", entity_id=anomaly_id,
              new_value={"channel": req.channel, "message": req.message},
              connection_id=row[0])
    db.commit()
    return {"shared": True, "channel": req.channel, "anomaly_id": anomaly_id}


# ── Test helpers: profiling seed / cleanup ─────────────────────────────────────

@router.post("/test-seed-profiling")
def test_seed_profiling(connection_id: str, db: Session = Depends(get_db),
                        current_user: CurrentUser = Depends(get_current_user)):
    """
    DEV/TEST ONLY — insert 5 baseline + 1 current profiling_reports row with
    a dramatic volume drop so the scan algorithm (2σ rule) fires reliably.
    Baseline: ~4 300 rows/run. Current run: 450 rows (≈ -3 900σ deviation).
    """
    from datetime import timedelta
    import uuid as _uuid2

    # Use a unique test-only table name so no existing profiling data
    # from real runs pollutes the baseline (which would suppress 2σ detection).
    table_fqn = f"test_scan_schema.vol_drop_{connection_id[:8]}"

    now = datetime.now(timezone.utc)
    baselines = [4300, 4250, 4380, 4200, 4320]
    seeded_ids = []

    for i, count in enumerate(baselines):
        rid = str(_uuid2.uuid4())
        db.execute(text("""
            INSERT INTO profiling_reports
                (report_id, connection_id, table_fqn, layer, run_at, row_count, quality_score)
            VALUES (:id, :conn, :table, 'BRONZE', :run_at, :count, 95.0)
        """), {"id": rid, "conn": connection_id, "table": table_fqn,
               "run_at": now - timedelta(days=i + 1), "count": count})
        seeded_ids.append(rid)

    # Current run — massive drop
    rid_current = str(_uuid2.uuid4())
    db.execute(text("""
        INSERT INTO profiling_reports
            (report_id, connection_id, table_fqn, layer, run_at, row_count, quality_score)
        VALUES (:id, :conn, :table, 'BRONZE', :run_at, :count, 40.0)
    """), {"id": rid_current, "conn": connection_id, "table": table_fqn,
           "run_at": now, "count": 450})
    seeded_ids.append(rid_current)
    db.commit()

    return {"seeded": len(seeded_ids), "report_ids": seeded_ids,
            "table_fqn": table_fqn, "baseline_avg": 4290, "current_count": 450}


@router.delete("/test-cleanup-profiling")
def test_cleanup_profiling(connection_id: str, report_ids: str,
                           db: Session = Depends(get_db),
                           current_user: CurrentUser = Depends(get_current_user)):
    """DEV/TEST ONLY — delete seeded profiling reports and any scan-created anomalies."""
    ids = [i.strip() for i in report_ids.split(",") if i.strip()]
    deleted_reports = 0
    for rid in ids:
        r = db.execute(text(
            "DELETE FROM profiling_reports WHERE report_id=:id AND connection_id=:conn"
        ), {"id": rid, "conn": connection_id})
        deleted_reports += r.rowcount
    # Remove VOLUME anomalies the scan may have created from this seed data
    r2 = db.execute(text(
        "DELETE FROM anomaly_log WHERE connection_id=:conn "
        "AND anomaly_type='VOLUME' AND description LIKE '%450%'"
    ), {"conn": connection_id})
    db.commit()
    return {"deleted_reports": deleted_reports, "deleted_anomalies": r2.rowcount}
