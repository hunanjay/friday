import os

from fastapi import Header, HTTPException
from starlette.concurrency import run_in_threadpool
from supabase import create_client

supabase = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_ANON_KEY"])

# service_role bypasses RLS - only ever used server-side (e.g. ms_tokens table),
# never exposed to the frontend.
supabase_admin = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_ROLE_KEY"])


async def resolve_user_id(token: str) -> str | None:
    """Resolves a Supabase session JWT to a user id, or None if invalid."""
    try:
        user = await run_in_threadpool(supabase.auth.get_user, token)
    except Exception:
        user = None
    return user.user.id if user else None


async def get_user_id(authorization: str = Header(...)) -> str:
    """FastAPI dependency: resolves the caller's Supabase user id from their session JWT."""
    token = authorization.removeprefix("Bearer ").strip()
    user_id = await resolve_user_id(token)
    if not user_id:
        raise HTTPException(status_code=401, detail="Invalid session")
    return user_id
