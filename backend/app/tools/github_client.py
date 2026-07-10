import httpx
from fastapi import HTTPException
from starlette.concurrency import run_in_threadpool

from app.db.token_store import get_github_token

GITHUB_BASE = "https://api.github.com"

# Reused across requests so calls to GitHub aren't paying a fresh TCP+TLS
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


async def github_get(user_id: str, path: str) -> dict | list:
    """GitHub OAuth App user tokens (via Supabase's github provider) don't
    expire and have no refresh_token, so - unlike graph_client.py - there's
    no refresh-and-retry dance here: a 401 means the user revoked access and
    needs to reconnect, full stop."""
    token = await run_in_threadpool(get_github_token, user_id)
    if not token:
        raise HTTPException(status_code=404, detail="No GitHub account linked")

    resp = await _get_client().get(
        f"{GITHUB_BASE}{path}",
        headers={
            "Authorization": f"Bearer {token}",
            "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
        },
    )
    if resp.status_code == 401:
        raise HTTPException(status_code=401, detail="GitHub token invalid or revoked, reconnect GitHub")
    if resp.status_code >= 400:
        raise HTTPException(status_code=resp.status_code, detail=f"GitHub API error: {resp.text}")
    return resp.json()
