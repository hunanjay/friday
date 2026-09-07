"""Relationship-maintenance reminders (issue #17): explicit time-based
reminders extracted from contact facts, and (later) decay/external-event
reminders. This module owns storage and status transitions only; deciding
*when* a fact deserves a reminder is a model judgment call made by the
caller (the contact agent's create_contact_reminder tool).

No push channel: the dashboard Radar panel polls list_reminders and shows
every pending one, soonest due_at first."""

from app.infrastructure.db.pool import get_pool

_SCHEMA = """
create table if not exists contact_reminders (
    id uuid primary key default gen_random_uuid(),
    user_id text not null,
    contact_id uuid not null references contacts(id) on delete cascade,
    profile_id uuid references contact_profiles(id) on delete set null,
    type text not null default 'explicit',  -- 'explicit' | 'reconnect' | 'external_event'
    due_at timestamptz not null,
    reason text not null,
    suggested_action text not null,
    status text not null default 'pending',  -- 'pending' | 'done' | 'dismissed' | 'snoozed'
    dedupe_key text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);
create unique index if not exists contact_reminders_dedupe_idx
    on contact_reminders (user_id, dedupe_key) where dedupe_key is not null;
create index if not exists contact_reminders_due_idx
    on contact_reminders (user_id, status, due_at);
"""

_COLUMNS = (
    "id, contact_id, profile_id, type, due_at, reason, suggested_action, "
    "status, dedupe_key, created_at, updated_at"
)


def _db_pool():
    pool = get_pool()
    if pool is None:
        raise RuntimeError("Database pool is not initialized")
    return pool


async def init_schema() -> None:
    async with _db_pool().connection() as conn:
        await conn.execute(_SCHEMA)


def _row(row, contact_name: str | None = None, contact_avatar_url: str | None = None) -> dict:
    return {
        "id": str(row[0]),
        "contact_id": str(row[1]),
        "contact_name": contact_name,
        "contact_avatar_url": contact_avatar_url or "",
        "profile_id": str(row[2]) if row[2] else None,
        "type": row[3],
        "due_at": row[4].isoformat() if row[4] else None,
        "reason": row[5],
        "suggested_action": row[6],
        "status": row[7],
        "dedupe_key": row[8],
        "created_at": row[9].isoformat(),
        "updated_at": row[10].isoformat(),
    }


async def create_reminder(
    user_id: str,
    contact_id: str,
    due_at,
    reason: str,
    suggested_action: str,
    type: str = "explicit",
    profile_id: str | None = None,
    dedupe_key: str | None = None,
) -> dict | None:
    """Insert a reminder. Returns None (not an error) when `dedupe_key`
    already exists for this user - repeated extraction of the same fact
    must not pile up duplicate reminders."""
    async with _db_pool().connection() as conn:
        cur = await conn.execute(
            f"""
            insert into contact_reminders
                (user_id, contact_id, profile_id, type, due_at, reason, suggested_action, dedupe_key)
            values (%s, %s, %s, %s, %s, %s, %s, %s)
            on conflict (user_id, dedupe_key) where dedupe_key is not null do nothing
            returning {_COLUMNS}
            """,
            (user_id, contact_id, profile_id, type, due_at, reason, suggested_action, dedupe_key),
        )
        row = await cur.fetchone()
        if not row:
            return None
        cur = await conn.execute("select name, avatar_url from contacts where id = %s", (contact_id,))
        contact_row = await cur.fetchone()
    return _row(row, *(contact_row or (None, None)))


async def list_reminders(user_id: str, status: str | None = None) -> list[dict]:
    """Sorted soonest-first. No due-date gating - the dashboard Radar panel
    is an upcoming-reminders preview, not a due-today inbox, so a September
    reminder is fine to show in August."""
    async with _db_pool().connection() as conn:
        sql = f"""
            select r.{_COLUMNS.replace(', ', ', r.')}, c.name, c.avatar_url
            from contact_reminders r join contacts c on c.id = r.contact_id
            where r.user_id = %s
        """
        params: list = [user_id]
        if status:
            sql += " and r.status = %s"
            params.append(status)
        sql += " order by r.due_at asc"
        cur = await conn.execute(sql, tuple(params))
        rows = await cur.fetchall()
    return [_row(row[:-2], row[-2], row[-1]) for row in rows]


async def update_status(
    user_id: str, reminder_id: str, status: str, snooze_until=None
) -> dict | None:
    """status in {'done', 'dismissed', 'snoozed'}. Snoozing moves due_at
    forward and resets status to 'pending' so it reappears once due again."""
    async with _db_pool().connection() as conn:
        if status == "snoozed":
            cur = await conn.execute(
                f"""
                update contact_reminders
                set status = 'pending', due_at = %s, updated_at = now()
                where id = %s and user_id = %s
                returning {_COLUMNS}
                """,
                (snooze_until, reminder_id, user_id),
            )
        else:
            cur = await conn.execute(
                f"""
                update contact_reminders set status = %s, updated_at = now()
                where id = %s and user_id = %s
                returning {_COLUMNS}
                """,
                (status, reminder_id, user_id),
            )
        row = await cur.fetchone()
        if not row:
            return None
        cur = await conn.execute("select name, avatar_url from contacts where id = %s", (row[1],))
        contact_row = await cur.fetchone()
    return _row(row, *(contact_row or (None, None)))
