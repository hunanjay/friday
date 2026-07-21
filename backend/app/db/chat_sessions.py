import os

from psycopg_pool import AsyncConnectionPool

_pool: AsyncConnectionPool | None = None

_SCHEMA = """
create table if not exists chat_sessions (
    id uuid primary key default gen_random_uuid(),
    user_id text not null,
    title text not null default 'New chat',
    created_at timestamptz not null default now()
);
create index if not exists chat_sessions_user_id_idx on chat_sessions (user_id, created_at desc);
"""


async def init_pool():
    global _pool
    _pool = AsyncConnectionPool(os.environ["CHECKPOINT_DB_URL"], open=False)
    await _pool.open()
    async with _pool.connection() as conn:
        await conn.execute(_SCHEMA)


async def close_pool():
    if _pool is not None:
        await _pool.close()


async def list_sessions(user_id: str) -> list[dict]:
    async with _pool.connection() as conn:
        cur = await conn.execute(
            "select id, title, created_at from chat_sessions where user_id = %s order by created_at desc",
            (user_id,),
        )
        rows = await cur.fetchall()
    return [{"id": str(r[0]), "title": r[1], "created_at": r[2].isoformat()} for r in rows]


async def create_session(user_id: str, title: str = "New chat") -> dict:
    async with _pool.connection() as conn:
        cur = await conn.execute(
            "insert into chat_sessions (user_id, title) values (%s, %s) returning id, title, created_at",
            (user_id, title),
        )
        row = await cur.fetchone()
    return {"id": str(row[0]), "title": row[1], "created_at": row[2].isoformat()}



async def get_session(user_id: str, session_id: str) -> dict | None:
    async with _pool.connection() as conn:
        cur = await conn.execute(
            "select id, title, created_at from chat_sessions where id = %s and user_id = %s",
            (session_id, user_id),
        )
        row = await cur.fetchone()
    return {"id": str(row[0]), "title": row[1], "created_at": row[2].isoformat()} if row else None


async def update_session_title(user_id: str, session_id: str, title: str) -> None:
    async with _pool.connection() as conn:
        await conn.execute(
            "update chat_sessions set title = %s where id = %s and user_id = %s",
            (title, session_id, user_id),
        )


async def delete_session(user_id: str, session_id: str) -> bool:
    """Deletes the session row plus its LangGraph checkpoint history. Returns
    False if the session doesn't exist or belongs to another user."""
    async with _pool.connection() as conn:
        cur = await conn.execute(
            "delete from chat_sessions where id = %s and user_id = %s returning id",
            (session_id, user_id),
        )
        deleted = await cur.fetchone()
        if not deleted:
            return False
        for table in ("checkpoints", "checkpoint_blobs", "checkpoint_writes"):
            await conn.execute(f"delete from {table} where thread_id = %s", (session_id,))
    return True
