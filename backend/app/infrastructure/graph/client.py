import os
import time
import httpx
from fastapi import HTTPException
from starlette.concurrency import run_in_threadpool

from app.infrastructure.db.repositories.token_store import get_ms_token, get_ms_token_row, set_ms_token

GRAPH_BASE = "https://graph.microsoft.com/v1.0"
MS_TOKEN_URL = "https://login.microsoftonline.com/common/oauth2/v2.0/token"

_client: httpx.AsyncClient | None = None
_MS_TOKEN_CACHE_TTL_SECONDS = 300
_MS_TOKEN_CACHE_MAX_ENTRIES = 1024
_ms_token_cache: dict[str, tuple[float, str]] = {}


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
        _client = httpx.AsyncClient()
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
            "scope": "openid email profile offline_access Mail.ReadWrite Mail.Send Calendars.ReadWrite",
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
    user_id: str, method: str, path: str, json: dict | None = None, extra_headers: dict | None = None
) -> dict | None:
    ms_token = _get_cached_ms_token(user_id)
    if not ms_token:
        ms_token = await run_in_threadpool(get_ms_token, user_id)
        if ms_token:
            cache_ms_token(user_id, ms_token)
    if not ms_token:
        raise HTTPException(status_code=404, detail="No Microsoft account linked")

    url = path if path.startswith("http") else f"{GRAPH_BASE}{path}"

    async def _call(token: str) -> httpx.Response:
        headers = {"Authorization": f"Bearer {token}", **(extra_headers or {})}
        return await _get_client().request(method, url, headers=headers, json=json)

    resp = await _call(ms_token)
    if resp.status_code == 401:
        invalidate_ms_token(user_id, ms_token)
        refreshed = await refresh_ms_token(user_id)
        if not refreshed:
            raise HTTPException(status_code=401, detail="Microsoft token expired, please sign in again")
        resp = await _call(refreshed)
        if resp.status_code == 401:
            raise HTTPException(status_code=401, detail="Microsoft token expired, please sign in again")
    if resp.status_code >= 400:
        raise HTTPException(status_code=resp.status_code, detail=f"Graph API error: {resp.text}")
    return resp.json() if resp.content else None


async def graph_get(user_id: str, path: str, extra_headers: dict | None = None) -> dict:
    return await _graph_request(user_id, "GET", path, extra_headers=extra_headers)


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
