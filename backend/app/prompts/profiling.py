from app.prompts._loader import load_prompt


def build_profiling_summary_prompt(
    schema: str,
    table: str,
    row_count: int,
    scores: dict,
    risks: list,
) -> list[dict]:
    risk_text = "\n".join(f"- {r.severity}: {r.description}" for r in risks) or "None"
    return load_prompt(
        "profiling", "summary",
        schema=schema,
        table=table,
        row_count=f"{row_count:,}",
        overall_score=scores.get("overall", 0),
        completeness=scores.get("completeness", 0),
        uniqueness=scores.get("uniqueness", 0),
        consistency=scores.get("consistency", 0),
        risk_text=risk_text,
    )
