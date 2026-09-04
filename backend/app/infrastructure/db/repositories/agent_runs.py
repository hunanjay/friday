"""Always-on usage log behind /api/stats: one row per finished chat turn.

Langfuse owns per-trace debugging - the message chain, per-model-call tokens
and latency - but it is opt-in and self-hosted: docker-compose.tracing.yml is
only pulled in when explicitly passed and needs a sibling ../langfuse
checkout, so nothing is recorded while it is off and nothing in it is
queryable from this backend. This table is the counterpart that is always on.
It keeps no message content, so it stays cheap to retain, and it lives in the
app database so usage can be joined to the other business tables by user_id.

Deliberately no foreign key to chat_sessions: deleting a conversation must not
erase the usage history that conversation contributed to.
"""

import json
import logging

from app.infrastructure.db.pool import get_pool

logger = logging.getLogger(__name__)

_SCHEMA = """
create table if not exists agent_runs (
    id bigserial primary key,
    user_id text not null,
    session_id uuid not null,
    route text not null,
    agent text,
    agent_calls jsonb not null default '{}'::jsonb,
    tool_calls integer not null default 0,
    paused boolean not null default false,
    ok boolean not null default true,
    duration_ms integer,
    created_at timestamptz not null default now()
);
alter table agent_runs
    add column if not exists agent_calls jsonb not null default '{}'::jsonb;
create index if not exists agent_runs_created_idx on agent_runs (created_at desc);
create index if not exists agent_runs_user_idx on agent_runs (user_id, created_at desc);
"""


def _db_pool():
    pool = get_pool()
    if pool is None:
        raise RuntimeError("Database pool is not initialized")
    return pool


async def init_schema():
    async with _db_pool().connection() as conn:
        await conn.execute(_SCHEMA)


async def record_run(
    user_id: str,
    session_id: str,
    *,
    route: str,
    agent: str | None,
    agent_calls: dict[str, int] | None = None,
    tool_calls: int,
    paused: bool,
    ok: bool,
    duration_ms: int,
) -> None:
    """Log one finished turn. Telemetry never breaks a chat turn, so a failure
    here degrades to "this turn is missing from the stats" rather than raising
    into the SSE stream."""
    try:
        calls = agent_calls if agent_calls is not None else {agent or "supervisor": 1}
        async with _db_pool().connection() as conn:
            await conn.execute(
                "insert into agent_runs "
                "(user_id, session_id, route, agent, agent_calls, tool_calls, paused, ok, duration_ms) "
                "values (%s, %s, %s, %s, %s::jsonb, %s, %s, %s, %s)",
                (
                    user_id,
                    session_id,
                    route,
                    agent,
                    json.dumps(calls),
                    tool_calls,
                    paused,
                    ok,
                    duration_ms,
                ),
            )
    except Exception:
        logger.exception("failed to record agent run")


async def agent_stats(days: int) -> dict:
    """Turn counts, failure rate and median latency over the window, plus the
    breakdown by entry path and by the agent that actually handled the turn."""
    async with _db_pool().connection() as conn:
        cur = await conn.execute(
            "select count(*), count(distinct user_id), count(distinct session_id), "
            "count(*) filter (where not ok), count(*) filter (where paused), "
            "coalesce(sum(tool_calls), 0), "
            "percentile_disc(0.5) within group (order by duration_ms) "
            "from agent_runs where created_at > now() - make_interval(days => %s)",
            (days,),
        )
        turns, users, sessions, errors, paused, tool_calls, p50 = await cur.fetchone()

        cur = await conn.execute(
            "select route, agent, count(*) from agent_runs "
            "where created_at > now() - make_interval(days => %s) group by 1, 2",
            (days,),
        )
        rows = await cur.fetchall()

    by_route: dict[str, int] = {}
    by_agent: dict[str, int] = {}
    for route, agent, count in rows:
        by_route[route] = by_route.get(route, 0) + count
        # NULL agent = the supervisor answered without delegating to anyone.
        key = agent or "none"
        by_agent[key] = by_agent.get(key, 0) + count

    return {
        "turns": turns,
        "active_users": users,
        "sessions": sessions,
        "errors": errors,
        "error_rate": round(errors / turns, 4) if turns else 0.0,
        "paused_for_approval": paused,
        "tool_calls": tool_calls,
        "turns_per_user": round(turns / users, 2) if users else 0.0,
        "median_duration_ms": p50,
        "by_route": by_route,
        "by_agent": by_agent,
    }


async def agent_call_counts() -> dict[str, int]:
    """All-time delegation count for every agent invoked in a turn.

    Rows written before agent_calls existed fall back to their single handled
    agent, so deploying this migration does not reset the visible totals.
    """
    async with _db_pool().connection() as conn:
        cur = await conn.execute(
            "with calls as ("
            "  select entry.key as agent, entry.value::bigint as call_count "
            "  from agent_runs cross join lateral jsonb_each_text(agent_calls) as entry "
            "  union all "
            "  select coalesce(agent, 'supervisor'), 1 "
            "  from agent_runs where agent_calls = '{}'::jsonb"
            ") "
            "select agent, sum(call_count)::bigint from calls group by agent order by agent"
        )
        rows = await cur.fetchall()
    return {agent: count for agent, count in rows}


# Every business table carries user_id + updated_at (memos has no created_at),
# so "active" means last touch in any of them, not just chat.
# ponytail: sequential scan over five tables, capped at 30 days; add a rollup
# table if this ever gets slow enough to notice.
_ACTIVITY = """
with acts as (
    select user_id, created_at as at from agent_runs
    union all select user_id, updated_at from chat_sessions
    union all select user_id, updated_at from memos
    union all select user_id, updated_at from todos
    union all select user_id, updated_at from contacts
)
select
    count(distinct user_id) filter (where at > now() - interval '1 day'),
    count(distinct user_id) filter (where at > now() - interval '7 days'),
    count(distinct user_id) filter (where at > now() - interval '30 days')
from acts where at > now() - interval '30 days'
"""


async def active_users() -> dict:
    async with _db_pool().connection() as conn:
        cur = await conn.execute(_ACTIVITY)
        dau, wau, mau = await cur.fetchone()
    return {
        "dau": dau,
        "wau": wau,
        "mau": mau,
        # The one number that says whether this is a habit or a demo.
        "wau_over_mau": round(wau / mau, 2) if mau else 0.0,
    }


async def hitl_stats(days: int) -> dict:
    """Approval outcomes per tool. A cancelled action is the user overruling
    the agent, which makes this the most honest quality signal available."""
    async with _db_pool().connection() as conn:
        cur = await conn.execute(
            "select action->>'tool_name', status, count(*) from hitl_action_audit "
            "where created_at > now() - make_interval(days => %s) group by 1, 2",
            (days,),
        )
        rows = await cur.fetchall()

    by_tool: dict[str, dict[str, int]] = {}
    totals: dict[str, int] = {}
    for tool_name, status, count in rows:
        by_tool.setdefault(tool_name or "unknown", {})[status] = count
        totals[status] = totals.get(status, 0) + count

    approved = totals.get("succeeded", 0)
    rejected = totals.get("cancelled", 0)
    decided = approved + rejected
    return {
        "by_status": totals,
        "by_tool": by_tool,
        "approval_rate": round(approved / decided, 4) if decided else None,
    }
