from app.prompts._loader import load_prompt

CLASSIFY_PROMPT_VERSION = "classify-v1.0"
NARRATIVE_PROMPT_VERSION = "narrative-v1.1"


def build_classify_prompt(scenario_text: str) -> list[dict]:
    """Return messages list for scenario classification.

    System prompt is loaded from simulation.yaml (versioned).
    User message is appended directly to avoid Jinja2 rendering the scenario text.
    """
    msgs = load_prompt("simulation", "classify_scenario")
    msgs.append({"role": "user", "content": f"Classify: {scenario_text}"})
    return msgs


def build_narrative_prompt(
    scenario_text: str,
    scenario_type: str,
    profiling_ctx: dict,
    lineage_ctx: dict,
) -> list[dict]:
    """Return messages list for narrative generation with real profiling/lineage context.

    User message is built here — never in YAML — to keep Jinja2 away from
    user-provided text and to inject real metrics at call time.
    """
    msgs = load_prompt("simulation", "narrative_scenario")

    lines = [
        f'The reporter described the incident as:\n"{scenario_text}"',
        f"\nScenario type: {scenario_type}",
    ]

    table_fqn = profiling_ctx.get("table_fqn", "")
    if table_fqn:
        lines.append(f"Affected table: {table_fqn}")

    row_count    = profiling_ctx.get("row_count")
    quality_score = profiling_ctx.get("quality_score")
    last_profiled = profiling_ctx.get("last_profiled")
    column_name  = profiling_ctx.get("column_name")
    null_pct     = profiling_ctx.get("null_pct")
    mean_value   = profiling_ctx.get("mean_value")

    if row_count or quality_score is not None:
        lines.append("\nReal profiling metrics (from most recent profiling run):")
        if row_count:
            lines.append(f"- Table row count: {row_count:,}")
        if quality_score is not None:
            lines.append(f"- Data quality score: {round(quality_score)}/100")
        if last_profiled:
            lines.append(f"- Last profiled: {last_profiled}")
        if column_name and null_pct is not None:
            lines.append(f"- {column_name} null rate (baseline): {null_pct:.1f}%")
        if column_name and mean_value is not None:
            lines.append(f"- {column_name} mean value: {mean_value:.2f}")
    else:
        lines.append("\nNo profiling data available for this table.")

    downstream = lineage_ctx.get("downstream", [])
    if downstream:
        lines.append("\nDownstream tables and reports that depend on this data:")
        for node in downstream[:6]:
            layer = node.get("layer", "")
            ntype = node.get("node_type", "table")
            tag = f"{layer} {ntype}".strip()
            lines.append(f"- {node['label']} ({tag})")

    lines.append("\nWrite a 3–5 bullet JSON impact summary.")

    msgs.append({"role": "user", "content": "\n".join(lines)})
    return msgs


def build_synthesize_unknown_prompt(scenario_text: str) -> list[dict]:
    """Return messages list for unknown scenario type labeling."""
    msgs = load_prompt("simulation", "synthesize_unknown")
    msgs.append({"role": "user", "content": scenario_text})
    return msgs
