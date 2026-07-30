import os
from psycopg.types.json import Jsonb
from psycopg_pool import AsyncConnectionPool

_pool: AsyncConnectionPool | None = None

_SCHEMA = """
create table if not exists pending_agent_actions (
    id uuid primary key default gen_random_uuid(),
    user_id text not null,
    session_id uuid not null references chat_sessions(id) on delete cascade,
    action_type text not null check (action_type in ('send_email', 'delete_email')),
    payload jsonb not null,
    status text not null default 'pending'
        check (status in ('pending', 'executing', 'completed', 'cancelled', 'failed', 'expired')),
    error text,
    created_at timestamptz not null default now(),
    expires_at timestamptz not null default now() + interval '15 minutes',
    completed_at timestamptz,
    anchor_message_id text
);
alter table pending_agent_actions add column if not exists anchor_message_id text;
create index if not exists pending_agent_actions_lookup_idx
    on pending_agent_actions (user_id, session_id, status, created_at desc);
"""

_COLUMNS = "id, user_id, session_id, action_type, payload, status, error, created_at, expires_at, completed_at, anchor_message_id"


async def init_pool() -> None:
    global _pool
    _pool = AsyncConnectionPool(os.environ["CHECKPOINT_DB_URL"], open=False)
    await _pool.open()
    async with _pool.connection() as conn:
        await conn.execute(_SCHEMA)


async def close_pool() -> None:
    if _pool is not None:
        await _pool.close()


def _row_to_dict(row) -> dict:
    return {
        "id": str(row[0]),
        "user_id": row[1],
        "session_id": str(row[2]),
        "action_type": row[3],
        "payload": row[4],
        "status": row[5],
        "error": row[6],
        "created_at": row[7].isoformat(),
        "expires_at": row[8].isoformat(),
        "completed_at": row[9].isoformat() if row[9] else None,
        "anchor_message_id": row[10],
    }


def public_action(action: dict) -> dict:
    return {
        "id": action["id"],
        "session_id": action["session_id"],
        "action_type": action["action_type"],
        "payload": action["payload"],
        "status": action["status"],
        "error": action["error"],
        "created_at": action["created_at"],
        "expires_at": action["expires_at"],
        "completed_at": action["completed_at"],
        "anchor_message_id": action["anchor_message_id"],
    }


async def create_action(user_id: str, session_id: str, action_type: str, payload: dict) -> dict:
    async with _pool.connection() as conn:
        cur = await conn.execute(
            f"select {_COLUMNS} from pending_agent_actions "
            "where user_id = %s and session_id = %s and action_type = %s "
            "and payload = %s and status = 'pending' and expires_at > now() "
            "order by created_at desc limit 1",
            (user_id, session_id, action_type, Jsonb(payload)),
        )
        existing = await cur.fetchone()
        if existing:
            return _row_to_dict(existing)

        cur = await conn.execute(
            "insert into pending_agent_actions (user_id, session_id, action_type, payload) "
            f"values (%s, %s, %s, %s) returning {_COLUMNS}",
            (user_id, session_id, action_type, Jsonb(payload)),
        )
        return _row_to_dict(await cur.fetchone())


async def set_action_anchor(user_id: str, action_id: str, anchor_message_id: str) -> None:
    async with _pool.connection() as conn:
        await conn.execute(
            "update pending_agent_actions set anchor_message_id = %s "
            "where id = %s and user_id = %s",
            (anchor_message_id, action_id, user_id),
        )


async def list_pending_actions(user_id: str, session_id: str) -> list[dict]:
    async with _pool.connection() as conn:
        await conn.execute(
            "update pending_agent_actions set status = 'expired' "
            "where user_id = %s and session_id = %s and status = 'pending' and expires_at <= now()",
            (user_id, session_id),
        )
        cur = await conn.execute(
            f"select {_COLUMNS} from pending_agent_actions "
            "where user_id = %s and session_id = %s and status = 'pending' "
            "order by created_at",
            (user_id, session_id),
        )
        return [_row_to_dict(row) for row in await cur.fetchall()]


async def list_session_actions(user_id: str, session_id: str) -> list[dict]:
    async with _pool.connection() as conn:
        await conn.execute(
            "update pending_agent_actions set status = 'expired' "
            "where user_id = %s and session_id = %s and status = 'pending' and expires_at <= now()",
            (user_id, session_id),
        )
        cur = await conn.execute(
            f"select {_COLUMNS} from pending_agent_actions "
            "where user_id = %s and session_id = %s and status in ('pending', 'completed') "
            "order by created_at",
            (user_id, session_id),
        )
        return [_row_to_dict(row) for row in await cur.fetchall()]


async def get_action(user_id: str, action_id: str) -> dict | None:
    async with _pool.connection() as conn:
        await conn.execute(
            "update pending_agent_actions set status = 'expired' "
            "where id = %s and user_id = %s and status = 'pending' and expires_at <= now()",
            (action_id, user_id),
        )
        cur = await conn.execute(
            f"select {_COLUMNS} from pending_agent_actions where id = %s and user_id = %s",
            (action_id, user_id),
        )
        row = await cur.fetchone()
        return _row_to_dict(row) if row else None


async def claim_action(user_id: str, action_id: str) -> dict | None:
    async with _pool.connection() as conn:
        cur = await conn.execute(
            "update pending_agent_actions set status = 'executing' "
            "where id = %s and user_id = %s and status = 'pending' and expires_at > now() "
            f"returning {_COLUMNS}",
            (action_id, user_id),
        )
        row = await cur.fetchone()
        return _row_to_dict(row) if row else None


async def complete_action(user_id: str, action_id: str) -> dict:
    async with _pool.connection() as conn:
        cur = await conn.execute(
            "update pending_agent_actions set status = 'completed', completed_at = now(), error = null "
            "where id = %s and user_id = %s and status = 'executing' "
            f"returning {_COLUMNS}",
            (action_id, user_id),
        )
        return _row_to_dict(await cur.fetchone())


async def fail_action(user_id: str, action_id: str, error: str) -> None:
    async with _pool.connection() as conn:
        await conn.execute(
            "update pending_agent_actions set status = 'failed', error = %s "
            "where id = %s and user_id = %s and status = 'executing'",
            (error[:1000], action_id, user_id),
        )


async def cancel_action(user_id: str, action_id: str) -> dict | None:
    async with _pool.connection() as conn:
        cur = await conn.execute(
            "update pending_agent_actions set status = 'cancelled' "
            "where id = %s and user_id = %s and status = 'pending' "
            f"returning {_COLUMNS}",
            (action_id, user_id),
        )
        row = await cur.fetchone()
        return _row_to_dict(row) if row else None
