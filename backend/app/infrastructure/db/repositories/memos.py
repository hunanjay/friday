import json

from app.infrastructure.db.pool import get_pool

_SCHEMA = """
create table if not exists memos (
    id uuid primary key default gen_random_uuid(),
    user_id text not null,
    title text not null,
    content text not null,
    category text not null default 'ideas',
    color text not null default 'beige',
    pinned boolean not null default false,
    updated_at timestamptz not null default now(),
    attachments jsonb not null default '[]'::jsonb
);
alter table memos add column if not exists attachments jsonb not null default '[]'::jsonb;
alter table memos add column if not exists agent_maintained boolean not null default false;
alter table memos add column if not exists sync_status text not null default 'pending';
create index if not exists memos_user_id_idx on memos (user_id, updated_at desc);
"""

_COLUMNS = "id, title, content, category, color, pinned, updated_at, attachments, agent_maintained, sync_status"


def _db_pool():
    pool = get_pool()
    if pool is None:
        raise RuntimeError("Database pool is not initialized")
    return pool


async def init_schema():
    async with _db_pool().connection() as conn:
        await conn.execute(_SCHEMA)


def _row_to_dict(row) -> dict:
    attachments = row[7]
    if isinstance(attachments, str):
        try:
            attachments = json.loads(attachments)
        except Exception:
            attachments = []
    elif not isinstance(attachments, list):
        attachments = []

    return {
        "id": str(row[0]),
        "title": row[1],
        "content": row[2],
        "category": row[3],
        "color": row[4],
        "pinned": row[5],
        "updated_at": row[6].isoformat(),
        "attachments": attachments,
        "agent_maintained": row[8],
        "sync_status": row[9],
    }


async def list_memos(user_id: str) -> list[dict]:
    async with _db_pool().connection() as conn:
        cur = await conn.execute(
            f"select {_COLUMNS} from memos where user_id = %s order by pinned desc, updated_at desc",
            (user_id,),
        )
        rows = await cur.fetchall()
    return [_row_to_dict(r) for r in rows]


async def get_memo(user_id: str, memo_id: str) -> dict | None:
    async with _db_pool().connection() as conn:
        cur = await conn.execute(
            f"select {_COLUMNS} from memos where id = %s and user_id = %s",
            (memo_id, user_id),
        )
        row = await cur.fetchone()
    return _row_to_dict(row) if row else None


async def create_memo(
    user_id: str,
    title: str,
    content: str,
    category: str,
    color: str,
    attachments: list | None = None,
    agent_maintained: bool = False,
) -> dict:
    att_json = json.dumps(attachments or [])
    async with _db_pool().connection() as conn:
        cur = await conn.execute(
            "insert into memos (user_id, title, content, category, color, attachments, agent_maintained) "
            "values (%s, %s, %s, %s, %s, %s::jsonb, %s) "
            f"returning {_COLUMNS}",
            (user_id, title, content, category, color, att_json, agent_maintained),
        )
        row = await cur.fetchone()
    return _row_to_dict(row)


async def update_memo(
    user_id: str,
    memo_id: str,
    title: str,
    content: str,
    category: str,
    color: str,
    pinned: bool,
    attachments: list | None = None,
    agent_maintained: bool = False,
) -> dict | None:
    att_json = json.dumps(attachments or [])
    async with _db_pool().connection() as conn:
        cur = await conn.execute(
            "update memos set title = %s, content = %s, category = %s, color = %s, pinned = %s, "
            "attachments = %s::jsonb, agent_maintained = %s, updated_at = now() "
            f"where id = %s and user_id = %s returning {_COLUMNS}",
            (title, content, category, color, pinned, att_json, agent_maintained, memo_id, user_id),
        )
        row = await cur.fetchone()
    return _row_to_dict(row) if row else None


async def delete_memo(user_id: str, memo_id: str) -> bool:
    async with _db_pool().connection() as conn:
        cur = await conn.execute(
            "delete from memos where id = %s and user_id = %s returning id",
            (memo_id, user_id),
        )
        return await cur.fetchone() is not None


async def set_sync_status(user_id: str, memo_id: str, sync_status: str) -> dict | None:
    """Flip only sync_status, not the full update_memo field set - the
    memo-routing tools don't touch title/content/category/etc."""
    async with _db_pool().connection() as conn:
        cur = await conn.execute(
            "update memos set sync_status = %s, updated_at = now() "
            f"where id = %s and user_id = %s returning {_COLUMNS}",
            (sync_status, memo_id, user_id),
        )
        row = await cur.fetchone()
    return _row_to_dict(row) if row else None
