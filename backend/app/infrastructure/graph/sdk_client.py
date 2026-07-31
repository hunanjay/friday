import logging
import time
from collections.abc import Awaitable
from typing import TypeVar

from azure.core.credentials import AccessToken
from azure.core.credentials_async import AsyncTokenCredential
from msgraph import GraphServiceClient
from fastapi import HTTPException
from starlette.concurrency import run_in_threadpool

from app.infrastructure.graph.client import (
    _get_cached_ms_token,
    get_ms_token,
    cache_ms_token,
    refresh_ms_token,
)

logger = logging.getLogger(__name__)
T = TypeVar("T")


async def timed_graph_sdk_call(operation: str, request: Awaitable[T]) -> T:
    """Log one SDK request without exposing Graph IDs, tokens, or payloads."""
    started = time.perf_counter()
    try:
        result = await request
    except Exception:
        logger.exception(
            "graph.sdk.request operation=%s status=error duration_ms=%.1f",
            operation,
            (time.perf_counter() - started) * 1000,
        )
        raise

    logger.info(
        "graph.sdk.request operation=%s status=ok duration_ms=%.1f",
        operation,
        (time.perf_counter() - started) * 1000,
    )
    return result


class FridayTokenCredential(AsyncTokenCredential):
    """
    Adapter that bridges our existing database/cache token management
    into the official Azure SDK AsyncTokenCredential interface.
    """
    def __init__(self, user_id: str):
        self.user_id = user_id

    async def get_token(self, *scopes: str, **kwargs) -> AccessToken:
        started = time.perf_counter()
        ms_token = _get_cached_ms_token(self.user_id)
        token_source = "memory_cache"
        if not ms_token:
            token_source = "supabase"
            ms_token = await run_in_threadpool(get_ms_token, self.user_id)
            if ms_token:
                cache_ms_token(self.user_id, ms_token)

        # If we still have no token, we can't proceed
        if not ms_token:
            raise HTTPException(status_code=404, detail="No Microsoft account linked")

        # The SDK expects an AccessToken with an expiry time.
        # Since we handle refreshing via our own interceptor logic (or the token cache TTL),
        # we'll provide a nominal expiry in the future to satisfy the SDK's checks.
        expires_on = int(time.time()) + 3600

        logger.info(
            "graph.sdk.token source=%s duration_ms=%.1f",
            token_source,
            (time.perf_counter() - started) * 1000,
        )
        return AccessToken(ms_token, expires_on)

    async def close(self) -> None:
        pass


def get_graph_sdk_client(user_id: str) -> GraphServiceClient:
    """
    Returns an authenticated Microsoft Graph SDK client for the given user.
    """
    started = time.perf_counter()
    cred = FridayTokenCredential(user_id)
    scopes = ["https://graph.microsoft.com/.default"]
    client = GraphServiceClient(credentials=cred, scopes=scopes)
    logger.info(
        "graph.sdk.client action=create duration_ms=%.1f",
        (time.perf_counter() - started) * 1000,
    )
    return client
