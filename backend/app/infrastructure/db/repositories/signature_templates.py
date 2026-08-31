"""Named signature blocks, exactly one of which is the user's default.

Replaces the single `user_settings.signature` column. Every send path - the
agent's send_email, Graph and IMAP compose and reply, the draft tool, the
approval card preview - already asked one function for "the user's signature",
so they keep asking one function here. Which template is active is decided in
this module and nowhere else; no caller had to learn that templates exist.
"""

from app.infrastructure.db.pool import get_pool

_SCHEMA = """
create table if not exists signature_templates (
    id uuid primary key default gen_random_uuid(),
    user_id text not null,
    name text not null,
    content text not null,
    is_default boolean not null default false,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);
create index if not exists signature_templates_user_idx
    on signature_templates (user_id, created_at);
-- One default per user, enforced by the database instead of by whoever
-- remembers to clear the previous one.
create unique index if not exists signature_templates_one_default_idx
    on signature_templates (user_id) where is_default;
"""

# A personal signature list is a handful of entries; the cap only stops a stuck
# client from growing the table without bound.
MAX_TEMPLATES_PER_USER = 20

_COLUMNS = "id, name, content, is_default, created_at, updated_at"


def _db_pool():
    pool = get_pool()
    if pool is None:
        raise RuntimeError("Database pool is not initialized")
    return pool


def _row(row) -> dict:
    return {
        "id": str(row[0]),
        "name": row[1],
        "content": row[2],
        "is_default": row[3],
        "created_at": row[4].isoformat(),
        "updated_at": row[5].isoformat(),
    }


async def init_schema() -> None:
    async with _db_pool().connection() as conn:
        await conn.execute(_SCHEMA)


async def list_templates(user_id: str) -> list[dict]:
    async with _db_pool().connection() as conn:
        cur = await conn.execute(
            f"select {_COLUMNS} from signature_templates "
            "where user_id = %s order by is_default desc, created_at",
            (user_id,),
        )
        rows = await cur.fetchall()
    return [_row(row) for row in rows]


async def count_templates(user_id: str) -> int:
    async with _db_pool().connection() as conn:
        cur = await conn.execute(
            "select count(*) from signature_templates where user_id = %s", (user_id,)
        )
        row = await cur.fetchone()
    return row[0]


async def create_template(user_id: str, name: str, content: str) -> dict:
    """Create a template. The first one a user has becomes their default, so a
    saved signature is never inert."""
    async with _db_pool().connection() as conn:
        cur = await conn.execute(
            "insert into signature_templates (user_id, name, content, is_default) "
            "select %s, %s, %s, not exists "
            "(select 1 from signature_templates where user_id = %s) "
            f"returning {_COLUMNS}",
            (user_id, name, content, user_id),
        )
        row = await cur.fetchone()
    return _row(row)


async def update_template(
    user_id: str, template_id: str, name: str, content: str
) -> dict | None:
    async with _db_pool().connection() as conn:
        cur = await conn.execute(
            "update signature_templates set name = %s, content = %s, updated_at = now() "
            f"where id = %s and user_id = %s returning {_COLUMNS}",
            (name, content, template_id, user_id),
        )
        row = await cur.fetchone()
    return _row(row) if row else None


async def set_default(user_id: str, template_id: str) -> bool:
    """Move the default flag. Two statements rather than one, because a single
    UPDATE flipping both rows can trip the partial unique index mid-statement."""
    async with _db_pool().connection() as conn:
        cur = await conn.execute(
            "select 1 from signature_templates where id = %s and user_id = %s",
            (template_id, user_id),
        )
        if not await cur.fetchone():
            return False
        await conn.execute(
            "update signature_templates set is_default = false, updated_at = now() "
            "where user_id = %s and is_default",
            (user_id,),
        )
        await conn.execute(
            "update signature_templates set is_default = true, updated_at = now() "
            "where id = %s and user_id = %s",
            (template_id, user_id),
        )
    return True


async def delete_template(user_id: str, template_id: str) -> bool:
    """Delete a template, promoting the oldest survivor if the default went.

    Leaving a user with templates but no default would silently stop signing
    their mail, which is the one outcome nobody would think to check for.
    """
    async with _db_pool().connection() as conn:
        cur = await conn.execute(
            "delete from signature_templates where id = %s and user_id = %s "
            "returning is_default",
            (template_id, user_id),
        )
        deleted = await cur.fetchone()
        if not deleted:
            return False
        if deleted[0]:
            await conn.execute(
                "update signature_templates set is_default = true, updated_at = now() "
                "where id = (select id from signature_templates where user_id = %s "
                "order by created_at limit 1)",
                (user_id,),
            )
    return True


async def get_default_content(user_id: str) -> str:
    """The block appended to outgoing mail. Empty string when the user has none."""
    async with _db_pool().connection() as conn:
        cur = await conn.execute(
            "select content from signature_templates where user_id = %s and is_default",
            (user_id,),
        )
        row = await cur.fetchone()
    return (row[0] if row else None) or ""
