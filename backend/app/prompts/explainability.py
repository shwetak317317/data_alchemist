from app.prompts._loader import load_prompt


def build_anomaly_explanation_prompt(anomaly) -> list[dict]:
    return load_prompt(
        "explainability", "anomaly",
        anomaly_type=anomaly.anomaly_type,
        table_fqn=anomaly.table_fqn,
        layer=anomaly.layer,
        column_name=anomaly.column_name or "N/A",
        description=anomaly.description,
        severity=anomaly.severity,
        metric_value=anomaly.metric_value,
        baseline_value=anomaly.baseline_value,
        deviation_pct=anomaly.deviation_pct,
    )


def build_rule_failure_prompt(result) -> list[dict]:
    return load_prompt(
        "explainability", "rule_failure",
        rule_name=result.rule_name,
        table_fqn=result.table_fqn,
        layer=result.layer or "N/A",
        failed_records=f"{result.failed_records:,}",
        fail_pct=f"{result.fail_pct:.1f}",
        severity=result.severity,
        is_cde_rule=result.is_cde_rule,
    )
