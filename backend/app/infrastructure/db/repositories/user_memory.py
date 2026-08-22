from app.infrastructure.db.pool import get_pool
from app.infrastructure.db.repositories.contacts import normalize_facet

_SCHEMA = """
CREATE TABLE IF NOT EXISTS user_memory (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id TEXT NOT NULL,
    category TEXT NOT NULL,   -- 'profile' | 'preference' | 'topic'
    topic TEXT,               -- only set when category='topic', e.g. 'mail', 'calendar'
    fact_key TEXT NOT NULL,
    fact_value TEXT NOT NULL,
    source_type TEXT,
    source_id TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_user_memory_search ON user_memory (user_id, category);
-- Same (category, topic, fact_key) recorded again updates the existing fact
-- instead of piling up a contradictory duplicate - "remember X" behaves like
-- an edit when X was already known under that key.
CREATE UNIQUE INDEX IF NOT EXISTS idx_user_memory_key
    ON user_memory (user_id, category, COALESCE(topic, ''), fact_key);
"""

_COLUMNS = "id, category, topic, fact_key, fact_value, source_type, source_id, created_at, updated_at"

# How many rows of each injected category ride in every agent's system prompt.
# Past this, a fact is still reachable via search_user_memory - it just stops
# being volunteered unprompted. No pinning yet; see plan doc for the tradeoff.
_INJECT_LIMIT = 20


def _db_pool():
    pool = get_pool()
    if pool is None:
        raise RuntimeError("Database pool is not initialized")
    return pool


async def init_schema() -> None:
    async with _db_pool().connection() as conn:
        await conn.execute(_SCHEMA)


def _row_to_dict(row) -> dict:
    return {
        "id": str(row[0]),
        "category": row[1],
        "topic": row[2],
        "fact_key": row[3],
        "fact_value": row[4],
        "source_type": row[5],
        "source_id": row[6],
        "created_at": row[7].isoformat(),
        "updated_at": row[8].isoformat(),
    }


async def remember_fact(
    user_id: str,
    category: str,
    fact_key: str,
    fact_value: str,
    topic: str | None = None,
    source_type: str = "chat",
    source_id: str | None = None,
) -> dict:
    """Insert a fact, or overwrite it in place if (category, topic, fact_key)
    already exists - recording the same key again is an update, not a new
    contradicting entry sitting alongside the old one."""
    normalized_topic = normalize_facet(topic, "general") if category == "topic" else None
    async with _db_pool().connection() as conn:
        cur = await conn.execute(
            "insert into user_memory (user_id, category, topic, fact_key, fact_value, source_type, source_id) "
            "values (%s, %s, %s, %s, %s, %s, %s) "
            "on conflict (user_id, category, coalesce(topic, ''), fact_key) do update set "
            "fact_value = excluded.fact_value, source_type = excluded.source_type, "
            "source_id = excluded.source_id, updated_at = now() "
            f"returning {_COLUMNS}",
            (user_id, category, normalized_topic, fact_key, fact_value, source_type, source_id),
        )
        row = await cur.fetchone()
    return _row_to_dict(row)


async def forget_fact(user_id: str, category: str, fact_key: str, topic: str | None = None) -> bool:
    normalized_topic = normalize_facet(topic, "general") if category == "topic" else None
    async with _db_pool().connection() as conn:
        cur = await conn.execute(
            "delete from user_memory where user_id = %s and category = %s "
            "and coalesce(topic, '') = coalesce(%s, '') and fact_key = %s returning id",
            (user_id, category, normalized_topic, fact_key),
        )
        return await cur.fetchone() is not None


async def get_injectable_memory(user_id: str) -> tuple[list[dict], list[dict]]:
    """Profile and preference facts, most recent first, capped so the prompt
    block they render into can never grow unbounded."""
    async with _db_pool().connection() as conn:
        cur = await conn.execute(
            f"select {_COLUMNS} from user_memory where user_id = %s and category = 'profile' "
            "order by updated_at desc limit %s",
            (user_id, _INJECT_LIMIT),
        )
        profile_rows = await cur.fetchall()
        cur = await conn.execute(
            f"select {_COLUMNS} from user_memory where user_id = %s and category = 'preference' "
            "order by updated_at desc limit %s",
            (user_id, _INJECT_LIMIT),
        )
        preference_rows = await cur.fetchall()
    return [_row_to_dict(r) for r in profile_rows], [_row_to_dict(r) for r in preference_rows]


async def search_facts(user_id: str, query: str, category: str | None = None) -> list[dict]:
    like = f"%{query}%"
    params: list = [user_id, like, like]
    sql = (
        f"select {_COLUMNS} from user_memory where user_id = %s "
        "and (fact_key ilike %s or fact_value ilike %s)"
    )
    if category:
        sql += " and category = %s"
        params.append(category)
    sql += " order by updated_at desc limit 20"
    async with _db_pool().connection() as conn:
        cur = await conn.execute(sql, params)
        rows = await cur.fetchall()
    return [_row_to_dict(r) for r in rows]
