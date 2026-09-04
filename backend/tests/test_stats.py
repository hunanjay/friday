#!/usr/bin/env python3
"""Tests for the /api/stats aggregation.

The admin gate needs no database and always runs. The aggregation tests are
optional and run against a disposable database only:

    STATS_TEST_DB_URL=postgresql://.../friday_test python tests/test_stats.py
"""

import os
import sys
import unittest
import uuid
from unittest.mock import patch
from urllib.parse import urlparse

from psycopg_pool import AsyncConnectionPool

backend_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
sys.path.insert(0, backend_dir)

# app.core.security builds a Supabase client at import time, so importing the
# stats router needs *some* credentials. The admin gate never calls Supabase,
# so placeholders keep this test independent of any real project or .env file.
os.environ.setdefault("SUPABASE_URL", "https://placeholder.supabase.co")
os.environ.setdefault("SUPABASE_ANON_KEY", "placeholder")
os.environ.setdefault("SUPABASE_SERVICE_ROLE_KEY", "placeholder")

from app.infrastructure.db.repositories import agent_runs
from app.infrastructure.db.repositories.chat_sessions import _SCHEMA as CHAT_SESSIONS_SCHEMA
from app.infrastructure.db.repositories.contacts import _SCHEMA as CONTACTS_SCHEMA
from app.infrastructure.db.repositories.hitl_audit import _SCHEMA as HITL_AUDIT_SCHEMA
from app.infrastructure.db.repositories.memos import _SCHEMA as MEMOS_SCHEMA
from app.infrastructure.db.repositories.todos import _SCHEMA as TODOS_SCHEMA

TEST_DB_URL = os.environ.get("STATS_TEST_DB_URL")


class TestAdminGate(unittest.IsolatedAsyncioTestCase):
    """An all-user view must never open up by accident."""

    def setUp(self):
        from app.api import stats

        self.stats = stats
        self.original = stats.settings.ADMIN_USER_IDS

    def tearDown(self):
        self.stats.settings.ADMIN_USER_IDS = self.original

    async def _call(self, user_id: str):
        from fastapi import HTTPException

        try:
            return await self.stats.require_admin(user_id)
        except HTTPException as exc:
            return exc.status_code

    async def test_unset_allowlist_denies_everyone(self):
        self.stats.settings.ADMIN_USER_IDS = ""
        self.assertEqual(await self._call("anyone"), 403)

    async def test_only_listed_ids_pass(self):
        self.stats.settings.ADMIN_USER_IDS = " admin-1 , admin-2 "
        self.assertEqual(await self._call("admin-2"), "admin-2")
        self.assertEqual(await self._call("admin-3"), 403)


@unittest.skipUnless(TEST_DB_URL, "STATS_TEST_DB_URL is not configured")
class TestStatsAggregation(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        database_name = urlparse(TEST_DB_URL).path.removeprefix("/")
        if "test" not in database_name.casefold():
            raise RuntimeError("STATS_TEST_DB_URL must point to a disposable test database")
        self.pool = AsyncConnectionPool(TEST_DB_URL, open=False, min_size=1, max_size=4)
        await self.pool.open()
        async with self.pool.connection() as conn:
            for table in ("agent_runs", "hitl_action_audit", "memos", "todos", "contacts"):
                await conn.execute(f"drop table if exists {table} cascade")
            await conn.execute("drop table if exists chat_sessions cascade")
            # The activity union spans every business table, so build them all
            # from the schemas the app actually ships.
            for schema in (
                CHAT_SESSIONS_SCHEMA,
                HITL_AUDIT_SCHEMA,
                MEMOS_SCHEMA,
                TODOS_SCHEMA,
                CONTACTS_SCHEMA,
                agent_runs._SCHEMA,
            ):
                await conn.execute(schema)

    async def asyncTearDown(self):
        await self.pool.close()

    async def _insert(self, user_id, route, agent, *, tool_calls=0, ok=True, paused=False):
        with patch.object(agent_runs, "get_pool", return_value=self.pool):
            await agent_runs.record_run(
                user_id,
                str(uuid.uuid4()),
                route=route,
                agent=agent,
                tool_calls=tool_calls,
                paused=paused,
                ok=ok,
                duration_ms=100,
            )

    async def test_agent_stats_counts_and_breakdowns(self):
        alice, bob = f"u-{uuid.uuid4().hex}", f"u-{uuid.uuid4().hex}"
        await self._insert(alice, "supervisor", "mail_agent", tool_calls=2)
        await self._insert(alice, "supervisor", None)
        await self._insert(bob, "slash_command", "memos_agent", tool_calls=1, ok=False)
        await self._insert(bob, "supervisor", "mail_agent", paused=True)

        with patch.object(agent_runs, "get_pool", return_value=self.pool):
            stats = await agent_runs.agent_stats(7)
            call_counts = await agent_runs.agent_call_counts()

        self.assertEqual(stats["turns"], 4)
        self.assertEqual(stats["active_users"], 2)
        self.assertEqual(stats["errors"], 1)
        self.assertEqual(stats["error_rate"], 0.25)
        self.assertEqual(stats["paused_for_approval"], 1)
        self.assertEqual(stats["tool_calls"], 3)
        self.assertEqual(stats["turns_per_user"], 2.0)
        self.assertEqual(stats["median_duration_ms"], 100)
        self.assertEqual(stats["by_route"], {"supervisor": 3, "slash_command": 1})
        # A turn the supervisor answered itself is reported, not dropped.
        self.assertEqual(stats["by_agent"], {"mail_agent": 2, "memos_agent": 1, "none": 1})
        self.assertEqual(
            call_counts,
            {"mail_agent": 2, "memos_agent": 1, "supervisor": 1},
        )

    async def test_window_excludes_older_runs(self):
        user_id = f"u-{uuid.uuid4().hex}"
        await self._insert(user_id, "supervisor", "mail_agent")
        async with self.pool.connection() as conn:
            await conn.execute(
                "update agent_runs set created_at = now() - interval '40 days' where user_id = %s",
                (user_id,),
            )
        with patch.object(agent_runs, "get_pool", return_value=self.pool):
            self.assertEqual((await agent_runs.agent_stats(7))["turns"], 0)
            self.assertEqual((await agent_runs.agent_stats(365))["turns"], 1)

    async def test_agent_call_counts_split_multi_agent_turns(self):
        user_id = f"u-{uuid.uuid4().hex}"
        with patch.object(agent_runs, "get_pool", return_value=self.pool):
            await agent_runs.record_run(
                user_id,
                str(uuid.uuid4()),
                route="supervisor",
                agent="mail_agent",
                agent_calls={"mail_agent": 2, "calendar_agent": 1},
                tool_calls=0,
                paused=False,
                ok=True,
                duration_ms=100,
            )
            counts = await agent_runs.agent_call_counts()

        self.assertEqual(counts, {"calendar_agent": 1, "mail_agent": 2})

    async def test_agent_call_counts_keep_legacy_rows(self):
        user_id = f"u-{uuid.uuid4().hex}"
        async with self.pool.connection() as conn:
            await conn.execute(
                "insert into agent_runs "
                "(user_id, session_id, route, agent) values (%s, %s, %s, %s)",
                (user_id, str(uuid.uuid4()), "supervisor", "memos_agent"),
            )

        with patch.object(agent_runs, "get_pool", return_value=self.pool):
            counts = await agent_runs.agent_call_counts()

        self.assertEqual(counts, {"memos_agent": 1})

    async def test_active_users_spans_every_table(self):
        chatter = f"u-{uuid.uuid4().hex}"
        await self._insert(chatter, "supervisor", "mail_agent")
        # A user who only writes memos is active too - memos has no created_at,
        # which is why the union reads updated_at everywhere.
        memo_writer = f"u-{uuid.uuid4().hex}"
        stale = f"u-{uuid.uuid4().hex}"
        async with self.pool.connection() as conn:
            for user_id in (memo_writer, stale):
                await conn.execute(
                    "insert into memos (user_id, title, content) values (%s, 'n', 'n')",
                    (user_id,),
                )
            await conn.execute(
                "update memos set updated_at = now() - interval '40 days' where user_id = %s",
                (stale,),
            )

        with patch.object(agent_runs, "get_pool", return_value=self.pool):
            active = await agent_runs.active_users()

        self.assertEqual(active["dau"], 2)
        self.assertEqual(active["wau"], 2)
        self.assertEqual(active["mau"], 2)
        self.assertEqual(active["wau_over_mau"], 1.0)

    async def test_hitl_stats_group_by_tool(self):
        user_id = f"u-{uuid.uuid4().hex}"
        session_id = str(uuid.uuid4())
        async with self.pool.connection() as conn:
            await conn.execute(
                "insert into chat_sessions (id, user_id) values (%s, %s)", (session_id, user_id)
            )
            for action_id, tool, status in (
                ("a1", "send_email", "succeeded"),
                ("a2", "send_email", "cancelled"),
                ("a3", "delete_event", "succeeded"),
                ("a4", "delete_event", "pending"),
            ):
                await conn.execute(
                    "insert into hitl_action_audit "
                    "(action_id, session_id, user_id, action, status) "
                    "values (%s, %s, %s, %s::jsonb, %s)",
                    (action_id, session_id, user_id, f'{{"tool_name": "{tool}"}}', status),
                )

        with patch.object(agent_runs, "get_pool", return_value=self.pool):
            stats = await agent_runs.hitl_stats(7)

        self.assertEqual(stats["by_status"], {"succeeded": 2, "cancelled": 1, "pending": 1})
        self.assertEqual(stats["by_tool"]["send_email"], {"succeeded": 1, "cancelled": 1})
        # Undecided actions must not dilute the rate.
        self.assertEqual(stats["approval_rate"], round(2 / 3, 4))

    async def test_empty_database_reports_zeroes_not_errors(self):
        with patch.object(agent_runs, "get_pool", return_value=self.pool):
            stats = await agent_runs.agent_stats(7)
            hitl = await agent_runs.hitl_stats(7)
            active = await agent_runs.active_users()
            call_counts = await agent_runs.agent_call_counts()
        self.assertEqual(stats["turns"], 0)
        self.assertEqual(stats["error_rate"], 0.0)
        self.assertIsNone(stats["median_duration_ms"])
        self.assertIsNone(hitl["approval_rate"])
        self.assertEqual(active["wau_over_mau"], 0.0)
        self.assertEqual(call_counts, {})

    async def test_record_run_never_raises_into_the_stream(self):
        broken = AsyncConnectionPool("postgresql://nobody@127.0.0.1:1/none", open=False)
        with patch.object(agent_runs, "get_pool", return_value=broken):
            await agent_runs.record_run(
                "u", str(uuid.uuid4()), route="supervisor", agent=None,
                tool_calls=0, paused=False, ok=True, duration_ms=1,
            )


if __name__ == "__main__":
    unittest.main(verbosity=2)
