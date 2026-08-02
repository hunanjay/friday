from app.agents.message_visibility import normalize_preview
from app.infrastructure.db.pool import get_pool

_SCHEMA = """
create table if not exists chat_sessions (
    id uuid primary key default gen_random_uuid(),
    user_id text not null,
    title text not null default 'New chat',
    preview text not null default '',
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);
alter table chat_sessions add column if not exists preview text not null default '';
alter table chat_sessions add column if not exists updated_at timestamptz not null default now();
create index if not exists chat_sessions_user_id_idx on chat_sessions (user_id, created_at desc);
create index if not exists chat_sessions_user_updated_idx on chat_sessions (user_id, updated_at desc);
"""


def _db_pool():
    pool = get_pool()
    if pool is None:
        raise RuntimeError("Database pool is not initialized")
    return pool


async def init_schema():
    async with _db_pool().connection() as conn:
        await conn.execute(_SCHEMA)


async def list_sessions(user_id: str) -> list[dict]:
    async with _db_pool().connection() as conn:
        cur = await conn.execute(
            "select id, title, preview, created_at, updated_at from chat_sessions "
            "where user_id = %s order by updated_at desc",
            (user_id,),
        )
        rows = await cur.fetchall()
    return [
        {
            "id": str(r[0]),
            "title": r[1],
            "preview": r[2],
            "created_at": r[3].isoformat(),
            "updated_at": r[4].isoformat(),
        }
        for r in rows
    ]


async def create_session(user_id: str, title: str = "New chat") -> dict:
    async with _db_pool().connection() as conn:
        cur = await conn.execute(
            "insert into chat_sessions (user_id, title) values (%s, %s) "
            "returning id, title, preview, created_at, updated_at",
            (user_id, title),
        )
        row = await cur.fetchone()
    return {
        "id": str(row[0]),
        "title": row[1],
        "preview": row[2],
        "created_at": row[3].isoformat(),
        "updated_at": row[4].isoformat(),
    }


async def get_session(user_id: str, session_id: str) -> dict | None:
    async with _db_pool().connection() as conn:
        cur = await conn.execute(
            "select id, title, preview, created_at, updated_at from chat_sessions "
            "where id = %s and user_id = %s",
            (session_id, user_id),
        )
        row = await cur.fetchone()
    return (
        {
            "id": str(row[0]),
            "title": row[1],
            "preview": row[2],
            "created_at": row[3].isoformat(),
            "updated_at": row[4].isoformat(),
        }
        if row
        else None
    )


async def update_session_title(user_id: str, session_id: str, title: str) -> None:
    async with _db_pool().connection() as conn:
        await conn.execute(
            "update chat_sessions set title = %s where id = %s and user_id = %s",
            (title, session_id, user_id),
        )


async def update_session_preview(
    user_id: str,
    session_id: str,
    text: str,
    *,
    touch_updated_at: bool = True,
) -> str:
    preview = normalize_preview(text)
    if not preview:
        return ""
    update_clause = "preview = %s, updated_at = now()" if touch_updated_at else "preview = %s"
    async with _db_pool().connection() as conn:
        await conn.execute(
            f"update chat_sessions set {update_clause} where id = %s and user_id = %s",
            (preview, session_id, user_id),
        )
    return preview


async def delete_session(user_id: str, session_id: str) -> bool:
    async with _db_pool().connection() as conn:
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
