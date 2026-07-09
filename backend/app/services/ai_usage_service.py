"""Best-effort AI usage ledger — one row per LLM call, powering the Trust
Dashboard's Cost & Governance transparency panel.

Never raises: a logging failure must not break the feature that made the AI
call. Call this AFTER your own commit (or in its own try/except) so a usage-
log failure can never roll back real work.
"""
import logging
import uuid
from sqlalchemy.orm import Session
from sqlalchemy import text

logger = logging.getLogger(__name__)


def log_ai_usage(
    db: Session,
    *,
    feature: str,
    connection_id: str | None,
    model: str | None = None,
    usage: dict | None = None,
    latency_ms: int | None = None,
    status: str = "ai",   # ai | fallback | error
) -> None:
    try:
        db.execute(text("""
            INSERT INTO ai_usage_log
                (log_id, connection_id, feature, model, input_tokens, output_tokens, latency_ms, status)
            VALUES
                (:id, :conn, :feature, :model, :in_tok, :out_tok, :latency, :status)
        """), {
            "id": str(uuid.uuid4()),
            "conn": connection_id,
            "feature": feature,
            "model": model or (usage or {}).get("model"),
            "in_tok": (usage or {}).get("input_tokens"),
            "out_tok": (usage or {}).get("output_tokens"),
            "latency": latency_ms,
            "status": status,
        })
        db.commit()
    except Exception as exc:
        logger.warning("ai_usage_log write skipped (%s): %s", feature, exc)
        try:
            db.rollback()
        except Exception:
            pass
