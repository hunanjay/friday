"""Aggregate usage stats for whoever operates this deployment.

Every other route in this API is scoped to the caller's own user_id. This one
is not - it reports across all users - so it is gated on an explicit
ADMIN_USER_IDS allowlist that is empty by default.
"""

import logging
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
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


def _count_registered(days: int) -> dict:
    """Registration counts from Supabase.

    auth.users lives in the Supabase project, not in this backend's Postgres
    (CHECKPOINT_DB_URL), and PostgREST does not expose the auth schema - so
    the admin API is the only way to count sign-ups. Synchronous client, so
    call this in a threadpool.
    """
    since = datetime.now(timezone.utc) - timedelta(days=days)
    total = 0
    new_in_window = 0
    truncated = True
    for page in range(1, _MAX_USER_PAGES + 1):
        users = supabase_admin.auth.admin.list_users(page=page, per_page=_USER_PAGE_SIZE)
        total += len(users)
        for user in users:
            created_at = getattr(user, "created_at", None)
            if created_at and created_at.tzinfo and created_at > since:
                new_in_window += 1
        if len(users) < _USER_PAGE_SIZE:
            truncated = False
            break
    return {"total": total, "new_in_window": new_in_window, "truncated": truncated}


@router.get("")
async def stats(days: int = Query(7, ge=1, le=365), _: str = Depends(require_admin)):
    """Usage over the last `days`.

    `users.registered` is null when Supabase's admin API is unreachable or
    SUPABASE_SERVICE_ROLE_KEY is unset - the local activity numbers are still
    returned rather than failing the whole response. dau/wau/mau keep their
    conventional 1/7/30-day windows and ignore `days`.
    """
    try:
        registered = await run_in_threadpool(_count_registered, days)
    except Exception:
        logger.exception("Supabase admin user listing failed")
        registered = None

    return {
        "window_days": days,
        "users": {"registered": registered, **await agent_runs.active_users()},
        "agent": await agent_runs.agent_stats(days),
        "hitl": await agent_runs.hitl_stats(days),
    }
