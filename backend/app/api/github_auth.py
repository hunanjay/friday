from fastapi import APIRouter, Depends, HTTPException
from starlette.concurrency import run_in_threadpool

from app.db.supabase_client import get_user_id
from app.db.token_store import set_github_token
from app.tools.github_client import github_get

router = APIRouter(prefix="/api/github", tags=["auth"])


@router.post("/token")
async def store_github_token(body: dict, user_id: str = Depends(get_user_id)):
    github_token = body.get("github_token")
    if not github_token:
        raise HTTPException(status_code=400, detail="github_token is required")
    await run_in_threadpool(set_github_token, user_id, github_token)
    return {"status": "ok"}


@router.get("/status")
async def github_status(user_id: str = Depends(get_user_id)):
    try:
        await github_get(user_id, "/user")
    except HTTPException as exc:
        if exc.status_code == 404:
            return {"connected": False, "expired": False}
        if exc.status_code == 401:
            return {"connected": False, "expired": True}
        raise
    return {"connected": True, "expired": False}
