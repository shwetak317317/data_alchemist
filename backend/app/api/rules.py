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
from app.agents.rule_agent import recommend_rules, nl_to_rule, recommend_cross_table_rules
from app.agents.execution_agent import build_rule_check_sql
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
        generation_source=row[17], related_table_fqn=row[18],
    )

# Column list matching _row_to_rule's positional unpacking — every SELECT that
# feeds it must use exactly this projection.
_RULE_COLUMNS = (
    "r.rule_id, r.connection_id, r.rule_name, r.rule_description, r.table_fqn, "
    "r.layer, r.column_name, r.rule_expression, r.rule_type, r.severity, r.is_cde_rule, r.status, "
    "r.approved_by, r.approved_at, r.snooze_until, r.created_by, r.nl_source, "
    "r.generation_source, r.related_table_fqn"
)


def _dry_run_validate(connection_id: str, db: Session, rules) -> None:
    """Compile-check every generated expression against the LIVE connection before a
    human ever reviews it. Uses the exact SQL shape the executor will run (via
    build_rule_check_sql) with WHERE 1=0 inside the derived table — the database
    parses, binds, and validates the whole expression (column names, table names,
    syntax, window placement) but scans no rows, so this is deterministic ground
    truth where the regex lints in rule_agent.py are only heuristics. A failed rule
    is still persisted (the reviewer may fix it via edit) but gets a ⚠️ prefix so it
    can't be mistaken for a validated suggestion. If the connector itself is
    unavailable, generation still succeeds — the gate degrades to the regex lints."""
    if not rules:
        return
    try:
        connector = get_active_connector(connection_id, db)
    except Exception as e:
        logger.info("Dry-run validation skipped — connector unavailable: %s", e)
        return
    try:
        # Connectivity gate: if the source itself is unreachable, a per-rule query
        # failure means nothing about the SQL — skipping avoids stamping every rule
        # with a false "did not compile" warning when the network/VPN is down.
        try:
            if not connector.test():
                logger.info("Dry-run validation skipped — connection test failed")
                return
        except Exception as e:
            logger.info("Dry-run validation skipped — connection unreachable: %s", e)
            return
        for rule in rules:
            # Same table_ref derivation as execution_agent.execute_rule — parity with
            # execution is the whole point of this gate.
            parts = rule.table_fqn.rsplit(".", 1)
            tref = connector.table_ref(parts[0], parts[1]) if len(parts) == 2 else f'"{rule.table_fqn}"'
            try:
                connector.query_scalar(build_rule_check_sql(tref, rule.rule_expression, dry_run=True))
            except Exception as e:
                logger.info("Rule %r failed dry-run validation: %s", rule.rule_name, e)
                rule.rule_description = (
                    "⚠️ Failed dry-run validation against the live connection — this SQL did not compile "
                    "(check column/table names and dialect); it must be edited before approving. "
                    f"{rule.rule_description or ''}"
                ).strip()
    finally:
        try:
            connector.close()
        except Exception:
            pass


@router.get("", response_model=list[DQRule])
def list_rules(connection_id: str | None = None, status: str | None = None,
               db: Session = Depends(get_db),
               current_user: CurrentUser = Depends(get_current_user)):
    # snooze_until was, until now, a stored date nothing ever read back — a snoozed
    # rule stayed snoozed forever regardless of the date picked, since no cron/scheduler
    # exists to expire it. Self-heal here instead: every time rules are listed, flip any
    # snoozed rule whose snooze_until has passed back to 'draft' so it re-enters the
    # normal review queue. Scoped to the same org boundary as the SELECT below so this
    # can never touch a rule outside the caller's own visibility.
    db.execute(text(
        "UPDATE dq_rules SET status='draft', updated_at=NOW() "
        "WHERE status='snoozed' AND snooze_until IS NOT NULL AND snooze_until <= NOW() "
        "AND connection_id IN (SELECT id FROM connections WHERE org_id = :org OR org_id = 'default')"
    ), {"org": current_user.org_id})
    db.commit()

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
        f"SELECT {_RULE_COLUMNS} "
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
        # created_by stays "AI_AGENT" (rule_agent.py default) for batch-recommended
        # rules — dual control (decide_rule) exists to stop a human from rubber-
        # stamping SQL *they personally authored* (NL/manual rules); it shouldn't
        # also block the reviewer from approving AI-suggested SQL nobody "owns",
        # since that reviewer's approval already IS the independent human check.
        rules = recommend_rules(report, req.connection_id, cde_cols, sql_dialect=sql_dialect, db=db)
    except Exception:
        # recommend_rules() re-raises on LLM/parse failure rather than swallowing to an
        # empty list, so a real failure is never indistinguishable from "found 0 rules".
        raise HTTPException(502, "AI rule recommendation is temporarily unavailable — please retry.")

    _dry_run_validate(req.connection_id, db, rules)

    # Resolve table_id FK from the connection_tables cache (if populated)
    table_id_row = db.execute(text(
        "SELECT id FROM connection_tables WHERE connection_id=:conn AND table_fqn=:fqn LIMIT 1"
    ), {"conn": req.connection_id, "fqn": report.table_fqn}).fetchone()
    table_id = table_id_row[0] if table_id_row else None

    # "Regenerate" must actually regenerate, not just pile on: the LLM invents a fresh
    # rule_name most calls (it's not deterministic table-to-table), so the ON CONFLICT
    # upsert below only dedupes the rare exact-name rematch — every other rule from a
    # prior generation call was otherwise left behind forever, growing this table's
    # rule count without bound and leaving any now-superseded (e.g. previously buggy)
    # description/expression on screen untouched. Clear out this table's previous
    # single-table AI-generated, still-undecided drafts before inserting the fresh
    # batch. Never touch a rule a human has actually acted on (approved/active/
    # rejected/snoozed), one authored via NL/manual flows, or anything the separate
    # "Cross-table rules" button generated (including its self-reference rules) —
    # scoped on the structured generation_source column (migration 31 backfills it),
    # NOT on the "[Cross-table:" description prefix, which ⚠️ warning prefixes can
    # displace from position 0.
    db.execute(text("""
        DELETE FROM dq_rules
        WHERE connection_id=:conn AND table_fqn=:table_fqn
          AND status='draft' AND created_by='AI_AGENT'
          AND generation_source='single_table'
    """), {"conn": req.connection_id, "table_fqn": report.table_fqn})

    # Persist as draft rules — ON CONFLICT deduplicates by (connection_id, table_fqn, rule_name)
    # so re-generating rules for the same table is always idempotent.
    # The DO UPDATE is restricted to rows still in 'draft': LLM rule names are semantic
    # and highly repeatable for the same table, so without the guard a regenerate could
    # silently swap brand-new, unreviewed SQL into a rule a human already APPROVED —
    # keeping its approved status and approved_by — bypassing the dual control that
    # decide_rule() enforces. A conflict with a non-draft rule returns no row; the
    # fresh suggestion is dropped (the reviewed rule wins) and logged.
    saved = []
    skipped_non_draft = 0
    for rule in rules:
        rid = str(uuid.uuid4())
        result = db.execute(text("""
            INSERT INTO dq_rules
                (rule_id, connection_id, rule_name, rule_description, table_fqn,
                 layer, column_name, rule_expression, rule_type, severity,
                 is_cde_rule, status, created_by, table_id, generation_source, created_at, updated_at)
            VALUES
                (:rule_id, :conn, :name, :desc, :table_fqn,
                 :layer, :col, :expr, :type, :sev,
                 :cde, 'draft', :created_by, :table_id, 'single_table', NOW(), NOW())
            ON CONFLICT (connection_id, table_fqn, rule_name) DO UPDATE
                SET rule_description = EXCLUDED.rule_description,
                    rule_expression  = EXCLUDED.rule_expression,
                    table_id         = COALESCE(EXCLUDED.table_id, dq_rules.table_id),
                    generation_source = EXCLUDED.generation_source,
                    updated_at       = NOW()
                WHERE dq_rules.status = 'draft'
            RETURNING rule_id
        """), {
            "rule_id": rid, "conn": rule.connection_id, "name": rule.rule_name,
            "desc": rule.rule_description, "table_fqn": rule.table_fqn,
            "layer": rule.layer, "col": rule.column_name, "expr": rule.rule_expression,
            "type": rule.rule_type, "sev": rule.severity, "cde": rule.is_cde_rule,
            "table_id": table_id, "created_by": rule.created_by,
        })
        row_back = result.fetchone()
        if row_back is None:
            skipped_non_draft += 1
            logger.info("Skipped regenerated rule %r for %s: name collides with a non-draft rule",
                        rule.rule_name, rule.table_fqn)
            continue
        rule.rule_id = row_back[0]  # use existing rule_id on conflict
        saved.append(rule)
    db.commit()
    if skipped_non_draft:
        logger.info("recommend: %d suggestion(s) skipped — same-named rule already reviewed", skipped_non_draft)
    return saved


@router.post("/recommend-cross-table", response_model=list[DQRule])
def recommend_cross_table(req: RuleRecommendRequest, db: Session = Depends(get_db),
                          current_user: CurrentUser = Depends(get_current_user)):
    """Generate FK/referential-integrity rule recommendations between one table
    and every other cataloged table in the same connection — recommend_rules()
    only ever sees one table's own profiling stats, so it can never propose a
    check that spans tables."""
    row = db.execute(text(
        "SELECT report_id, connection_id, table_fqn, layer, column_stats "
        "FROM profiling_reports WHERE report_id=:id"
    ), {"id": req.report_id}).fetchone()
    if not row:
        raise HTTPException(404, "Profiling report not found")
    if row[1] != req.connection_id:
        raise HTTPException(400, "Profiling report does not belong to the specified connection")
    table_fqn, layer = row[2], row[3] or "UNKNOWN"

    conn_row = db.execute(text(
        "SELECT platform, org_id FROM connections WHERE id=:conn AND deleted_at IS NULL"
    ), {"conn": req.connection_id}).fetchone()
    if not conn_row:
        raise HTTPException(404, "Connection not found")
    assert_connection_access(conn_row[1], current_user)
    sql_dialect = (conn_row[0] or "postgresql").lower()

    # Primary table's columns — prefer the cataloged dictionary (real, human-verified
    # types); fall back to the profiling report's own column_stats if it hasn't been
    # through Dictionary enrichment yet.
    primary_rows = db.execute(text(
        "SELECT column_name, data_type FROM data_dictionary WHERE connection_id=:conn AND table_fqn=:fqn"
    ), {"conn": req.connection_id, "fqn": table_fqn}).fetchall()
    if primary_rows:
        primary_columns = [{"name": r[0], "type": r[1]} for r in primary_rows]
    else:
        blob = row[4] if isinstance(row[4], list) else (json.loads(row[4]) if row[4] else [])
        primary_columns = [{"name": c.get("name") or c.get("column_name"), "type": c.get("data_type")} for c in (blob or [])]
    if not primary_columns:
        raise HTTPException(400, "No column information for this table — run Profiling first")

    # Every other cataloged table in this connection is a candidate relationship target.
    # A wide connection can have dozens of tables — embedding every column of every
    # table blew the prompt up large enough that the local model burned its whole
    # token budget "thinking" and returned no JSON at all (confirmed live: 100%
    # failure rate on a 53-sibling-table connection). Only ID/key-like columns are
    # ever relevant to a foreign-key relationship anyway, so filter to those and
    # cap the table count — this is a token-budget fix, not a feature reduction.
    sibling_rows = db.execute(text(
        "SELECT table_fqn, column_name, data_type FROM data_dictionary "
        "WHERE connection_id=:conn AND table_fqn != :fqn "
        "AND column_name ~* '(_id|id|key|code)$' "
        "ORDER BY table_fqn"
    ), {"conn": req.connection_id, "fqn": table_fqn}).fetchall()

    # Uniqueness signal per sibling column, from each sibling table's latest profiling
    # report — tells the model which side of a candidate relationship is the natural-key/
    # lookup target (unique) vs. the FK/attribute side (has duplicates). Deferred earlier
    # while on the 4B model (token-budget risk); safe to add now with a larger completion
    # budget and a model that showed no truncation regressions in eval.
    cardinality_rows = db.execute(text("""
        WITH latest_reports AS (
            SELECT table_fqn, report_id, row_count,
                   ROW_NUMBER() OVER (PARTITION BY table_fqn ORDER BY run_at DESC) AS rn
            FROM profiling_reports
            WHERE connection_id = :conn
        )
        SELECT cs.table_fqn, cs.column_name, cs.distinct_count, lr.row_count
        FROM column_stats cs
        JOIN latest_reports lr ON lr.table_fqn = cs.table_fqn AND lr.report_id = cs.report_id AND lr.rn = 1
        WHERE cs.connection_id = :conn AND cs.table_fqn != :fqn
          AND cs.column_name ~* '(_id|id|key|code)$'
    """), {"conn": req.connection_id, "fqn": table_fqn}).fetchall()
    uniqueness: dict = {}
    for r in cardinality_rows:
        if r[3]:  # row_count > 0
            uniqueness[(r[0], r[1])] = (r[2] or 0) / r[3] >= 0.95

    siblings_by_table: dict = {}
    for r in sibling_rows:
        col = {"name": r[1], "type": r[2]}
        is_unique = uniqueness.get((r[0], r[1]))
        if is_unique is not None:
            col["unique"] = is_unique
        siblings_by_table.setdefault(r[0], []).append(col)
    _MAX_SIBLING_TABLES = 40
    sibling_tables = [{"table_fqn": fqn, "columns": cols} for fqn, cols in siblings_by_table.items()][:_MAX_SIBLING_TABLES]
    if not sibling_tables:
        raise HTTPException(400, "No other cataloged tables with ID-like columns in this connection yet — enrich "
                                  "at least one more table's data dictionary first so there's something to check against")

    try:
        rules = recommend_cross_table_rules(
            table_fqn=table_fqn, layer=layer, primary_columns=primary_columns,
            sibling_tables=sibling_tables, connection_id=req.connection_id,
            sql_dialect=sql_dialect, db=db,
        )
    except Exception:
        raise HTTPException(502, "AI cross-table rule recommendation is temporarily unavailable — please retry.")

    _dry_run_validate(req.connection_id, db, rules)

    # Same rationale as /recommend: clear this table's previous cross-table drafts
    # (including self-reference rules this button generated — regenerate scoping
    # follows the button that owns the suggestion, not the SQL's shape) before
    # inserting the fresh batch, so clicking "Cross-table rules for X" again
    # regenerates instead of accumulating. Scoped on generation_source so it never
    # touches single-table drafts from the other button, and to status='draft' so
    # an already-approved/rejected/snoozed decision is untouched.
    db.execute(text("""
        DELETE FROM dq_rules
        WHERE connection_id=:conn AND table_fqn=:table_fqn
          AND status='draft' AND created_by='AI_AGENT'
          AND generation_source='cross_table'
    """), {"conn": req.connection_id, "table_fqn": table_fqn})

    # Same draft-only guard as /recommend: never let a regenerated suggestion
    # overwrite a rule a human already approved/rejected/snoozed.
    saved = []
    skipped_non_draft = 0
    for rule in rules:
        rid = str(uuid.uuid4())
        result = db.execute(text("""
            INSERT INTO dq_rules
                (rule_id, connection_id, rule_name, rule_description, table_fqn,
                 layer, column_name, rule_expression, rule_type, severity,
                 is_cde_rule, status, created_by, generation_source, related_table_fqn,
                 created_at, updated_at)
            VALUES
                (:rule_id, :conn, :name, :desc, :table_fqn,
                 :layer, :col, :expr, :type, :sev, :cde,
                 'draft', :created_by, 'cross_table', :related_fqn, NOW(), NOW())
            ON CONFLICT (connection_id, table_fqn, rule_name) DO UPDATE
                SET rule_description = EXCLUDED.rule_description,
                    rule_expression  = EXCLUDED.rule_expression,
                    generation_source = EXCLUDED.generation_source,
                    related_table_fqn = EXCLUDED.related_table_fqn,
                    updated_at       = NOW()
                WHERE dq_rules.status = 'draft'
            RETURNING rule_id
        """), {
            "rule_id": rid, "conn": rule.connection_id, "name": rule.rule_name,
            "desc": rule.rule_description, "table_fqn": rule.table_fqn,
            "layer": rule.layer, "col": rule.column_name, "expr": rule.rule_expression,
            "type": rule.rule_type, "sev": rule.severity, "cde": rule.is_cde_rule,
            "created_by": rule.created_by, "related_fqn": rule.related_table_fqn,
        })
        row_back = result.fetchone()
        if row_back is None:
            skipped_non_draft += 1
            logger.info("Skipped regenerated cross-table rule %r for %s: name collides with a non-draft rule",
                        rule.rule_name, rule.table_fqn)
            continue
        rule.rule_id = row_back[0]
        saved.append(rule)
    db.commit()
    if skipped_non_draft:
        logger.info("recommend-cross-table: %d suggestion(s) skipped — same-named rule already reviewed",
                    skipped_non_draft)
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
        "SELECT r.rule_id, r.status, r.rule_expression, r.connection_id, c.org_id, r.created_by "
        "FROM dq_rules r LEFT JOIN connections c ON c.id = r.connection_id "
        "WHERE r.rule_id=:id"
    ), {"id": rule_id}).fetchone()
    if not row:
        raise HTTPException(404, "Rule not found")
    assert_connection_access(row[4], current_user)

    old_status = row[1]
    now = datetime.now(timezone.utc)

    # An approval must apply to text someone actually reviewed. Allowing
    # edited_expression/edited_description alongside decision=approve would let
    # the approver swap in brand-new, unreviewed SQL in the same request that
    # "approves" it — defeating dual control by construction. Editing always
    # goes through decision="edit" below, which resets the rule to draft so it
    # requires its own, later approval.
    if req.decision == "approve" and (req.edited_expression or req.edited_description):
        raise HTTPException(400, "Cannot edit and approve in the same request — save the edit first, "
                                  "then approve the updated draft.")

    if req.decision == "approve":
        # Dual control: a rule's author cannot approve their own rule expression
        # (which runs as raw SQL against the connection) — someone else on the
        # org must review it first. Admins may override.
        if row[5] and row[5] == current_user.email and current_user.role != "admin":
            raise HTTPException(403, "You cannot approve a rule you created — ask another team member to review it.")
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

    elif req.decision == "edit":
        # Editing a previously-approved rule's SQL must send it back through
        # review — the whole point of dual control is that a human other than
        # the editor signs off on the SQL that actually runs.
        new_status = "draft"
        db.execute(text(
            "UPDATE dq_rules SET status='draft', approved_by=NULL, approved_at=NULL, updated_at=:at "
            "WHERE rule_id=:id"
        ), {"at": now, "id": rule_id})

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
        f"SELECT {_RULE_COLUMNS} FROM dq_rules r WHERE r.rule_id=:id"
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
             is_cde_rule, status, created_by, nl_source, generation_source, created_at, updated_at)
        VALUES
            (:rule_id, :conn, :name, :desc, :table_fqn,
             :layer, :col, :expr, :type, :sev, :cde,
             'draft', :created_by, :nl_source, :gen_source, NOW(), NOW())
    """), {
        "rule_id": rid, "conn": rule.connection_id, "name": rule.rule_name,
        "desc": rule.rule_description, "table_fqn": rule.table_fqn,
        "layer": rule.layer, "col": rule.column_name, "expr": rule.rule_expression,
        "type": rule.rule_type, "sev": rule.severity, "cde": rule.is_cde_rule,
        "created_by": current_user.email, "nl_source": rule.nl_source,
        "gen_source": "nl" if rule.nl_source else "manual",
    })
    db.commit()
    rule.rule_id = rid
    rule.status = "draft"
    return rule
