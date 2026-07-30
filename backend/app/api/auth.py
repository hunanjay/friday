from fastapi import APIRouter, Depends, HTTPException
from starlette.concurrency import run_in_threadpool

from app.core.security import get_user_id
from app.infrastructure.db.repositories.token_store import set_ms_token
from app.tools.graph_client import cache_ms_token, graph_get, refresh_ms_token

router = APIRouter(prefix="/api/graph", tags=["auth"])


@router.post("/token")
async def store_graph_token(body: dict, user_id: str = Depends(get_user_id)):
    ms_token = body.get("ms_token")
    if not ms_token:
        raise HTTPException(status_code=400, detail="ms_token is required")
    await run_in_threadpool(
        set_ms_token, user_id, ms_token, body.get("refresh_token"), body.get("expires_in")
    )
    cache_ms_token(user_id, ms_token)
    return {"status": "ok"}


@router.post("/refresh")
async def refresh_graph_token(user_id: str = Depends(get_user_id)):
    refreshed = await refresh_ms_token(user_id)
    if not refreshed:
        raise HTTPException(status_code=401, detail="Microsoft token expired, please sign in again")
    return {"status": "ok"}


@router.get("/status")
async def graph_status(user_id: str = Depends(get_user_id)):
    # Reuses graph_get's own refresh-and-retry: a real Graph call is the
    # only reliable way to know the token still works. Uses a mail endpoint
    # (not /me) since the app registration only has Mail.Read/Calendars.Read
    # consented, not User.Read.
    try:
        await graph_get(user_id, "/me/mailFolders/inbox/messages?$top=1")
    except HTTPException as exc:
        if exc.status_code == 404:
            return {"connected": False, "expired": False}
        if exc.status_code == 401:
            return {"connected": False, "expired": True}
        raise
    return {"connected": True, "expired": False}
