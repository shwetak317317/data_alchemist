"""Scenario classification service.

Separated from the API layer so the eval script can import it
without triggering database connections or the full FastAPI app.
"""
from __future__ import annotations

import asyncio
import json
import logging
import re as _re
import time
from typing import Literal, Optional

from pydantic import BaseModel, Field, field_validator

logger = logging.getLogger(__name__)

# Bump when the YAML prompt is edited so logs stay traceable.
CLASSIFY_PROMPT_VERSION = "classify-v1.1"

_VALID_KEYS = frozenset({"segment", "nullcol", "volume", "whitelist", "source", "unknown"})


# ── Output schema ─────────────────────────────────────────────────────────────

class _Entities(BaseModel):
    region: Optional[str] = None
    table: Optional[str] = None
    column: Optional[str] = None
    value: Optional[str] = None


class ClassifyResult(BaseModel):
    key: Literal["segment", "nullcol", "volume", "whitelist", "source", "unknown"]
    confidence: float = Field(ge=0.0, le=1.0)
    extracted_entities: _Entities = Field(default_factory=_Entities)
    compound: bool = False
    reasoning: str = ""
    method: Literal["llm", "regex"] = "llm"


class NarrativeOutput(BaseModel):
    bullets: list[str] = Field(min_length=3, max_length=5)

    @field_validator("bullets")
    @classmethod
    def bullets_not_blank(cls, v: list[str]) -> list[str]:
        cleaned = [b.strip() for b in v]
        if any(not b for b in cleaned):
            raise ValueError("Each bullet must be a non-empty string")
        return cleaned


class UnknownScenarioShape(BaseModel):
    type: str = Field(min_length=1, max_length=60)
    inject_label: str = Field(min_length=1, max_length=150)
    alert_title: str = Field(min_length=1, max_length=120)

    @field_validator("type")
    @classmethod
    def type_not_whitespace(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("type must not be whitespace-only")
        return v

    @field_validator("alert_title")
    @classmethod
    def alert_title_prefix(cls, v: str) -> str:
        if not v.upper().startswith("DATA QUALITY ALERT"):
            raise ValueError('alert_title must start with "DATA QUALITY ALERT"')
        return v


# ── Logging ───────────────────────────────────────────────────────────────────

def _log_classify(
    text: str,
    result: ClassifyResult,
    method: str,
    latency_s: float,
    raw_response: str | None = None,
    run_id: str | None = None,
    model: str | None = None,
    input_tokens: int | None = None,
    output_tokens: int | None = None,
) -> None:
    logger.info(json.dumps({
        "event": "llm.classify",
        "prompt_version": CLASSIFY_PROMPT_VERSION,
        "run_id": run_id,
        "method": method,
        "model": model,
        "input_text": text[:120],
        "result_key": result.key,
        "confidence": round(result.confidence, 3),
        "compound": result.compound,
        "reasoning": result.reasoning[:120],
        "latency_ms": round(latency_s * 1000),
        "input_tokens": input_tokens,
        "output_tokens": output_tokens,
        "raw_response": (raw_response or "")[:300],
    }))


# ── Regex backstop ────────────────────────────────────────────────────────────

def classify_regex(text: str) -> ClassifyResult:
    """Conservative keyword classifier used only when the LLM is unavailable.

    Returns low confidence so callers can surface a warning.
    Defaults to 'unknown' rather than forcing a wrong category.
    """
    t = text.lower()

    _ABSENCE = ("stop", "stopped", "offline", "zero", "down", "no data", "empty",
                "absence", "missing", "not sending", "not arriving", "dropped",
                "gap", "nothing")

    # segment: named geography / channel WITH an absence signal — require both.
    if any(loc in t for loc in (
        "northeast", "southeast", "northwest", "southwest",
        "apac", "emea", "west coast", "east coast", "chicago",
    )) and any(w in t for w in _ABSENCE):
        return ClassifyResult(key="segment", confidence=0.45,
                              reasoning="regex: known geographic term + absence signal")
    if ("region" in t or "channel" in t or "segment" in t or "partition" in t) and any(
        w in t for w in _ABSENCE
    ):
        return ClassifyResult(key="segment", confidence=0.40,
                              reasoning="regex: region + absence signal")

    # nullcol: null/blank/missing with column/data context — require both signals
    _NULL_WORDS = ("null", "blank", "empty", "missing", "not loaded", "not populated")
    _COL_WORDS  = ("column", "field", "revenue", "amount", "value", "col", "data")
    if any(n in t for n in _NULL_WORDS) and any(w in t for w in _COL_WORDS):
        return ClassifyResult(key="nullcol", confidence=0.45,
                              reasoning="regex: null/blank + column context")

    # whitelist: explicit invalid-value language only — 'code' alone is too broad
    # Bug fix: "not in.*enum" was treated as a literal string; use re.search instead.
    if ("whitelist" in t or ("invalid" in t and "value" in t) or "unapproved" in t
            or _re.search(r"not in.{0,10}enum", t)
            or _re.search(r"(new|unknown|unexpected|unapproved).{0,20}(status|code|value)", t)
            or _re.search(r"(status|error|category) code.{0,40}appear", t)):
        return ClassifyResult(key="whitelist", confidence=0.43,
                              reasoning="regex: whitelist signal")

    # volume: require an explicit drop/loss signal alongside "volume" to avoid false
    # positives on sentences like "data volume is correct today".
    _DROP = ("%", "row", "record", "order", "batch", "drop", "fell", "decline", "decrease",
             "below", "missing", "lost", "reduction", "collapsed", "lower")
    if ("volume" in t and any(p in t for p in _DROP)) or (
        "drop" in t and any(p in t for p in ("%", "row", "record", "order", "batch"))
    ):
        return ClassifyResult(key="volume", confidence=0.42,
                              reasoning="regex: volume drop signal")
    # volume: "only X%" or "only N records/rows" — explicit count shortfall pattern
    if _re.search(r"\bonly\s+\d+\s*%", t) or _re.search(r"\bonly\s+\d+\s+(record|row|order)", t):
        return ClassifyResult(key="volume", confidence=0.42,
                              reasoning="regex: only-N% / only-N-records shortfall")
    # volume: "row count" alone is a reliable signal — no false positives in DQ context
    if "row count" in t:
        return ClassifyResult(key="volume", confidence=0.40,
                              reasoning="regex: row count mention")

    # source: compound phrase matching to avoid false positives
    if any(phrase in t for phrase in (
        "crm feed", "source file", "didn't arrive", "did not arrive",
        "not landed", "not arrived", "hasn't arrived", "sla breach", "overdue",
    )):
        return ClassifyResult(key="source", confidence=0.43,
                              reasoning="regex: source non-arrival phrase")

    return ClassifyResult(key="unknown", confidence=0.20,
                          reasoning="regex: no pattern matched")


# ── LLM classifier ────────────────────────────────────────────────────────────

async def classify_with_llm(text: str, run_id: str | None = None) -> ClassifyResult:
    """LLM-first classification with structured JSON output and regex fallback.

    Uses parse_llm_json (handles code fences + thinking blocks) and validates
    the result against ClassifyResult. Any exception falls through to the regex
    backstop — callers always get a ClassifyResult, never an exception.
    """
    start = time.monotonic()
    try:
        # Lazy imports — keep module-level deps minimal for the eval script.
        from app.core.llm import achat_with_usage, parse_llm_json
        from app.prompts.simulation import build_classify_prompt

        messages = build_classify_prompt(text)
        raw, usage = await asyncio.wait_for(
            achat_with_usage(messages, temperature=0, max_tokens=200, num_retries=0, request_timeout=4),
            timeout=5.0,
        )

        data = parse_llm_json(raw)
        result = ClassifyResult.model_validate(data)
        result = result.model_copy(update={"method": "llm"})

        _log_classify(
            text, result, "llm", time.monotonic() - start, raw,
            run_id=run_id,
            model=usage.get("model") if usage else None,
            input_tokens=usage.get("input_tokens") if usage else None,
            output_tokens=usage.get("output_tokens") if usage else None,
        )
        return result

    except Exception as exc:
        logger.warning("LLM classification failed (%s: %s) — using regex fallback",
                       type(exc).__name__, exc)

    result = classify_regex(text)
    result = result.model_copy(update={"method": "regex"})
    _log_classify(text, result, "regex", time.monotonic() - start, run_id=run_id)
    return result
