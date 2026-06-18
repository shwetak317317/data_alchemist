import os
from functools import lru_cache
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # App
    app_env: str = "development"
    log_level: str = "INFO"

    # Metadata DB
    database_url: str = "postgresql://datatrust:datatrust_pass@localhost:5432/datatrust_meta"

    # Encryption key for stored connector credentials
    encryption_key: str = "change-me-32-chars-secret-key-here"

    # Slack
    slack_webhook_url: str = ""

    # ── LLM provider selection ────────────────────────────────────────────────
    # Set LLM_PROVIDER in .env — all config comes from .env, no yaml file needed.
    # Supported: anthropic | openai | gemini | azure | ollama
    llm_provider: str = ""

    # Generic LLM fields — populated by resolve_provider(), not set directly
    llm_model: str = "claude-sonnet-4-6"
    llm_api_key: str = ""
    llm_api_base: str = ""
    llm_max_tokens: int = 4096
    llm_temperature: float = 0.1

    # ── Per-provider model names (set in .env alongside API key) ─────────────
    anthropic_model_name: str = "claude-sonnet-4-6"
    openai_model_name: str = "gpt-4o"
    gemini_model_name: str = "gemini/gemini-2.0-flash"
    azure_model_name: str = "azure/gpt-4o"

    # ── Provider API keys ─────────────────────────────────────────────────────
    anthropic_api_key: str = ""
    openai_api_key: str = ""
    azure_api_key: str = ""
    azure_api_base: str = ""
    azure_api_version: str = "2024-02-01"
    gemini_api_key: str = ""
    google_api_key: str = ""        # alias — LiteLLM accepts either name

    # ── Ollama / LiteLLM proxy ────────────────────────────────────────────────
    # OLLAMA_BASE_URL points to a LiteLLM proxy server (default port 3300).
    # Calls are routed as  openai/<OLLAMA_MODEL>  through the proxy.
    ollama_base_url: str = "http://localhost:3300"
    ollama_model: str = "qwen3.5:4b"    # model name as registered in the proxy
    ollama_api_key: str = ""            # virtual key issued by the LiteLLM proxy

    # Microsoft Entra ID (Azure AD) SSO
    azure_tenant_id: str = ""
    azure_client_id: str = ""
    azure_redirect_uri: str = "http://localhost"
    azure_domain_hint: str = "pal.tech"

    def resolve_provider(self) -> None:
        """Auto-configure llm_model, llm_api_key, llm_api_base from LLM_PROVIDER."""
        p = self.llm_provider.lower().strip()
        if not p:
            return

        if p == "ollama":
            # LiteLLM proxy requires openai/ prefix; strip it if already present
            model = self.ollama_model.removeprefix("openai/")
            object.__setattr__(self, "llm_model", f"openai/{model}")
            object.__setattr__(self, "llm_api_base", self.ollama_base_url)
            object.__setattr__(self, "llm_api_key", self.ollama_api_key)

        elif p == "gemini":
            object.__setattr__(self, "llm_model", self.gemini_model_name)
            if self.gemini_api_key:
                object.__setattr__(self, "llm_api_key", self.gemini_api_key)

        elif p == "anthropic":
            object.__setattr__(self, "llm_model", self.anthropic_model_name)
            if self.anthropic_api_key:
                object.__setattr__(self, "llm_api_key", self.anthropic_api_key)

        elif p == "openai":
            object.__setattr__(self, "llm_model", self.openai_model_name)
            if self.openai_api_key:
                object.__setattr__(self, "llm_api_key", self.openai_api_key)

        elif p == "azure":
            object.__setattr__(self, "llm_model", self.azure_model_name)
            if self.azure_api_key:
                object.__setattr__(self, "llm_api_key", self.azure_api_key)
            base = self.azure_api_base or self.llm_api_base
            if base:
                object.__setattr__(self, "llm_api_base", base)


@lru_cache
def get_settings() -> Settings:
    s = Settings()
    s.resolve_provider()
    # Fallback: if no api_key resolved, pick the first available provider key
    if not s.llm_api_key:
        for key in (s.anthropic_api_key, s.openai_api_key, s.azure_api_key,
                    s.gemini_api_key, s.google_api_key):
            if key:
                object.__setattr__(s, "llm_api_key", key)
                break
    return s


settings = get_settings()
