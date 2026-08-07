import json
import logging
from typing import Any

from app.infrastructure.db.pool import get_pool

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
    dimension TEXT NOT NULL,  -- 'basic', 'business', 'private', 'dynamic'
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
"""

def _db_pool():
    pool = get_pool()
    if pool is None:
        raise RuntimeError("Database pool is not initialized")
    return pool


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
    }


_CONTACT_COLS = "id, user_id, outlook_contact_id, name, email, phone, company, job_title, location, ai_summary, last_synced_at, created_at, updated_at"


async def list_contacts(user_id: str, query: str | None = None, tag: str | None = None) -> list[dict]:
    async with _db_pool().connection() as conn:
        if tag:
            sql = f"""
                SELECT DISTINCT c.id, c.user_id, c.outlook_contact_id, c.name, c.email, c.phone, c.company, c.job_title, c.location, c.ai_summary, c.last_synced_at, c.created_at, c.updated_at
                FROM contacts c
                JOIN contact_tags t ON c.id = t.contact_id
                WHERE c.user_id = %s AND t.tag_name = %s
            """
            params = [user_id, tag]
            if query:
                sql += " AND (c.name ILIKE %s OR c.email ILIKE %s OR c.company ILIKE %s OR c.job_title ILIKE %s)"
                q_pat = f"%{query}%"
                params.extend([q_pat, q_pat, q_pat, q_pat])
            sql += " ORDER BY c.updated_at DESC"
            cur = await conn.execute(sql, tuple(params))
        else:
            sql = f"SELECT {_CONTACT_COLS} FROM contacts WHERE user_id = %s"
            params = [user_id]
            if query:
                sql += " AND (name ILIKE %s OR email ILIKE %s OR company ILIKE %s OR job_title ILIKE %s)"
                q_pat = f"%{query}%"
                params.extend([q_pat, q_pat, q_pat, q_pat])
            sql += " ORDER BY updated_at DESC"
            cur = await conn.execute(sql, tuple(params))

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

        if not updates:
            return await get_contact_by_id(user_id, contact_id)

        updates.append("updated_at = NOW()")
        params.extend([contact_id, user_id])

        sql = f"UPDATE contacts SET {', '.join(updates)} WHERE id = %s AND user_id = %s RETURNING {_CONTACT_COLS}"
        cur = await conn.execute(sql, tuple(params))
        row = await cur.fetchone()

    if not row:
        return None

    return await get_contact_by_id(user_id, contact_id)


async def delete_contact(user_id: str, contact_id: str) -> bool:
    async with _db_pool().connection() as conn:
        cur = await conn.execute(
            "DELETE FROM contacts WHERE id = %s AND user_id = %s RETURNING id",
            (contact_id, user_id),
        )
        return await cur.fetchone() is not None


# --- Contact Profiles (Facts) Operations ---

async def get_contact_profiles(user_id: str, contact_id: str) -> list[dict]:
    async with _db_pool().connection() as conn:
        cur = await conn.execute(
            """
            SELECT id, dimension, category, fact_key, fact_value, confidence, created_at
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
        }
        for r in rows
    ]


async def add_contact_profile(
    user_id: str,
    contact_id: str,
    dimension: str,
    category: str,
    fact_key: str,
    fact_value: str,
    confidence: float = 1.0,
) -> dict:
    async with _db_pool().connection() as conn:
        cur = await conn.execute(
            """
            INSERT INTO contact_profiles (user_id, contact_id, dimension, category, fact_key, fact_value, confidence)
            VALUES (%s, %s, %s, %s, %s, %s, %s)
            RETURNING id, dimension, category, fact_key, fact_value, confidence, created_at
            """,
            (user_id, contact_id, dimension, category, fact_key, fact_value, confidence),
        )
        r = await cur.fetchone()

    return {
        "id": str(r[0]),
        "dimension": r[1],
        "category": r[2],
        "fact_key": r[3],
        "fact_value": r[4],
        "confidence": r[5],
        "created_at": r[6].isoformat() if r[6] else None,
    }


async def delete_contact_profile(user_id: str, contact_id: str, fact_id: str) -> bool:
    async with _db_pool().connection() as conn:
        cur = await conn.execute(
            "DELETE FROM contact_profiles WHERE id = %s AND contact_id = %s AND user_id = %s RETURNING id",
            (fact_id, contact_id, user_id),
        )
        return await cur.fetchone() is not None


# --- Contact Tags Operations ---

async def get_contact_tags(user_id: str, contact_id: str) -> list[str]:
    async with _db_pool().connection() as conn:
        cur = await conn.execute(
            "SELECT tag_name FROM contact_tags WHERE user_id = %s AND contact_id = %s ORDER BY created_at ASC",
            (user_id, contact_id),
        )
        rows = await cur.fetchall()

    return [r[0] for r in rows]


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

    return {
        "id": str(r[0]),
        "source_type": r[1],
        "summary": r[2],
        "raw_snippet": r[3] or "",
        "event_date": r[4].isoformat() if r[4] else None,
        "created_at": r[5].isoformat() if r[5] else None,
    }


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
            updated_row = await cur.fetchone()
            return _row_to_contact_dict(updated_row), False
        else:
            cur = await conn.execute(
                f"""
                INSERT INTO contacts (user_id, outlook_contact_id, name, email, phone, company, job_title, last_synced_at)
                VALUES (%s, %s, %s, %s, %s, %s, %s, NOW())
                RETURNING {_CONTACT_COLS}
                """,
                (user_id, outlook_contact_id, name, email, phone, company, job_title),
            )
            inserted_row = await cur.fetchone()
            return _row_to_contact_dict(inserted_row), True
