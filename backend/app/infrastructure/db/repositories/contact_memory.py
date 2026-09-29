"""Postgres storage for Memora-style Contact Memory artifacts.

``contact_profiles`` remains the current-value projection consumed by the UI.
Primary Abstraction, Evidence, Revision, Cue Anchor, and Judge audit data are
kept beside it, and authoritative Judge actions are applied transactionally.
"""

import json
import re
import unicodedata
import uuid
from datetime import datetime

from app.infrastructure.db.pool import get_pool

_SCHEMA = """
alter table contact_profiles add column if not exists primary_abstraction text;
alter table contact_profiles add column if not exists memory_status text not null default 'active';
alter table contact_profiles add column if not exists version integer not null default 1;
alter table contact_profiles add column if not exists occurred_at timestamptz;
alter table contact_profiles add column if not exists updated_at timestamptz not null default now();
alter table contact_profiles add column if not exists abstraction_indexed_at timestamptz;

alter table contact_profiles drop constraint if exists contact_profiles_memory_status_check;
alter table contact_profiles add constraint contact_profiles_memory_status_check
    check (memory_status in ('active', 'superseded', 'disputed', 'deleted'));

create index if not exists idx_contact_profiles_abstraction_pending
    on contact_profiles (user_id, contact_id)
    where primary_abstraction is null;
create index if not exists idx_contact_profiles_abstraction_index_pending
    on contact_profiles (user_id, updated_at)
    where primary_abstraction is not null and abstraction_indexed_at is null;

create table if not exists contact_memory_evidence (
    id uuid primary key default gen_random_uuid(),
    user_id text not null,
    memory_id uuid not null references contact_profiles(id) on delete cascade,
    contact_id uuid not null references contacts(id) on delete cascade,
    observed_value text not null,
    source_type text not null,
    source_id text,
    interaction_id uuid references contact_interactions(id) on delete set null,
    occurred_at timestamptz,
    confidence float not null default 1.0,
    created_at timestamptz not null default now(),
    check (confidence >= 0.0 and confidence <= 1.0)
);

create index if not exists idx_contact_memory_evidence_memory
    on contact_memory_evidence (user_id, memory_id, created_at desc);
create index if not exists idx_contact_memory_evidence_source
    on contact_memory_evidence (user_id, source_type, source_id)
    where source_id is not null;
create unique index if not exists uq_contact_memory_evidence_source_value
    on contact_memory_evidence (user_id, memory_id, source_type, source_id, observed_value)
    where source_id is not null;

create table if not exists contact_memory_revisions (
    id uuid primary key default gen_random_uuid(),
    user_id text not null,
    memory_id uuid not null references contact_profiles(id) on delete cascade,
    version integer not null,
    operation text not null,
    previous_abstraction text,
    next_abstraction text not null,
    previous_value text,
    next_value text not null,
    decision_reason text,
    decision_metadata jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now(),
    unique (memory_id, version),
    check (operation in ('create', 'merge', 'correct', 'conflict', 'delete', 'restore'))
);

create index if not exists idx_contact_memory_revisions_memory
    on contact_memory_revisions (user_id, memory_id, version desc);

create table if not exists contact_memory_shadow_decisions (
    id uuid primary key default gen_random_uuid(),
    user_id text not null,
    contact_id uuid not null references contacts(id) on delete cascade,
    source_type text not null,
    source_id text,
    candidate_payload jsonb not null,
    retrieved_memory_ids jsonb not null default '[]'::jsonb,
    v1_requested_action text not null,
    v1_outcome text not null,
    judge_action text not null,
    target_memory_id uuid references contact_profiles(id) on delete set null,
    merged_abstraction text,
    merged_value text,
    reason text,
    confidence float not null,
    prompt_version text not null,
    created_at timestamptz not null default now(),
    check (v1_requested_action in ('new', 'update', 'delete', 'skip')),
    check (v1_outcome in ('created', 'updated', 'deleted', 'skipped')),
    check (judge_action in ('create', 'merge', 'noop', 'conflict')),
    check (confidence >= 0.0 and confidence <= 1.0)
);

create index if not exists idx_contact_memory_shadow_decisions_user
    on contact_memory_shadow_decisions (user_id, created_at desc);
create index if not exists idx_contact_memory_shadow_decisions_comparison
    on contact_memory_shadow_decisions (user_id, v1_outcome, judge_action, created_at desc);

create table if not exists contact_memory_cues (
    id uuid primary key default gen_random_uuid(),
    user_id text not null,
    cue_text text not null,
    normalized_cue text not null,
    cue_type text not null default 'semantic',
    indexed_at timestamptz,
    created_at timestamptz not null default now(),
    unique (user_id, normalized_cue),
    check (cue_type in ('semantic', 'temporal', 'entity', 'other'))
);

create table if not exists contact_memory_cue_links (
    user_id text not null,
    cue_id uuid not null references contact_memory_cues(id) on delete cascade,
    memory_id uuid not null references contact_profiles(id) on delete cascade,
    contact_id uuid not null references contacts(id) on delete cascade,
    created_at timestamptz not null default now(),
    primary key (cue_id, memory_id)
);

create index if not exists idx_contact_memory_cues_index_pending
    on contact_memory_cues (user_id, created_at)
    where indexed_at is null;
create index if not exists idx_contact_memory_cue_links_memory
    on contact_memory_cue_links (user_id, memory_id);
create index if not exists idx_contact_memory_cue_links_contact
    on contact_memory_cue_links (user_id, contact_id, cue_id);
"""


def _db_pool():
    pool = get_pool()
    if pool is None:
        raise RuntimeError("Database pool is not initialized")
    return pool


async def init_schema() -> None:
    async with _db_pool().connection() as conn:
        await conn.execute(_SCHEMA)


async def get_contact_name(user_id: str, contact_id: str) -> str:
    async with _db_pool().connection() as conn:
        cur = await conn.execute(
            "select name from contacts where id = %s and user_id = %s",
            (contact_id, user_id),
        )
        row = await cur.fetchone()
    return row[0] if row else ""


async def get_memory_snapshot(user_id: str, contact_id: str, memory_id: str) -> dict | None:
    async with _db_pool().connection() as conn:
        cur = await conn.execute(
            """
            select id, primary_abstraction, fact_value, version, memory_status
            from contact_profiles
            where id = %s and contact_id = %s and user_id = %s
            """,
            (memory_id, contact_id, user_id),
        )
        row = await cur.fetchone()
    if not row:
        return None
    return {
        "id": str(row[0]),
        "primary_abstraction": row[1] or "",
        "fact_value": row[2],
        "version": row[3],
        "memory_status": row[4],
    }


def _interaction_id(source_type: str, source_id: str | None) -> str | None:
    if source_type != "chat_paste" or not source_id:
        return None
    try:
        return str(uuid.UUID(source_id))
    except ValueError:
        return None


async def record_shadow_write(
    *,
    user_id: str,
    contact_id: str,
    memory_id: str,
    primary_abstraction: str,
    observed_value: str,
    next_value: str,
    source_type: str,
    source_id: str | None,
    occurred_at: datetime | None,
    confidence: float,
    outcome: str,
    requested_action: str,
    previous: dict | None = None,
) -> dict:
    """Atomically attach shadow metadata, evidence, and one revision."""

    version_increment = 1 if outcome == "updated" else 0
    operation = "correct" if outcome == "updated" else "create"
    previous = previous or {}
    metadata = json.dumps(
        {
            "schema_version": 1,
            "mode": "shadow",
            "requested_action": requested_action,
            "outcome": outcome,
        },
        ensure_ascii=False,
    )

    async with _db_pool().connection() as conn:
        cur = await conn.execute(
            """
            insert into contact_memory_evidence
                (user_id, memory_id, contact_id, observed_value, source_type,
                 source_id, interaction_id, occurred_at, confidence)
            select %s, p.id, p.contact_id, %s, %s, %s, %s, %s, %s
            from contact_profiles p
            where p.id = %s and p.contact_id = %s and p.user_id = %s
            on conflict do nothing
            returning id
            """,
            (
                user_id,
                observed_value,
                source_type,
                source_id,
                _interaction_id(source_type, source_id),
                occurred_at,
                confidence,
                memory_id,
                contact_id,
                user_id,
            ),
        )
        evidence_row = await cur.fetchone()

        # A source/value pair is idempotent. If it was already mirrored, do not
        # increment the memory version or append a duplicate revision.
        if not evidence_row and source_id is not None:
            cur = await conn.execute(
                """
                select primary_abstraction, fact_value, version
                from contact_profiles
                where id = %s and contact_id = %s and user_id = %s
                """,
                (memory_id, contact_id, user_id),
            )
            existing_row = await cur.fetchone()
            if not existing_row:
                raise ValueError("contact memory disappeared before shadow artifacts were recorded")
            return {
                "memory_id": memory_id,
                "primary_abstraction": existing_row[0] or primary_abstraction,
                "version": existing_row[2],
                "evidence_id": None,
                "revision_id": None,
            }

        cur = await conn.execute(
            """
            update contact_profiles
            set primary_abstraction = case
                    when primary_abstraction is null or primary_abstraction = '' then %s
                    else primary_abstraction
                end,
                occurred_at = coalesce(%s, occurred_at),
                version = version + %s,
                abstraction_indexed_at = null,
                updated_at = now()
            where id = %s and contact_id = %s and user_id = %s
            returning primary_abstraction, fact_value, version
            """,
            (
                primary_abstraction,
                occurred_at,
                version_increment,
                memory_id,
                contact_id,
                user_id,
            ),
        )
        memory_row = await cur.fetchone()
        if not memory_row:
            raise ValueError("contact memory disappeared before shadow artifacts were recorded")

        actual_abstraction, actual_value, version = memory_row

        cur = await conn.execute(
            """
            insert into contact_memory_revisions
                (user_id, memory_id, version, operation, previous_abstraction,
                 next_abstraction, previous_value, next_value, decision_reason,
                 decision_metadata)
            values (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s::jsonb)
            on conflict (memory_id, version) do nothing
            returning id
            """,
            (
                user_id,
                memory_id,
                version,
                operation,
                previous.get("primary_abstraction") or None,
                actual_abstraction,
                previous.get("fact_value"),
                actual_value or next_value,
                "v1 write mirrored into phase-1 shadow artifacts",
                metadata,
            ),
        )
        revision_row = await cur.fetchone()

    return {
        "memory_id": memory_id,
        "primary_abstraction": actual_abstraction,
        "version": version,
        "evidence_id": str(evidence_row[0]) if evidence_row else None,
        "revision_id": str(revision_row[0]) if revision_row else None,
    }


async def record_shadow_evidence(
    *,
    user_id: str,
    contact_id: str,
    memory_id: str,
    observed_value: str,
    source_type: str,
    source_id: str | None,
    occurred_at: datetime | None,
    confidence: float,
) -> str | None:
    """Record duplicate/no-op evidence without creating a revision."""

    async with _db_pool().connection() as conn:
        cur = await conn.execute(
            """
            insert into contact_memory_evidence
                (user_id, memory_id, contact_id, observed_value, source_type,
                 source_id, interaction_id, occurred_at, confidence)
            select %s, p.id, p.contact_id, %s, %s, %s, %s, %s, %s
            from contact_profiles p
            where p.id = %s and p.contact_id = %s and p.user_id = %s
            on conflict do nothing
            returning id
            """,
            (
                user_id,
                observed_value,
                source_type,
                source_id,
                _interaction_id(source_type, source_id),
                occurred_at,
                confidence,
                memory_id,
                contact_id,
                user_id,
            ),
        )
        row = await cur.fetchone()
    return str(row[0]) if row else None


def default_primary_abstraction(contact_name: str, fact_key: str) -> str:
    """Build the deterministic v1-to-v2 abstraction used by shadow backfill."""

    topic = " ".join((fact_key.strip() or "note").replace("_", " ").split())
    return f"{contact_name.strip()} · {topic}" if contact_name.strip() else topic


def normalize_cue(cue_text: str) -> str:
    normalized = unicodedata.normalize("NFKC", cue_text).strip().lower()
    return re.sub(r"\s+", " ", normalized)


def default_cue_anchors(contact_name: str, fact_key: str, category: str) -> list[dict]:
    """Build value-free recall phrases for legacy rows without extracted cues."""

    name = " ".join(contact_name.split())
    topic = " ".join((fact_key.strip() or "note").replace("_", " ").split())
    category_text = " ".join((category or "").replace("_", " ").split())
    values = [f"{name} {topic}".strip(), topic]
    if category_text and category_text != "other":
        values.insert(1, f"{name} {category_text}".strip())

    cues: list[dict] = []
    seen: set[str] = set()
    for value in values:
        normalized = normalize_cue(value)
        if not normalized or normalized in seen:
            continue
        cues.append({"cue_text": value, "cue_type": "semantic"})
        seen.add(normalized)
        if len(cues) == 3:
            break
    return cues


def _normalize_facet(value: str, fallback: str) -> str:
    folded = "_".join(
        (value or "").strip().lower().replace("-", " ").replace("_", " ").split()
    )
    return folded or fallback


def _fact_dict(row) -> dict:
    return {
        "id": str(row[0]),
        "dimension": row[1],
        "category": row[2],
        "fact_key": row[3],
        "fact_value": row[4],
        "confidence": row[5],
        "created_at": row[6].isoformat() if row[6] else None,
        "source_type": row[7] or "",
        "source_id": row[8] or "",
    }


async def apply_authoritative_judge_action(
    *,
    user_id: str,
    contact_id: str,
    action: str,
    target_memory_id: str,
    primary_abstraction: str,
    merged_abstraction: str,
    merged_value: str,
    dimension: str,
    category: str,
    fact_key: str,
    observed_value: str,
    source_type: str,
    source_id: str | None,
    occurred_at: datetime | None,
    confidence: float,
    reason: str,
    prompt_version: str,
) -> dict:
    """Apply a validated merge/noop/conflict decision in one transaction.

    The target is locked and scoped to the caller's user/contact. ``noop`` only
    appends evidence. ``merge`` updates the current projection and revision.
    ``conflict`` preserves both statements as disputed memories and appends a
    revision to each side.
    """

    if action not in {"merge", "noop", "conflict"}:
        raise ValueError("authoritative Judge action must be merge, noop, or conflict")
    if not target_memory_id:
        raise ValueError("authoritative Judge action requires a target memory")

    dimension = _normalize_facet(dimension, "basic")
    category = _normalize_facet(category, "other")
    fact_key = fact_key.strip() or "note"
    abstraction = (merged_abstraction or primary_abstraction).strip()
    next_value = (merged_value or observed_value).strip()
    metadata = json.dumps(
        {
            "schema_version": 1,
            "mode": "authoritative",
            "judge_action": action,
            "prompt_version": prompt_version,
            "target_memory_id": target_memory_id,
            "confidence": confidence,
        },
        ensure_ascii=False,
    )

    async with _db_pool().connection() as conn:
        cur = await conn.execute(
            """
            select id, dimension, category, fact_key, fact_value, confidence,
                   created_at, source_type, source_id, primary_abstraction,
                   version, memory_status
            from contact_profiles
            where id = %s and contact_id = %s and user_id = %s
              and memory_status <> 'deleted'
            for update
            """,
            (target_memory_id, contact_id, user_id),
        )
        target = await cur.fetchone()
        if not target:
            raise ValueError("Judge target is outside the user/contact scope or deleted")

        cur = await conn.execute(
            """
            insert into contact_memory_evidence
                (user_id, memory_id, contact_id, observed_value, source_type,
                 source_id, interaction_id, occurred_at, confidence)
            values (%s, %s, %s, %s, %s, %s, %s, %s, %s)
            on conflict do nothing
            returning id
            """,
            (
                user_id,
                target_memory_id,
                contact_id,
                observed_value,
                source_type,
                source_id,
                _interaction_id(source_type, source_id),
                occurred_at,
                confidence,
            ),
        )
        evidence_row = await cur.fetchone()

        # Replaying the same source/value must not increment a version or create
        # a second conflicting row. Return the locked current projection.
        if evidence_row is None and source_id is not None:
            return {
                "outcome": "skipped",
                "fact": _fact_dict(target),
                "affected_memories": [
                    {
                        "memory_id": str(target[0]),
                        "user_id": user_id,
                        "contact_id": contact_id,
                        "primary_abstraction": target[9] or primary_abstraction,
                        "dimension": target[1],
                        "category": target[2],
                        "memory_status": target[11],
                    }
                ],
                "reason": "source observation was already applied",
            }

        if action == "noop":
            return {
                "outcome": "skipped",
                "fact": _fact_dict(target),
                "affected_memories": [],
                "reason": reason or "Judge found no new information",
            }

        if action == "merge":
            previous_abstraction = target[9] or primary_abstraction
            next_version = int(target[10]) + 1
            cur = await conn.execute(
                """
                update contact_profiles
                set dimension = %s, category = %s, fact_key = %s,
                    fact_value = %s, confidence = %s, source_type = %s,
                    source_id = %s, primary_abstraction = %s,
                    occurred_at = coalesce(%s, occurred_at), version = %s,
                    memory_status = 'active', indexed_at = null,
                    abstraction_indexed_at = null, updated_at = now()
                where id = %s and contact_id = %s and user_id = %s
                returning id, dimension, category, fact_key, fact_value,
                          confidence, created_at, source_type, source_id
                """,
                (
                    dimension,
                    category,
                    fact_key,
                    next_value,
                    confidence,
                    source_type,
                    source_id,
                    abstraction,
                    occurred_at,
                    next_version,
                    target_memory_id,
                    contact_id,
                    user_id,
                ),
            )
            merged = await cur.fetchone()
            await conn.execute(
                """
                insert into contact_memory_revisions
                    (user_id, memory_id, version, operation,
                     previous_abstraction, next_abstraction,
                     previous_value, next_value, decision_reason,
                     decision_metadata)
                values (%s, %s, %s, 'merge', %s, %s, %s, %s, %s, %s::jsonb)
                """,
                (
                    user_id,
                    target_memory_id,
                    next_version,
                    previous_abstraction,
                    abstraction,
                    target[4],
                    next_value,
                    reason,
                    metadata,
                ),
            )
            return {
                "outcome": "updated",
                "fact": _fact_dict(merged),
                "affected_memories": [
                    {
                        "memory_id": target_memory_id,
                        "user_id": user_id,
                        "contact_id": contact_id,
                        "primary_abstraction": abstraction,
                        "dimension": dimension,
                        "category": category,
                        "memory_status": "active",
                    }
                ],
                "reason": reason,
            }

        # A conflict is represented by two intact disputed statements. The
        # candidate evidence belongs to the newly-created statement, so move it
        # from the locked target to the new row after insertion.
        cur = await conn.execute(
            """
            insert into contact_profiles
                (user_id, contact_id, dimension, category, fact_key, fact_value,
                 confidence, source_type, source_id, primary_abstraction,
                 memory_status, occurred_at)
            values (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, 'disputed', %s)
            returning id, dimension, category, fact_key, fact_value,
                      confidence, created_at, source_type, source_id
            """,
            (
                user_id,
                contact_id,
                dimension,
                category,
                fact_key,
                observed_value,
                confidence,
                source_type,
                source_id,
                abstraction,
                occurred_at,
            ),
        )
        conflicting = await cur.fetchone()
        new_memory_id = str(conflicting[0])
        if evidence_row:
            await conn.execute(
                """
                update contact_memory_evidence
                set memory_id = %s
                where id = %s and user_id = %s and memory_id = %s
                """,
                (new_memory_id, evidence_row[0], user_id, target_memory_id),
            )

        target_version = int(target[10]) + 1
        await conn.execute(
            """
            update contact_profiles
            set memory_status = 'disputed', version = %s,
                abstraction_indexed_at = null, updated_at = now()
            where id = %s and contact_id = %s and user_id = %s
            """,
            (target_version, target_memory_id, contact_id, user_id),
        )
        await conn.execute(
            """
            insert into contact_memory_revisions
                (user_id, memory_id, version, operation,
                 previous_abstraction, next_abstraction,
                 previous_value, next_value, decision_reason,
                 decision_metadata)
            values
                (%s, %s, %s, 'conflict', %s, %s, %s, %s, %s, %s::jsonb),
                (%s, %s, 1, 'conflict', null, %s, null, %s, %s, %s::jsonb)
            """,
            (
                user_id,
                target_memory_id,
                target_version,
                target[9] or primary_abstraction,
                target[9] or primary_abstraction,
                target[4],
                target[4],
                reason,
                metadata,
                user_id,
                new_memory_id,
                abstraction,
                observed_value,
                reason,
                metadata,
            ),
        )
        return {
            "outcome": "created",
            "fact": _fact_dict(conflicting),
            "affected_memories": [
                {
                    "memory_id": target_memory_id,
                    "user_id": user_id,
                    "contact_id": contact_id,
                    "primary_abstraction": target[9] or primary_abstraction,
                    "dimension": target[1],
                    "category": target[2],
                    "memory_status": "disputed",
                },
                {
                    "memory_id": new_memory_id,
                    "user_id": user_id,
                    "contact_id": contact_id,
                    "primary_abstraction": abstraction,
                    "dimension": dimension,
                    "category": category,
                    "memory_status": "disputed",
                },
            ],
            "reason": reason,
        }


async def set_memory_deleted(
    *,
    user_id: str,
    contact_id: str,
    memory_id: str,
    deleted: bool,
    reason: str,
) -> dict | None:
    """Soft-delete or restore a memory while preserving its full audit trail."""

    expected_status = "deleted" if not deleted else None
    next_status = "active" if not deleted else "deleted"
    operation = "restore" if not deleted else "delete"
    metadata = json.dumps(
        {"schema_version": 1, "mode": "authoritative", "operation": operation},
        ensure_ascii=False,
    )
    async with _db_pool().connection() as conn:
        status_clause = "and memory_status = 'deleted'" if expected_status else "and memory_status <> 'deleted'"
        cur = await conn.execute(
            f"""
            select id, dimension, category, fact_key, fact_value, confidence,
                   created_at, source_type, source_id, primary_abstraction,
                   version, memory_status
            from contact_profiles
            where id = %s and contact_id = %s and user_id = %s {status_clause}
            for update
            """,
            (memory_id, contact_id, user_id),
        )
        row = await cur.fetchone()
        if not row:
            return None
        version = int(row[10]) + 1
        cur = await conn.execute(
            """
            update contact_profiles
            set memory_status = %s, version = %s, indexed_at = null,
                abstraction_indexed_at = null, updated_at = now()
            where id = %s and contact_id = %s and user_id = %s
            returning id, dimension, category, fact_key, fact_value,
                      confidence, created_at, source_type, source_id
            """,
            (next_status, version, memory_id, contact_id, user_id),
        )
        updated = await cur.fetchone()
        await conn.execute(
            """
            insert into contact_memory_revisions
                (user_id, memory_id, version, operation,
                 previous_abstraction, next_abstraction,
                 previous_value, next_value, decision_reason,
                 decision_metadata)
            values (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s::jsonb)
            """,
            (
                user_id,
                memory_id,
                version,
                operation,
                row[9] or "",
                row[9] or "",
                row[4],
                row[4],
                reason,
                metadata,
            ),
        )
    return {
        "fact": _fact_dict(updated),
        "memory": {
            "memory_id": memory_id,
            "user_id": user_id,
            "contact_id": contact_id,
            "primary_abstraction": row[9] or default_primary_abstraction("", row[3]),
            "dimension": row[1],
            "category": row[2],
            "memory_status": next_status,
        },
    }


async def get_memory_history(
    *, user_id: str, contact_id: str, memory_id: str
) -> dict | None:
    """Return a scoped memory projection with append-only evidence/revisions."""

    async with _db_pool().connection() as conn:
        cur = await conn.execute(
            """
            select id, primary_abstraction, fact_value, dimension, category,
                   fact_key, memory_status, version, occurred_at, confidence,
                   created_at, updated_at
            from contact_profiles
            where id = %s and contact_id = %s and user_id = %s
            """,
            (memory_id, contact_id, user_id),
        )
        memory = await cur.fetchone()
        if not memory:
            return None
        cur = await conn.execute(
            """
            select id, observed_value, source_type, source_id, occurred_at,
                   confidence, created_at
            from contact_memory_evidence
            where user_id = %s and contact_id = %s and memory_id = %s
            order by created_at desc
            """,
            (user_id, contact_id, memory_id),
        )
        evidence = await cur.fetchall()
        cur = await conn.execute(
            """
            select id, version, operation, previous_abstraction,
                   next_abstraction, previous_value, next_value,
                   decision_reason, created_at
            from contact_memory_revisions
            where user_id = %s and memory_id = %s
            order by version desc
            """,
            (user_id, memory_id),
        )
        revisions = await cur.fetchall()
    return {
        "memory": {
            "memory_id": str(memory[0]),
            "primary_abstraction": memory[1] or "",
            "memory_value": memory[2],
            "dimension": memory[3],
            "category": memory[4],
            "fact_key": memory[5],
            "memory_status": memory[6],
            "version": memory[7],
            "occurred_at": memory[8].isoformat() if memory[8] else None,
            "confidence": memory[9],
            "created_at": memory[10].isoformat() if memory[10] else None,
            "updated_at": memory[11].isoformat() if memory[11] else None,
        },
        "evidence": [
            {
                "id": str(row[0]),
                "observed_value": row[1],
                "source_type": row[2],
                "source_id": row[3],
                "occurred_at": row[4].isoformat() if row[4] else None,
                "confidence": row[5],
                "created_at": row[6].isoformat() if row[6] else None,
            }
            for row in evidence
        ],
        "revisions": [
            {
                "id": str(row[0]),
                "version": row[1],
                "operation": row[2],
                "previous_abstraction": row[3],
                "next_abstraction": row[4],
                "previous_value": row[5],
                "next_value": row[6],
                "decision_reason": row[7],
                "created_at": row[8].isoformat() if row[8] else None,
            }
            for row in revisions
        ],
    }


async def restore_memory_revision(
    *,
    user_id: str,
    contact_id: str,
    memory_id: str,
    revision_version: int,
    reason: str,
) -> dict | None:
    """Restore a prior revision as a new append-only revision."""

    if revision_version < 1:
        raise ValueError("revision_version must be positive")
    async with _db_pool().connection() as conn:
        cur = await conn.execute(
            """
            select p.id, p.dimension, p.category, p.fact_key, p.fact_value,
                   p.confidence, p.created_at, p.source_type, p.source_id,
                   p.primary_abstraction, p.version,
                   r.next_abstraction, r.next_value
            from contact_profiles p
            join contact_memory_revisions r
              on r.memory_id = p.id and r.user_id = p.user_id
            where p.id = %s and p.contact_id = %s and p.user_id = %s
              and p.memory_status <> 'deleted' and r.version = %s
            for update of p
            """,
            (memory_id, contact_id, user_id, revision_version),
        )
        row = await cur.fetchone()
        if not row:
            return None
        next_version = int(row[10]) + 1
        cur = await conn.execute(
            """
            update contact_profiles
            set primary_abstraction = %s, fact_value = %s,
                memory_status = 'active', version = %s, indexed_at = null,
                abstraction_indexed_at = null, updated_at = now()
            where id = %s and contact_id = %s and user_id = %s
            returning id, dimension, category, fact_key, fact_value,
                      confidence, created_at, source_type, source_id
            """,
            (row[11], row[12], next_version, memory_id, contact_id, user_id),
        )
        restored = await cur.fetchone()
        metadata = json.dumps(
            {
                "schema_version": 1,
                "mode": "authoritative",
                "restored_from_version": revision_version,
            }
        )
        await conn.execute(
            """
            insert into contact_memory_revisions
                (user_id, memory_id, version, operation,
                 previous_abstraction, next_abstraction,
                 previous_value, next_value, decision_reason,
                 decision_metadata)
            values (%s, %s, %s, 'restore', %s, %s, %s, %s, %s, %s::jsonb)
            """,
            (
                user_id,
                memory_id,
                next_version,
                row[9],
                row[11],
                row[4],
                row[12],
                reason,
                metadata,
            ),
        )
    return {
        "fact": _fact_dict(restored),
        "memory": {
            "memory_id": memory_id,
            "user_id": user_id,
            "contact_id": contact_id,
            "primary_abstraction": row[11],
            "dimension": row[1],
            "category": row[2],
            "memory_status": "active",
        },
    }


async def backfill_missing_memories(*, user_id: str, limit: int = 500) -> list[dict]:
    """Backfill one resumable, tenant-scoped batch of legacy profile rows.

    Rows are locked with ``SKIP LOCKED`` and all artifacts for a row are written
    in the same transaction. A successful row stops matching the NULL predicate,
    so reruns do not create duplicate evidence or revisions.
    """

    if limit < 1 or limit > 2000:
        raise ValueError("limit must be between 1 and 2000")

    metadata = json.dumps(
        {
            "schema_version": 1,
            "mode": "shadow_backfill",
            "requested_action": "existing",
            "outcome": "backfilled",
        },
        ensure_ascii=False,
    )
    backfilled: list[dict] = []

    async with _db_pool().connection() as conn:
        cur = await conn.execute(
            """
            select p.id, p.contact_id, c.name, p.dimension, p.category,
                   p.fact_key, p.fact_value, p.confidence, p.source_type,
                   p.source_id, p.occurred_at, p.memory_status, p.version
            from contact_profiles p
            join contacts c on c.id = p.contact_id and c.user_id = p.user_id
            where p.user_id = %s and p.primary_abstraction is null
            order by p.created_at, p.id
            for update of p skip locked
            limit %s
            """,
            (user_id, limit),
        )
        rows = await cur.fetchall()

        for row in rows:
            memory_id = str(row[0])
            contact_id = str(row[1])
            abstraction = default_primary_abstraction(row[2] or "", row[5] or "note")
            source_type = row[8] or "unknown"
            source_id = row[9]
            version = int(row[12] or 1)

            cur = await conn.execute(
                """
                update contact_profiles
                set primary_abstraction = %s, updated_at = now()
                where id = %s and contact_id = %s and user_id = %s
                  and primary_abstraction is null
                returning id
                """,
                (abstraction, memory_id, contact_id, user_id),
            )
            if not await cur.fetchone():
                continue

            await conn.execute(
                """
                insert into contact_memory_evidence
                    (user_id, memory_id, contact_id, observed_value, source_type,
                     source_id, interaction_id, occurred_at, confidence)
                values (%s, %s, %s, %s, %s, %s, %s, %s, %s)
                on conflict do nothing
                """,
                (
                    user_id,
                    memory_id,
                    contact_id,
                    row[6],
                    source_type,
                    source_id,
                    _interaction_id(source_type, source_id),
                    row[10],
                    row[7] if row[7] is not None else 1.0,
                ),
            )
            await conn.execute(
                """
                insert into contact_memory_revisions
                    (user_id, memory_id, version, operation, next_abstraction,
                     next_value, decision_reason, decision_metadata)
                values (%s, %s, %s, 'create', %s, %s, %s, %s::jsonb)
                on conflict (memory_id, version) do nothing
                """,
                (
                    user_id,
                    memory_id,
                    version,
                    abstraction,
                    row[6],
                    "legacy contact profile mirrored by resumable backfill",
                    metadata,
                ),
            )
            backfilled.append(
                {
                    "memory_id": memory_id,
                    "user_id": user_id,
                    "contact_id": contact_id,
                    "primary_abstraction": abstraction,
                    "dimension": row[3],
                    "category": row[4],
                    "memory_status": row[11],
                }
            )

    return backfilled


async def backfill_missing_cues(*, user_id: str, limit: int = 500) -> int:
    """Attach deterministic, value-free cues to legacy memories with no links."""

    if limit < 1 or limit > 2000:
        raise ValueError("limit must be between 1 and 2000")
    linked = 0
    async with _db_pool().connection() as conn:
        cur = await conn.execute(
            """
            select p.id, p.contact_id, c.name, p.fact_key, p.category,
                   p.primary_abstraction
            from contact_profiles p
            join contacts c on c.id = p.contact_id and c.user_id = p.user_id
            where p.user_id = %s
              and p.primary_abstraction is not null
              and p.memory_status <> 'deleted'
              and not exists (
                  select 1 from contact_memory_cue_links l
                  where l.user_id = p.user_id and l.memory_id = p.id
              )
            order by p.updated_at, p.id
            for update of p skip locked
            limit %s
            """,
            (user_id, limit),
        )
        rows = await cur.fetchall()
        for row in rows:
            memory_id, contact_id = str(row[0]), str(row[1])
            primary_key = normalize_cue(row[5] or "")
            cues = default_cue_anchors(row[2] or "", row[3] or "note", row[4] or "other")
            for cue in cues:
                normalized = normalize_cue(cue["cue_text"])
                if normalized == primary_key:
                    continue
                cur = await conn.execute(
                    """
                    insert into contact_memory_cues
                        (user_id, cue_text, normalized_cue, cue_type)
                    values (%s, %s, %s, %s)
                    on conflict (user_id, normalized_cue) do update
                    set cue_type = contact_memory_cues.cue_type
                    returning id
                    """,
                    (user_id, cue["cue_text"], normalized, cue["cue_type"]),
                )
                cue_row = await cur.fetchone()
                cur = await conn.execute(
                    """
                    insert into contact_memory_cue_links
                        (user_id, cue_id, memory_id, contact_id)
                    values (%s, %s, %s, %s)
                    on conflict (cue_id, memory_id) do nothing
                    returning cue_id
                    """,
                    (user_id, str(cue_row[0]), memory_id, contact_id),
                )
                if await cur.fetchone():
                    linked += 1
    return linked


async def count_backfill_pending(user_id: str) -> int:
    async with _db_pool().connection() as conn:
        cur = await conn.execute(
            """
            select count(*)
            from contact_profiles
            where user_id = %s and primary_abstraction is null
            """,
            (user_id,),
        )
        row = await cur.fetchone()
    return int(row[0])


async def list_primary_index_pending(*, user_id: str, limit: int = 500) -> list[dict]:
    """Return reconstructable primary points whose v2 Qdrant write is pending."""

    if limit < 1 or limit > 2000:
        raise ValueError("limit must be between 1 and 2000")
    async with _db_pool().connection() as conn:
        cur = await conn.execute(
            """
            select id, contact_id, primary_abstraction, dimension, category, memory_status
            from contact_profiles
            where user_id = %s
              and primary_abstraction is not null
              and abstraction_indexed_at is null
            order by updated_at, id
            limit %s
            """,
            (user_id, limit),
        )
        rows = await cur.fetchall()
    return [
        {
            "memory_id": str(row[0]),
            "user_id": user_id,
            "contact_id": str(row[1]),
            "primary_abstraction": row[2],
            "dimension": row[3],
            "category": row[4],
            "memory_status": row[5],
        }
        for row in rows
    ]


async def mark_primary_indexed(*, user_id: str, memory_id: str) -> bool:
    async with _db_pool().connection() as conn:
        cur = await conn.execute(
            """
            update contact_profiles
            set abstraction_indexed_at = now()
            where id = %s and user_id = %s and primary_abstraction is not null
            returning id
            """,
            (memory_id, user_id),
        )
        row = await cur.fetchone()
    return row is not None


async def count_primary_index_pending(user_id: str) -> int:
    async with _db_pool().connection() as conn:
        cur = await conn.execute(
            """
            select count(*)
            from contact_profiles
            where user_id = %s
              and primary_abstraction is not null
              and abstraction_indexed_at is null
            """,
            (user_id,),
        )
        row = await cur.fetchone()
    return int(row[0])


async def get_memory_candidates(
    *,
    user_id: str,
    contact_id: str,
    memory_ids: list[str],
) -> list[dict]:
    """Load Judge context only from the caller's user/contact scope."""

    if not memory_ids:
        return []
    async with _db_pool().connection() as conn:
        cur = await conn.execute(
            """
            select id, primary_abstraction, fact_value, dimension, category,
                   memory_status, version, occurred_at, confidence
            from contact_profiles
            where user_id = %s and contact_id = %s and id = any(%s::uuid[])
            """,
            (user_id, contact_id, memory_ids),
        )
        rows = await cur.fetchall()
        cur = await conn.execute(
            """
            select memory_id, observed_value, source_type, source_id,
                   occurred_at, confidence
            from (
                select memory_id, observed_value, source_type, source_id,
                       occurred_at, confidence,
                       row_number() over (partition by memory_id order by created_at desc) as rank
                from contact_memory_evidence
                where user_id = %s and contact_id = %s and memory_id = any(%s::uuid[])
            ) recent
            where rank <= 3
            order by memory_id, rank
            """,
            (user_id, contact_id, memory_ids),
        )
        evidence_rows = await cur.fetchall()

    evidence_by_memory: dict[str, list[dict]] = {}
    for row in evidence_rows:
        evidence_by_memory.setdefault(str(row[0]), []).append(
            {
                "observed_value": row[1],
                "source_type": row[2],
                "source_id": row[3],
                "occurred_at": row[4].isoformat() if row[4] else None,
                "confidence": row[5],
            }
        )
    by_id = {
        str(row[0]): {
            "memory_id": str(row[0]),
            "primary_abstraction": row[1] or "",
            "memory_value": row[2],
            "dimension": row[3],
            "category": row[4],
            "memory_status": row[5],
            "version": row[6],
            "occurred_at": row[7].isoformat() if row[7] else None,
            "confidence": row[8],
            "recent_evidence": evidence_by_memory.get(str(row[0]), []),
        }
        for row in rows
    }
    return [by_id[memory_id] for memory_id in memory_ids if memory_id in by_id]


async def record_shadow_decision(
    *,
    user_id: str,
    contact_id: str,
    source_type: str,
    source_id: str | None,
    candidate_payload: dict,
    retrieved_memory_ids: list[str],
    v1_requested_action: str,
    v1_outcome: str,
    judge_action: str,
    target_memory_id: str | None,
    merged_abstraction: str,
    merged_value: str,
    reason: str,
    confidence: float,
    prompt_version: str,
) -> str:
    """Persist a comparable v1-vs-Judge decision without mutating memory."""

    async with _db_pool().connection() as conn:
        if target_memory_id:
            cur = await conn.execute(
                """
                select 1 from contact_profiles
                where id = %s and contact_id = %s and user_id = %s
                """,
                (target_memory_id, contact_id, user_id),
            )
            if not await cur.fetchone():
                raise ValueError("shadow Judge target is outside the user/contact scope")

        cur = await conn.execute(
            """
            insert into contact_memory_shadow_decisions
                (user_id, contact_id, source_type, source_id, candidate_payload,
                 retrieved_memory_ids, v1_requested_action, v1_outcome,
                 judge_action, target_memory_id, merged_abstraction, merged_value,
                 reason, confidence, prompt_version)
            values (%s, %s, %s, %s, %s::jsonb, %s::jsonb, %s, %s, %s,
                    %s, %s, %s, %s, %s, %s)
            returning id
            """,
            (
                user_id,
                contact_id,
                source_type,
                source_id,
                json.dumps(candidate_payload, ensure_ascii=False),
                json.dumps(retrieved_memory_ids),
                v1_requested_action,
                v1_outcome,
                judge_action,
                target_memory_id,
                merged_abstraction or None,
                merged_value or None,
                reason,
                confidence,
                prompt_version,
            ),
        )
        row = await cur.fetchone()
    return str(row[0])


async def upsert_memory_cues(
    *,
    user_id: str,
    contact_id: str,
    memory_id: str,
    cues: list[dict],
) -> list[dict]:
    """Upsert up to three reusable cue anchors and link them to one memory."""

    cleaned: list[dict] = []
    seen: set[str] = set()
    for cue in cues:
        text = str(cue.get("cue_text") or "").strip()[:160]
        normalized = normalize_cue(text)
        if not normalized or normalized in seen:
            continue
        cue_type = cue.get("cue_type") or "semantic"
        if cue_type not in {"semantic", "temporal", "entity", "other"}:
            cue_type = "other"
        cleaned.append(
            {"cue_text": text, "normalized_cue": normalized, "cue_type": cue_type}
        )
        seen.add(normalized)
        if len(cleaned) == 3:
            break
    if not cleaned:
        return []

    created: list[dict] = []
    async with _db_pool().connection() as conn:
        cur = await conn.execute(
            """
            select 1 from contact_profiles
            where id = %s and contact_id = %s and user_id = %s
            """,
            (memory_id, contact_id, user_id),
        )
        if not await cur.fetchone():
            raise ValueError("cue target is outside the user/contact scope")

        for cue in cleaned:
            cur = await conn.execute(
                """
                insert into contact_memory_cues
                    (user_id, cue_text, normalized_cue, cue_type)
                values (%s, %s, %s, %s)
                on conflict (user_id, normalized_cue) do update
                set cue_type = contact_memory_cues.cue_type
                returning id, cue_text, cue_type, indexed_at
                """,
                (
                    user_id,
                    cue["cue_text"],
                    cue["normalized_cue"],
                    cue["cue_type"],
                ),
            )
            row = await cur.fetchone()
            cue_id = str(row[0])
            await conn.execute(
                """
                insert into contact_memory_cue_links
                    (user_id, cue_id, memory_id, contact_id)
                values (%s, %s, %s, %s)
                on conflict (cue_id, memory_id) do nothing
                """,
                (user_id, cue_id, memory_id, contact_id),
            )
            created.append(
                {
                    "cue_id": cue_id,
                    "user_id": user_id,
                    "cue_text": row[1],
                    "cue_type": row[2],
                    "indexed_at": row[3].isoformat() if row[3] else None,
                }
            )
    return created


async def mark_cues_indexed(*, user_id: str, cue_ids: list[str]) -> int:
    if not cue_ids:
        return 0
    async with _db_pool().connection() as conn:
        cur = await conn.execute(
            """
            update contact_memory_cues
            set indexed_at = now()
            where user_id = %s and id = any(%s::uuid[])
            returning id
            """,
            (user_id, cue_ids),
        )
        rows = await cur.fetchall()
    return len(rows)


async def list_cue_index_pending(*, user_id: str, limit: int = 500) -> list[dict]:
    if limit < 1 or limit > 2000:
        raise ValueError("limit must be between 1 and 2000")
    async with _db_pool().connection() as conn:
        cur = await conn.execute(
            """
            select id, cue_text, cue_type
            from contact_memory_cues
            where user_id = %s and indexed_at is null
            order by created_at, id
            limit %s
            """,
            (user_id, limit),
        )
        rows = await cur.fetchall()
    return [
        {
            "cue_id": str(row[0]),
            "user_id": user_id,
            "cue_text": row[1],
            "cue_type": row[2],
        }
        for row in rows
    ]


async def count_cue_index_pending(user_id: str) -> int:
    async with _db_pool().connection() as conn:
        cur = await conn.execute(
            "select count(*) from contact_memory_cues where user_id = %s and indexed_at is null",
            (user_id,),
        )
        row = await cur.fetchone()
    return int(row[0])


async def resolve_cue_links(
    *,
    user_id: str,
    cue_ids: list[str],
    contact_id: str | None = None,
) -> list[dict]:
    if not cue_ids:
        return []
    contact_clause = "and contact_id = %s" if contact_id else ""
    params: tuple = (
        (user_id, cue_ids, contact_id) if contact_id else (user_id, cue_ids)
    )
    async with _db_pool().connection() as conn:
        cur = await conn.execute(
            f"""
            select cue_id, memory_id, contact_id
            from contact_memory_cue_links
            where user_id = %s and cue_id = any(%s::uuid[]) {contact_clause}
            """,
            params,
        )
        rows = await cur.fetchall()
    return [
        {
            "cue_id": str(row[0]),
            "memory_id": str(row[1]),
            "contact_id": str(row[2]),
        }
        for row in rows
    ]


async def list_memory_cues(
    *,
    user_id: str,
    memory_ids: list[str],
    contact_id: str | None = None,
) -> list[dict]:
    """Load the cue frontier for scoped, active working-set memories."""

    if not memory_ids:
        return []
    contact_clause = "and l.contact_id = %s" if contact_id else ""
    params: tuple = (
        (user_id, memory_ids, contact_id) if contact_id else (user_id, memory_ids)
    )
    async with _db_pool().connection() as conn:
        cur = await conn.execute(
            f"""
            select distinct c.id, c.cue_text, c.cue_type, l.memory_id, l.contact_id
            from contact_memory_cue_links l
            join contact_memory_cues c
              on c.id = l.cue_id and c.user_id = l.user_id
            join contact_profiles p
              on p.id = l.memory_id and p.user_id = l.user_id
            where l.user_id = %s and l.memory_id = any(%s::uuid[])
              and p.memory_status = 'active' {contact_clause}
            order by c.id, l.memory_id
            """,
            params,
        )
        rows = await cur.fetchall()
    return [
        {
            "cue_id": str(row[0]),
            "cue_text": row[1],
            "cue_type": row[2],
            "memory_id": str(row[3]),
            "contact_id": str(row[4]),
        }
        for row in rows
    ]
