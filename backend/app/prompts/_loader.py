"""
YAML prompt loader with Jinja2 templating.

Usage:
    from app.prompts._loader import load_prompt

    messages = load_prompt("rules", "recommend_rules",
        table_fqn="silver.orders",
        layer="SILVER",
        row_count="1,234",
        col_summary_json="[...]",
        risk_lines="- HIGH: ...",
    )
    # → [{"role": "system", "content": "..."}, {"role": "user", "content": "..."}]

Jinja2 note:
    Variables use {{ var }} syntax in YAML.
    JSON schema examples in prompts use single braces {"key": "val"} which
    are safe — Jinja2 only triggers on double braces {{ }}.
"""
from __future__ import annotations

import yaml
from jinja2 import Environment, StrictUndefined
from pathlib import Path
from functools import lru_cache

_PROMPTS_DIR = Path(__file__).parent

# StrictUndefined raises an error if a template variable is not provided —
# catches typos in variable names at call time rather than silently rendering "".
_jinja_env = Environment(undefined=StrictUndefined, keep_trailing_newline=False)


@lru_cache(maxsize=None)
def _load_yaml(file: str) -> dict:
    """Load and cache a prompt YAML file. Cache is per-process (refreshes on restart)."""
    path = _PROMPTS_DIR / f"{file}.yaml"
    return yaml.safe_load(path.read_text(encoding="utf-8"))


def load_prompt(file: str, key: str, **vars) -> list[dict]:
    """
    Load a named prompt from <file>.yaml, render its Jinja2 templates, and
    return a messages list ready for litellm.completion().

    Args:
        file: YAML filename without extension (e.g. "rules")
        key:  Top-level key in the YAML (e.g. "recommend_rules")
        **vars: Template variables injected into {{ ... }} placeholders
    """
    data = _load_yaml(file)[key]
    messages: list[dict] = []

    if "system" in data:
        content = _jinja_env.from_string(data["system"]).render(**vars).strip()
        messages.append({"role": "system", "content": content})

    if "user" in data:
        content = _jinja_env.from_string(data["user"]).render(**vars).strip()
        messages.append({"role": "user", "content": content})

    return messages


def reload_prompts() -> None:
    """Clear the YAML cache so prompts reload from disk on the next call."""
    _load_yaml.cache_clear()
