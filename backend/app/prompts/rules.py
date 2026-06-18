import json
from app.prompts._loader import load_prompt


def build_recommend_rules_prompt(
    table_fqn: str,
    layer: str,
    row_count: int,
    col_summary: list[dict],
    risks: list,
) -> list[dict]:
    risk_lines = "\n".join(f"- {r.severity}: {r.description}" for r in risks[:10]) or "None"
    return load_prompt(
        "rules", "recommend_rules",
        table_fqn=table_fqn,
        layer=layer,
        row_count=f"{row_count:,}",
        col_summary_json=json.dumps(col_summary, indent=2),
        risk_lines=risk_lines,
    )


def build_nl_to_rule_prompt(
    table_fqn: str,
    layer: str,
    natural_language: str,
) -> list[dict]:
    return load_prompt(
        "rules", "nl_to_rule",
        table_fqn=table_fqn or "unknown",
        layer=layer,
        natural_language=natural_language,
    )
