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
        # Wrap expression: count records where the rule FAILS
        fail_sql = (
            f"SELECT COUNT(*) FROM {table_fqn} WHERE NOT ({rule_expression})"
        )
        total_sql = f"SELECT COUNT(*) FROM {table_fqn}"

        total = int(connector.query_scalar(total_sql) or 0)
        failed = int(connector.query_scalar(fail_sql) or 0)
        fail_pct = round(failed / max(total, 1) * 100, 2)

        # Sample failed records (top 20)
        sample_sql = (
            f"SELECT * FROM {table_fqn} WHERE NOT ({rule_expression}) LIMIT 20"
        )
        try:
            sample_result = connector.query(sample_sql)
            sample_rows = [
                dict(zip(sample_result.columns, row))
                for row in sample_result.rows[:20]
            ]
        except Exception:
            sample_rows = []

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
            remediation_suggestion=f"Execution error: {e}",
        )


def run_all_rules(
    connector: BaseConnector,
    connection_id: str,
    rules: list[dict],        # dicts with keys: rule_id, rule_name, table_fqn, layer, rule_expression, severity, is_cde_rule
) -> ExecutionRunResponse:
    """
    Execute all provided rules and return a consolidated run response.
    """
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
    severity_weight = {"CRITICAL": 3, "HIGH": 2, "MEDIUM": 1, "LOW": 0.5}
    total_weight = sum(severity_weight.get(r.severity, 1) for r in results) or 1
    weighted_score = sum(
        r.quality_score * severity_weight.get(r.severity, 1) for r in results
    )
    overall = round(weighted_score / total_weight, 1)

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
