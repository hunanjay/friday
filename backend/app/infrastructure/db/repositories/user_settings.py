from app.infrastructure.db.pool import get_pool

DEFAULT_ASSISTANT_NAME = "Friday"

_SCHEMA = """
create table if not exists user_settings (
    user_id text primary key,
    assistant_name text not null default 'Friday',
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);
alter table user_settings add column if not exists avatar_url text;
alter table user_settings add column if not exists signature text;
"""


def _db_pool():
    pool = get_pool()
    if pool is None:
        raise RuntimeError("Database pool is not initialized")
    return pool


async def init_schema() -> None:
    async with _db_pool().connection() as conn:
        await conn.execute(_SCHEMA)


async def get_assistant_name(user_id: str) -> str:
    async with _db_pool().connection() as conn:
        cur = await conn.execute(
            "select assistant_name from user_settings where user_id = %s",
            (user_id,),
        )
        row = await cur.fetchone()
    return row[0] if row else DEFAULT_ASSISTANT_NAME


async def set_assistant_name(user_id: str, name: str) -> str:
    async with _db_pool().connection() as conn:
        cur = await conn.execute(
            "insert into user_settings (user_id, assistant_name) values (%s, %s) "
            "on conflict (user_id) do update set assistant_name = excluded.assistant_name, "
            "updated_at = now() "
            "returning assistant_name",
            (user_id, name),
        )
        row = await cur.fetchone()
    return row[0]


async def get_avatar_url(user_id: str) -> str | None:
    async with _db_pool().connection() as conn:
        cur = await conn.execute(
            "select avatar_url from user_settings where user_id = %s",
            (user_id,),
        )
        row = await cur.fetchone()
    return row[0] if row else None


async def set_avatar_url(user_id: str, avatar_url: str) -> str:
    async with _db_pool().connection() as conn:
        cur = await conn.execute(
            "insert into user_settings (user_id, avatar_url) values (%s, %s) "
            "on conflict (user_id) do update set avatar_url = excluded.avatar_url, "
            "updated_at = now() "
            "returning avatar_url",
            (user_id, avatar_url),
        )
        row = await cur.fetchone()
    return row[0]


async def get_signature(user_id: str) -> str:
    async with _db_pool().connection() as conn:
        cur = await conn.execute(
            "select signature from user_settings where user_id = %s",
            (user_id,),
        )
        row = await cur.fetchone()
    return (row[0] if row else None) or ""


async def set_signature(user_id: str, signature: str) -> str:
    async with _db_pool().connection() as conn:
        cur = await conn.execute(
            "insert into user_settings (user_id, signature) values (%s, %s) "
            "on conflict (user_id) do update set signature = excluded.signature, "
            "updated_at = now() "
            "returning signature",
            (user_id, signature),
        )
        row = await cur.fetchone()
    return row[0] or ""
