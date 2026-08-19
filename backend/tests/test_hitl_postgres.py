#!/usr/bin/env python3
"""Optional PostgreSQL integration tests for HITL execution state.

Run against a disposable database only:
    HITL_TEST_DB_URL=postgresql://... python tests/test_hitl_postgres.py
"""

import asyncio
import os
import sys
import unittest
import uuid
from unittest.mock import patch
from urllib.parse import urlparse

from psycopg_pool import AsyncConnectionPool

backend_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
sys.path.insert(0, backend_dir)

from app.infrastructure.db.repositories import hitl_audit

TEST_DB_URL = os.environ.get("HITL_TEST_DB_URL")


@unittest.skipUnless(TEST_DB_URL, "HITL_TEST_DB_URL is not configured")
class TestHitlPostgres(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        database_name = urlparse(TEST_DB_URL).path.removeprefix("/")
        if "test" not in database_name.casefold():
            raise RuntimeError("HITL_TEST_DB_URL must point to a disposable test database")
        self.pool = AsyncConnectionPool(TEST_DB_URL, open=False, min_size=1, max_size=4)
        await self.pool.open()
        async with self.pool.connection() as conn:
            await conn.execute("drop table if exists hitl_action_audit")
            await conn.execute("drop table if exists chat_sessions")
            await conn.execute(
                "create table if not exists chat_sessions ("
                "id uuid primary key, user_id text not null, title text not null default 'New chat')"
            )
            # Recreate the pre-hardening table to exercise the real upgrade,
            # not only a clean installation.
            await conn.execute(
                "create table if not exists hitl_action_audit ("
                "action_id text primary key, "
                "session_id uuid not null references chat_sessions(id) on delete cascade, "
                "user_id text not null, action jsonb not null, "
                "status text not null check (status in ('completed', 'cancelled')), "
                "created_at timestamptz not null default now(), "
                "resolved_at timestamptz not null default now())"
            )
        self.user_id = f"hitl-test-{uuid.uuid4()}"
        self.session_id = str(uuid.uuid4())
        self.legacy_action_id = f"legacy-{uuid.uuid4()}"
        async with self.pool.connection() as conn:
            await conn.execute(
                "insert into chat_sessions (id, user_id) values (%s, %s)",
                (self.session_id, self.user_id),
            )
            await conn.execute(
                "insert into hitl_action_audit (action_id, session_id, user_id, action, status) "
                "values (%s, %s, %s, %s::jsonb, 'completed')",
                (
                    self.legacy_action_id,
                    self.session_id,
                    self.user_id,
                    '{"id":"legacy","payload":{}}',
                ),
            )
        with patch.object(hitl_audit, "get_pool", return_value=self.pool):
            await hitl_audit.init_schema()

    async def asyncTearDown(self):
        await self.pool.close()

    def _action(self, action_id: str) -> dict:
        return {
            "id": action_id,
            "session_id": self.session_id,
            "tool_name": "send_email",
            "action_type": "mail.send",
            "payload": {"to": "test@example.com", "subject": "test", "body": "body"},
            "status": "pending",
            "resolved": False,
        }

    async def test_concurrent_claim_has_one_winner(self):
        action = self._action(f"action-{uuid.uuid4()}")
        with patch.object(hitl_audit, "get_pool", return_value=self.pool):
            await hitl_audit.ensure_pending(self.user_id, self.session_id, action)
            results = await asyncio.gather(
                hitl_audit.claim_action(
                    self.user_id, self.session_id, action["id"], "approve"
                ),
                hitl_audit.claim_action(
                    self.user_id, self.session_id, action["id"], "approve"
                ),
            )

        self.assertCountEqual(results, ["claimed", "executing"])

    async def test_legacy_completed_status_migrates_to_succeeded(self):
        with patch.object(hitl_audit, "get_pool", return_value=self.pool):
            visible = await hitl_audit.list_actions(self.user_id, self.session_id)

        legacy = next(item for item in visible if item["id"] == "legacy")
        self.assertEqual(legacy["status"], "succeeded")

    async def test_rejected_action_is_retained_as_cancelled(self):
        action = self._action(f"action-{uuid.uuid4()}")
        with patch.object(hitl_audit, "get_pool", return_value=self.pool):
            await hitl_audit.ensure_pending(self.user_id, self.session_id, action)
            claim = await hitl_audit.claim_action(
                self.user_id, self.session_id, action["id"], "reject"
            )
            await hitl_audit.finish_action(
                self.user_id,
                self.session_id,
                action,
                "cancelled",
            )
            visible = await hitl_audit.list_actions(self.user_id, self.session_id)

        cancelled = next(item for item in visible if item["id"] == action["id"])
        self.assertEqual(claim, "claimed")
        self.assertEqual(cancelled["status"], "cancelled")

    async def test_expired_action_cannot_be_claimed(self):
        action = self._action(f"action-{uuid.uuid4()}")
        with patch.object(hitl_audit, "get_pool", return_value=self.pool):
            await hitl_audit.ensure_pending(
                self.user_id,
                self.session_id,
                action,
                ttl_seconds=-1,
            )
            status = await hitl_audit.claim_action(
                self.user_id, self.session_id, action["id"], "approve"
            )
            visible = await hitl_audit.list_actions(self.user_id, self.session_id)

        self.assertEqual(status, "expired")
        expired = next(item for item in visible if item["id"] == action["id"])
        self.assertEqual(expired["status"], "expired")
        self.assertTrue(expired["resolved"])


if __name__ == "__main__":
    unittest.main()
