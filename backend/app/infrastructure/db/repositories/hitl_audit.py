"""Durable presentation history for official LangChain HITL decisions.

LangGraph's checkpoint is the only execution authority: pending actions come
from ``StateSnapshot.interrupts`` and decisions resume the graph with
``Command(resume=...)``.  This table only keeps the already-rendered card after
an interrupt has been resolved so refreshing the UI does not erase the audit
trail.
"""

import json

from app.infrastructure.db.pool import get_pool

_SCHEMA = """
create table if not exists hitl_action_audit (
    action_id text primary key,
    session_id uuid not null references chat_sessions(id) on delete cascade,
    user_id text not null,
    action jsonb not null,
    status text not null check (status in ('completed', 'cancelled')),
    created_at timestamptz not null default now(),
    resolved_at timestamptz not null default now()
);
create index if not exists hitl_action_audit_session_idx
    on hitl_action_audit (user_id, session_id, created_at);
"""


def _db_pool():
    pool = get_pool()
    if pool is None:
        raise RuntimeError("Database pool is not initialized")
    return pool


async def init_schema() -> None:
    async with _db_pool().connection() as conn:
        await conn.execute(_SCHEMA)


async def record_resolution(
    user_id: str,
    session_id: str,
    action: dict,
    status: str,
) -> None:
    if status not in {"completed", "cancelled"}:
        raise ValueError("Only resolved HITL actions belong in the audit table")
    public_action = {
        key: value
        for key, value in action.items()
        if key not in {"busy", "error"}
    }
    public_action.update({"status": status, "resolved": status == "completed"})
    async with _db_pool().connection() as conn:
        await conn.execute(
            "insert into hitl_action_audit "
            "(action_id, session_id, user_id, action, status) "
            "values (%s, %s, %s, %s::jsonb, %s) "
            "on conflict (action_id) do update set "
            "action = excluded.action, status = excluded.status, resolved_at = now()",
            (action["id"], session_id, user_id, json.dumps(public_action), status),
        )


async def list_completed(user_id: str, session_id: str) -> list[dict]:
    async with _db_pool().connection() as conn:
        cur = await conn.execute(
            "select action from hitl_action_audit "
            "where user_id = %s and session_id = %s and status = 'completed' "
            "order by created_at",
            (user_id, session_id),
        )
        rows = await cur.fetchall()
    actions = []
    for row in rows:
        action = row[0]
        if isinstance(action, str):
            action = json.loads(action)
        if isinstance(action, dict):
            actions.append({**action, "status": "completed", "resolved": True})
    return actions
