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
        # Build a rule-based fallback so the response is always substantive
        atype = anomaly.anomaly_type or "DATA"
        table = anomaly.table_fqn or "the table"
        layer = anomaly.layer or "UNKNOWN"
        sev = anomaly.severity or "HIGH"
        dev = f"{anomaly.deviation_pct:+.1f}%" if anomaly.deviation_pct is not None else "significantly"
        metric = anomaly.metric_value
        baseline = anomaly.baseline_value

        if atype == "VOLUME":
            why = (
                f"A {sev.lower()} volume anomaly on {table} ({layer} layer) means downstream "
                f"pipelines, reports, and dashboards that depend on this table may be consuming "
                f"incomplete or stale data. Any SLA-bound jobs reading this table are at risk of "
                f"producing incorrect aggregates or missed rows ({dev} vs baseline)."
            )
            actions = [
                f"Check the ETL/ELT pipeline for {table} for failures or partial loads in the last run.",
                f"Compare source system record counts against the {layer} table for the same time window.",
                "Pause any downstream reports or dashboards that rely on this table until the root cause is confirmed.",
                "Open a P1 incident ticket and notify the pipeline owner and data steward immediately.",
            ]
        elif atype == "DISTRIBUTION":
            why = (
                f"A distribution anomaly in {table} ({layer} layer) signals that the statistical "
                f"profile of one or more columns has shifted {dev} from the expected baseline. "
                f"Decisions, models, or reports built on these columns may now produce biased or "
                f"incorrect results until the data drift is investigated and resolved."
            )
            actions = [
                f"Run a column-level profiling report on {table} to identify which columns shifted.",
                "Compare the current data distribution with the previous 7-day baseline histogram.",
                "Trace back to the source system to determine if a schema change or upstream process change occurred.",
                "Flag any ML models or KPI calculations that use the affected columns for re-validation.",
            ]
        else:
            why = (
                f"This {sev.lower()} {atype.lower()} anomaly on {table} ({layer} layer) indicates "
                f"that a data quality threshold has been breached ({dev} deviation). Business "
                f"reports, operational pipelines, and any downstream consumers of this table "
                f"may be affected until the underlying issue is resolved."
            )
            actions = [
                f"Investigate the {table} table for recent changes in source data or pipeline logic.",
                "Review the anomaly detection thresholds and confirm the alert is not a false positive.",
                "Notify the data owner and downstream report owners about the potential data quality issue.",
                "Document findings in the audit trail and create a remediation task in the task board.",
            ]

        return AnomalyExplanationResponse(
            anomaly_id=anomaly.anomaly_id,
            what_happened=anomaly.description or f"{atype} anomaly detected on {table}: {dev} deviation from baseline.",
            where=f"{layer} / {table}",
            when_first_seen=str(anomaly.detected_at),
            why_it_matters=why,
            how_bad=f"Severity: {sev}. Immediate investigation recommended.",
            recommended_actions=actions,
        )


def explain_rule_failure(result: RuleResult) -> str:
    prompt = build_rule_failure_prompt(result)
    try:
        return chat(prompt, max_tokens=150)
    except Exception as e:
        logger.warning("Rule failure explanation failed: %s", e)
        return f"{result.rule_name} failed on {result.fail_pct:.1f}% of records. Review the affected data."
