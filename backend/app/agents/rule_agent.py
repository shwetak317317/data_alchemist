"""
Rule Agent — two capabilities:
  1. recommend_rules(profiling_report) → list of recommended DQ rules
  2. nl_to_rule(table_fqn, natural_language) → structured DQ rule
Both use LiteLLM for intelligence.
"""
import json
import logging
from app.core.llm import chat
from app.models.rule import DQRule, NLConvertResponse
from app.models.profiling import ProfilingReport

logger = logging.getLogger(__name__)

_SYSTEM_RULE = (
    "You are a senior data engineer who specialises in data quality. "
    "Your job is to write precise, executable DQ rules. "
    "Always return valid JSON with no markdown fences."
)


def recommend_rules(
    report: ProfilingReport,
    connection_id: str,
    cde_columns: list[str] | None = None,
) -> list[DQRule]:
    """
    Given a profiling report, return a ranked list of recommended DQ rules.
    """
    cde_set = set(cde_columns or [])
    col_summary = []
    for c in report.columns:
        col_summary.append({
            "name": c.name, "type": c.data_type,
            "null_pct": c.null_pct, "cardinality_ratio": c.cardinality_ratio,
            "format_pattern": c.format_pattern, "is_cde": c.name in cde_set,
        })

    prompt = [
        {"role": "system", "content": _SYSTEM_RULE},
        {"role": "user", "content": (
            f"Table: {report.table_fqn}  Layer: {report.layer}  Rows: {report.row_count:,}\n\n"
            f"Column statistics:\n{json.dumps(col_summary, indent=2)}\n\n"
            f"Top risks detected:\n"
            + "\n".join(f"- {r.severity}: {r.description}" for r in report.risks[:10])
            + "\n\nGenerate a list of 5–15 DQ rules. For each rule return JSON:\n"
            '{"rules": [{"rule_name": "", "rule_description": "", "column_name": "" or null, '
            '"rule_expression": "(SQL returning TRUE=pass)", "rule_type": "NULL_CHECK|RANGE|FORMAT|FK|VOLUME|CUSTOM", '
            '"severity": "CRITICAL|HIGH|MEDIUM|LOW", "is_cde_rule": true/false}]}'
        )},
    ]

    try:
        raw = chat(prompt)
        data = json.loads(raw)
        rules_raw = data.get("rules", [])
    except Exception as e:
        logger.error("Rule recommendation LLM failed: %s", e)
        rules_raw = []

    rules = []
    for r in rules_raw:
        rules.append(DQRule(
            connection_id=connection_id,
            rule_name=r.get("rule_name", "unnamed_rule"),
            rule_description=r.get("rule_description"),
            table_fqn=report.table_fqn,
            layer=report.layer,
            column_name=r.get("column_name"),
            rule_expression=r.get("rule_expression", "1=1"),
            rule_type=r.get("rule_type", "CUSTOM"),
            severity=r.get("severity", "MEDIUM"),
            is_cde_rule=r.get("is_cde_rule", False),
            status="draft",
            created_by="AI_AGENT",
        ))
    return rules


def nl_to_rule(
    table_fqn: str | None,
    natural_language: str,
    connection_id: str,
    layer: str = "UNKNOWN",
) -> NLConvertResponse:
    """
    Convert a plain-English quality expectation to a structured DQ rule.
    """
    prompt = [
        {"role": "system", "content": _SYSTEM_RULE},
        {"role": "user", "content": (
            f"Table: {table_fqn or 'unknown'}  Layer: {layer}\n\n"
            f"Business user says: \"{natural_language}\"\n\n"
            "Convert this into a DQ rule. Return JSON:\n"
            '{"rule_name": "", "rule_expression": "(SQL returning TRUE=pass)", '
            '"rule_type": "NULL_CHECK|RANGE|FORMAT|FK|VOLUME|CUSTOM", '
            '"severity": "CRITICAL|HIGH|MEDIUM|LOW", "description": "", '
            '"is_cde_rule": true/false, "explanation": "(why this rule matters)"}'
        )},
    ]

    try:
        raw = chat(prompt)
        data = json.loads(raw)
    except Exception as e:
        logger.error("NL to rule LLM failed: %s", e)
        return NLConvertResponse(
            rule_name="custom_rule",
            rule_expression="/* could not parse */",
            rule_type="CUSTOM",
            severity="MEDIUM",
            description=natural_language,
            is_cde_rule=False,
            explanation="LLM conversion failed. Please edit the expression manually.",
        )

    return NLConvertResponse(
        rule_name=data.get("rule_name", "custom_rule"),
        rule_expression=data.get("rule_expression", "/* edit me */"),
        rule_type=data.get("rule_type", "CUSTOM"),
        severity=data.get("severity", "MEDIUM"),
        description=data.get("description", natural_language),
        is_cde_rule=data.get("is_cde_rule", False),
        explanation=data.get("explanation", ""),
        table_fqn=table_fqn,
    )
