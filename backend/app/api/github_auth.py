import os
from urllib.parse import urlencode

import httpx
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import RedirectResponse
from starlette.concurrency import run_in_threadpool

from app.db.supabase_client import get_user_id, resolve_user_id
from app.db.token_store import delete_github_token, set_github_token
from app.tools.github_client import github_get

router = APIRouter(prefix="/api/github", tags=["auth"])

GITHUB_AUTHORIZE_URL = "https://github.com/login/oauth/authorize"
GITHUB_TOKEN_URL = "https://github.com/login/oauth/access_token"


@router.get("/connect")
async def connect_github(token: str):
    """Redirects the browser into GitHub's own OAuth authorize page - not
    Supabase's. `token` (the caller's Supabase access token) arrives as a
    query param, not a header, since this is a plain browser navigation, not
    a fetch() call. It's round-tripped back to us as `state` so /callback
    knows which user this is, without needing a server-side session store.

    # ponytail: Supabase's linkIdentity() looked like the natural fit here,
    but it only verifies a second identity for login purposes - it doesn't
    hand back a usable GitHub API token via session.provider_token the way
    signInWithOAuth does for the primary provider. Confirmed by inspecting a
    captured "GitHub" token that was actually Microsoft-shaped. This raw
    OAuth flow talks to GitHub directly instead.
    """
    user_id = await resolve_user_id(token)
    if not user_id:
        raise HTTPException(status_code=401, detail="Invalid session")
    backend_url = os.environ.get("BACKEND_URL", "http://localhost:8005")
    query = urlencode({
        "client_id": os.environ["GITHUB_CLIENT_ID"],
        "redirect_uri": f"{backend_url}/api/github/callback",
        "scope": "repo",
        "state": token,
    })
    return RedirectResponse(f"{GITHUB_AUTHORIZE_URL}?{query}")


@router.get("/callback")
async def github_callback(code: str, state: str):
    """GitHub redirects the user's browser here after they approve access.
    `state` is the same Supabase JWT /connect embedded - resolved back to a
    user id so we know whose github_tokens row to write."""
    frontend_url = os.environ.get("FRONTEND_URL", "http://localhost:3005")
    user_id = await resolve_user_id(state)
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
