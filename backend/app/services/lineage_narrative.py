"""Impact narrative generation — the only LLM-touching piece of the lineage
module. The graph itself (nodes, edges, health) is always deterministic,
sourced from lineage_discovery.py or manual curation; this service only turns
a REAL downstream slice of that graph into business-readable prose. The LLM
never invents graph structure — it's given the actual downstream node list and
explicitly instructed never to reference anything outside it (see
app/prompts/lineage.yaml). A timeout or parse failure always falls back to a
deterministic templated summary — this endpoint never errors out to the user.
"""
from __future__ import annotations

import asyncio
import json
import logging
import time
from collections import deque

from pydantic import BaseModel, Field, field_validator
from sqlalchemy import text as sqlt
from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)


class ImpactNarrativeOutput(BaseModel):
    # severity is intentionally NOT part of the LLM's output schema: it's a fixed
    # function of (health_status, downstream_count), which is a rule, not a
    # judgment call — computed deterministically in _compute_severity() instead.
    # An earlier version let the LLM assign it and it once called a single
    # downstream dependency "critical" when the stated rule said "high" — a
    # class of inconsistency that doesn't belong in a prompt at all.
    bullets: list[str] = Field(min_length=3, max_length=5)

    @field_validator("bullets")
    @classmethod
    def bullets_not_blank(cls, v: list[str]) -> list[str]:
        cleaned = [b.strip() for b in v]
        if any(not b for b in cleaned):
            raise ValueError("Each bullet must be a non-empty string")
        return cleaned


def _compute_severity(health_status: str, downstream_count: int) -> str:
    if health_status == "fail":
        return "critical" if downstream_count >= 3 else "high"
    if health_status == "warn":
        return "medium" if downstream_count >= 1 else "low"
    return "low"


def _get_node(db: Session, connection_id: str, table_fqn: str):
    return db.execute(sqlt("""
        SELECT node_id, label, health_status, layer FROM lineage_nodes
        WHERE connection_id = :conn AND external_id = :fqn
    """), {"conn": connection_id, "fqn": table_fqn}).fetchone()


def _get_downstream_nodes(db: Session, connection_id: str, root_node_id: str) -> list[dict]:
    """BFS downstream, confirmed edges only — mirrors the same traversal used by
    GET /api/lineage/{table_fqn} so the narrative and the visible graph never
    disagree about what's downstream of what."""
    visited = {root_node_id}
    queue = deque([root_node_id])
    downstream_ids: list[str] = []
    while queue:
        current = queue.popleft()
        for (nid,) in db.execute(sqlt(
            "SELECT target_node_id FROM lineage_edges WHERE source_node_id = :src AND status = 'confirmed'"
        ), {"src": current}).fetchall():
            if nid not in visited:
                visited.add(nid)
                downstream_ids.append(nid)
                queue.append(nid)

    if not downstream_ids:
        return []
    placeholders = ", ".join(f":id_{i}" for i in range(len(downstream_ids)))
    params = {f"id_{i}": v for i, v in enumerate(downstream_ids)}
    rows = db.execute(sqlt(f"""
        SELECT label, layer, node_type FROM lineage_nodes WHERE node_id IN ({placeholders})
    """), params).fetchall()
    return [{"label": r[0], "layer": r[1] or "", "node_type": r[2] or "table"} for r in rows]


def _fallback_narrative(table_fqn: str, health_status: str, downstream: list[dict]) -> dict:
    """Deterministic template — used when the LLM call fails, times out, or
    returns output that fails validation. Never leaves the user with an error."""
    count = len(downstream)
    severity = _compute_severity(health_status, count)
    if health_status == "fail":
        bullets = [f"{table_fqn} is currently failing its data quality checks."]
    elif health_status == "warn":
        bullets = [f"{table_fqn} has an active data quality warning."]
    else:
        bullets = [f"{table_fqn} currently shows a healthy status."]

    if downstream:
        labels = ", ".join(n["label"] for n in downstream[:5])
        more = f" and {count - 5} more" if count > 5 else ""
        bullets.append(f"This table feeds {count} downstream table(s)/report(s): {labels}{more}.")
        bullets.append("Recommended action: verify these downstream consumers before they next refresh.")
    else:
        bullets.append("No downstream dependents are recorded in the lineage graph for this table yet.")
        bullets.append("Recommended action: confirm the lineage graph is complete before ruling out downstream impact.")

    return {"bullets": bullets, "severity": severity, "generated_via": "template", "downstream_count": count}


def generate_impact_narrative(db: Session, connection_id: str, table_fqn: str) -> dict:
    """Return {bullets, severity, generated_via, downstream_count, node_found}.
    node_found=False means table_fqn has no lineage node for this connection —
    callers should surface that distinctly from "no downstream impact"."""
    node = _get_node(db, connection_id, table_fqn)
    if not node:
        return {"bullets": [], "severity": "low", "generated_via": "none", "downstream_count": 0, "node_found": False}

    node_id, label, health_status, layer = node
    downstream = _get_downstream_nodes(db, connection_id, node_id)
    health_status = health_status or "ok"

    t0 = time.monotonic()
    try:
        # generate_impact_narrative is called from a sync FastAPI endpoint, which
        # Starlette runs in a worker thread — no event loop already running there,
        # so asyncio.run() is safe (unlike calling it from an async def endpoint).
        result = asyncio.run(_call_llm(table_fqn, health_status, downstream))
        result["node_found"] = True
        usage_meta = result.pop("_usage_meta", None)
        _log_usage(db, connection_id, usage_meta, int((time.monotonic() - t0) * 1000), "ai")
        return result
    except Exception as exc:
        logger.warning("Impact narrative LLM generation failed for %s: %s — using template fallback", table_fqn, exc)
        result = _fallback_narrative(table_fqn, health_status, downstream)
        result["node_found"] = True
        _log_usage(db, connection_id, None, int((time.monotonic() - t0) * 1000), "fallback")
        return result


def _log_usage(db: Session, connection_id: str, usage_meta: dict | None, latency_ms: int, status: str) -> None:
    try:
        from app.services.ai_usage_service import log_ai_usage
        log_ai_usage(db, feature="lineage_narrative", connection_id=connection_id,
                     model=(usage_meta or {}).get("model"), usage=usage_meta,
                     latency_ms=latency_ms, status=status)
    except Exception:
        pass


async def _call_llm(table_fqn: str, health_status: str, downstream: list[dict]) -> dict:
    from app.core.llm import achat_with_usage, parse_llm_json
    from app.prompts.lineage import build_impact_narrative_prompt, IMPACT_NARRATIVE_PROMPT_VERSION

    start = time.monotonic()
    messages = build_impact_narrative_prompt(table_fqn, health_status, downstream)
    # 900 tokens, not a smaller "3-5 short bullets should easily fit" guess — the
    # Simulator's narrative generator hit this exact JSON-truncation failure mode
    # at 500 tokens (this model's phrasing runs verbose); same fix applies here.
    raw, usage = await asyncio.wait_for(
        achat_with_usage(messages, temperature=0.2, max_tokens=900, num_retries=0, request_timeout=8),
        timeout=10.0,
    )
    data = parse_llm_json(raw)
    parsed = ImpactNarrativeOutput.model_validate(data)
    severity = _compute_severity(health_status, len(downstream))

    logger.info(json.dumps({
        "event": "llm.impact_narrative",
        "prompt_version": IMPACT_NARRATIVE_PROMPT_VERSION,
        "table_fqn": table_fqn,
        "model": usage.get("model") if usage else None,
        "latency_ms": round((time.monotonic() - start) * 1000),
        "input_tokens": usage.get("input_tokens") if usage else None,
        "output_tokens": usage.get("output_tokens") if usage else None,
        "downstream_count": len(downstream),
        "severity": severity,
    }))

    return {
        "bullets": parsed.bullets,
        "severity": severity,
        "generated_via": "llm",
        "downstream_count": len(downstream),
        "_usage_meta": usage,
    }
