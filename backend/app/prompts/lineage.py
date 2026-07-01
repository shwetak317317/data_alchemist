from app.prompts._loader import load_prompt

IMPACT_NARRATIVE_PROMPT_VERSION = "impact-narrative-v1.0"
QUERY_EXTRACTION_PROMPT_VERSION = "query-extract-v1.0"


def build_impact_narrative_prompt(
    table_fqn: str,
    health_status: str,
    downstream_nodes: list[dict],
) -> list[dict]:
    """Return messages list for impact narrative generation.

    downstream_nodes come straight from the real lineage graph (BFS from
    table_fqn) — never guessed. User message is built here, not in YAML, to
    keep Jinja2 away from data values and to inject the real graph at call time.
    """
    msgs = load_prompt("lineage", "impact_narrative")

    lines = [
        f"Affected table: {table_fqn}",
        f"Current health status: {health_status}",
    ]
    if downstream_nodes:
        lines.append(f"\nDownstream dependents ({len(downstream_nodes)} total, from the real lineage graph):")
        for node in downstream_nodes[:12]:
            layer = node.get("layer", "") or ""
            ntype = node.get("node_type", "table") or "table"
            lines.append(f"- {node['label']} ({layer} {ntype})".strip())
        if len(downstream_nodes) > 12:
            lines.append(f"...and {len(downstream_nodes) - 12} more not listed here for brevity.")
    else:
        lines.append("\nNo downstream dependents are recorded in the lineage graph for this table.")

    lines.append("\nWrite the 3-5 bullet JSON impact summary.")
    msgs.append({"role": "user", "content": "\n".join(lines)})
    return msgs


def build_query_extraction_prompt(sql_text: str) -> list[dict]:
    """Return messages list for LLM-assisted extraction of lineage facts from a
    single SQL statement the deterministic parser (sqlglot) failed on."""
    msgs = load_prompt("lineage", "query_log_extraction")
    msgs.append({"role": "user", "content": f"SQL statement:\n{sql_text[:1500]}"})
    return msgs
