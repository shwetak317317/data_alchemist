"""
Explainability Agent — converts technical rule failures and anomalies into
plain-English business narratives that non-technical stakeholders can act on.
"""
import json
import logging
from app.core.llm import chat, parse_llm_json
from app.models.anomaly import AnomalyRecord, AnomalyExplanationResponse
from app.models.execution import RuleResult
from app.prompts.explainability import build_anomaly_explanation_prompt, build_rule_failure_prompt

logger = logging.getLogger(__name__)


def explain_anomaly(anomaly: AnomalyRecord) -> AnomalyExplanationResponse:
    prompt = build_anomaly_explanation_prompt(anomaly)
    try:
        raw = chat(prompt)
        data = parse_llm_json(raw)
        return AnomalyExplanationResponse(
            anomaly_id=anomaly.anomaly_id,
            what_happened=data.get("what_happened", anomaly.description),
            where=data.get("where", f"{anomaly.layer} / {anomaly.table_fqn}"),
            when_first_seen=data.get("when_first_seen", str(anomaly.detected_at)),
            why_it_matters=data.get("why_it_matters", "Impact unknown"),
            how_bad=data.get("how_bad", f"Severity: {anomaly.severity}"),
            recommended_actions=data.get("recommended_actions", ["Investigate the issue"]),
        )
    except Exception as e:
        logger.error("Explainability agent failed: %s", e)
        return AnomalyExplanationResponse(
            anomaly_id=anomaly.anomaly_id,
            what_happened=anomaly.description,
            where=f"{anomaly.layer} / {anomaly.table_fqn}",
            when_first_seen=str(anomaly.detected_at),
            why_it_matters="Unable to generate explanation",
            how_bad=f"Severity: {anomaly.severity}",
            recommended_actions=["Review the anomaly details and investigate the data source"],
        )


def explain_rule_failure(result: RuleResult) -> str:
    prompt = build_rule_failure_prompt(result)
    try:
        return chat(prompt, max_tokens=150)
    except Exception as e:
        logger.warning("Rule failure explanation failed: %s", e)
        return f"{result.rule_name} failed on {result.fail_pct:.1f}% of records. Review the affected data."
