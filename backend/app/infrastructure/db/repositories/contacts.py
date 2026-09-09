import logging

from app.infrastructure.db.pool import get_pool
from app.infrastructure.vector import qdrant as vector_store

logger = logging.getLogger(__name__)

_SCHEMA = """
-- 1. 联系人主表
CREATE TABLE IF NOT EXISTS contacts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id TEXT NOT NULL,
    outlook_contact_id TEXT,
    name TEXT NOT NULL,
    email TEXT,
    phone TEXT,
    company TEXT,
    job_title TEXT,
    location TEXT,
    ai_summary TEXT,
    last_synced_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_contacts_user_outlook_id ON contacts (user_id, outlook_contact_id) WHERE outlook_contact_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_contacts_user_id ON contacts (user_id, updated_at DESC);

-- 2. 4 大维度原子事实表 (Profiles & Memory Facts)
CREATE TABLE IF NOT EXISTS contact_profiles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id TEXT NOT NULL,
    contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
    dimension TEXT NOT NULL,  -- open vocabulary; see repositories.contacts.BUILTIN_DIMENSIONS
    category TEXT NOT NULL,   -- 'preference', 'pain_point', 'demand', 'family', 'anniversary', 'event'
    fact_key TEXT NOT NULL,   -- 'diet_preference', 'children_education', etc.
    fact_value TEXT NOT NULL,
    confidence FLOAT DEFAULT 1.0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_profiles_contact_id ON contact_profiles (contact_id);
CREATE INDEX IF NOT EXISTS idx_profiles_search ON contact_profiles (user_id, dimension, category);

-- 3. 结构化标签表 (Tags)
CREATE TABLE IF NOT EXISTS contact_tags (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id TEXT NOT NULL,
    contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
    tag_name TEXT NOT NULL,
    tag_category TEXT DEFAULT 'general', -- 'industry', 'location', 'role', 'interest'
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_tags_contact_name ON contact_tags (contact_id, tag_name);

-- 4. 互动时间线明细表 (Interactions)
CREATE TABLE IF NOT EXISTS contact_interactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id TEXT NOT NULL,
    contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
    source_type TEXT NOT NULL,
    summary TEXT NOT NULL,
    raw_snippet TEXT,
    event_date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_interactions_contact_id ON contact_interactions (contact_id, event_date DESC);

-- 5. 向量索引状态: NULL = 尚未写入 Qdrant (写入失败时保持 NULL, 供后台补偿重建)
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS indexed_at TIMESTAMPTZ;
ALTER TABLE contact_profiles ADD COLUMN IF NOT EXISTS indexed_at TIMESTAMPTZ;
ALTER TABLE contact_interactions ADD COLUMN IF NOT EXISTS indexed_at TIMESTAMPTZ;

-- 6. 事实来源溯源: 这条事实是从哪封邮件/备忘录/会话/手动录入学到的。
-- 不设 DEFAULT: 迁移前写入的事实来源不可考, NULL 表示未知, 好过谎称 'manual'。
ALTER TABLE contact_profiles ADD COLUMN IF NOT EXISTS source_type TEXT;
ALTER TABLE contact_profiles ADD COLUMN IF NOT EXISTS source_id TEXT;

-- 7. 头像: 存 storage.py 返回的 URL (OSS 签名链接或本地 /uploads/contacts/ 路径)。
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS avatar_url TEXT;
"""

def _db_pool():
    pool = get_pool()
    if pool is None:
        raise RuntimeError("Database pool is not initialized")
    return pool


_INDEXED_TABLES = {"contacts", "contact_profiles", "contact_interactions"}


async def _index_docs(docs: list[dict], table: str, row_id: str) -> None:
    """Write vector docs after the row is committed, best effort.

    Postgres stays the source of truth: an index failure only leaves indexed_at
    NULL, which is exactly what a rebuild/compensation job selects on.
    """
    if table not in _INDEXED_TABLES:
        raise ValueError(f"unknown indexed table: {table}")
    try:
        await vector_store.upsert_contact_docs(docs)
    except Exception:
        logger.warning("failed to index %s row %s in Qdrant", table, row_id, exc_info=True)
        return
    try:
        async with _db_pool().connection() as conn:
            await conn.execute(f"UPDATE {table} SET indexed_at = NOW() WHERE id = %s", (row_id,))
    except Exception:
        logger.warning("failed to mark %s row %s as indexed", table, row_id, exc_info=True)


async def _unindex(doc_ids: list[str]) -> None:
    try:
        await vector_store.delete_contact_docs(doc_ids)
    except Exception:
        logger.warning("failed to drop contact docs %s from Qdrant", doc_ids, exc_info=True)


async def _contact_name(user_id: str, contact_id: str) -> str:
    async with _db_pool().connection() as conn:
        cur = await conn.execute(
            "SELECT name FROM contacts WHERE id = %s AND user_id = %s", (contact_id, user_id)
        )
        row = await cur.fetchone()
    return row[0] if row else ""


async def init_schema():
    async with _db_pool().connection() as conn:
        await conn.execute(_SCHEMA)


def _row_to_contact_dict(row) -> dict:
    return {
        "id": str(row[0]),
        "user_id": row[1],
        "outlook_contact_id": row[2],
        "name": row[3],
        "email": row[4] or "",
        "phone": row[5] or "",
        "company": row[6] or "",
        "jobTitle": row[7] or "",
        "location": row[8] or "",
        "ai_summary": row[9] or "",
        "last_synced_at": row[10].isoformat() if row[10] else None,
        "created_at": row[11].isoformat() if row[11] else None,
        "updated_at": row[12].isoformat() if row[12] else None,
        "avatar_url": row[13] or "",
    }


_CONTACT_COLS = "id, user_id, outlook_contact_id, name, email, phone, company, job_title, location, ai_summary, last_synced_at, created_at, updated_at, avatar_url"


async def list_contacts(user_id: str, query: str | None = None, tag: str | None = None) -> list[dict]:
    # Clean query: strip question words or pronouns if user searched "他最近在干啥" or "查一下张明"
    cleaned_query = (query or "").strip()
    # Remove leading common intent prefixes
    import re
    cleaned_query = re.sub(r"^(查一下|帮我找|搜索|查询|who is|search for|about)\s*", "", cleaned_query, flags=re.IGNORECASE).strip()

    async with _db_pool().connection() as conn:
        if tag:
            sql = """
                SELECT DISTINCT c.id, c.user_id, c.outlook_contact_id, c.name, c.email, c.phone, c.company, c.job_title, c.location, c.ai_summary, c.last_synced_at, c.created_at, c.updated_at
                FROM contacts c
                JOIN contact_tags t ON c.id = t.contact_id
                WHERE c.user_id = %s AND t.tag_name = %s
            """
            params = [user_id, tag]
            if cleaned_query and cleaned_query not in ("他", "她", "它", "他们", "he", "she", "they", "him", "her"):
                q_pat = f"%{cleaned_query}%"
                sql += """
                    AND (
                        c.name ILIKE %s OR c.email ILIKE %s OR c.company ILIKE %s OR c.job_title ILIKE %s OR c.location ILIKE %s OR c.ai_summary ILIKE %s
                        OR c.id IN (SELECT contact_id FROM contact_profiles WHERE user_id = %s AND (fact_key ILIKE %s OR fact_value ILIKE %s))
                        OR c.id IN (SELECT contact_id FROM contact_tags WHERE user_id = %s AND tag_name ILIKE %s)
                    )
                """
                params.extend([q_pat, q_pat, q_pat, q_pat, q_pat, q_pat, user_id, q_pat, q_pat, user_id, q_pat])
            sql += " ORDER BY c.updated_at DESC"
            cur = await conn.execute(sql, tuple(params))
        else:
            if cleaned_query and cleaned_query not in ("他", "她", "它", "他们", "he", "she", "they", "him", "her"):
                q_pat = f"%{cleaned_query}%"
                sql = f"""
                    SELECT DISTINCT {_CONTACT_COLS} FROM contacts c
                    WHERE c.user_id = %s
                    AND (
                        c.name ILIKE %s OR c.email ILIKE %s OR c.company ILIKE %s OR c.job_title ILIKE %s OR c.location ILIKE %s OR c.ai_summary ILIKE %s
                        OR c.id IN (SELECT contact_id FROM contact_profiles WHERE user_id = %s AND (fact_key ILIKE %s OR fact_value ILIKE %s))
                        OR c.id IN (SELECT contact_id FROM contact_tags WHERE user_id = %s AND tag_name ILIKE %s)
                    )
                    ORDER BY c.updated_at DESC
                """
                params = [user_id, q_pat, q_pat, q_pat, q_pat, q_pat, q_pat, user_id, q_pat, q_pat, user_id, q_pat]
                cur = await conn.execute(sql, tuple(params))
            else:
                sql = f"SELECT {_CONTACT_COLS} FROM contacts WHERE user_id = %s ORDER BY updated_at DESC"
                cur = await conn.execute(sql, (user_id,))

        rows = await cur.fetchall()

    contacts = [_row_to_contact_dict(r) for r in rows]

    # Attach profiles, tags, and timeline for each contact
    for c in contacts:
        contact_id = c["id"]
        c["profiles"] = await get_contact_profiles(user_id, contact_id)
        c["tags"] = await get_contact_tags(user_id, contact_id)
        c["timeline"] = await get_contact_interactions(user_id, contact_id)

    return contacts


async def get_contact_by_id(user_id: str, contact_id: str) -> dict | None:
    async with _db_pool().connection() as conn:
        cur = await conn.execute(
            f"SELECT {_CONTACT_COLS} FROM contacts WHERE id = %s AND user_id = %s",
            (contact_id, user_id),
        )
        row = await cur.fetchone()

    if not row:
        return None

    contact = _row_to_contact_dict(row)
    contact["profiles"] = await get_contact_profiles(user_id, contact_id)
    contact["tags"] = await get_contact_tags(user_id, contact_id)
    contact["timeline"] = await get_contact_interactions(user_id, contact_id)
    return contact


async def create_contact(
    user_id: str,
    name: str,
    email: str = "",
    phone: str = "",
    company: str = "",
    job_title: str = "",
    location: str = "",
    outlook_contact_id: str | None = None,
    ai_summary: str = "",
) -> dict:
    async with _db_pool().connection() as conn:
        cur = await conn.execute(
            f"""
            INSERT INTO contacts (user_id, name, email, phone, company, job_title, location, outlook_contact_id, ai_summary)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
            RETURNING {_CONTACT_COLS}
            """,
            (user_id, name, email, phone, company, job_title, location, outlook_contact_id, ai_summary),
        )
        row = await cur.fetchone()

    contact = _row_to_contact_dict(row)
    contact["profiles"] = []
    contact["tags"] = []
    contact["timeline"] = []
    await _index_docs([vector_store.contact_identity_doc(contact)], "contacts", contact["id"])
    return contact


async def update_contact(
    user_id: str,
    contact_id: str,
    name: str | None = None,
    email: str | None = None,
    phone: str | None = None,
    company: str | None = None,
    job_title: str | None = None,
    location: str | None = None,
    ai_summary: str | None = None,
    avatar_url: str | None = None,
) -> dict | None:
    async with _db_pool().connection() as conn:
        updates = []
        params = []
        if name is not None:
            updates.append("name = %s")
            params.append(name)
        if email is not None:
            updates.append("email = %s")
            params.append(email)
        if phone is not None:
            updates.append("phone = %s")
            params.append(phone)
        if company is not None:
            updates.append("company = %s")
            params.append(company)
        if job_title is not None:
            updates.append("job_title = %s")
            params.append(job_title)
        if location is not None:
            updates.append("location = %s")
            params.append(location)
        if ai_summary is not None:
            updates.append("ai_summary = %s")
            params.append(ai_summary)
        if avatar_url is not None:
            updates.append("avatar_url = %s")
            params.append(avatar_url)

        if not updates:
            return await get_contact_by_id(user_id, contact_id)

        updates.append("updated_at = NOW()")
        params.extend([contact_id, user_id])

        sql = f"UPDATE contacts SET {', '.join(updates)} WHERE id = %s AND user_id = %s RETURNING {_CONTACT_COLS}"
        cur = await conn.execute(sql, tuple(params))
        row = await cur.fetchone()

    if not row:
        return None

    contact = await get_contact_by_id(user_id, contact_id)
    if contact:
        await _index_docs(
            [vector_store.contact_identity_doc(contact, contact.get("tags"))], "contacts", contact_id
        )
    return contact


async def delete_contact(user_id: str, contact_id: str) -> bool:
    async with _db_pool().connection() as conn:
        cur = await conn.execute(
            "DELETE FROM contacts WHERE id = %s AND user_id = %s RETURNING id",
            (contact_id, user_id),
        )
        deleted = await cur.fetchone() is not None

    if deleted:
        # Postgres cascades the child rows; mirror that in the vector store.
        try:
            await vector_store.delete_contact_points(user_id, contact_id)
        except Exception:
            logger.warning("failed to drop contact %s points from Qdrant", contact_id, exc_info=True)
    return deleted


# --- Contact Profiles (Facts) Operations ---

async def get_contact_profiles(user_id: str, contact_id: str) -> list[dict]:
    async with _db_pool().connection() as conn:
        cur = await conn.execute(
            """
            SELECT id, dimension, category, fact_key, fact_value, confidence, created_at, source_type, source_id
            FROM contact_profiles
            WHERE user_id = %s AND contact_id = %s
            ORDER BY dimension, created_at DESC
            """,
            (user_id, contact_id),
        )
        rows = await cur.fetchall()

    return [
        {
            "id": str(r[0]),
            "dimension": r[1],
            "category": r[2],
            "fact_key": r[3],
            "fact_value": r[4],
            "confidence": r[5],
            "created_at": r[6].isoformat() if r[6] else None,
            "source_type": r[7] or "",
            "source_id": r[8] or "",
        }
        for r in rows
    ]


# The four built-in dimensions. Not a whitelist - the agent may coin a new one
# when a fact fits none of these - but a fact written under a coined dimension
# must still land in the same bucket every time, hence normalize_facet below.
BUILTIN_DIMENSIONS = ("basic", "business", "private", "dynamic")


def normalize_facet(value: str | None, fallback: str) -> str:
    """Fold a dimension/category label to one canonical spelling.

    The vocabulary is open, so 'Dynamic Status', 'dynamic status' and
    'dynamic_status' would otherwise become three separate buckets holding one
    fact each. Case and separators are collapsed here, at the single write path
    every caller goes through; genuine synonyms are a prompt problem, not this
    function's job.
    """
    folded = "_".join((value or "").strip().lower().replace("-", " ").replace("_", " ").split())
    return folded or fallback


async def get_fact_vocabulary(user_id: str) -> dict[str, list[str]]:
    """Dimensions and categories this user's facts already use, so the agent can
    reuse a label instead of coining a near-duplicate of it."""
    async with _db_pool().connection() as conn:
        cur = await conn.execute(
            "SELECT DISTINCT dimension, category FROM contact_profiles WHERE user_id = %s",
            (user_id,),
        )
        rows = await cur.fetchall()

    return {
        "dimensions": sorted({r[0] for r in rows if r[0]} | set(BUILTIN_DIMENSIONS)),
        "categories": sorted({r[1] for r in rows if r[1]}),
    }


async def add_contact_profile(
    user_id: str,
    contact_id: str,
    dimension: str,
    category: str,
    fact_key: str,
    fact_value: str,
    confidence: float = 1.0,
    source_type: str = "manual",
    source_id: str | None = None,
) -> dict:
    dimension = normalize_facet(dimension, "basic")
    category = normalize_facet(category, "other")
    async with _db_pool().connection() as conn:
        cur = await conn.execute(
            """
            INSERT INTO contact_profiles (user_id, contact_id, dimension, category, fact_key, fact_value, confidence, source_type, source_id)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
            RETURNING id, dimension, category, fact_key, fact_value, confidence, created_at, source_type, source_id
            """,
            (user_id, contact_id, dimension, category, fact_key, fact_value, confidence, source_type, source_id),
        )
        r = await cur.fetchone()

    fact = {
        "id": str(r[0]),
        "dimension": r[1],
        "category": r[2],
        "fact_key": r[3],
        "fact_value": r[4],
        "confidence": r[5],
        "created_at": r[6].isoformat() if r[6] else None,
        "source_type": r[7],
        "source_id": r[8] or "",
    }
    # ponytail: one embedding round trip per fact. ContactBrainService adds ~5 facts
    # per extraction; batch them through upsert_contact_docs if that latency shows up.
    await _index_docs(
        [vector_store.contact_fact_doc(user_id, contact_id, await _contact_name(user_id, contact_id), fact)],
        "contact_profiles",
        fact["id"],
    )
    return fact


async def update_contact_profile(
    user_id: str,
    contact_id: str,
    fact_id: str,
    dimension: str,
    category: str,
    fact_key: str,
    fact_value: str,
    confidence: float = 1.0,
    source_type: str = "manual",
    source_id: str | None = None,
) -> dict | None:
    dimension = normalize_facet(dimension, "basic")
    category = normalize_facet(category, "other")
    async with _db_pool().connection() as conn:
        cur = await conn.execute(
            """
            UPDATE contact_profiles
            SET dimension = %s, category = %s, fact_key = %s, fact_value = %s,
                confidence = %s, source_type = %s, source_id = %s, indexed_at = NULL
            WHERE id = %s AND contact_id = %s AND user_id = %s
            RETURNING id, dimension, category, fact_key, fact_value, confidence, created_at, source_type, source_id
            """,
            (dimension, category, fact_key, fact_value, confidence, source_type, source_id, fact_id, contact_id, user_id),
        )
        r = await cur.fetchone()

    if not r:
        return None

    fact = {
        "id": str(r[0]),
        "dimension": r[1],
        "category": r[2],
        "fact_key": r[3],
        "fact_value": r[4],
        "confidence": r[5],
        "created_at": r[6].isoformat() if r[6] else None,
        "source_type": r[7],
        "source_id": r[8] or "",
    }
    await _index_docs(
        [vector_store.contact_fact_doc(user_id, contact_id, await _contact_name(user_id, contact_id), fact)],
        "contact_profiles",
        fact["id"],
    )
    return fact


async def delete_contact_profile(user_id: str, contact_id: str, fact_id: str) -> bool:
    async with _db_pool().connection() as conn:
        cur = await conn.execute(
            "DELETE FROM contact_profiles WHERE id = %s AND contact_id = %s AND user_id = %s RETURNING id",
            (fact_id, contact_id, user_id),
        )
        deleted = await cur.fetchone() is not None

    if deleted:
        await _unindex([fact_id])
    return deleted


# --- Contact Tags Operations ---

async def get_contact_tags(user_id: str, contact_id: str) -> list[str]:
    async with _db_pool().connection() as conn:
        cur = await conn.execute(
            "SELECT tag_name FROM contact_tags WHERE user_id = %s AND contact_id = %s ORDER BY created_at ASC",
            (user_id, contact_id),
        )
        rows = await cur.fetchall()

    return [r[0] for r in rows]


# ponytail: tags ride along in the identity doc, so a tag added on its own only
# reaches Qdrant on the next contact update. Swap for client.set_payload if tag
# filtering on the vector side starts mattering.
async def add_contact_tag(user_id: str, contact_id: str, tag_name: str, tag_category: str = "general") -> bool:
    async with _db_pool().connection() as conn:
        cur = await conn.execute(
            """
            INSERT INTO contact_tags (user_id, contact_id, tag_name, tag_category)
            VALUES (%s, %s, %s, %s)
            ON CONFLICT (contact_id, tag_name) DO NOTHING
            RETURNING id
            """,
            (user_id, contact_id, tag_name, tag_category),
        )
        return await cur.fetchone() is not None


async def get_all_user_tags(user_id: str) -> list[str]:
    async with _db_pool().connection() as conn:
        cur = await conn.execute(
            "SELECT DISTINCT tag_name FROM contact_tags WHERE user_id = %s ORDER BY tag_name ASC",
            (user_id,),
        )
        rows = await cur.fetchall()

    return [r[0] for r in rows]


# --- Contact Interactions Operations ---

async def get_contact_interactions(user_id: str, contact_id: str) -> list[dict]:
    async with _db_pool().connection() as conn:
        cur = await conn.execute(
            """
            SELECT id, source_type, summary, raw_snippet, event_date, created_at
            FROM contact_interactions
            WHERE user_id = %s AND contact_id = %s
            ORDER BY event_date DESC
            """,
            (user_id, contact_id),
        )
        rows = await cur.fetchall()

    return [
        {
            "id": str(r[0]),
            "source_type": r[1],
            "summary": r[2],
            "raw_snippet": r[3] or "",
            "event_date": r[4].isoformat() if r[4] else None,
            "created_at": r[5].isoformat() if r[5] else None,
        }
        for r in rows
    ]


async def add_contact_interaction(
    user_id: str,
    contact_id: str,
    source_type: str,
    summary: str,
    raw_snippet: str = "",
) -> dict:
    async with _db_pool().connection() as conn:
        cur = await conn.execute(
            """
            INSERT INTO contact_interactions (user_id, contact_id, source_type, summary, raw_snippet)
            VALUES (%s, %s, %s, %s, %s)
            RETURNING id, source_type, summary, raw_snippet, event_date, created_at
            """,
            (user_id, contact_id, source_type, summary, raw_snippet),
        )
        r = await cur.fetchone()

    interaction = {
        "id": str(r[0]),
        "source_type": r[1],
        "summary": r[2],
        "raw_snippet": r[3] or "",
        "event_date": r[4].isoformat() if r[4] else None,
        "created_at": r[5].isoformat() if r[5] else None,
    }
    await _index_docs(
        [
            vector_store.contact_interaction_doc(
                user_id, contact_id, await _contact_name(user_id, contact_id), interaction
            )
        ],
        "contact_interactions",
        interaction["id"],
    )
    return interaction


# --- MS Graph Sync Helpers ---

async def upsert_contact_from_microsoft(
    user_id: str,
    outlook_contact_id: str,
    name: str,
    email: str = "",
    phone: str = "",
    company: str = "",
    job_title: str = "",
) -> tuple[dict, bool]:
    async with _db_pool().connection() as conn:
        cur = await conn.execute(
            f"SELECT {_CONTACT_COLS} FROM contacts WHERE user_id = %s AND (outlook_contact_id = %s OR (email <> '' AND email = %s))",
            (user_id, outlook_contact_id, email),
        )
        row = await cur.fetchone()

        if row:
            cid = str(row[0])
            cur = await conn.execute(
                f"""
                UPDATE contacts
                SET outlook_contact_id = %s, name = %s, email = %s, phone = %s, company = %s, job_title = %s, last_synced_at = NOW(), updated_at = NOW()
                WHERE id = %s AND user_id = %s
                RETURNING {_CONTACT_COLS}
                """,
                (outlook_contact_id, name, email or row[4], phone or row[5], company or row[6], job_title or row[7], cid, user_id),
            )
            result_row, is_new = await cur.fetchone(), False
        else:
            cur = await conn.execute(
                f"""
                INSERT INTO contacts (user_id, outlook_contact_id, name, email, phone, company, job_title, last_synced_at)
                VALUES (%s, %s, %s, %s, %s, %s, %s, NOW())
                RETURNING {_CONTACT_COLS}
                """,
                (user_id, outlook_contact_id, name, email, phone, company, job_title),
            )
            result_row, is_new = await cur.fetchone(), True

    # Index outside the connection block: the row must be committed first, and
    # _index_docs checks out its own connection.
    contact = _row_to_contact_dict(result_row)
    await _index_docs([vector_store.contact_identity_doc(contact)], "contacts", contact["id"])
    return contact, is_new


# --- Vector Index Rebuild / Compensation ---

async def reindex_pending(user_id: str | None = None, limit: int = 500) -> dict:
    """Index every row a previous write failed to index (indexed_at IS NULL).

    This is the compensation half of the best-effort writes in _index_docs: the
    DB write always won, so the backlog is simply the NULL rows. Call
    reset_index_state() first to force a full rebuild.
    """
    scope = "AND user_id = %s" if user_id else ""
    args: tuple = (user_id, limit) if user_id else (limit,)
    counts = {"identity": 0, "profile": 0, "interaction": 0, "pending": 0}

    async with _db_pool().connection() as conn:
        cur = await conn.execute(
            f"SELECT {_CONTACT_COLS} FROM contacts WHERE indexed_at IS NULL {scope} ORDER BY updated_at LIMIT %s",
            args,
        )
        contact_rows = await cur.fetchall()
        cur = await conn.execute(
            f"""
            SELECT p.id, p.user_id, p.contact_id, c.name, p.dimension, p.category, p.fact_key,
                   p.fact_value, p.confidence, p.source_type, p.source_id
            FROM contact_profiles p JOIN contacts c ON c.id = p.contact_id
            WHERE p.indexed_at IS NULL {scope.replace("user_id", "p.user_id")} ORDER BY p.created_at LIMIT %s
            """,
            args,
        )
        fact_rows = await cur.fetchall()
        cur = await conn.execute(
            f"""
            SELECT i.id, i.user_id, i.contact_id, c.name, i.source_type, i.summary, i.raw_snippet, i.event_date
            FROM contact_interactions i JOIN contacts c ON c.id = i.contact_id
            WHERE i.indexed_at IS NULL {scope.replace("user_id", "i.user_id")} ORDER BY i.created_at LIMIT %s
            """,
            args,
        )
        interaction_rows = await cur.fetchall()

    for row in contact_rows:
        contact = _row_to_contact_dict(row)
        contact["tags"] = await get_contact_tags(contact["user_id"], contact["id"])
        await _index_docs(
            [vector_store.contact_identity_doc(contact, contact["tags"])], "contacts", contact["id"]
        )
        counts["identity"] += 1

    for r in fact_rows:
        fact = {
            "id": str(r[0]),
            "dimension": r[4],
            "category": r[5],
            "fact_key": r[6],
            "fact_value": r[7],
            "confidence": r[8],
            "source_type": r[9],
            "source_id": r[10] or "",
        }
        await _index_docs(
            [vector_store.contact_fact_doc(r[1], str(r[2]), r[3], fact)], "contact_profiles", fact["id"]
        )
        counts["profile"] += 1

    for r in interaction_rows:
        interaction = {
            "id": str(r[0]),
            "source_type": r[4],
            "summary": r[5],
            "raw_snippet": r[6] or "",
            "event_date": r[7].isoformat() if r[7] else None,
        }
        await _index_docs(
            [vector_store.contact_interaction_doc(r[1], str(r[2]), r[3], interaction)],
            "contact_interactions",
            interaction["id"],
        )
        counts["interaction"] += 1

    # _index_docs swallows failures, so re-read the backlog rather than assuming
    # success. Non-zero means rows failed again or were past this batch's limit.
    counts["pending"] = await count_pending(user_id)
    return counts


async def count_pending(user_id: str | None = None) -> int:
    """Rows still missing from the vector index."""
    scope = "AND user_id = %s" if user_id else ""
    args: tuple = (user_id,) * 3 if user_id else ()
    async with _db_pool().connection() as conn:
        cur = await conn.execute(
            f"""
            SELECT (SELECT COUNT(*) FROM contacts WHERE indexed_at IS NULL {scope})
                 + (SELECT COUNT(*) FROM contact_profiles WHERE indexed_at IS NULL {scope})
                 + (SELECT COUNT(*) FROM contact_interactions WHERE indexed_at IS NULL {scope})
            """,
            args,
        )
        row = await cur.fetchone()
    return int(row[0])


async def reset_index_state(user_id: str | None = None) -> None:
    """Mark everything unindexed so reindex_pending() performs a full rebuild."""
    scope = "WHERE user_id = %s" if user_id else ""
    args: tuple = (user_id,) if user_id else ()
    async with _db_pool().connection() as conn:
        for table in ("contacts", "contact_profiles", "contact_interactions"):
            await conn.execute(f"UPDATE {table} SET indexed_at = NULL {scope}", args)
