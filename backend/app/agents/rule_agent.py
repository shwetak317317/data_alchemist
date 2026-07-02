"""
Rule Agent — two capabilities:
  1. recommend_rules(profiling_report) → list of recommended DQ rules
  2. nl_to_rule(table_fqn, natural_language) → structured DQ rule
Both use LiteLLM for intelligence.
"""
import json
import logging
import uuid
from sqlalchemy.orm import Session
from sqlalchemy import text
from app.core.llm import chat, parse_llm_json
from app.core.config import settings
from app.models.rule import DQRule, NLConvertResponse
from app.models.profiling import ProfilingReport
from app.prompts.rules import build_recommend_rules_prompt, build_nl_to_rule_prompt

logger = logging.getLogger(__name__)


def _log_ai_call(db: Session | None, *, connection_id: str, call_type: str,
                  table_fqn: str | None, prompt, raw_response: str | None,
                  status: str, error_message: str | None = None) -> None:
    """Persist an LLM call so a bad AI-generated rule can be traced back to its prompt/response."""
    if db is None:
        return
    try:
        db.execute(text("""
            INSERT INTO rule_ai_calls
                (call_id, connection_id, call_type, table_fqn, model, prompt, raw_response, status, error_message)
            VALUES
                (:id, :conn, :type, :table_fqn, :model, :prompt, :raw, :status, :err)
        """), {
            "id": str(uuid.uuid4()), "conn": connection_id, "type": call_type,
            "table_fqn": table_fqn, "model": settings.llm_model,
            "prompt": json.dumps(prompt), "raw": raw_response,
            "status": status, "err": error_message,
        })
        db.commit()
    except Exception as e:
        logger.warning("Failed to persist rule_ai_calls row: %s", e)


def recommend_rules(
    report: ProfilingReport,
    connection_id: str,
    cde_columns: list[str] | None = None,
    sql_dialect: str = "postgresql",
    db: Session | None = None,
) -> list[DQRule]:
    cde_set = set(cde_columns or [])
    known_column_names = {c.name for c in report.columns}
    col_summary = [
        {
            "name": c.name, "type": c.data_type,
            "null_pct": c.null_pct, "cardinality_ratio": c.cardinality_ratio,
            "format_pattern": c.format_pattern, "is_cde": c.name in cde_set,
        }
        for c in report.columns
    ]

    prompt = build_recommend_rules_prompt(
        table_fqn=report.table_fqn,
        layer=report.layer,
        row_count=report.row_count,
        col_summary=col_summary,
        risks=report.risks,
        sql_dialect=sql_dialect,
    )

    try:
        raw = chat(prompt)
        data = parse_llm_json(raw)
        rules_raw = data.get("rules", [])
        logger.info("Rule recommendation LLM call succeeded: connection=%s table=%s rules=%d",
                    connection_id, report.table_fqn, len(rules_raw))
        _log_ai_call(db, connection_id=connection_id, call_type="RECOMMEND",
                     table_fqn=report.table_fqn, prompt=prompt, raw_response=raw, status="success")
    except Exception as e:
        logger.error("Rule recommendation LLM failed: %s", e)
        _log_ai_call(db, connection_id=connection_id, call_type="RECOMMEND",
                     table_fqn=report.table_fqn, prompt=prompt, raw_response=None,
                     status="error", error_message=str(e))
        # Re-raise rather than silently returning an empty list — the caller (rules.py)
        # must be able to tell "LLM failed" apart from "LLM legitimately found nothing
        # to flag," otherwise a failure looks identical to a clean table.
        raise

    rules = []
    for r in rules_raw:
        try:
            column_name = r.get("column_name")
            description = r.get("rule_description")
            # Defense-in-depth: the prompt is grounded with the table's real columns,
            # but if the model still drifts, flag it in the description rather than
            # silently persisting a rule that references a column that doesn't exist.
            if column_name and column_name not in known_column_names:
                description = f"⚠️ Unverified column reference ('{column_name}' not found in profiled schema) — review before approving. {description or ''}".strip()
            rules.append(DQRule(
                connection_id=connection_id,
                rule_name=r.get("rule_name", "unnamed_rule"),
                rule_description=description,
                table_fqn=report.table_fqn,
                layer=report.layer,
                column_name=column_name,
                rule_expression=r.get("rule_expression", "1=1"),
                rule_type=r.get("rule_type", "CUSTOM"),
                severity=r.get("severity", "MEDIUM"),
                is_cde_rule=r.get("is_cde_rule", False),
                status="draft",
                created_by="AI_AGENT",
            ))
        except Exception as e:
            logger.warning("Skipping malformed rule recommendation for %s: %s (raw=%r)",
                            report.table_fqn, e, r)
    return rules


def _nl_fallback(natural_language: str, table_fqn: str | None, reason: str) -> NLConvertResponse:
    return NLConvertResponse(
        rule_name="custom_rule",
        rule_expression="/* could not parse */",
        rule_type="CUSTOM",
        severity="MEDIUM",
        description=natural_language,
        is_cde_rule=False,
        explanation=reason,
        table_fqn=table_fqn,
        unresolved=True,
        unresolved_reason=reason,
    )


def nl_to_rule(
    table_fqn: str | None,
    natural_language: str,
    connection_id: str,
    layer: str = "UNKNOWN",
    sql_dialect: str = "postgresql",
    db: Session | None = None,
    known_columns: list[dict] | None = None,
) -> NLConvertResponse:
    prompt = build_nl_to_rule_prompt(
        table_fqn=table_fqn,
        layer=layer,
        natural_language=natural_language,
        sql_dialect=sql_dialect,
        known_columns=known_columns,
    )

    try:
        raw = chat(prompt)
        data = parse_llm_json(raw)
        logger.info("NL-to-rule LLM call succeeded: connection=%s table=%s", connection_id, table_fqn)
        _log_ai_call(db, connection_id=connection_id, call_type="NL_CONVERT",
                     table_fqn=table_fqn, prompt=prompt, raw_response=raw, status="success")
    except Exception as e:
        logger.error("NL to rule LLM failed: %s", e)
        _log_ai_call(db, connection_id=connection_id, call_type="NL_CONVERT",
                     table_fqn=table_fqn, prompt=prompt, raw_response=None,
                     status="error", error_message=str(e))
        return _nl_fallback(natural_language, table_fqn, "LLM conversion failed. Please edit the expression manually.")

    try:
        column_name = data.get("column_name")
        unresolved = bool(data.get("unresolved", False))
        unresolved_reason = data.get("unresolved_reason")
        # Defense-in-depth: even if the model didn't flag itself as unresolved, catch
        # drift against the verified column list when we have one.
        if known_columns and column_name:
            known_names = {c["column_name"] for c in known_columns}
            if column_name not in known_names:
                unresolved = True
                unresolved_reason = unresolved_reason or f"Column '{column_name}' was not found in the verified schema for this table."

        return NLConvertResponse(
            rule_name=data.get("rule_name", "custom_rule"),
            column_name=column_name,
            rule_expression=data.get("rule_expression", "/* edit me */"),
            rule_type=data.get("rule_type", "CUSTOM"),
            severity=data.get("severity", "MEDIUM"),
            description=data.get("description", natural_language),
            is_cde_rule=data.get("is_cde_rule", False),
            explanation=data.get("explanation", ""),
            table_fqn=table_fqn,
            unresolved=unresolved,
            unresolved_reason=unresolved_reason,
        )
    except Exception as e:
        # A malformed field (wrong type, unexpected shape) must fall back safely
        # instead of raising a 500 straight through to the frontend.
        logger.error("NL to rule response failed validation: %s (raw=%r)", e, data)
        _log_ai_call(db, connection_id=connection_id, call_type="NL_CONVERT",
                     table_fqn=table_fqn, prompt=prompt, raw_response=raw,
                     status="error", error_message=f"validation error: {e}")
        return _nl_fallback(natural_language, table_fqn, "The AI response was malformed. Please edit the expression manually.")
