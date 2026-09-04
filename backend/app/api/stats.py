"""Registered user total and agent call counts for deployment operators.

Every other route in this API is scoped to the caller's own user_id. This one
is not - it reports across all users - so it is gated on an explicit
ADMIN_USER_IDS allowlist that is empty by default.
"""

import logging

from fastapi import APIRouter, Depends, HTTPException
from starlette.concurrency import run_in_threadpool

from app.core.config import settings
from app.core.security import get_user_id, supabase_admin
from app.infrastructure.db.repositories import agent_runs

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/stats", tags=["stats"])

_USER_PAGE_SIZE = 1000
_MAX_USER_PAGES = 20


async def require_admin(user_id: str = Depends(get_user_id)) -> str:
    admins = {entry.strip() for entry in settings.ADMIN_USER_IDS.split(",") if entry.strip()}
    # An unset allowlist denies everyone: an all-user view must fail closed.
    if user_id not in admins:
        raise HTTPException(status_code=403, detail="Not permitted")
    return user_id


def _count_registered() -> dict:
    """Registration counts from Supabase.

    auth.users lives in the Supabase project, not in this backend's Postgres
    (CHECKPOINT_DB_URL), and PostgREST does not expose the auth schema - so
    the admin API is the only way to count sign-ups. Synchronous client, so
    call this in a threadpool.
    """
    total = 0
    truncated = True
    for page in range(1, _MAX_USER_PAGES + 1):
        users = supabase_admin.auth.admin.list_users(page=page, per_page=_USER_PAGE_SIZE)
        total += len(users)
        if len(users) < _USER_PAGE_SIZE:
            truncated = False
            break
    return {"total": total, "truncated": truncated}


@router.get("")
async def stats(_: str = Depends(require_admin)):
    """Return registered users and all-time handled turns by agent.

    `users.registered` is null when Supabase's admin API is unreachable or
    SUPABASE_SERVICE_ROLE_KEY is unset.
    """
    try:
        registered = await run_in_threadpool(_count_registered)
    except Exception:
        logger.exception("Supabase admin user listing failed")
        registered = None

    try:
        agent_counts = await agent_runs.agent_call_counts()
    except Exception:
        logger.exception("Agent call count query failed")
        agent_counts = None

    return {
        "users": {"registered": registered},
        "agents": {"by_agent": agent_counts},
    }
