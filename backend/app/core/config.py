import os
import yaml
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

    # LLM — loaded from llm_config.yaml, overridable via env
    llm_config_path: str = "llm_config.yaml"
    llm_model: str = "claude-sonnet-4-6"
    llm_api_key: str = ""
    llm_max_tokens: int = 4096
    llm_temperature: float = 0.1

    # Provider API keys (picked up by LiteLLM automatically via env)
    anthropic_api_key: str = ""
    openai_api_key: str = ""
    azure_api_key: str = ""
    azure_api_base: str = ""
    azure_api_version: str = "2024-02-01"

    # Microsoft Entra ID (Azure AD) SSO
    azure_tenant_id: str = ""         # pal.tech Azure AD tenant GUID
    azure_client_id: str = ""         # App Registration client ID
    azure_redirect_uri: str = "http://localhost"
    azure_domain_hint: str = "pal.tech"  # restricts Microsoft login to pal.tech accounts

    def load_llm_config(self) -> None:
        path = self.llm_config_path
        if not os.path.exists(path):
            return
        with open(path) as f:
            cfg = yaml.safe_load(f) or {}
        if "model" in cfg:
            object.__setattr__(self, "llm_model", cfg["model"])
        if "max_tokens" in cfg:
            object.__setattr__(self, "llm_max_tokens", cfg["max_tokens"])
        if "temperature" in cfg:
            object.__setattr__(self, "llm_temperature", cfg["temperature"])
        # Resolve API key from the named env var
        key_env = cfg.get("api_key_env", "")
        if key_env and os.getenv(key_env):
            object.__setattr__(self, "llm_api_key", os.getenv(key_env))


@lru_cache
def get_settings() -> Settings:
    s = Settings()
    s.load_llm_config()
    # If no explicit llm_api_key, fall back to provider-specific env vars
    if not s.llm_api_key:
        for key in (s.anthropic_api_key, s.openai_api_key, s.azure_api_key):
            if key:
                object.__setattr__(s, "llm_api_key", key)
                break
    return s


settings = get_settings()
