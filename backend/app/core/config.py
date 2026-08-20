import os
from collections.abc import Mapping
from dataclasses import dataclass
from functools import lru_cache

from pydantic import BaseModel


@dataclass(frozen=True)
class LLMProviderConfig:
    provider: str
    api_key: str
    base_url: str
    model: str
    enable_thinking: bool | None
    embedding_model: str
    embedding_base_url: str
    embedding_api_key: str


def resolve_llm_provider(environ: Mapping[str, str] | None = None) -> LLMProviderConfig:
    env = os.environ if environ is None else environ
    provider = env.get("LLM_PROVIDER", "custom").strip().lower()
    legacy_base = env.get("OPENAI_BASE_URL", "")
    legacy_key = env.get("OPENAI_API_KEY", "")

    if provider == "qwen":
        matching_legacy = "maas.aliyuncs.com" in legacy_base
        base_url = env.get("QWEN_BASE_URL") or (legacy_base if matching_legacy else "")
        api_key = env.get("QWEN_API_KEY") or (legacy_key if matching_legacy else "")
        return LLMProviderConfig(
            provider=provider,
            api_key=api_key,
            base_url=base_url,
            model=env.get("QWEN_MODEL") or "qwen3.6-flash",
            enable_thinking=False,
            embedding_model=env.get("QWEN_EMBEDDING_MODEL") or "qwen3.7-text-embedding",
            embedding_base_url=env.get("QWEN_EMBEDDING_BASE_URL") or base_url,
            embedding_api_key=env.get("QWEN_EMBEDDING_API_KEY") or api_key,
        )

    if provider == "zhipu":
        matching_legacy = "bigmodel.cn" in legacy_base
        base_url = env.get("ZHIPU_BASE_URL") or (
            legacy_base if matching_legacy else "https://open.bigmodel.cn/api/paas/v4/"
        )
        api_key = env.get("ZHIPU_API_KEY") or (legacy_key if matching_legacy else "")
        return LLMProviderConfig(
            provider=provider,
            api_key=api_key,
            base_url=base_url,
            model=env.get("ZHIPU_MODEL") or "glm-4-flash",
            enable_thinking=None,
            embedding_model=env.get("ZHIPU_EMBEDDING_MODEL") or "embedding-3",
            embedding_base_url=env.get("ZHIPU_EMBEDDING_BASE_URL") or base_url,
            embedding_api_key=env.get("ZHIPU_EMBEDDING_API_KEY") or api_key,
        )

    if provider != "custom":
        raise ValueError("LLM_PROVIDER must be one of: qwen, zhipu, custom")

    thinking_value = env.get("OPENAI_ENABLE_THINKING", "").strip().lower()
    return LLMProviderConfig(
        provider=provider,
        api_key=legacy_key,
        base_url=legacy_base or "https://api.openai.com/v1",
        model=env.get("OPENAI_MODEL") or "gpt-4o-mini",
        enable_thinking=None if not thinking_value else thinking_value == "true",
        embedding_model=env.get("EMBEDDING_MODEL") or "text-embedding-3-large",
        embedding_base_url=env.get("EMBEDDING_BASE_URL") or legacy_base,
        embedding_api_key=env.get("EMBEDDING_API_KEY") or legacy_key,
    )


_llm = resolve_llm_provider()


class Settings(BaseModel):
    # App
    ENV: str = os.getenv("ENV", "development")
    LOG_LEVEL: str = os.getenv("LOG_LEVEL", "INFO")
    FRONTEND_URL: str = os.getenv("FRONTEND_URL", "http://localhost:3005")

    # Supabase / DB
    SUPABASE_URL: str = os.getenv("SUPABASE_URL", "")
    SUPABASE_ANON_KEY: str = os.getenv("SUPABASE_ANON_KEY", "")
    SUPABASE_SERVICE_ROLE_KEY: str = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")
    DATABASE_URL: str = os.getenv("DATABASE_URL", "")

    # LLM provider profile. Existing OPENAI_* variables remain the custom
    # profile and a migration fallback when they already match the selected
    # provider's host.
    LLM_PROVIDER: str = _llm.provider
    OPENAI_API_KEY: str = _llm.api_key
    OPENAI_BASE_URL: str = _llm.base_url
    OPENAI_MODEL: str = _llm.model
    OPENAI_ENABLE_THINKING: bool | None = _llm.enable_thinking
    DRAFT_MODEL: str = os.getenv("DRAFT_MODEL", _llm.model)
    VISION_MODEL: str = os.getenv("VISION_MODEL", _llm.model)
    EMBEDDING_MODEL: str = _llm.embedding_model
    EMBEDDING_BASE_URL: str = _llm.embedding_base_url
    EMBEDDING_API_KEY: str = _llm.embedding_api_key
    EMBEDDING_DIMENSIONS: int = int(os.getenv("EMBEDDING_DIMENSIONS", "1536"))

    # Qdrant Vector Store
    QDRANT_HOST: str = os.getenv("QDRANT_HOST", "localhost")
    QDRANT_PORT: int = int(os.getenv("QDRANT_PORT", "6333"))

    # GitHub OAuth
    GITHUB_CLIENT_ID: str = os.getenv("GITHUB_CLIENT_ID", "")
    GITHUB_CLIENT_SECRET: str = os.getenv("GITHUB_CLIENT_SECRET", "")

    # Dev-only escape hatch: skip the SSRF host check when binding mail accounts.
    # Some local proxies (Clash/Surge Fake-IP mode) resolve real domains into
    # 198.18.0.0/15, which the checker correctly rejects as reserved - this lets
    # you test the mail-binding flow through such a proxy. Never set in prod.
    MAIL_SSRF_CHECK_DISABLED: bool = os.getenv("MAIL_SSRF_CHECK_DISABLED", "false").lower() == "true"


@lru_cache()
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
