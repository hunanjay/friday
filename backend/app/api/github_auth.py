import os
import secrets
import time
from urllib.parse import urlencode

import httpx
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import RedirectResponse
from starlette.concurrency import run_in_threadpool

from app.core.security import get_user_id, resolve_user_id
from app.infrastructure.db.repositories.token_store import delete_github_token, set_github_token
from app.tools.github_client import github_get

router = APIRouter(prefix="/api/github", tags=["auth"])

GITHUB_AUTHORIZE_URL = "https://github.com/login/oauth/authorize"
GITHUB_TOKEN_URL = "https://github.com/login/oauth/access_token"

# In-process nonce store: nonce -> (user_id, expires_at).
# The OAuth round-trip is seconds; 5 min TTL is generous.
# ponytail: single-instance deployment (see docker-compose) so a plain dict is
# fine. Multi-worker / multi-instance setups should move this to Redis or a
# one-column Postgres table (nonce TEXT PK, user_id TEXT, expires_at TIMESTAMPTZ).
_TTL_SECONDS = 300
_pending: dict[str, tuple[str, float]] = {}


def _issue_nonce(user_id: str) -> str:
    """Generates a cryptographically random nonce, records it against user_id,
    and prunes any expired entries from the map."""
    nonce = secrets.token_urlsafe(32)
    now = time.monotonic()
    _pending[nonce] = (user_id, now + _TTL_SECONDS)
    # Prune stale entries so the dict doesn't grow unbounded in long-running procs.
    expired = [k for k, (_, exp) in _pending.items() if exp < now]
    for k in expired:
        del _pending[k]
    return nonce


def _redeem_nonce(nonce: str) -> str | None:
    """Looks up a nonce and immediately removes it (one-time use).
    Returns the associated user_id, or None if missing/expired."""
    entry = _pending.pop(nonce, None)
    if entry is None:
        return None
    user_id, expires_at = entry
    return user_id if time.monotonic() < expires_at else None


@router.get("/connect")
async def connect_github(token: str):
    """Redirects the browser into GitHub's own OAuth authorize page - not
    Supabase's. `token` (the caller's Supabase access token) arrives as a
    query param since this is a plain browser navigation, not a fetch() call.

    The token is resolved to a user_id here and then discarded - it is NOT
    forwarded to GitHub. Only a random one-time nonce is sent as `state`, so
    the Supabase JWT never appears in GitHub's logs, the browser history bar
    beyond this server, or nginx access logs past the initial /connect hit.

    # ponytail: the token still arrives in the /connect query string - there is
    no way to avoid this for a browser navigation (headers aren't available).
    The attack surface is therefore limited to: this server's own access log
    (acceptable) and the browser history entry for this URL. Users on shared
    machines should be warned that the history entry for /connect contains their
    session token, but this is a much smaller exposure than leaking it to GitHub.
    """
    user_id = await resolve_user_id(token)
    if not user_id:
        raise HTTPException(status_code=401, detail="Invalid session")
    nonce = _issue_nonce(user_id)
    backend_url = os.environ.get("BACKEND_URL", "http://localhost:8005")
    query = urlencode({
        "client_id": os.environ["GITHUB_CLIENT_ID"],
        "redirect_uri": f"{backend_url}/api/github/callback",
        "scope": "repo",
        "state": nonce,
    })
    return RedirectResponse(f"{GITHUB_AUTHORIZE_URL}?{query}")


@router.get("/callback")
async def github_callback(code: str, state: str):
    """GitHub redirects the user's browser here after they approve access.
    `state` is the nonce /connect issued - redeemed here for the user_id."""
    frontend_url = os.environ.get("FRONTEND_URL", "http://localhost:3005")
    user_id = _redeem_nonce(state)
    if not user_id:
        return RedirectResponse(f"{frontend_url}?github_error=invalid_session")

    backend_url = os.environ.get("BACKEND_URL", "http://localhost:8005")
    async with httpx.AsyncClient() as client:
        resp = await client.post(
            GITHUB_TOKEN_URL,
            headers={"Accept": "application/json"},
            data={
                "client_id": os.environ["GITHUB_CLIENT_ID"],
                "client_secret": os.environ["GITHUB_CLIENT_SECRET"],
                "code": code,
                "redirect_uri": f"{backend_url}/api/github/callback",
            },
        )
    access_token = resp.json().get("access_token")
    if not access_token:
        return RedirectResponse(f"{frontend_url}?github_error=exchange_failed")

    await run_in_threadpool(set_github_token, user_id, access_token)
    return RedirectResponse(frontend_url)


@router.get("/status")
async def github_status(user_id: str = Depends(get_user_id)):
    try:
        me = await github_get(user_id, "/user")
    except HTTPException as exc:
        if exc.status_code == 404:
            return {"connected": False, "expired": False}
        if exc.status_code == 401:
            return {"connected": False, "expired": True}
        raise
    return {
        "connected": True,
        "expired": False,
        "login": me.get("login"),
        "avatar_url": me.get("avatar_url"),
        "name": me.get("name"),
    }


@router.delete("/token")
async def disconnect_github(user_id: str = Depends(get_user_id)):
    await run_in_threadpool(delete_github_token, user_id)
    return {"status": "ok"}
