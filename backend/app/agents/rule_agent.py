"""
Rule Agent — two capabilities:
  1. recommend_rules(profiling_report) → list of recommended DQ rules
  2. nl_to_rule(table_fqn, natural_language) → structured DQ rule
Both use LiteLLM for intelligence.
"""
import json
import logging
from app.core.llm import chat, parse_llm_json
from app.models.rule import DQRule, NLConvertResponse
from app.models.profiling import ProfilingReport
from app.prompts.rules import build_recommend_rules_prompt, build_nl_to_rule_prompt

logger = logging.getLogger(__name__)


def recommend_rules(
    report: ProfilingReport,
    connection_id: str,
    cde_columns: list[str] | None = None,
) -> list[DQRule]:
    cde_set = set(cde_columns or [])
    col_summary = [
        {
            "name": c.name, "type": c.data_type,
            "null_pct": c.null_pct, "cardinality_ratio": c.cardinality_ratio,
            "format_pattern": c.format_pattern, "is_cde": c.name in cde_set,
        }
        for c in report.columns
    ]

    prompt = build_recommend_rules_prompt(
        table_fqn=report.table_fqn,
        layer=report.layer,
        row_count=report.row_count,
        col_summary=col_summary,
        risks=report.risks,
    )

    try:
        raw = chat(prompt)
        data = parse_llm_json(raw)
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
    prompt = build_nl_to_rule_prompt(
        table_fqn=table_fqn,
        layer=layer,
        natural_language=natural_language,
    )

    try:
        raw = chat(prompt)
        data = parse_llm_json(raw)
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
