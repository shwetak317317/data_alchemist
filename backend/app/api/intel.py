"""Intel API — pre-run advisory and data trust receipt, served from PostgreSQL."""
import json
import logging
import time
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.orm import Session
from sqlalchemy import text

from app.core.metadata_db import get_db
from app.core.auth_deps import get_current_user, CurrentUser
from app.core.llm import chat_with_usage
from app.services.ai_usage_service import log_ai_usage
from app.prompts.intel import (
    build_advisory_prompt, ADVISORY_PROMPT_VERSION,
    build_receipt_prompt, RECEIPT_PROMPT_VERSION,
    build_daily_summary_prompt, DAILY_SUMMARY_PROMPT_VERSION,
)

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/intel", tags=["intel"])


class RiskReason(BaseModel):
    risk: str    # "high" | "med"
    text: str


class AdvisoryResponse(BaseModel):
    advisory_id: str
    predicted_score: float
    risk_reasons: list[RiskReason]
    recommendation: str
    advisory_time: str
    generated_at: Optional[str] = None   # ISO — lets the UI decide staleness
    generated_by: Optional[str] = None   # "ai" | "heuristic"


class FieldTrust(BaseModel):
    name: str
    status: str  # ok | warn | fail
    note: str


class ReceiptResponse(BaseModel):
    receipt_id: str
    query_text: str
    table_fqn: str
    executed_at: str
    executed_by: str
    row_count: int
    trust_score: float
    fields: list[FieldTrust]
    recommendation: str
    last_clean_snapshot: Optional[str] = None


@router.get("/advisory", response_model=AdvisoryResponse)
def get_advisory(connection_id: Optional[str] = None, db: Session = Depends(get_db),
                 current_user: CurrentUser = Depends(get_current_user)):
    """Return the latest pre-run advisory for a connection."""
    params: dict = {}
    conn_filter = "WHERE connection_id=:conn" if connection_id else ""
    if connection_id:
        params["conn"] = connection_id

    row = db.execute(text(f"""
        SELECT advisory_id, predicted_score, risk_reasons, recommendation, advisory_time,
               generated_at, pipeline_name
        FROM intel_advisories
        {conn_filter}
        ORDER BY generated_at DESC
        LIMIT 1
    """), params).fetchone()

    if not row:
        return AdvisoryResponse(
            advisory_id="none",
            predicted_score=0.0,
            risk_reasons=[],
            recommendation="No advisory available yet.",
            advisory_time="—",
        )

    reasons_raw = row[2] or []
    if isinstance(reasons_raw, str):
        reasons_raw = json.loads(reasons_raw)

    return AdvisoryResponse(
        advisory_id=row[0],
        predicted_score=float(row[1] or 0),
        risk_reasons=[RiskReason(risk=r.get("risk", "med"), text=r.get("text", "")) for r in reasons_raw],
        recommendation=row[3] or "—",
        advisory_time=row[4] or "—",
        generated_at=str(row[5]) if row[5] else None,
        generated_by=("ai" if row[6] == "main-ai" else "heuristic") if row[6] else None,
    )


# ── Advisory generation — derives risk from live metadata, no dead tables ──────

def _gather_advisory_signals(connection_id: str, db: Session) -> dict:
    """Every signal is MEASURED from live tables; nothing is guessed. The LLM is
    only allowed to phrase these — hallucinated numbers can't survive because
    the prompt contains the only numbers it may quote."""
    p = {"conn": connection_id}
    signals: dict = {}

    # Open anomalies
    sev_rows = db.execute(text(
        "SELECT severity, COUNT(*) FROM anomaly_log WHERE status='open' AND connection_id=:conn GROUP BY severity"
    ), p).fetchall()
    by_sev = {r[0]: int(r[1]) for r in sev_rows}
    top_tables = [r[0] for r in db.execute(text(
        "SELECT table_fqn FROM anomaly_log WHERE status='open' AND connection_id=:conn "
        "GROUP BY table_fqn ORDER BY COUNT(*) DESC LIMIT 3"
    ), p).fetchall() if r[0]]
    signals["open_anomalies"] = {"total": sum(by_sev.values()), "by_severity": by_sev, "top_tables": top_tables}

    # Latest run failures + repeat offenders
    latest_run = db.execute(text(
        "SELECT run_id FROM dq_run_results WHERE connection_id=:conn ORDER BY run_timestamp DESC LIMIT 1"
    ), p).scalar()
    failing = []
    if latest_run:
        rows = db.execute(text("""
            SELECT COALESCE(NULLIF(rr.rule_name,''), NULLIF(dr.rule_name,''), 'unnamed rule'),
                   rr.table_fqn, rr.fail_pct, rr.severity
            FROM dq_run_results rr LEFT JOIN dq_rules dr ON dr.rule_id = rr.rule_id
            WHERE rr.run_id=:run AND rr.status='FAIL'
            ORDER BY rr.fail_pct DESC LIMIT 5
        """), {"run": latest_run}).fetchall()
        failing = [{"rule": r[0], "table": r[1], "fail_pct": float(r[2] or 0), "severity": r[3] or "MEDIUM"} for r in rows]
    signals["failing_rules"] = failing

    rep_rows = db.execute(text("""
        SELECT COALESCE(NULLIF(rr.rule_name,''), NULLIF(dr.rule_name,''), rr.rule_id)
        FROM dq_run_results rr LEFT JOIN dq_rules dr ON dr.rule_id = rr.rule_id
        WHERE rr.connection_id=:conn AND rr.status='FAIL'
          AND rr.run_timestamp > NOW() - INTERVAL '7 days'
        GROUP BY 1 HAVING COUNT(DISTINCT rr.run_id) >= 2
    """), p).fetchall()
    signals["repeat_offenders"] = [r[0] for r in rep_rows if r[0]]

    # Volume trends: latest vs previous profiling of the same table
    vol_rows = db.execute(text("""
        SELECT table_fqn, row_count, rn FROM (
            SELECT table_fqn, row_count,
                   ROW_NUMBER() OVER (PARTITION BY table_fqn ORDER BY run_at DESC) AS rn
            FROM profiling_reports WHERE connection_id=:conn AND row_count IS NOT NULL
        ) t WHERE rn <= 2
    """), p).fetchall()
    cur, prev = {}, {}
    for r in vol_rows:
        (cur if r[2] == 1 else prev)[r[0]] = int(r[1])
    trends = []
    for tbl, c in cur.items():
        if tbl in prev and prev[tbl] > 0:
            delta = (c - prev[tbl]) / prev[tbl] * 100
            if abs(delta) >= 20:
                trends.append({"table": tbl, "cur": c, "prev": prev[tbl], "delta_pct": round(delta, 1)})
    trends.sort(key=lambda t: -abs(t["delta_pct"]))
    signals["volume_trends"] = trends[:5]

    # Ages
    def _age_h(ts):
        if ts is None:
            return "never"
        return round((datetime.utcnow() - ts).total_seconds() / 3600, 1)
    last_prof = db.execute(text("SELECT MAX(run_at) FROM profiling_reports WHERE connection_id=:conn"), p).scalar()
    last_exec = db.execute(text("SELECT MAX(run_timestamp) FROM dq_run_results WHERE connection_id=:conn"), p).scalar()
    signals["ages"] = {"profiling_h": _age_h(last_prof), "execution_h": _age_h(last_exec)}

    # Day-of-week anomaly pattern (last 90 days)
    dow_rows = db.execute(text("""
        SELECT EXTRACT(DOW FROM detected_at)::int, COUNT(*)
        FROM anomaly_log WHERE connection_id=:conn AND detected_at > NOW() - INTERVAL '90 days'
        GROUP BY 1
    """), p).fetchall()
    if dow_rows:
        counts = {int(r[0]): int(r[1]) for r in dow_rows}
        today_dow = datetime.utcnow().weekday()  # Mon=0
        pg_dow = (today_dow + 1) % 7             # postgres: Sun=0
        weeks = 13.0
        today_avg = round(counts.get(pg_dow, 0) / weeks, 1)
        overall_avg = round(sum(counts.values()) / 90.0, 1)
        names = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]
        signals["dow"] = {"today_name": names[today_dow], "today_avg": today_avg, "overall_avg": overall_avg}
    else:
        signals["dow"] = {}

    # Institutional memory
    fp_rows = db.execute(text("""
        SELECT incident_date, related_table, root_cause, resolution
        FROM anomaly_fingerprints WHERE connection_id=:conn
        ORDER BY created_at DESC LIMIT 3
    """), p).fetchall()
    signals["fingerprints"] = [
        {"date": str(r[0]) if r[0] else "unknown date", "table": r[1] or "unknown table",
         "cause": (r[2] or "")[:160], "resolution": (r[3] or "")[:160]}
        for r in fp_rows
    ]

    # Base score: latest execution run's average, falling back to profiling avg
    base = db.execute(text(
        "SELECT AVG(quality_score) FROM dq_run_results WHERE run_id=:run"
    ), {"run": latest_run}).scalar() if latest_run else None
    if base is None:
        base = db.execute(text("""
            SELECT AVG(quality_score) FROM (
                SELECT DISTINCT ON (table_fqn) quality_score FROM profiling_reports
                WHERE connection_id=:conn ORDER BY table_fqn, run_at DESC
            ) t
        """), p).scalar()
    base = float(base) if base is not None else 70.0

    penalty = 0.0
    penalty += min(15, by_sev.get("CRITICAL", 0) * 5)
    penalty += min(10, by_sev.get("HIGH", 0) * 2)
    penalty += min(9, len(signals["repeat_offenders"]) * 3)
    penalty += min(10, sum(1 for t in trends if abs(t["delta_pct"]) >= 40) * 5)
    if isinstance(signals["ages"]["profiling_h"], (int, float)) and signals["ages"]["profiling_h"] > 48:
        penalty += 5
    elif signals["ages"]["profiling_h"] == "never":
        penalty += 10
    signals["predicted_score"] = round(max(5.0, min(99.0, base - penalty)), 1)
    return signals


def _fallback_reasons(signals: dict) -> list[dict]:
    """Deterministic advisory when the LLM is unavailable — same signals, plainer prose."""
    reasons = []
    oa = signals.get("open_anomalies", {})
    if oa.get("total"):
        sev = oa.get("by_severity", {})
        lvl = "high" if sev.get("CRITICAL") else "med"
        reasons.append({"risk": lvl, "text": f"{oa['total']} anomalies are still open ({', '.join(f'{v} {k}' for k, v in sev.items())}) — most affected: {', '.join(oa.get('top_tables', [])[:2]) or 'n/a'}."})
    for f in signals.get("failing_rules", [])[:2]:
        reasons.append({"risk": "high" if f["severity"] in ("CRITICAL", "HIGH") else "med",
                        "text": f"{f['rule']} on {f['table']} is failing at {f['fail_pct']}% and will fail again today unless fixed."})
    for v in signals.get("volume_trends", [])[:2]:
        reasons.append({"risk": "high" if abs(v["delta_pct"]) >= 40 else "med",
                        "text": f"{v['table']} volume changed {v['delta_pct']:+.0f}% vs its previous profiling ({v['prev']:,} → {v['cur']:,} rows)."})
    ages = signals.get("ages", {})
    if ages.get("profiling_h") == "never" or (isinstance(ages.get("profiling_h"), (int, float)) and ages["profiling_h"] > 48):
        reasons.append({"risk": "med", "text": f"Profiling is stale (last run: {ages.get('profiling_h')}h ago) — scores may not reflect current data."})
    if not reasons:
        reasons.append({"risk": "med", "text": "No open anomalies, failing rules, or volume swings were measured — signals look healthy."})
    return reasons[:5]


@router.post("/advisory/generate", response_model=AdvisoryResponse)
def generate_advisory(connection_id: str, db: Session = Depends(get_db),
                      current_user: CurrentUser = Depends(get_current_user)):
    """Derive a fresh pre-run advisory from live metadata and persist it."""
    signals = _gather_advisory_signals(connection_id, db)

    reasons: list[dict] = []
    recommendation = ""
    generated_by = "heuristic"
    t0 = time.monotonic()
    try:
        raw, usage = chat_with_usage(build_advisory_prompt(signals), temperature=0.2, request_timeout=20, timeout=25)
        cleaned = raw.strip().removeprefix("```json").removeprefix("```").removesuffix("```").strip()
        parsed = json.loads(cleaned)
        cand = parsed.get("risk_reasons", [])
        reasons = [
            {"risk": r["risk"] if r.get("risk") in ("high", "med") else "med", "text": str(r["text"]).strip()}
            for r in cand if isinstance(r, dict) and str(r.get("text", "")).strip()
        ][:5]
        recommendation = str(parsed.get("recommendation", "")).strip()
        if len(reasons) >= 2 and recommendation:
            generated_by = "ai"
        else:
            raise ValueError("LLM advisory failed validation (needs >=2 reasons + recommendation)")
        log_ai_usage(db, feature="advisory", connection_id=connection_id, usage=usage,
                     latency_ms=int((time.monotonic() - t0) * 1000), status="ai")
    except Exception as exc:
        log_ai_usage(db, feature="advisory", connection_id=connection_id,
                     latency_ms=int((time.monotonic() - t0) * 1000), status="fallback")
        logger.warning(json.dumps({"event": "advisory.llm_fallback", "connection_id": connection_id,
                                   "prompt_version": ADVISORY_PROMPT_VERSION, "error": str(exc)[:300]}))
        reasons = _fallback_reasons(signals)
        oa = signals.get("open_anomalies", {})
        recommendation = (
            "Triage the open critical anomalies before running today's pipeline."
            if oa.get("by_severity", {}).get("CRITICAL")
            else "Review the flagged signals above; if they match expectations, proceed with today's run."
        )

    now = datetime.now(timezone.utc)
    advisory_time = now.strftime("%I:%M %p UTC").lstrip("0")
    row = db.execute(text("""
        INSERT INTO intel_advisories
            (connection_id, predicted_score, risk_reasons, recommendation, pipeline_name, advisory_time)
        VALUES (:conn, :score, CAST(:reasons AS JSONB), :rec, :pipe, :atime)
        RETURNING advisory_id, generated_at
    """), {
        "conn": connection_id, "score": signals["predicted_score"],
        "reasons": json.dumps(reasons), "rec": recommendation,
        "pipe": "main-ai" if generated_by == "ai" else "main-heuristic",
        "atime": advisory_time,
    }).fetchone()
    db.commit()
    logger.info(json.dumps({"event": "advisory.generated", "connection_id": connection_id,
                            "generated_by": generated_by, "predicted_score": signals["predicted_score"],
                            "reasons": len(reasons), "prompt_version": ADVISORY_PROMPT_VERSION}))

    return AdvisoryResponse(
        advisory_id=row[0], predicted_score=signals["predicted_score"],
        risk_reasons=[RiskReason(**r) for r in reasons],
        recommendation=recommendation, advisory_time=advisory_time,
        generated_at=str(row[1]), generated_by=generated_by,
    )


@router.get("/receipt", response_model=ReceiptResponse)
def get_receipt(connection_id: Optional[str] = None, table_fqn: Optional[str] = None,
                db: Session = Depends(get_db),
                current_user: CurrentUser = Depends(get_current_user)):
    """Return the latest trust receipt for a connection / table."""
    params: dict = {}
    conditions = []
    if connection_id:
        conditions.append("connection_id=:conn")
        params["conn"] = connection_id
    if table_fqn:
        conditions.append("table_fqn=:table")
        params["table"] = table_fqn

    where = ("WHERE " + " AND ".join(conditions)) if conditions else ""

    row = db.execute(text(f"""
        SELECT receipt_id, query_text, table_fqn, executed_at, executed_by,
               row_count, trust_score, fields, recommendation, last_clean_snapshot
        FROM intel_receipts
        {where}
        ORDER BY executed_at DESC
        LIMIT 1
    """), params).fetchone()

    if not row:
        return ReceiptResponse(
            receipt_id="none", query_text="—", table_fqn="—",
            executed_at="—", executed_by="—", row_count=0, trust_score=0.0,
            fields=[], recommendation="No receipt available yet.",
        )

    fields_raw = row[7] or []
    if isinstance(fields_raw, str):
        import json
        fields_raw = json.loads(fields_raw)

    executed_at_str = str(row[3])[:16].replace("T", " ") if row[3] else "—"
    last_clean = str(row[9]) if row[9] else None

    return ReceiptResponse(
        receipt_id=row[0],
        query_text=row[1] or "—",
        table_fqn=row[2] or "—",
        executed_at=executed_at_str,
        executed_by=row[4] or "—",
        row_count=int(row[5] or 0),
        trust_score=float(row[6] or 0),
        fields=[FieldTrust(name=f.get("name", ""), status=f.get("status", "ok"), note=f.get("note", "")) for f in fields_raw],
        recommendation=row[8] or "—",
        last_clean_snapshot=last_clean,
    )


# ── Daily narrative — one LLM paragraph per connection per day, cached ────────

def _gather_daily_facts(connection_id: str, db: Session) -> dict:
    p = {"conn": connection_id}
    facts: dict = {}

    hist = db.execute(text(
        "SELECT overall_score FROM trust_score_history WHERE connection_id=:conn ORDER BY score_date DESC LIMIT 2"
    ), p).fetchall()
    latest_run = db.execute(text(
        "SELECT run_id FROM dq_run_results WHERE connection_id=:conn ORDER BY run_timestamp DESC LIMIT 1"
    ), p).scalar()
    score = None
    if latest_run:
        score = db.execute(text("SELECT ROUND(AVG(quality_score),0) FROM dq_run_results WHERE run_id=:r"), {"r": latest_run}).scalar()
    facts["score"] = float(score) if score is not None else (float(hist[0][0]) if hist else None)
    facts["delta"] = (float(hist[0][0]) - float(hist[1][0])) if len(hist) > 1 else None

    facts["runs_today"] = int(db.execute(text(
        "SELECT COUNT(DISTINCT run_id) FROM dq_run_results WHERE connection_id=:conn AND run_timestamp::date = CURRENT_DATE"
    ), p).scalar() or 0)
    fr = db.execute(text("""
        SELECT DISTINCT COALESCE(NULLIF(rr.rule_name,''), NULLIF(dr.rule_name,''), 'unnamed rule')
        FROM dq_run_results rr LEFT JOIN dq_rules dr ON dr.rule_id = rr.rule_id
        WHERE rr.connection_id=:conn AND rr.run_timestamp::date = CURRENT_DATE AND rr.status='FAIL'
        LIMIT 5
    """), p).fetchall()
    facts["failing_rules"] = [r[0] for r in fr]

    an_rows = db.execute(text(
        "SELECT severity, COUNT(*) FROM anomaly_log WHERE connection_id=:conn AND detected_at::date = CURRENT_DATE GROUP BY severity"
    ), p).fetchall()
    by_sev = {r[0]: int(r[1]) for r in an_rows}
    facts["anomalies_today"] = {"total": sum(by_sev.values()), "by_severity": by_sev}

    dec_rows = db.execute(text("""
        SELECT event_type, COUNT(*) FROM audit_trail
        WHERE connection_id=:conn AND event_timestamp::date = CURRENT_DATE
        GROUP BY event_type ORDER BY COUNT(*) DESC LIMIT 6
    """), p).fetchall()
    facts["decisions_today"] = [f"{int(r[1])} {r[0].lower()}" for r in dec_rows]

    try:
        facts["simulations_today"] = int(db.execute(text(
            "SELECT COUNT(*) FROM simulation_runs WHERE connection_id=:conn AND started_at::date = CURRENT_DATE"
        ), p).scalar() or 0)
    except Exception:
        facts["simulations_today"] = 0

    facts["open_anomalies"] = int(db.execute(text(
        "SELECT COUNT(*) FROM anomaly_log WHERE connection_id=:conn AND status='open'"
    ), p).scalar() or 0)
    facts["open_critical"] = int(db.execute(text("""
        SELECT COUNT(*) FROM dq_run_results
        WHERE run_id=(SELECT run_id FROM dq_run_results WHERE connection_id=:conn ORDER BY run_timestamp DESC LIMIT 1)
          AND status='FAIL' AND severity='CRITICAL'
    """), p).scalar() or 0) if latest_run else 0
    return facts


@router.get("/daily-narrative")
def get_daily_narrative(connection_id: str, regenerate: bool = False,
                        db: Session = Depends(get_db),
                        current_user: CurrentUser = Depends(get_current_user)):
    """Today's LLM-composed one-paragraph summary — generated once per
    connection per day and cached; regenerate=true forces a fresh one."""
    if not regenerate:
        row = db.execute(text("""
            SELECT narrative, watch_items, generated_by, generated_at
            FROM daily_summaries
            WHERE connection_id=:conn AND summary_date=CURRENT_DATE
        """), {"conn": connection_id}).fetchone()
        if row:
            wi = row[1] or []
            if isinstance(wi, str):
                wi = json.loads(wi)
            return {"narrative": row[0], "watch_items": wi,
                    "generated_by": row[2], "generated_at": str(row[3]), "cached": True}

    facts = _gather_daily_facts(connection_id, db)
    narrative, watch_items, generated_by = "", [], "heuristic"
    t0 = time.monotonic()
    try:
        raw, usage = chat_with_usage(build_daily_summary_prompt(facts), temperature=0.3, request_timeout=20, timeout=25)
        cleaned = raw.strip().removeprefix("```json").removeprefix("```").removesuffix("```").strip()
        parsed = json.loads(cleaned)
        narrative = str(parsed.get("narrative", "")).strip()
        watch_items = [str(w).strip() for w in parsed.get("watch_items", []) if str(w).strip()][:3]
        if len(narrative) > 40:
            generated_by = "ai"
        else:
            raise ValueError("daily summary narrative too short")
        log_ai_usage(db, feature="daily_summary", connection_id=connection_id, usage=usage,
                     latency_ms=int((time.monotonic() - t0) * 1000), status="ai")
    except Exception as exc:
        log_ai_usage(db, feature="daily_summary", connection_id=connection_id,
                     latency_ms=int((time.monotonic() - t0) * 1000), status="fallback")
        logger.warning(json.dumps({"event": "daily_summary.llm_fallback", "connection_id": connection_id,
                                   "prompt_version": DAILY_SUMMARY_PROMPT_VERSION, "error": str(exc)[:300]}))
        an = facts.get("anomalies_today", {})
        narrative = (
            f"Today saw {facts.get('runs_today', 0)} rule execution(s) and {an.get('total', 0)} new anomalies. "
            f"{facts.get('open_anomalies', 0)} anomalies and {facts.get('open_critical', 0)} critical rule failure(s) remain open."
        )
        watch_items = [f"Triage the {facts['open_critical']} open critical rule failure(s) first thing."] if facts.get("open_critical") else []

    db.execute(text("""
        INSERT INTO daily_summaries (connection_id, summary_date, narrative, watch_items, generated_by)
        VALUES (:conn, CURRENT_DATE, :narr, CAST(:wi AS JSONB), :by)
        ON CONFLICT (connection_id, summary_date)
        DO UPDATE SET narrative=:narr, watch_items=CAST(:wi AS JSONB), generated_by=:by, generated_at=NOW()
    """), {"conn": connection_id, "narr": narrative, "wi": json.dumps(watch_items), "by": generated_by})
    db.commit()
    logger.info(json.dumps({"event": "daily_summary.generated", "connection_id": connection_id,
                            "generated_by": generated_by, "prompt_version": DAILY_SUMMARY_PROMPT_VERSION}))
    return {"narrative": narrative, "watch_items": watch_items,
            "generated_by": generated_by, "generated_at": None, "cached": False}


@router.get("/tables")
def list_receipt_tables(connection_id: str, db: Session = Depends(get_db),
                        current_user: CurrentUser = Depends(get_current_user)):
    """Tables a receipt can be generated for — anything this connection has profiled."""
    rows = db.execute(text("""
        SELECT DISTINCT ON (table_fqn) table_fqn, layer, quality_score, run_at
        FROM profiling_reports WHERE connection_id=:conn
        ORDER BY table_fqn, run_at DESC
    """), {"conn": connection_id}).fetchall()
    return [{"table_fqn": r[0], "layer": r[1], "quality_score": float(r[2] or 0)} for r in rows]


def _gather_receipt_signals(connection_id: str, table_fqn: str, db: Session) -> dict:
    """Field-level trust signals for one table — every number measured, none guessed."""
    p = {"conn": connection_id, "tbl": table_fqn}

    prof = db.execute(text("""
        SELECT row_count, quality_score, column_stats, run_at
        FROM profiling_reports
        WHERE connection_id=:conn AND table_fqn=:tbl
        ORDER BY run_at DESC LIMIT 1
    """), p).fetchone()
    if not prof:
        return {}
    row_count = int(prof[0] or 0)
    base_score = float(prof[1] or 0)
    col_stats = prof[2] or []
    if isinstance(col_stats, str):
        col_stats = json.loads(col_stats)
    as_of = str(prof[3])[:16].replace("T", " ")

    # Latest rule results for this table (most recent run that touched it)
    rule_rows = db.execute(text("""
        SELECT COALESCE(NULLIF(rr.rule_name,''), NULLIF(dr.rule_name,''), 'rule'),
               COALESCE(dr.column_name, ''), rr.status, rr.fail_pct, rr.severity
        FROM dq_run_results rr
        LEFT JOIN dq_rules dr ON dr.rule_id = rr.rule_id
        WHERE rr.connection_id=:conn AND rr.table_fqn=:tbl
          AND rr.run_id = (SELECT run_id FROM dq_run_results
                           WHERE connection_id=:conn AND table_fqn=:tbl
                           ORDER BY run_timestamp DESC LIMIT 1)
    """), p).fetchall()

    anom_rows = db.execute(text("""
        SELECT anomaly_type, COALESCE(column_name,''), severity, description
        FROM anomaly_log
        WHERE connection_id=:conn AND table_fqn=:tbl AND status='open'
        ORDER BY CASE severity WHEN 'CRITICAL' THEN 0 WHEN 'HIGH' THEN 1 ELSE 2 END
        LIMIT 6
    """), p).fetchall()

    # Upstream feed health from the lineage graph
    upstream_issues = []
    try:
        up_rows = db.execute(text("""
            SELECT n.external_id, n.health_status
            FROM lineage_edges e
            JOIN lineage_nodes n   ON n.node_id = e.source_node_id
            JOIN lineage_nodes tgt ON tgt.node_id = e.target_node_id
            WHERE tgt.external_id = :tbl AND n.connection_id = :conn
        """), p).fetchall()
        upstream_issues = [f"{r[0]} is currently {r[1]}" for r in up_rows if (r[1] or "ok") not in ("ok", "OK", "HEALTHY")]
    except Exception:
        pass

    # Assemble per-column signals: failed rules + high nulls + column anomalies
    field_map: dict = {}
    def _touch(col, status, signal):
        col = col or "Entire table"
        cur = field_map.get(col)
        rank = {"fail": 2, "warn": 1, "ok": 0}
        if cur is None:
            field_map[col] = {"name": col, "status": status, "signals": [signal]}
        else:
            if rank[status] > rank[cur["status"]]:
                cur["status"] = status
            cur["signals"].append(signal)

    for r in rule_rows:
        rule, col, status, fail_pct, sev = r[0], r[1], r[2], float(r[3] or 0), r[4] or "MEDIUM"
        if status == "FAIL":
            _touch(col, "fail" if sev in ("CRITICAL", "HIGH") else "warn",
                   f"rule {rule} failing at {fail_pct}% (severity {sev})")
        elif status == "ERROR":
            _touch(col, "warn", f"rule {rule} could not execute (source error)")

    for a in anom_rows:
        _touch(a[1], "fail" if a[2] == "CRITICAL" else "warn",
               f"open {a[2]} {a[0]} anomaly: {(a[3] or '')[:120]}")

    for cs in col_stats:
        name = cs.get("name")
        null_pct = float(cs.get("null_pct") or 0)
        if name and null_pct >= 10 and name not in field_map:
            _touch(name, "warn", f"{null_pct}% null in the latest profiling")

    flagged = list(field_map.values())
    flagged.sort(key=lambda f: {"fail": 0, "warn": 1, "ok": 2}[f["status"]])
    flagged = flagged[:6]

    # A couple of demonstrably-clean columns so the receipt shows contrast
    clean = [cs.get("name") for cs in col_stats
             if cs.get("name") and float(cs.get("null_pct") or 0) < 1 and cs.get("name") not in field_map][:2]
    fields = [{"name": f["name"], "status": f["status"], "signal": "; ".join(f["signals"][:3])} for f in flagged]
    fields += [{"name": c, "status": "ok", "signal": "passing all checks, <1% null"} for c in clean]

    # Trust score: profiling base minus live incident penalties. Then a
    # coherence guard: the headline number may never contradict the field
    # verdicts below it — a green 95 above a failing CDE rule and an 18-day
    # staleness warning destroys the receipt's credibility (seen live).
    crit_anoms = sum(1 for a in anom_rows if a[2] == "CRITICAL")
    high_anoms = sum(1 for a in anom_rows if a[2] == "HIGH")
    fails = sum(1 for r in rule_rows if r[2] == "FAIL")
    score = base_score - crit_anoms * 8 - high_anoms * 5 - fails * 4 - len(upstream_issues) * 4
    statuses = {f["status"] for f in fields}
    if "fail" in statuses:
        score = min(score, 65.0)
    elif "warn" in statuses:
        score = min(score, 82.0)
    score = max(5.0, min(99.0, score))

    # Last fully-trusted snapshot: most recent profiling with a healthy score
    last_clean = db.execute(text("""
        SELECT MAX(run_at)::date FROM profiling_reports
        WHERE connection_id=:conn AND table_fqn=:tbl AND quality_score >= 85
    """), p).scalar()

    return {
        "row_count": row_count, "as_of": as_of, "score": round(score, 1),
        "fields": fields, "upstream_issues": upstream_issues,
        "last_clean": str(last_clean) if last_clean else None,
    }


class ReceiptGenerateRequest(BaseModel):
    connection_id: str
    table_fqn: str


@router.post("/receipt/generate", response_model=ReceiptResponse)
def generate_receipt(req: ReceiptGenerateRequest, db: Session = Depends(get_db),
                     current_user: CurrentUser = Depends(get_current_user)):
    """Derive a fresh trust receipt for a table from live rule results, profiling,
    anomalies, and upstream lineage health — then persist it."""
    signals = _gather_receipt_signals(req.connection_id, req.table_fqn, db)
    if not signals:
        from fastapi import HTTPException
        raise HTTPException(404, f"{req.table_fqn} has never been profiled on this connection — profile it first, then generate a receipt.")

    fields_out: list[dict] = []
    recommendation = ""
    t0 = time.monotonic()
    try:
        raw, usage = chat_with_usage(build_receipt_prompt(req.table_fqn, signals["score"], signals["fields"],
                                        signals["upstream_issues"], signals["as_of"]),
                   temperature=0.2, request_timeout=20, timeout=25)
        cleaned = raw.strip().removeprefix("```json").removeprefix("```").removesuffix("```").strip()
        parsed = json.loads(cleaned)
        by_name = {f["name"]: f for f in signals["fields"]}
        for f in parsed.get("fields", []):
            if isinstance(f, dict) and f.get("name") in by_name and str(f.get("note", "")).strip():
                fields_out.append({"name": f["name"], "status": by_name[f["name"]]["status"], "note": str(f["note"]).strip()})
        recommendation = str(parsed.get("recommendation", "")).strip()
        if not fields_out or not recommendation:
            raise ValueError("receipt LLM output failed validation")
        log_ai_usage(db, feature="receipt", connection_id=req.connection_id, usage=usage,
                     latency_ms=int((time.monotonic() - t0) * 1000), status="ai")
    except Exception as exc:
        log_ai_usage(db, feature="receipt", connection_id=req.connection_id,
                     latency_ms=int((time.monotonic() - t0) * 1000), status="fallback")
        logger.warning(json.dumps({"event": "receipt.llm_fallback", "table": req.table_fqn,
                                   "prompt_version": RECEIPT_PROMPT_VERSION, "error": str(exc)[:300]}))
        fields_out = [{"name": f["name"], "status": f["status"], "note": f["signal"]} for f in signals["fields"]]
        bad = [f for f in fields_out if f["status"] != "ok"]
        recommendation = (
            f"Verify the {len(bad)} flagged column{'s' if len(bad) != 1 else ''} before publishing numbers from this table."
            if bad else f"All measured signals are healthy as of {signals['as_of']} — safe to use."
        )

    query_text = f"SELECT * FROM {req.table_fqn}"
    row = db.execute(text("""
        INSERT INTO intel_receipts
            (connection_id, query_text, table_fqn, executed_by, row_count,
             trust_score, fields, recommendation, last_clean_snapshot)
        VALUES (:conn, :q, :tbl, :by, :rows, :score, CAST(:fields AS JSONB), :rec, CAST(:clean AS DATE))
        RETURNING receipt_id, executed_at
    """), {
        "conn": req.connection_id, "q": query_text, "tbl": req.table_fqn,
        "by": current_user.email, "rows": signals["row_count"], "score": signals["score"],
        "fields": json.dumps(fields_out), "rec": recommendation, "clean": signals["last_clean"],
    }).fetchone()
    db.commit()
    logger.info(json.dumps({"event": "receipt.generated", "table": req.table_fqn,
                            "score": signals["score"], "fields": len(fields_out),
                            "prompt_version": RECEIPT_PROMPT_VERSION}))

    return ReceiptResponse(
        receipt_id=row[0], query_text=query_text, table_fqn=req.table_fqn,
        executed_at=str(row[1])[:16].replace("T", " "), executed_by=current_user.email,
        row_count=signals["row_count"], trust_score=signals["score"],
        fields=[FieldTrust(**f) for f in fields_out],
        recommendation=recommendation, last_clean_snapshot=signals["last_clean"],
    )
