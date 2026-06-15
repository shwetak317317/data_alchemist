"""
LiteLLM wrapper — all agents call chat() or stream_chat().
Switch model by editing llm_config.yaml — no code changes needed.
"""
import os
from typing import Generator, AsyncGenerator
import litellm
from app.core.config import settings

# Suppress LiteLLM's verbose startup banners
litellm.suppress_debug_info = True


def _build_kwargs() -> dict:
    kwargs = {
        "model": settings.llm_model,
        "max_tokens": settings.llm_max_tokens,
        "temperature": settings.llm_temperature,
    }
    if settings.llm_api_key:
        kwargs["api_key"] = settings.llm_api_key
    if settings.azure_api_base and settings.llm_model.startswith("azure/"):
        kwargs["api_base"] = settings.azure_api_base
        kwargs["api_version"] = settings.azure_api_version
    return kwargs


def chat(messages: list[dict], **overrides) -> str:
    """Synchronous completion. Returns the assistant text."""
    kwargs = {**_build_kwargs(), **overrides}
    response = litellm.completion(messages=messages, **kwargs)
    return response.choices[0].message.content


def stream_chat(messages: list[dict], **overrides) -> Generator[str, None, None]:
    """Synchronous streaming. Yields text chunks."""
    kwargs = {**_build_kwargs(), "stream": True, **overrides}
    for chunk in litellm.completion(messages=messages, **kwargs):
        delta = chunk.choices[0].delta.content
        if delta:
            yield delta


async def achat(messages: list[dict], **overrides) -> str:
    """Async completion."""
    kwargs = {**_build_kwargs(), **overrides}
    response = await litellm.acompletion(messages=messages, **kwargs)
    return response.choices[0].message.content


async def astream_chat(messages: list[dict], **overrides) -> AsyncGenerator[str, None]:
    """Async streaming. Async-yields text chunks."""
    kwargs = {**_build_kwargs(), "stream": True, **overrides}
    async for chunk in await litellm.acompletion(messages=messages, **kwargs):
        delta = chunk.choices[0].delta.content
        if delta:
            yield delta
