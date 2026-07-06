import os

import httpx
from fastapi import HTTPException
from starlette.concurrency import run_in_threadpool

from app.db.token_store import get_ms_token, get_ms_token_row, set_ms_token

GRAPH_BASE = "https://graph.microsoft.com/v1.0"
MS_TOKEN_URL = "https://login.microsoftonline.com/common/oauth2/v2.0/token"

# Reused across requests so calls to Graph aren't paying a fresh TCP+TLS
# handshake every time. Closed in main.py's lifespan on shutdown.
_client: httpx.AsyncClient | None = None


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


async def refresh_ms_token(user_id: str) -> str | None:
    """Exchanges the stored MS refresh_token for a new access token. Returns
    the new access token, or None if there's nothing to refresh with or
    Microsoft rejects it (refresh_token itself expired/revoked)."""
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
            "scope": "openid email profile offline_access Mail.Read Calendars.Read",
        },
    )
    if resp.status_code >= 400:
        return None
    data = resp.json()
    await run_in_threadpool(
        set_ms_token, user_id, data["access_token"], data.get("refresh_token"), data.get("expires_in")
    )
    return data["access_token"]


async def _graph_request(user_id: str, method: str, path: str, json: dict | None = None) -> dict | None:
    ms_token = await run_in_threadpool(get_ms_token, user_id)
    if not ms_token:
        raise HTTPException(status_code=404, detail="No Microsoft account linked")

    def _call(token: str) -> httpx.Response:
        return _get_client().request(method, f"{GRAPH_BASE}{path}", headers={"Authorization": f"Bearer {token}"}, json=json)

    resp = await _call(ms_token)
    if resp.status_code == 401:
        refreshed = await refresh_ms_token(user_id)
        if not refreshed:
            raise HTTPException(status_code=401, detail="Microsoft token expired, please sign in again")
        resp = await _call(refreshed)
        if resp.status_code == 401:
            raise HTTPException(status_code=401, detail="Microsoft token expired, please sign in again")
    if resp.status_code >= 400:
        raise HTTPException(status_code=resp.status_code, detail=f"Graph API error: {resp.text}")
    return resp.json() if resp.content else None


async def graph_get(user_id: str, path: str) -> dict:
    return await _graph_request(user_id, "GET", path)


async def graph_post(user_id: str, path: str, json: dict) -> dict | None:
    return await _graph_request(user_id, "POST", path, json=json)


async def graph_delete(user_id: str, path: str) -> None:
    await _graph_request(user_id, "DELETE", path)
