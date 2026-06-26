"""Execution API — run DQ rules for a connection and retrieve results."""
import json
import logging
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import text

from app.core.metadata_db import get_db
from app.core.auth_deps import get_current_user, CurrentUser
from app.api.connections import get_active_connector
from app.agents.execution_agent import run_all_rules
from app.models.execution import ExecutionRunResponse, AcknowledgeFailureRequest
from app.services.audit_service import log_event
from app.api.lineage import propagate_lineage_health_sync

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/execution", tags=["execution"])


@router.post("/run", response_model=ExecutionRunResponse)
def run_execution(connection_id: str, db: Session = Depends(get_db),
                  current_user: CurrentUser = Depends(get_current_user)):
    """Run all approved/active rules for a connection."""
    connector = get_active_connector(connection_id, db)

    # Fetch all active rules for this connection
    rows = db.execute(text(
        "SELECT rule_id, rule_name, table_fqn, layer, rule_expression, severity, is_cde_rule "
        "FROM dq_rules WHERE connection_id=:conn AND status IN ('approved','active') "
        "ORDER BY layer, severity"
    ), {"conn": connection_id}).fetchall()

    if not rows:
        raise HTTPException(400, "No active rules found. Approve at least one rule first.")

    rules = [
        {"rule_id": r[0], "rule_name": r[1], "table_fqn": r[2],
         "layer": r[3], "rule_expression": r[4], "severity": r[5], "is_cde_rule": r[6]}
        for r in rows
    ]

    run_response = run_all_rules(connector, connection_id, rules)
    connector.close()

    # Persist results
    for result in run_response.results:
        db.execute(text("""
            INSERT INTO dq_run_results
                (result_id, run_id, run_timestamp, connection_id, rule_id, table_fqn,
                 layer, status, total_records, failed_records, fail_pct, quality_score,
                 severity, sample_failed_records, remediation_suggestion)
            VALUES
                (:result_id, :run_id, :run_ts, :conn, :rule_id, :table_fqn,
                 :layer, :status, :total, :failed, :fail_pct, :score,
                 :severity, CAST(:sample AS jsonb), :remediation)
        """), {
            "result_id": result.result_id,
            "run_id": run_response.run_id,
            "run_ts": run_response.run_timestamp,
            "conn": connection_id,
            "rule_id": result.rule_id,
            "table_fqn": result.table_fqn,
            "layer": result.layer,
            "status": result.status,
            "total": result.total_records,
            "failed": result.failed_records,
            "fail_pct": result.fail_pct,
            "score": result.quality_score,
            "severity": result.severity,
            "sample": json.dumps(result.sample_failed_records),
            "remediation": result.remediation_suggestion,
        })
    db.commit()

    # Propagate health status to lineage nodes (non-blocking — failures are logged, not raised)
    try:
        updated = propagate_lineage_health_sync(db, connection_id, run_response.run_id)
        if updated > 0:
            db.commit()
            logger.info("Lineage health updated for %d nodes after execution run %s", updated, run_response.run_id)
    except Exception as exc:
        logger.warning("Lineage health propagation skipped: %s", exc)

    return run_response


@router.get("/latest")
def get_latest_run(connection_id: str, db: Session = Depends(get_db),
                   current_user: CurrentUser = Depends(get_current_user)):
    """Return the run_id of the most recent execution run for a connection."""
    row = db.execute(text(
        "SELECT run_id FROM dq_run_results WHERE connection_id=:conn "
        "ORDER BY run_timestamp DESC LIMIT 1"
    ), {"conn": connection_id}).fetchone()
    if not row:
        raise HTTPException(404, "No runs found for this connection")
    return {"run_id": row[0]}


@router.get("/results/{run_id}", response_model=ExecutionRunResponse)
def get_run_results(run_id: str, db: Session = Depends(get_db),
                    current_user: CurrentUser = Depends(get_current_user)):
    rows = db.execute(text(
        "SELECT r.result_id, r.run_id, r.run_timestamp, r.connection_id, r.rule_id, "
        "r.table_fqn, r.layer, r.status, r.total_records, r.failed_records, r.fail_pct, "
        "r.quality_score, r.severity, r.sample_failed_records, r.remediation_suggestion, "
        "r.is_expected_failure, r.acknowledged_by, dr.rule_name, dr.is_cde_rule "
        "FROM dq_run_results r LEFT JOIN dq_rules dr ON r.rule_id=dr.rule_id "
        "WHERE r.run_id=:run_id"
    ), {"run_id": run_id}).fetchall()

    if not rows:
        raise HTTPException(404, "Run not found")

    results = []
    for row in rows:
        results.append({
            "result_id": row[0], "run_id": row[1], "rule_id": row[4],
            "rule_name": row[17] or "", "table_fqn": row[5], "layer": row[6],
            "status": row[7], "total_records": row[8] or 0,
            "failed_records": row[9] or 0, "fail_pct": float(row[10] or 0),
            "quality_score": float(row[11] or 0), "severity": row[12],
            "sample_failed_records": row[13] or [],
            "remediation_suggestion": row[14],
            "is_expected_failure": row[15] or False,
            "acknowledged_by": row[16],
            "is_cde_rule": row[18] or False,
        })

    from app.models.execution import RuleResult
    rule_results = [RuleResult(**r) for r in results]
    passed = sum(1 for r in rule_results if r.status == "PASS")
    failed = sum(1 for r in rule_results if r.status == "FAIL")
    errors = sum(1 for r in rule_results if r.status == "ERROR")

    return ExecutionRunResponse(
        run_id=run_id,
        connection_id=rows[0][3],
        run_timestamp=rows[0][2],
        total_rules=len(rule_results),
        passed=passed, failed=failed, errors=errors,
        overall_quality_score=sum(r.quality_score for r in rule_results) / max(len(rule_results), 1),
        results=rule_results,
    )


@router.post("/acknowledge")
def acknowledge_failure(req: AcknowledgeFailureRequest, db: Session = Depends(get_db),
                        current_user: CurrentUser = Depends(get_current_user)):
    db.execute(text(
        "UPDATE dq_run_results SET acknowledged_by=:by, acknowledged_at=NOW(), "
        "is_expected_failure=:expected, expected_failure_reason=:reason "
        "WHERE result_id=:id"
    ), {"by": current_user.email, "expected": req.is_expected,
        "reason": req.reason, "id": req.rule_result_id})
    db.commit()
    log_event(db, user_email=current_user.email, event_type="ACK",
              entity_type="RULE_RESULT", entity_id=req.rule_result_id,
              new_value={"is_expected": req.is_expected, "reason": req.reason})
    db.commit()
    return {"status": "acknowledged"}
