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
) -> RuleResult:
    """
    Execute a single rule expression and return a RuleResult.
    The rule_expression should return TRUE for passing rows, FALSE for failing rows.
    We count: total rows, rows where expression = FALSE.
    """
    try:
        # Build a platform-safe table reference (handles cross-DB SQL Server, Snowflake quoting, etc.)
        parts = table_fqn.rsplit(".", 1)
        tref = connector.table_ref(parts[0], parts[1]) if len(parts) == 2 else f'"{table_fqn}"'

        fail_sql  = f"SELECT COUNT(*) FROM {tref} WHERE NOT ({rule_expression})"
        total_sql = f"SELECT COUNT(*) FROM {tref}"

        total = int(connector.query_scalar(total_sql) or 0)
        failed = int(connector.query_scalar(fail_sql) or 0)
        fail_pct = round(failed / max(total, 1) * 100, 2)

        # Sample failed records — try ANSI LIMIT first, fall back to TOP (SQL Server)
        sample_rows = []
        for sample_sql in (
            f"SELECT TOP 20 * FROM {tref} WHERE NOT ({rule_expression})",
            f"SELECT * FROM {tref} WHERE NOT ({rule_expression}) LIMIT 20",
        ):
            try:
                sample_result = connector.query(sample_sql)
                sample_rows = [
                    dict(zip(sample_result.columns, row))
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
            result.remediation_suggestion = explain_rule_failure(result)

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
            remediation_suggestion=_safe_error_message(e),
        )


def _safe_error_message(e: Exception) -> str:
    """User-facing summary of a rule execution failure — never the raw driver/DB
    exception text. The full exception is already logged server-side (see caller);
    this value is returned in the API response and must not leak SQL error detail,
    which would hand an attacker an oracle for refining an injected rule_expression."""
    text = str(e).lower()
    if any(s in text for s in ("login timeout", "could not connect", "timeout expired",
                                "cannot reach", "timed out", "connection refused")):
        return "Connection to the data source timed out or is unreachable. Check the connection's health on the Connections page."
    if "login failed" in text or "authentication" in text or "access denied" in text or "permission" in text:
        return "The connection's credentials do not have permission to run this rule. Check the connection's configuration."
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
