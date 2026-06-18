"""
Prompt library — all prompt templates live in YAML files alongside this package.

    prompts/profiling.yaml      → profiling agent summary
    prompts/rules.yaml          → rule recommendation + NL-to-rule
    prompts/metadata.yaml       → data dictionary enrichment
    prompts/explainability.yaml → anomaly and rule failure narratives

Python builder functions are thin wrappers that call _loader.load_prompt()
with the right variables. Agents import only the builders — they are not
aware of YAML or Jinja2.

To reload prompts without restarting (useful during prompt iteration):
    from app.prompts._loader import reload_prompts
    reload_prompts()
"""
from app.prompts.profiling import build_profiling_summary_prompt
from app.prompts.rules import build_recommend_rules_prompt, build_nl_to_rule_prompt
from app.prompts.metadata import build_metadata_enrichment_prompt
from app.prompts.explainability import build_anomaly_explanation_prompt, build_rule_failure_prompt

__all__ = [
    "build_profiling_summary_prompt",
    "build_recommend_rules_prompt",
    "build_nl_to_rule_prompt",
    "build_metadata_enrichment_prompt",
    "build_anomaly_explanation_prompt",
    "build_rule_failure_prompt",
]
