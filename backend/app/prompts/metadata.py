import json
from app.prompts._loader import load_prompt


def build_metadata_enrichment_prompt(
    table_fqn: str,
    layer: str,
    col_summary: list[dict],
) -> list[dict]:
    return load_prompt(
        "metadata", "enrich",
        table_fqn=table_fqn,
        layer=layer,
        col_summary_json=json.dumps(col_summary, indent=2),
    )
