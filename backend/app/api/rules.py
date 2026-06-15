"""Rules API — recommend, NL convert, CRUD with human approve/edit/reject."""
import json
import uuid
import logging
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import text

from app.core.metadata_db import get_db
from app.api.connections import get_active_connector
from app.agents.rule_agent import recommend_rules, nl_to_rule
from app.models.rule import DQRule, RuleDecisionRequest, NLConvertRequest, NLConvertResponse, RuleRecommendRequest
from app.models.profiling import ProfilingReport
from app.services.audit_service import log_event

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/rules", tags=["rules"])


def _row_to_rule(row) -> DQRule:
    return DQRule(
        rule_id=row[0], connection_id=row[1], rule_name=row[2],
        rule_description=row[3], table_fqn=row[4], layer=row[5],
        column_name=row[6], rule_expression=row[7], rule_type=row[8],
        severity=row[9], is_cde_rule=row[10], status=row[11],
        approved_by=row[12], approved_at=row[13], snooze_until=row[14],
        created_by=row[15], nl_source=row[16],
    )


@router.get("", response_model=list[DQRule])
def list_rules(connection_id: str | None = None, status: str | None = None,
               db: Session = Depends(get_db)):
    filters = []
    params: dict = {}
    if connection_id:
        filters.append("connection_id = :conn")
        params["conn"] = connection_id
    if status:
        filters.append("status = :status")
        params["status"] = status
    where = "WHERE " + " AND ".join(filters) if filters else ""
    rows = db.execute(text(
        f"SELECT rule_id, connection_id, rule_name, rule_description, table_fqn, "
        f"layer, column_name, rule_expression, rule_type, severity, is_cde_rule, status, "
        f"approved_by, approved_at, snooze_until, created_by, nl_source "
        f"FROM dq_rules {where} ORDER BY created_at DESC"
    ), params).fetchall()
    return [_row_to_rule(r) for r in rows]


@router.post("/recommend", response_model=list[DQRule])
def recommend(req: RuleRecommendRequest, db: Session = Depends(get_db)):
    """Generate rule recommendations based on a profiling report."""
    row = db.execute(text(
        "SELECT report_id, connection_id, table_fqn, layer, run_at, row_count, "
        "quality_score, completeness_score, uniqueness_score, consistency_score, "
        "freshness_score, risks_flagged, column_stats, summary_text "
        "FROM profiling_reports WHERE report_id=:id"
    ), {"id": req.report_id}).fetchone()
    if not row:
        raise HTTPException(404, "Profiling report not found")

    report = ProfilingReport(
        report_id=row[0], connection_id=row[1], table_fqn=row[2],
        layer=row[3] or "UNKNOWN", run_at=row[4],
        row_count=row[5] or 0, quality_score=row[6] or 0,
        completeness_score=row[7] or 0, uniqueness_score=row[8] or 0,
        consistency_score=row[9] or 0, freshness_score=row[10] or 100,
        risks=row[11] or [], columns=row[12] or [], summary_text=row[13],
    )

    # Get CDE columns for this connection
    cde_rows = db.execute(text(
        "SELECT column_name FROM data_dictionary WHERE connection_id=:conn AND is_cde=TRUE"
    ), {"conn": req.connection_id}).fetchall()
    cde_cols = [r[0] for r in cde_rows]

    rules = recommend_rules(report, req.connection_id, cde_cols)

    # Persist as draft rules
    saved = []
    for rule in rules:
        rid = str(uuid.uuid4())
        db.execute(text("""
            INSERT INTO dq_rules
                (rule_id, connection_id, rule_name, rule_description, table_fqn,
                 layer, column_name, rule_expression, rule_type, severity,
                 is_cde_rule, status, created_by, created_at, updated_at)
            VALUES
                (:rule_id, :conn, :name, :desc, :table_fqn,
                 :layer, :col, :expr, :type, :sev,
                 :cde, 'draft', 'AI_AGENT', NOW(), NOW())
        """), {
            "rule_id": rid, "conn": rule.connection_id, "name": rule.rule_name,
            "desc": rule.rule_description, "table_fqn": rule.table_fqn,
            "layer": rule.layer, "col": rule.column_name, "expr": rule.rule_expression,
            "type": rule.rule_type, "sev": rule.severity, "cde": rule.is_cde_rule,
        })
        rule.rule_id = rid
        saved.append(rule)
    db.commit()
    return saved


@router.post("/nl", response_model=NLConvertResponse)
def nl_convert(req: NLConvertRequest, db: Session = Depends(get_db)):
    """Convert plain-English expectation to a structured DQ rule."""
    return nl_to_rule(req.table_fqn, req.natural_language, req.connection_id)


@router.patch("/{rule_id}", response_model=DQRule)
def decide_rule(rule_id: str, req: RuleDecisionRequest, db: Session = Depends(get_db)):
    """Human approves / edits / rejects / snoozes a rule."""
    row = db.execute(text(
        "SELECT rule_id, status, rule_expression, connection_id FROM dq_rules WHERE rule_id=:id"
    ), {"id": rule_id}).fetchone()
    if not row:
        raise HTTPException(404, "Rule not found")

    old_status = row[1]
    now = datetime.now(timezone.utc)

    if req.decision == "approve":
        new_status = "approved"
        db.execute(text(
            "UPDATE dq_rules SET status='approved', approved_by=:by, approved_at=:at, updated_at=:at "
            "WHERE rule_id=:id"
        ), {"by": req.decided_by, "at": now, "id": rule_id})

    elif req.decision == "reject":
        new_status = "retired"
        db.execute(text("UPDATE dq_rules SET status='retired', updated_at=:at WHERE rule_id=:id"),
                   {"at": now, "id": rule_id})

    elif req.decision == "snooze":
        new_status = "snoozed"
        db.execute(text(
            "UPDATE dq_rules SET status='snoozed', snooze_until=:until, updated_at=:at WHERE rule_id=:id"
        ), {"until": req.snooze_until, "at": now, "id": rule_id})

    else:
        raise HTTPException(400, f"Invalid decision: {req.decision}")

    # Handle inline edit
    if req.edited_expression:
        db.execute(text("UPDATE dq_rules SET rule_expression=:expr, updated_at=:at WHERE rule_id=:id"),
                   {"expr": req.edited_expression, "at": now, "id": rule_id})
    if req.edited_description:
        db.execute(text("UPDATE dq_rules SET rule_description=:desc, updated_at=:at WHERE rule_id=:id"),
                   {"desc": req.edited_description, "at": now, "id": rule_id})

    db.commit()

    log_event(db, user_name=req.decided_by, event_type=req.decision.upper(),
              entity_type="RULE", entity_id=rule_id,
              old_value={"status": old_status}, new_value={"status": new_status},
              reason=req.reason, connection_id=row[3])
    db.commit()

    updated = db.execute(text(
        "SELECT rule_id, connection_id, rule_name, rule_description, table_fqn, "
        "layer, column_name, rule_expression, rule_type, severity, is_cde_rule, status, "
        "approved_by, approved_at, snooze_until, created_by, nl_source "
        "FROM dq_rules WHERE rule_id=:id"
    ), {"id": rule_id}).fetchone()
    return _row_to_rule(updated)


@router.post("", response_model=DQRule, status_code=201)
def create_rule(rule: DQRule, db: Session = Depends(get_db)):
    """Manually add a custom rule."""
    rid = str(uuid.uuid4())
    db.execute(text("""
        INSERT INTO dq_rules
            (rule_id, connection_id, rule_name, rule_description, table_fqn,
             layer, column_name, rule_expression, rule_type, severity,
             is_cde_rule, status, created_by, nl_source, created_at, updated_at)
        VALUES
            (:rule_id, :conn, :name, :desc, :table_fqn,
             :layer, :col, :expr, :type, :sev, :cde, 'draft',
             :created_by, :nl_source, NOW(), NOW())
    """), {
        "rule_id": rid, "conn": rule.connection_id, "name": rule.rule_name,
        "desc": rule.rule_description, "table_fqn": rule.table_fqn,
        "layer": rule.layer, "col": rule.column_name, "expr": rule.rule_expression,
        "type": rule.rule_type, "sev": rule.severity, "cde": rule.is_cde_rule,
        "created_by": rule.created_by or "user", "nl_source": rule.nl_source,
    })
    db.commit()
    rule.rule_id = rid
    return rule
