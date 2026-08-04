from datetime import date

from app.infrastructure.db.pool import get_pool

_SCHEMA = """
create table if not exists todos (
    id uuid primary key default gen_random_uuid(),
    user_id text not null,
    text text not null,
    completed boolean not null default false,
    due_date date,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);
create index if not exists todos_user_id_idx
    on todos (user_id, completed, due_date asc nulls last, created_at desc);
"""

_COLUMNS = "id, text, completed, due_date, created_at, updated_at"


def _db_pool():
    pool = get_pool()
    if pool is None:
        raise RuntimeError("Database pool is not initialized")
    return pool


async def init_schema():
    async with _db_pool().connection() as conn:
        await conn.execute(_SCHEMA)


def _row_to_dict(row) -> dict:
    return {
        "id": str(row[0]),
        "text": row[1],
        "completed": row[2],
        "due_date": row[3].isoformat() if row[3] else None,
        "created_at": row[4].isoformat(),
        "updated_at": row[5].isoformat(),
    }


async def list_todos(user_id: str) -> list[dict]:
    async with _db_pool().connection() as conn:
        cur = await conn.execute(
            f"select {_COLUMNS} from todos where user_id = %s "
            "order by completed asc, due_date asc nulls last, created_at desc",
            (user_id,),
        )
        rows = await cur.fetchall()
    return [_row_to_dict(row) for row in rows]


async def create_todo(user_id: str, text: str, due_date: date | None) -> dict:
    async with _db_pool().connection() as conn:
        cur = await conn.execute(
            "insert into todos (user_id, text, due_date) values (%s, %s, %s) "
            f"returning {_COLUMNS}",
            (user_id, text, due_date),
        )
        row = await cur.fetchone()
    return _row_to_dict(row)


async def update_todo(
    user_id: str, todo_id: str, text: str, completed: bool, due_date: date | None
) -> dict | None:
    async with _db_pool().connection() as conn:
        cur = await conn.execute(
            "update todos set text = %s, completed = %s, due_date = %s, updated_at = now() "
            f"where id = %s and user_id = %s returning {_COLUMNS}",
            (text, completed, due_date, todo_id, user_id),
        )
        row = await cur.fetchone()
    return _row_to_dict(row) if row else None


async def delete_todo(user_id: str, todo_id: str) -> bool:
    async with _db_pool().connection() as conn:
        cur = await conn.execute(
            "delete from todos where id = %s and user_id = %s returning id",
            (todo_id, user_id),
        )
        return await cur.fetchone() is not None
