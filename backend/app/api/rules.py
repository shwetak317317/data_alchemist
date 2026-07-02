"""Rules API — recommend, NL convert, CRUD with human approve/edit/reject."""
import json
import uuid
import logging
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import text

from app.core.metadata_db import get_db
from app.core.auth_deps import get_current_user, assert_connection_access, CurrentUser
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
               db: Session = Depends(get_db),
               current_user: CurrentUser = Depends(get_current_user)):
    # Always scope to the caller's org (or pre-multitenancy 'default' connections) so
    # rules from another organisation's connections can never appear in the list,
    # whether or not a specific connection_id was requested.
    filters = ["(c.org_id = :org OR c.org_id = 'default')"]
    params: dict = {"org": current_user.org_id}
    if connection_id:
        filters.append("r.connection_id = :conn")
        params["conn"] = connection_id
    if status:
        filters.append("r.status = :status")
        params["status"] = status
    where = "WHERE " + " AND ".join(filters)
    rows = db.execute(text(
        f"SELECT r.rule_id, r.connection_id, r.rule_name, r.rule_description, r.table_fqn, "
        f"r.layer, r.column_name, r.rule_expression, r.rule_type, r.severity, r.is_cde_rule, r.status, "
        f"r.approved_by, r.approved_at, r.snooze_until, r.created_by, r.nl_source "
        f"FROM dq_rules r JOIN connections c ON c.id = r.connection_id {where} "
        f"ORDER BY r.created_at DESC"
    ), params).fetchall()
    return [_row_to_rule(r) for r in rows]


@router.post("/recommend", response_model=list[DQRule])
def recommend(req: RuleRecommendRequest, db: Session = Depends(get_db),
              current_user: CurrentUser = Depends(get_current_user)):
    """Generate rule recommendations based on a profiling report."""
    row = db.execute(text(
        "SELECT report_id, connection_id, table_fqn, layer, run_at, row_count, "
        "quality_score, completeness_score, uniqueness_score, consistency_score, "
        "freshness_score, risks_flagged, column_stats, summary_text "
        "FROM profiling_reports WHERE report_id=:id"
    ), {"id": req.report_id}).fetchone()
    if not row:
        raise HTTPException(404, "Profiling report not found")
    if row[1] != req.connection_id:
        raise HTTPException(400, "Profiling report does not belong to the specified connection")

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

    # Get connection platform + org so the LLM generates dialect-correct SQL and
    # cross-organisation recommendation requests are rejected.
    conn_row = db.execute(text(
        "SELECT platform, org_id FROM connections WHERE id=:conn AND deleted_at IS NULL"
    ), {"conn": req.connection_id}).fetchone()
    if not conn_row:
        raise HTTPException(404, "Connection not found")
    assert_connection_access(conn_row[1], current_user)
    sql_dialect = (conn_row[0] or "postgresql").lower()

    try:
        rules = recommend_rules(report, req.connection_id, cde_cols, sql_dialect=sql_dialect, db=db)
    except Exception:
        # recommend_rules() re-raises on LLM/parse failure rather than swallowing to an
        # empty list, so a real failure is never indistinguishable from "found 0 rules".
        raise HTTPException(502, "AI rule recommendation is temporarily unavailable — please retry.")

    # Resolve table_id FK from the connection_tables cache (if populated)
    table_id_row = db.execute(text(
        "SELECT id FROM connection_tables WHERE connection_id=:conn AND table_fqn=:fqn LIMIT 1"
    ), {"conn": req.connection_id, "fqn": report.table_fqn}).fetchone()
    table_id = table_id_row[0] if table_id_row else None

    # Persist as draft rules — ON CONFLICT deduplicates by (connection_id, table_fqn, rule_name)
    # so re-generating rules for the same table is always idempotent.
    saved = []
    for rule in rules:
        rid = str(uuid.uuid4())
        result = db.execute(text("""
            INSERT INTO dq_rules
                (rule_id, connection_id, rule_name, rule_description, table_fqn,
                 layer, column_name, rule_expression, rule_type, severity,
                 is_cde_rule, status, created_by, table_id, created_at, updated_at)
            VALUES
                (:rule_id, :conn, :name, :desc, :table_fqn,
                 :layer, :col, :expr, :type, :sev,
                 :cde, 'draft', 'AI_AGENT', :table_id, NOW(), NOW())
            ON CONFLICT (connection_id, table_fqn, rule_name) DO UPDATE
                SET rule_description = EXCLUDED.rule_description,
                    rule_expression  = EXCLUDED.rule_expression,
                    table_id         = COALESCE(EXCLUDED.table_id, dq_rules.table_id),
                    updated_at       = NOW()
            RETURNING rule_id
        """), {
            "rule_id": rid, "conn": rule.connection_id, "name": rule.rule_name,
            "desc": rule.rule_description, "table_fqn": rule.table_fqn,
            "layer": rule.layer, "col": rule.column_name, "expr": rule.rule_expression,
            "type": rule.rule_type, "sev": rule.severity, "cde": rule.is_cde_rule,
            "table_id": table_id,
        })
        rule.rule_id = result.fetchone()[0]  # use existing rule_id on conflict
        saved.append(rule)
    db.commit()
    return saved


@router.post("/nl", response_model=NLConvertResponse)
def nl_convert(req: NLConvertRequest, db: Session = Depends(get_db),
               current_user: CurrentUser = Depends(get_current_user)):
    """Convert plain-English expectation to a structured DQ rule."""
    conn_row = db.execute(text(
        "SELECT platform, org_id FROM connections WHERE id=:conn AND deleted_at IS NULL"
    ), {"conn": req.connection_id}).fetchone()
    if not conn_row:
        raise HTTPException(404, "Connection not found")
    assert_connection_access(conn_row[1], current_user)
    sql_dialect = (conn_row[0] or "postgresql").lower()

    known_columns = None
    if req.table_fqn:
        col_rows = db.execute(text(
            "SELECT column_name, data_type FROM data_dictionary WHERE connection_id=:conn AND table_fqn=:fqn"
        ), {"conn": req.connection_id, "fqn": req.table_fqn}).fetchall()
        if col_rows:
            known_columns = [{"column_name": r[0], "data_type": r[1]} for r in col_rows]

    return nl_to_rule(req.table_fqn, req.natural_language, req.connection_id, sql_dialect=sql_dialect,
                       db=db, known_columns=known_columns)


@router.patch("/{rule_id}", response_model=DQRule)
def decide_rule(rule_id: str, req: RuleDecisionRequest, db: Session = Depends(get_db),
                current_user: CurrentUser = Depends(get_current_user)):
    """Human approves / edits / rejects / snoozes a rule."""
    row = db.execute(text(
        "SELECT r.rule_id, r.status, r.rule_expression, r.connection_id, c.org_id "
        "FROM dq_rules r LEFT JOIN connections c ON c.id = r.connection_id "
        "WHERE r.rule_id=:id"
    ), {"id": rule_id}).fetchone()
    if not row:
        raise HTTPException(404, "Rule not found")
    assert_connection_access(row[4], current_user)

    old_status = row[1]
    now = datetime.now(timezone.utc)

    if req.decision == "approve":
        new_status = "approved"
        db.execute(text(
            "UPDATE dq_rules SET status='approved', approved_by=:by, approved_at=:at, updated_at=:at "
            "WHERE rule_id=:id"
        ), {"by": current_user.email, "at": now, "id": rule_id})

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

    log_event(db, user_email=current_user.email, event_type=req.decision.upper(),
              entity_type="RULE", entity_id=rule_id,
              old_value={"status": old_status}, new_value={"status": new_status},
              reason=req.reason, connection_id=row[3], org_id=row[4])
    db.commit()

    updated = db.execute(text(
        "SELECT rule_id, connection_id, rule_name, rule_description, table_fqn, "
        "layer, column_name, rule_expression, rule_type, severity, is_cde_rule, status, "
        "approved_by, approved_at, snooze_until, created_by, nl_source "
        "FROM dq_rules WHERE rule_id=:id"
    ), {"id": rule_id}).fetchone()
    return _row_to_rule(updated)


@router.post("", response_model=DQRule, status_code=201)
def create_rule(rule: DQRule, db: Session = Depends(get_db),
                current_user: CurrentUser = Depends(get_current_user)):
    """Manually add a custom rule."""
    conn_row = db.execute(text(
        "SELECT org_id FROM connections WHERE id=:conn AND deleted_at IS NULL"
    ), {"conn": rule.connection_id}).fetchone()
    if not conn_row:
        raise HTTPException(404, "Connection not found")
    assert_connection_access(conn_row[0], current_user)

    rid = str(uuid.uuid4())
    # Every new rule starts as 'draft' regardless of what the caller sends — approval
    # must go through decide_rule(), which requires a second explicit PATCH request
    # and writes an audit_trail row. Letting create_rule set status directly would
    # let a rule's author self-approve their own SQL in the same call that defines
    # it, with no audit trail and no second look before it runs against live data.
    db.execute(text("""
        INSERT INTO dq_rules
            (rule_id, connection_id, rule_name, rule_description, table_fqn,
             layer, column_name, rule_expression, rule_type, severity,
             is_cde_rule, status, created_by, nl_source, created_at, updated_at)
        VALUES
            (:rule_id, :conn, :name, :desc, :table_fqn,
             :layer, :col, :expr, :type, :sev, :cde,
             'draft', :created_by, :nl_source, NOW(), NOW())
    """), {
        "rule_id": rid, "conn": rule.connection_id, "name": rule.rule_name,
        "desc": rule.rule_description, "table_fqn": rule.table_fqn,
        "layer": rule.layer, "col": rule.column_name, "expr": rule.rule_expression,
        "type": rule.rule_type, "sev": rule.severity, "cde": rule.is_cde_rule,
        "created_by": current_user.email, "nl_source": rule.nl_source,
    })
    db.commit()
    rule.rule_id = rid
    rule.status = "draft"
    return rule
