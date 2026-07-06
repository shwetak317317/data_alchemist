"""
LiteLLM gateway — all agents call chat() or stream_chat().

Switch provider by setting LLM_PROVIDER in .env — no yaml file needed.
  LLM_PROVIDER=ollama     → openai/<OLLAMA_MODEL> via LiteLLM proxy at OLLAMA_BASE_URL
  LLM_PROVIDER=gemini     → GEMINI_MODEL_NAME + GEMINI_API_KEY (direct, no api_base)
  LLM_PROVIDER=anthropic  → ANTHROPIC_MODEL_NAME + ANTHROPIC_API_KEY
  LLM_PROVIDER=openai     → OPENAI_MODEL_NAME + OPENAI_API_KEY
  LLM_PROVIDER=azure      → AZURE_MODEL_NAME + AZURE_API_KEY + AZURE_API_BASE

Gemini: do NOT pass api_key explicitly — LiteLLM reads GEMINI_API_KEY from
os.environ and sends it as a query param. Passing it as Bearer token → 401.

Ollama proxy: calls go to the LiteLLM proxy (OLLAMA_BASE_URL), not Ollama
directly. Model string uses openai/ prefix; OLLAMA_API_KEY is the virtual key.
"""
import os
from typing import Generator, AsyncGenerator
import litellm
from app.core.config import settings

litellm.suppress_debug_info = True


def _bootstrap_env() -> None:
    """Copy provider keys into os.environ for LiteLLM auto-discovery."""
    gemini_key = settings.gemini_api_key or settings.google_api_key
    if gemini_key:
        os.environ.setdefault("GEMINI_API_KEY", gemini_key)
        os.environ.setdefault("GOOGLE_API_KEY", gemini_key)
    if settings.anthropic_api_key:
        os.environ.setdefault("ANTHROPIC_API_KEY", settings.anthropic_api_key)
    if settings.openai_api_key:
        os.environ.setdefault("OPENAI_API_KEY", settings.openai_api_key)

_bootstrap_env()


def _build_kwargs(**overrides) -> dict:
    model = settings.llm_model
    kwargs: dict = {
        "model": model,
        "max_tokens": settings.llm_max_tokens,
        "temperature": settings.llm_temperature,
        **overrides,
    }

    is_gemini = model.startswith("gemini/")
    is_ollama = model.startswith("openai/")   # openai/ prefix = LiteLLM proxy / Ollama

    # api_key: skip for gemini (reads GEMINI_API_KEY from env as query param)
    if settings.llm_api_key and not is_gemini:
        kwargs["api_key"] = settings.llm_api_key

    # api_base: proxy URL (ollama), Azure endpoint, or any custom override
    if settings.llm_api_base:
        kwargs["api_base"] = settings.llm_api_base
    elif model.startswith("azure/") and settings.azure_api_base:
        kwargs["api_base"] = settings.azure_api_base

    if model.startswith("azure/"):
        kwargs.setdefault("api_version", settings.azure_api_version)

    # Disable Qwen3 thinking mode — prevents <think> blocks and empty content fields
    if is_ollama:
        kwargs["extra_body"] = {"think": False}

    return kwargs


def chat(messages: list[dict], **overrides) -> str:
    """Synchronous completion. Returns the assistant text (never None)."""
    kwargs = _build_kwargs(**overrides)
    content = litellm.completion(messages=messages, **kwargs).choices[0].message.content
    return content or ""


def chat_with_usage(messages: list[dict], **overrides) -> tuple[str, dict | None]:
    """Synchronous completion — returns (content, usage_dict | None).

    usage_dict keys: input_tokens, output_tokens. Returns None for usage when the
    provider does not report it. Sync counterpart of achat_with_usage(), for the
    (still-synchronous) rule_agent.py call sites.
    """
    kwargs = _build_kwargs(**overrides)
    response = litellm.completion(messages=messages, **kwargs)
    content = response.choices[0].message.content or ""
    usage: dict | None = None
    if hasattr(response, "usage") and response.usage is not None:
        usage = {
            "input_tokens": getattr(response.usage, "prompt_tokens", None),
            "output_tokens": getattr(response.usage, "completion_tokens", None),
        }
    return content, usage


def parse_llm_json(raw: str | None):
    """Parse JSON from an LLM response.

    Handles four common failure modes:
    - Empty / None response (API key wrong, model filtered the request, etc.)
    - Qwen3 / thinking-model <think>...</think> blocks before the JSON answer
    - Markdown code fences (```json ... ```) that many models add despite instructions.
    - Model emits only a thinking block then an empty fence (text empty after stripping).
    """
    import json as _json, re as _re
    if not raw or not raw.strip():
        raise ValueError(
            "LLM returned an empty response. "
            "Check your API key, model name, and provider settings in .env / llm_config.yaml."
        )
    # Strip Qwen3-style thinking blocks  <think>...</think>
    text = _re.sub(r"<think>.*?</think>", "", raw, flags=_re.DOTALL).strip()
    if not text:
        raise ValueError(
            "LLM returned only thinking content with no final JSON answer. "
            "Add /no_think to the system prompt or set OLLAMA_MODEL to a non-thinking variant."
        )
    # Strip ```json ... ``` or ``` ... ``` wrappers
    if text.startswith("```"):
        lines = text.splitlines()
        inner = lines[1:]                               # drop opening fence line
        if inner and inner[-1].strip() == "```":
            inner = inner[:-1]                          # drop closing fence line
        text = "\n".join(inner).strip()

    # Guard: fence stripping may produce an empty string (model emitted empty code block)
    if not text:
        raise ValueError(
            "LLM returned an empty code block. "
            "The model emitted a thinking block followed by an empty fence — no JSON to parse."
        )

    # Try direct parse first; fall back to extracting the first {...} object from prose
    try:
        return _json.loads(text)
    except _json.JSONDecodeError:
        match = _re.search(r"\{.*\}", text, _re.DOTALL)
        if match:
            return _json.loads(match.group())
        raise


def stream_chat(messages: list[dict], **overrides) -> Generator[str, None, None]:
    """Synchronous streaming. Yields text chunks."""
    kwargs = _build_kwargs(stream=True, **overrides)
    for chunk in litellm.completion(messages=messages, **kwargs):
        delta = chunk.choices[0].delta.content
        if delta:
            yield delta


async def achat(messages: list[dict], **overrides) -> str:
    """Async completion."""
    kwargs = _build_kwargs(**overrides)
    response = await litellm.acompletion(messages=messages, **kwargs)
    return response.choices[0].message.content or ""


async def achat_with_usage(messages: list[dict], **overrides) -> tuple[str, dict | None]:
    """Async completion — returns (content, usage_dict | None).

    usage_dict keys: model, input_tokens, output_tokens.
    Returns None for usage when the provider does not report it.
    Keep achat() for callers that only need the text.
    """
    kwargs = _build_kwargs(**overrides)
    response = await litellm.acompletion(messages=messages, **kwargs)
    content = response.choices[0].message.content or ""
    usage: dict | None = None
    if hasattr(response, "usage") and response.usage is not None:
        usage = {
            "model": getattr(response, "model", kwargs.get("model")),
            "input_tokens": getattr(response.usage, "prompt_tokens", None),
            "output_tokens": getattr(response.usage, "completion_tokens", None),
        }
    return content, usage


async def astream_chat(messages: list[dict], **overrides) -> AsyncGenerator[str, None]:
    """Async streaming. Async-yields text chunks."""
    kwargs = _build_kwargs(stream=True, **overrides)
    async for chunk in await litellm.acompletion(messages=messages, **kwargs):
        delta = chunk.choices[0].delta.content
        if delta:
            yield delta
