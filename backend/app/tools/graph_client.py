import httpx
from fastapi import HTTPException
from starlette.concurrency import run_in_threadpool

from app.db.token_store import get_ms_token

GRAPH_BASE = "https://graph.microsoft.com/v1.0"

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


async def graph_get(user_id: str, path: str) -> dict:
    ms_token = await run_in_threadpool(get_ms_token, user_id)
    if not ms_token:
        raise HTTPException(status_code=404, detail="No Microsoft account linked")
    resp = await _get_client().get(
        f"{GRAPH_BASE}{path}",
        headers={"Authorization": f"Bearer {ms_token}"},
    )
    if resp.status_code == 401:
        raise HTTPException(status_code=401, detail="Microsoft token expired, please sign in again")
    if resp.status_code >= 400:
        raise HTTPException(status_code=resp.status_code, detail=f"Graph API error: {resp.text}")
    return resp.json()
