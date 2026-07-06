import json
from app.prompts._loader import load_prompt


def build_recommend_rules_prompt(
    table_fqn: str,
    layer: str,
    row_count: int,
    col_summary: list[dict],
    risks: list,
    sql_dialect: str = "postgresql",
) -> list[dict]:
    risk_lines = "\n".join(f"- {r.severity}: {r.description}" for r in risks[:10]) or "None"
    return load_prompt(
        "rules", "recommend_rules",
        table_fqn=table_fqn,
        layer=layer,
        row_count=f"{row_count:,}",
        col_summary_json=json.dumps(col_summary, indent=2),
        risk_lines=risk_lines,
        sql_dialect=sql_dialect,
    )


def build_cross_table_rules_prompt(
    table_fqn: str,
    layer: str,
    primary_columns: list[dict],
    sibling_tables: list[dict],
    sql_dialect: str = "postgresql",
) -> list[dict]:
    primary_text = "\n".join(f"- {c['name']} ({c.get('type') or 'unknown type'})" for c in primary_columns)

    def _col_line(c: dict) -> str:
        suffix = ", unique" if c.get("unique") is True else (", has duplicates" if c.get("unique") is False else "")
        return f"  - {c['name']} ({c.get('type') or 'unknown type'}{suffix})"

    sibling_text = "\n\n".join(
        f"{t['table_fqn']}:\n" + "\n".join(_col_line(c) for c in t["columns"])
        for t in sibling_tables
    ) or "(no other tables available)"
    return load_prompt(
        "rules", "cross_table_rules",
        table_fqn=table_fqn,
        layer=layer,
        sql_dialect=sql_dialect,
        primary_columns=primary_text,
        sibling_tables=sibling_text,
    )


def build_nl_to_rule_prompt(
    table_fqn: str,
    layer: str,
    natural_language: str,
    sql_dialect: str = "postgresql",
    known_columns: list[dict] | None = None,
) -> list[dict]:
    columns_text = "\n".join(
        f"- {c['column_name']} ({c.get('data_type') or 'unknown type'})" for c in known_columns
    ) if known_columns else None
    return load_prompt(
        "rules", "nl_to_rule",
        table_fqn=table_fqn or "unknown",
        layer=layer,
        natural_language=natural_language,
        sql_dialect=sql_dialect,
        known_columns=columns_text,
    )
