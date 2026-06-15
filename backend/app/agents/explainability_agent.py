"""
Explainability Agent — converts technical rule failures and anomalies into
plain-English business narratives that non-technical stakeholders can act on.
"""
import logging
from app.core.llm import chat
from app.models.anomaly import AnomalyRecord, AnomalyExplanationResponse
from app.models.execution import RuleResult

logger = logging.getLogger(__name__)

_SYSTEM = (
    "You are a senior data engineer explaining data quality issues to business stakeholders. "
    "Be concise, specific, and actionable. No jargon. No markdown. Plain text only."
)


def explain_anomaly(anomaly: AnomalyRecord) -> AnomalyExplanationResponse:
    prompt = [
        {"role": "system", "content": _SYSTEM},
        {"role": "user", "content": (
            f"Anomaly detected:\n"
            f"  Type: {anomaly.anomaly_type}\n"
            f"  Table: {anomaly.table_fqn}  Layer: {anomaly.layer}  Column: {anomaly.column_name or 'N/A'}\n"
            f"  Description: {anomaly.description}\n"
            f"  Severity: {anomaly.severity}\n"
            f"  Metric value: {anomaly.metric_value}  Baseline: {anomaly.baseline_value}  "
            f"Deviation: {anomaly.deviation_pct}%\n\n"
            "Return JSON with these exact keys (all strings/arrays of strings):\n"
            '{"what_happened": "", "where": "", "when_first_seen": "", '
            '"why_it_matters": "", "how_bad": "", "recommended_actions": ["step1", "step2"]}'
        )},
    ]
    try:
        import json
        raw = chat(prompt)
        data = json.loads(raw)
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
    """Return a short plain-English explanation for a rule failure (used in execution results)."""
    prompt = [
        {"role": "system", "content": _SYSTEM},
        {"role": "user", "content": (
            f"DQ rule failed:\n"
            f"  Rule: {result.rule_name}\n"
            f"  Table: {result.table_fqn}  Layer: {result.layer or 'N/A'}\n"
            f"  Failed records: {result.failed_records:,} ({result.fail_pct:.1f}%)\n"
            f"  Severity: {result.severity}  CDE: {result.is_cde_rule}\n\n"
            "Write 2–3 sentences: what happened, why it matters, what to do. No bullet points."
        )},
    ]
    try:
        return chat(prompt, max_tokens=150)
    except Exception as e:
        logger.warning("Rule failure explanation failed: %s", e)
        return f"{result.rule_name} failed on {result.fail_pct:.1f}% of records. Review the affected data."
