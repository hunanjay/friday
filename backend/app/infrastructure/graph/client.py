import asyncio
import logging
import os
import time
from dataclasses import dataclass

import httpx
from fastapi import HTTPException
from starlette.concurrency import run_in_threadpool

from app.infrastructure.db.repositories.token_store import get_ms_token, get_ms_token_row, set_ms_token

logger = logging.getLogger(__name__)

GRAPH_BASE = "https://graph.microsoft.com/v1.0"
MS_TOKEN_URL = "https://login.microsoftonline.com/common/oauth2/v2.0/token"

# Transient failures (rate limiting, upstream hiccups) - retry a couple times
# before giving up, instead of making the LLM decide whether to try again.
# Retrying is only safe for GET: for POST/PATCH/DELETE a network error or 5xx
# doesn't tell us whether Graph already applied the mutation before the
# response was lost, so a blind retry could send a second email or delete
# twice. Writes fail fast instead and surface as an error the HITL flow can
# mark "failed" for reconciliation, rather than silently double-executing.
_RETRYABLE_STATUS = {429, 502, 503, 504}
_SAFE_RETRY_METHODS = {"GET"}
_MAX_ATTEMPTS = 3

_client: httpx.AsyncClient | None = None
_MS_TOKEN_CACHE_TTL_SECONDS = 300
_MS_TOKEN_CACHE_MAX_ENTRIES = 1024
_ms_token_cache: dict[str, tuple[float, str]] = {}
# ponytail: unbounded per-user lock map, fine for a self-hosted personal
# deployment; add eviction if the user pool ever grows large.
_refresh_locks: dict[str, asyncio.Lock] = {}


def _get_refresh_lock(user_id: str) -> asyncio.Lock:
    lock = _refresh_locks.get(user_id)
    if lock is None:
        lock = asyncio.Lock()
        _refresh_locks[user_id] = lock
    return lock


@dataclass(frozen=True)
class GraphBinaryResponse:
    content: bytes
    content_type: str
    content_disposition: str | None


def cache_ms_token(user_id: str, token: str) -> None:
    now = time.monotonic()
    if len(_ms_token_cache) >= _MS_TOKEN_CACHE_MAX_ENTRIES:
        expired = [key for key, (expires_at, _) in _ms_token_cache.items() if expires_at <= now]
        for key in expired:
            _ms_token_cache.pop(key, None)
        if len(_ms_token_cache) >= _MS_TOKEN_CACHE_MAX_ENTRIES:
            oldest_key = min(_ms_token_cache, key=lambda key: _ms_token_cache[key][0])
            _ms_token_cache.pop(oldest_key, None)
    _ms_token_cache[user_id] = (now + _MS_TOKEN_CACHE_TTL_SECONDS, token)


def _get_cached_ms_token(user_id: str) -> str | None:
    entry = _ms_token_cache.get(user_id)
    if not entry:
        return None
    expires_at, token = entry
    if expires_at <= time.monotonic():
        _ms_token_cache.pop(user_id, None)
        return None
    return token


def invalidate_ms_token(user_id: str, expected_token: str | None = None) -> None:
    entry = _ms_token_cache.get(user_id)
    if entry and (expected_token is None or entry[1] == expected_token):
        _ms_token_cache.pop(user_id, None)


def _get_client() -> httpx.AsyncClient:
    global _client
    if _client is None:
        # Graph supports HTTP/2. Keeping one shared client avoids a fresh TLS
        # connection for each attachment request and allows multiplexing when
        # the UI loads metadata and content concurrently.
        _client = httpx.AsyncClient(http2=True)
    return _client


async def aclose_client() -> None:
    global _client
    if _client is not None:
        await _client.aclose()
        _client = None
    _ms_token_cache.clear()


async def refresh_ms_token(user_id: str) -> str | None:
    row = await run_in_threadpool(get_ms_token_row, user_id)
    if not row or not row.get("refresh_token"):
        return None
    client_id = os.environ.get("AZURE_CLIENT_ID")
    client_secret = os.environ.get("AZURE_CLIENT_SECRET")
    if not client_id or not client_secret:
        return None

    resp = await _get_client().post(
        MS_TOKEN_URL,
        data={
            "client_id": client_id,
            "client_secret": client_secret,
            "grant_type": "refresh_token",
            "refresh_token": row["refresh_token"],
            "scope": "openid email profile offline_access Mail.ReadWrite Mail.Send Calendars.ReadWrite Contacts.ReadWrite",
        },
    )
    if resp.status_code >= 400:
        return None
    data = resp.json()
    await run_in_threadpool(
        set_ms_token, user_id, data["access_token"], data.get("refresh_token"), data.get("expires_in")
    )
    cache_ms_token(user_id, data["access_token"])
    return data["access_token"]


async def _graph_request(
    user_id: str,
    method: str,
    path: str,
    json: dict | None = None,
    extra_headers: dict | None = None,
    return_binary: bool = False,
) -> dict | GraphBinaryResponse | None:
    request_started = time.perf_counter()
    token_started = time.perf_counter()
    ms_token = _get_cached_ms_token(user_id)
    token_source = "memory_cache"
    if not ms_token:
        token_source = "supabase"
        ms_token = await run_in_threadpool(get_ms_token, user_id)
        if ms_token:
            cache_ms_token(user_id, ms_token)
    token_duration_ms = (time.perf_counter() - token_started) * 1000
    if not ms_token:
        raise HTTPException(status_code=404, detail="No Microsoft account linked")

    url = path if path.startswith("http") else f"{GRAPH_BASE}{path}"

    upstream_duration_ms = 0.0
    attempts = 0

    async def _call(token: str) -> httpx.Response:
        nonlocal upstream_duration_ms, attempts
        headers = {"Authorization": f"Bearer {token}", **(extra_headers or {})}
        attempts += 1
        upstream_started = time.perf_counter()
        try:
            return await _get_client().request(method, url, headers=headers, json=json)
        finally:
            upstream_duration_ms += (time.perf_counter() - upstream_started) * 1000

    safe_path = url.split("?", 1)[0].removeprefix(GRAPH_BASE)
    for attempt in range(1, _MAX_ATTEMPTS + 1):
        try:
            resp = await _call(ms_token)
        except (httpx.TimeoutException, httpx.NetworkError):
            if method not in _SAFE_RETRY_METHODS or attempt == _MAX_ATTEMPTS:
                logger.exception(
                    "graph.http method=%s path=%s status=network_error token_source=%s "
                    "token_ms=%.1f upstream_ms=%.1f total_ms=%.1f attempts=%d",
                    method,
                    safe_path,
                    token_source,
                    token_duration_ms,
                    upstream_duration_ms,
                    (time.perf_counter() - request_started) * 1000,
                    attempts,
                )
                raise
            await asyncio.sleep(0.5 * 2 ** (attempt - 1))
            continue
        if (
            resp.status_code in _RETRYABLE_STATUS
            and method in _SAFE_RETRY_METHODS
            and attempt < _MAX_ATTEMPTS
        ):
            retry_after = resp.headers.get("Retry-After")
            delay = float(retry_after) if retry_after else 0.5 * 2 ** (attempt - 1)
            await asyncio.sleep(delay)
            continue
        break
    if resp.status_code == 401:
        invalidate_ms_token(user_id, ms_token)
        refresh_started = time.perf_counter()
        # Azure AD rotates refresh tokens on use, so concurrent 401s (e.g. the
        # frontend's parallel inbox/calendar/status fetches) must not each call
        # refresh_ms_token with the same now-stale refresh_token - only the
        # first would succeed and the rest would wrongly report the user as
        # logged out. Serialize per user, and let waiters reuse whatever the
        # lock holder already cached instead of refreshing again.
        async with _get_refresh_lock(user_id):
            refreshed = _get_cached_ms_token(user_id)
            if not refreshed:
                refreshed = await refresh_ms_token(user_id)
        token_duration_ms += (time.perf_counter() - refresh_started) * 1000
        token_source = "refresh"
        if not refreshed:
            raise HTTPException(status_code=401, detail="Microsoft token expired, please sign in again")
        resp = await _call(refreshed)
        if resp.status_code == 401:
            raise HTTPException(status_code=401, detail="Microsoft token expired, please sign in again")

    logger.info(
        "graph.http method=%s path=%s status=%d token_source=%s token_ms=%.1f "
        "upstream_ms=%.1f total_ms=%.1f attempts=%d response_bytes=%d",
        method,
        safe_path,
        resp.status_code,
        token_source,
        token_duration_ms,
        upstream_duration_ms,
        (time.perf_counter() - request_started) * 1000,
        attempts,
        len(resp.content),
    )
    if resp.status_code >= 400:
        raise HTTPException(status_code=resp.status_code, detail=f"Graph API error: {resp.text}")
    if return_binary:
        return GraphBinaryResponse(
            content=resp.content,
            content_type=resp.headers.get("content-type", "application/octet-stream"),
            content_disposition=resp.headers.get("content-disposition"),
        )
    return resp.json() if resp.content else None


async def graph_get(user_id: str, path: str, extra_headers: dict | None = None) -> dict:
    return await _graph_request(user_id, "GET", path, extra_headers=extra_headers)


async def graph_get_binary(user_id: str, path: str) -> GraphBinaryResponse:
    return await _graph_request(user_id, "GET", path, return_binary=True)


async def graph_get_paginated(user_id: str, path: str, max_count: int) -> dict:
    items: list = []
    next_path: str | None = path
    while next_path and len(items) < max_count:
        page = await _graph_request(user_id, "GET", next_path)
        items.extend(page.get("value", []))
        next_path = page.get("@odata.nextLink")
    return {"value": items[:max_count]}


async def graph_post(user_id: str, path: str, json: dict) -> dict | None:
    return await _graph_request(user_id, "POST", path, json=json)


async def graph_patch(user_id: str, path: str, json: dict) -> dict | None:
    return await _graph_request(user_id, "PATCH", path, json=json)


async def graph_delete(user_id: str, path: str) -> None:
    await _graph_request(user_id, "DELETE", path)
