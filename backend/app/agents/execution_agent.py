"""
Execution Agent — runs all approved/active DQ rules for a connection.
For each rule: executes the SQL expression, counts failures, scores results.
"""
import json
import uuid
import logging
from datetime import datetime, timezone

from app.connectors.base import BaseConnector
from app.models.execution import RuleResult, ExecutionRunResponse
from app.agents.explainability_agent import explain_rule_failure

logger = logging.getLogger(__name__)

SEVERITY_WEIGHT = {"CRITICAL": 3, "HIGH": 2, "MEDIUM": 1, "LOW": 0.5}

# The primary table is always aliased `t` in every query the executor builds. Two
# invariants depend on this exact alias:
#   1. Correlated subqueries: the rule prompts instruct the model to qualify the
#      primary table's columns as t.Col inside any EXISTS/subquery. Without the
#      alias, an unqualified outer reference binds to the SUBQUERY's table whenever
#      the column name exists there too (standard SQL scoping) — which is the normal
#      FK case and every self-reference case — turning the correlation predicate
#      into a tautology (c.X = c.X) so the rule passes every row and orphaned FKs
#      are never detected. Proven live before this fix.
#   2. The dry-run validation gate in api/rules.py compiles candidate expressions
#      with this same builder, so generation-time validation exactly matches
#      execution-time behavior.
PRIMARY_TABLE_ALIAS = "t"


def build_rule_check_sql(tref: str, rule_expression: str, *, dry_run: bool = False) -> str:
    """Build the fail-count query for a rule expression.

    The expression is evaluated in a derived table's SELECT list (CASE WHEN), not
    directly in WHERE, because the rule prompts mandate window-function shapes for
    uniqueness/consistency/VOLUME rules (COUNT(*) OVER (PARTITION BY ...)) and no
    dialect allows a window function in a WHERE clause — the old
    `WHERE NOT (expr)` form made every such rule error at execution.

    NULL semantics are deliberate and differ from the old form: CASE WHEN treats a
    NULL-valued expression as a FAILURE (ELSE 0), whereas `WHERE NOT (expr)`
    silently skipped NULL rows — a rule whose expression can't decide a row should
    surface it, not vanish it.

    dry_run=True adds WHERE 1=0 INSIDE the derived table: the database still
    parses, binds, and validates the whole expression (columns, tables, syntax,
    window placement) but scans no rows — used by the generation-time gate.
    """
    inner_filter = " WHERE 1=0" if dry_run else ""
    return (
        f"SELECT COUNT(*) FROM ("
        f"SELECT CASE WHEN ({rule_expression}) THEN 1 ELSE 0 END AS __dq_pass "
        f"FROM {tref} AS {PRIMARY_TABLE_ALIAS}{inner_filter}"
        f") __dq WHERE __dq_pass = 0"
    )


def build_failed_sample_sql(tref: str, rule_expression: str, limit_style: str) -> str:
    """Sample-failed-rows variant of build_rule_check_sql. limit_style: 'top' | 'limit'."""
    inner = (
        f"SELECT {PRIMARY_TABLE_ALIAS}.*, CASE WHEN ({rule_expression}) THEN 1 ELSE 0 END AS __dq_pass "
        f"FROM {tref} AS {PRIMARY_TABLE_ALIAS}"
    )
    if limit_style == "top":
        return f"SELECT TOP 20 * FROM ({inner}) __dq WHERE __dq_pass = 0"
    return f"SELECT * FROM ({inner}) __dq WHERE __dq_pass = 0 LIMIT 20"


def weighted_quality_score(results: list[RuleResult]) -> float:
    """Severity-weighted average quality score — the single definition of
    'overall quality' for a set of rule results. Used by run_all_rules() and
    by every endpoint/screen that reports an execution run's score, so the
    number never changes depending on which endpoint computed it."""
    if not results:
        return 0.0
    total_weight = sum(SEVERITY_WEIGHT.get(r.severity, 1) for r in results) or 1
    weighted_sum = sum(r.quality_score * SEVERITY_WEIGHT.get(r.severity, 1) for r in results)
    return round(weighted_sum / total_weight, 1)


def execute_rule(
    connector: BaseConnector,
    rule_id: str,
    rule_name: str,
    table_fqn: str,
    layer: str,
    rule_expression: str,
    severity: str,
    is_cde_rule: bool,
    run_id: str,
    db=None,
    connection_id: str | None = None,
) -> RuleResult:
    """
    Execute a single rule expression and return a RuleResult.
    The rule_expression should return TRUE for passing rows, FALSE for failing rows.
    We count: total rows, rows where expression = FALSE.
    """
    try:
        # Build a platform-safe table reference (handles cross-DB SQL Server, Snowflake quoting, etc.)
        #
        # split(", 1) — NOT rsplit — is required for 3-part FQNs. table_ref()'s
        # cross-DB contract is table_ref(database, "schema.table"): the first
        # part is the database, everything after the FIRST dot is schema.table.
        # rsplit(".", 1) instead cut at the LAST dot, so "RawDB.logiship.Reviews"
        # produced table_ref("RawDB.logiship", "Reviews") — "RawDB.logiship" was
        # then treated as one literal (invalid) database name, and every rule
        # against a 3-part (Database.Schema.Table) FQN failed with SQL Server
        # error 208 "Invalid object name 'RawDB.logiship.dbo.Reviews'". 2-part
        # FQNs (Database.Table, e.g. BronzeDB.br_categories) were unaffected —
        # split and rsplit agree when there's only one dot — which is why this
        # was invisible until a 3-part raw-layer table was actually run.
        parts = table_fqn.split(".", 1)
        tref = connector.table_ref(parts[0], parts[1]) if len(parts) == 2 else f'"{table_fqn}"'

        fail_sql  = build_rule_check_sql(tref, rule_expression)
        total_sql = f"SELECT COUNT(*) FROM {tref}"

        total = int(connector.query_scalar(total_sql) or 0)
        failed = int(connector.query_scalar(fail_sql) or 0)
        fail_pct = round(failed / max(total, 1) * 100, 2)

        # Sample failed records — try TOP (SQL Server) first, fall back to ANSI LIMIT.
        # __dq_pass is the wrapper's internal marker column, not table data — drop it.
        sample_rows = []
        for sample_sql in (
            build_failed_sample_sql(tref, rule_expression, "top"),
            build_failed_sample_sql(tref, rule_expression, "limit"),
        ):
            try:
                sample_result = connector.query(sample_sql)
                sample_rows = [
                    {k: v for k, v in zip(sample_result.columns, row) if k != "__dq_pass"}
                    for row in sample_result.rows[:20]
                ]
                break
            except Exception:
                continue

        status = "FAIL" if failed > 0 else "PASS"
        quality_score = round(max(0, 100 - (fail_pct * (2 if is_cde_rule else 1))), 1)

        result = RuleResult(
            result_id=str(uuid.uuid4()),
            run_id=run_id,
            rule_id=rule_id,
            rule_name=rule_name,
            table_fqn=table_fqn,
            layer=layer,
            status=status,
            total_records=total,
            failed_records=failed,
            fail_pct=fail_pct,
            quality_score=quality_score,
            severity=severity,
            is_cde_rule=is_cde_rule,
            sample_failed_records=sample_rows,
        )

        if status == "FAIL":
            result.remediation_suggestion = explain_rule_failure(result, db=db, connection_id=connection_id)

        return result

    except Exception as e:
        logger.error("Rule execution failed for %s: %s", rule_name, e)
        return RuleResult(
            result_id=str(uuid.uuid4()),
            run_id=run_id,
            rule_id=rule_id,
            rule_name=rule_name,
            table_fqn=table_fqn,
            layer=layer,
            status="ERROR",
            total_records=0,
            failed_records=0,
            fail_pct=0,
            quality_score=0,
            severity=severity,
            is_cde_rule=is_cde_rule,
            remediation_suggestion=_safe_error_message(e, table_fqn=table_fqn, connector=connector),
        )


def _safe_error_message(e: Exception, table_fqn: str | None = None, connector=None) -> str:
    """User-facing summary of a rule execution failure — never the raw driver/DB
    exception text. The full exception is already logged server-side (see caller);
    this value is returned in the API response and must not leak SQL error detail,
    which would hand an attacker an oracle for refining an injected rule_expression.

    Permission denials are the one class that gets MORE detail, not less: the
    table name and exact GRANT to request are what unblock the steward, and they
    reveal nothing an attacker doesn't already know (the rule's own table)."""
    from app.connectors.base import is_permission_error, permission_denied_message
    text = str(e).lower()
    if any(s in text for s in ("login timeout", "could not connect", "timeout expired",
                                "cannot reach", "timed out", "connection refused")):
        return "Connection to the data source timed out or is unreachable. Check the connection's health on the Connections page."
    if "login failed" in text or "authentication" in text:
        return "The connection's login or password was rejected by the data source. Check the connection's credentials."
    if is_permission_error(e):
        login = None
        if connector is not None:
            login = getattr(connector, "_config", {}).get("username")
        return permission_denied_message("select", table_fqn, login)
    return "This rule could not be executed due to a data source error. Check the connection's health, or contact support if the problem persists."


def all_rules_connection_error(
    connection_id: str,
    rules: list[dict],
    exc: Exception,
    run_id: str | None = None,
) -> ExecutionRunResponse:
    """Build a run response where every rule is ERROR, without touching the
    connector. Used when a pre-flight connectivity check has already failed —
    calling execute_rule() per rule in that case would retry the same doomed
    ODBC login for every single rule (each blocking for the full driver login
    timeout), turning an instant, well-understood failure into a multi-minute
    hang before the user sees anything."""
    if run_id is None:
        run_id = str(uuid.uuid4())
    run_timestamp = datetime.now(timezone.utc)
    message = _safe_error_message(exc)
    results = [
        RuleResult(
            result_id=str(uuid.uuid4()), run_id=run_id, rule_id=rule["rule_id"],
            rule_name=rule["rule_name"], table_fqn=rule["table_fqn"],
            layer=rule.get("layer", ""), status="ERROR",
            total_records=0, failed_records=0, fail_pct=0, quality_score=0,
            severity=rule.get("severity", "MEDIUM"), is_cde_rule=rule.get("is_cde_rule", False),
            remediation_suggestion=message,
        )
        for rule in rules
    ]
    return ExecutionRunResponse(
        run_id=run_id, connection_id=connection_id, run_timestamp=run_timestamp,
        total_rules=len(results), passed=0, failed=0, errors=len(results),
        overall_quality_score=0, results=results,
    )


def run_all_rules(
    connector: BaseConnector,
    connection_id: str,
    rules: list[dict],        # dicts with keys: rule_id, rule_name, table_fqn, layer, rule_expression, severity, is_cde_rule
    run_id: str | None = None,
    db=None,
) -> ExecutionRunResponse:
    """
    Execute all provided rules and return a consolidated run response.
    """
    if run_id is None:
        run_id = str(uuid.uuid4())
    run_timestamp = datetime.now(timezone.utc)
    results = []

    # Execute layer by layer: RAW → BRONZE → SILVER → GOLD
    layer_order = {"RAW": 0, "BRONZE": 1, "SILVER": 2, "GOLD": 3}
    sorted_rules = sorted(rules, key=lambda r: layer_order.get(r.get("layer", ""), 99))

    for rule in sorted_rules:
        result = execute_rule(
            connector=connector,
            rule_id=rule["rule_id"],
            rule_name=rule["rule_name"],
            table_fqn=rule["table_fqn"],
            layer=rule.get("layer", ""),
            rule_expression=rule["rule_expression"],
            severity=rule.get("severity", "MEDIUM"),
            is_cde_rule=rule.get("is_cde_rule", False),
            run_id=run_id,
            db=db,
            connection_id=connection_id,
        )
        results.append(result)

    passed = sum(1 for r in results if r.status == "PASS")
    failed = sum(1 for r in results if r.status == "FAIL")
    errors = sum(1 for r in results if r.status == "ERROR")

    # Overall quality score: weighted average (CRITICAL failures penalised more)
    overall = weighted_quality_score(results)

    return ExecutionRunResponse(
        run_id=run_id,
        connection_id=connection_id,
        run_timestamp=run_timestamp,
        total_rules=len(results),
        passed=passed,
        failed=failed,
        errors=errors,
        overall_quality_score=overall,
        results=results,
    )
