from typing import Any

from langchain_openai import ChatOpenAI

from app.core.config import settings


def make_chat_model(*, model: str | None = None, **kwargs: Any) -> ChatOpenAI:
    """Construct every chat model from the active provider profile."""
    if settings.LLM_PROVIDER in {"qwen", "zhipu"} and not settings.OPENAI_API_KEY:
        key_name = f"{settings.LLM_PROVIDER.upper()}_API_KEY"
        raise RuntimeError(f"{key_name} is required when LLM_PROVIDER={settings.LLM_PROVIDER}")
    if not settings.OPENAI_BASE_URL:
        raise RuntimeError(f"No base URL configured for LLM_PROVIDER={settings.LLM_PROVIDER}")

    extra_body = (
        {"enable_thinking": settings.OPENAI_ENABLE_THINKING}
        if settings.OPENAI_ENABLE_THINKING is not None
        else None
    )
    return ChatOpenAI(
        model=model or settings.OPENAI_MODEL,
        api_key=settings.OPENAI_API_KEY or None,
        base_url=settings.OPENAI_BASE_URL or None,
        extra_body=extra_body,
        **kwargs,
    )
