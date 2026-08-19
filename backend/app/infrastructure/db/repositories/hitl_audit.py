"""Durable state for LangChain HITL approvals and their presentation cards.

LangGraph checkpoints remain the source of the pending interrupt and the only
way to resume execution.  This table adds an application-level, atomic claim
around that resume so two backend replicas cannot execute the same approval.
It also keeps terminal cards visible after refresh.
"""

import json
import os
from datetime import datetime

from app.infrastructure.db.pool import get_pool

HITL_ACTION_TTL_SECONDS = int(os.environ.get("HITL_ACTION_TTL_SECONDS", "86400"))
TERMINAL_STATUSES = {"succeeded", "failed", "cancelled", "expired"}

_SCHEMA = """
create table if not exists hitl_action_audit (
    action_id text primary key,
    session_id uuid not null references chat_sessions(id) on delete cascade,
    user_id text not null,
    action jsonb not null,
    status text not null,
    decision text,
    error text,
    created_at timestamptz not null default now(),
    expires_at timestamptz,
    claimed_at timestamptz,
    resolved_at timestamptz,
    updated_at timestamptz not null default now()
);
alter table hitl_action_audit add column if not exists decision text;
alter table hitl_action_audit add column if not exists error text;
alter table hitl_action_audit add column if not exists expires_at timestamptz;
alter table hitl_action_audit add column if not exists claimed_at timestamptz;
alter table hitl_action_audit add column if not exists updated_at timestamptz not null default now();
alter table hitl_action_audit alter column resolved_at drop not null;
alter table hitl_action_audit alter column resolved_at drop default;
alter table hitl_action_audit drop constraint if exists hitl_action_audit_status_check;
update hitl_action_audit set status = 'succeeded' where status = 'completed';
update hitl_action_audit
set expires_at = coalesce(expires_at, created_at + interval '24 hours'),
    updated_at = coalesce(updated_at, resolved_at, created_at);
alter table hitl_action_audit
    add constraint hitl_action_audit_status_check
    check (status in ('pending', 'executing', 'succeeded', 'failed', 'cancelled', 'expired'));
create index if not exists hitl_action_audit_session_idx
    on hitl_action_audit (user_id, session_id, created_at);
create index if not exists hitl_action_audit_pending_expiry_idx
    on hitl_action_audit (expires_at) where status = 'pending';
"""


def _db_pool():
    pool = get_pool()
    if pool is None:
        raise RuntimeError("Database pool is not initialized")
    return pool


def _public_action(action: dict, status: str, *, error: str | None = None) -> dict:
    public = {key: value for key, value in action.items() if key not in {"busy", "error"}}
    public.update({"status": status, "resolved": status != "pending"})
    if error:
        public["error"] = error
    return public


def _iso(value: datetime | None) -> str | None:
    return value.isoformat() if value else None


async def init_schema() -> None:
    async with _db_pool().connection() as conn:
        await conn.execute(_SCHEMA)


async def ensure_pending(
    user_id: str,
    session_id: str,
    action: dict,
    *,
    ttl_seconds: int = HITL_ACTION_TTL_SECONDS,
) -> None:
    """Persist a newly surfaced interrupt without overwriting an existing claim."""
    public = _public_action(action, "pending")
    async with _db_pool().connection() as conn:
        await conn.execute(
            "insert into hitl_action_audit "
            "(action_id, session_id, user_id, action, status, expires_at) "
            "values (%s, %s, %s, %s::jsonb, 'pending', now() + make_interval(secs => %s)) "
            "on conflict (action_id) do nothing",
            (action["id"], session_id, user_id, json.dumps(public), ttl_seconds),
        )


async def claim_action(
    user_id: str,
    session_id: str,
    action_id: str,
    decision: str,
) -> str:
    """Atomically claim one pending action; return its resulting/current status."""
    if decision not in {"approve", "reject"}:
        raise ValueError("Unsupported HITL decision")
    async with _db_pool().connection() as conn:
        await conn.execute(
            "update hitl_action_audit set status = 'expired', resolved_at = now(), updated_at = now() "
            "where action_id = %s and user_id = %s and session_id = %s "
            "and status = 'pending' and expires_at <= now()",
            (action_id, user_id, session_id),
        )
        cur = await conn.execute(
            "update hitl_action_audit "
            "set status = 'executing', decision = %s, claimed_at = now(), updated_at = now() "
            "where action_id = %s and user_id = %s and session_id = %s "
            "and status = 'pending' and expires_at > now() returning status",
            (decision, action_id, user_id, session_id),
        )
        claimed = await cur.fetchone()
        if claimed:
            return "claimed"
        cur = await conn.execute(
            "select status from hitl_action_audit "
            "where action_id = %s and user_id = %s and session_id = %s",
            (action_id, user_id, session_id),
        )
        row = await cur.fetchone()
    return row[0] if row else "missing"


async def finish_action(
    user_id: str,
    session_id: str,
    action: dict,
    status: str,
    *,
    error: str | None = None,
) -> None:
    if status not in TERMINAL_STATUSES:
        raise ValueError(f"HITL action cannot finish with status {status!r}")
    public = _public_action(action, status, error=error)
    async with _db_pool().connection() as conn:
        cur = await conn.execute(
            "update hitl_action_audit "
            "set action = %s::jsonb, status = %s, error = %s, resolved_at = now(), updated_at = now() "
            "where action_id = %s and user_id = %s and session_id = %s and status = 'executing' "
            "returning action_id",
            (json.dumps(public), status, error, action["id"], user_id, session_id),
        )
        if not await cur.fetchone():
            raise RuntimeError("HITL action is no longer owned by this executor")


async def list_actions(user_id: str, session_id: str) -> list[dict]:
    async with _db_pool().connection() as conn:
        await conn.execute(
            "update hitl_action_audit set status = 'expired', resolved_at = now(), updated_at = now() "
            "where user_id = %s and session_id = %s and status = 'pending' and expires_at <= now()",
            (user_id, session_id),
        )
        cur = await conn.execute(
            "select action, status, error, expires_at from hitl_action_audit "
            "where user_id = %s and session_id = %s order by created_at",
            (user_id, session_id),
        )
        rows = await cur.fetchall()
    actions = []
    for raw_action, status, error, expires_at in rows:
        action = json.loads(raw_action) if isinstance(raw_action, str) else raw_action
        if not isinstance(action, dict):
            continue
        public = _public_action(action, status, error=error)
        public["expires_at"] = _iso(expires_at)
        actions.append(public)
    return actions


async def list_completed(user_id: str, session_id: str) -> list[dict]:
    """Backward-compatible alias; callers should use :func:`list_actions`."""
    return await list_actions(user_id, session_id)
