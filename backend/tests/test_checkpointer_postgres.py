#!/usr/bin/env python3
"""Real-Postgres integration tests for app.agents.checkpointer.init_checkpointer().

Run against a disposable database only:
    CHECKPOINTER_TEST_DB_URL=postgresql://... python tests/test_checkpointer_postgres.py
"""

import os
import sys
import unittest
import uuid
from unittest.mock import patch
from urllib.parse import urlparse

import psycopg
from langgraph.checkpoint.base import empty_checkpoint
from psycopg_pool import AsyncConnectionPool

backend_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
sys.path.insert(0, backend_dir)

from langgraph.checkpoint.postgres.aio import AsyncPostgresSaver  # noqa: E402

from app.agents import checkpointer  # noqa: E402

TEST_DB_URL = os.environ.get("CHECKPOINTER_TEST_DB_URL")


@unittest.skipUnless(TEST_DB_URL, "CHECKPOINTER_TEST_DB_URL is not configured")
class TestCheckpointerPostgres(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        database_name = urlparse(TEST_DB_URL).path.removeprefix("/")
        if "test" not in database_name.casefold():
            raise RuntimeError("CHECKPOINTER_TEST_DB_URL must point to a disposable test database")
        self.pool = AsyncConnectionPool(TEST_DB_URL, open=False, min_size=1, max_size=4)
        await self.pool.open()
        # Module-level singleton - reset so tests don't see state left by a
        # previous test's successful init_checkpointer() call.
        checkpointer._checkpointer = None
        async with self.pool.connection() as conn:
            for table in (
                "checkpoint_writes",
                "checkpoint_blobs",
                "checkpoints",
                "checkpoint_migrations",
            ):
                await conn.execute(f"drop table if exists {table}")
        self.addAsyncCleanup(self.pool.close)

    async def _applied_versions(self) -> list[int]:
        async with self.pool.connection() as conn:
            cur = await conn.execute("select v from checkpoint_migrations order by v")
            return [row[0] for row in await cur.fetchall()]

    async def test_fresh_database_migrates_to_head(self):
        with patch.object(checkpointer, "get_pool", return_value=self.pool):
            await checkpointer.init_checkpointer()

        from langgraph.checkpoint.postgres.base import MIGRATIONS

        self.assertEqual(await self._applied_versions(), list(range(1, len(MIGRATIONS) + 1)))

    async def test_rerun_is_idempotent(self):
        with patch.object(checkpointer, "get_pool", return_value=self.pool):
            await checkpointer.init_checkpointer()
            await checkpointer.init_checkpointer()

        from langgraph.checkpoint.postgres.base import MIGRATIONS

        self.assertEqual(await self._applied_versions(), list(range(1, len(MIGRATIONS) + 1)))

    async def test_migration_failure_does_not_advance_version_and_aborts_startup(self):
        broken_migrations = ["create table if not exists checkpoint_migrations (v integer primary key)", "this is not sql;"]
        with (
            patch.object(checkpointer, "get_pool", return_value=self.pool),
            patch("app.agents.checkpointer.MIGRATIONS", broken_migrations),
        ):
            with self.assertRaises(psycopg.Error):
                await checkpointer.init_checkpointer()

        # Only the first (successful) migration's version row was written; the
        # broken second statement must not appear, and startup must not have
        # produced a usable checkpointer.
        self.assertEqual(await self._applied_versions(), [1])
        self.assertIsNone(checkpointer.get_checkpointer())

    async def test_existing_checkpoint_and_pending_interrupt_survive_reinit(self):
        with patch.object(checkpointer, "get_pool", return_value=self.pool):
            await checkpointer.init_checkpointer()

        thread_id = str(uuid.uuid4())
        config = {"configurable": {"thread_id": thread_id, "checkpoint_ns": ""}}
        checkpoint = empty_checkpoint()
        saver = AsyncPostgresSaver(self.pool)
        # A pending HITL interrupt is just a checkpoint whose channel_values
        # carry the paused task state - what matters here is that the row
        # written before a re-migration is still readable after one.
        checkpoint["channel_values"] = {"__interrupt__": "pending-approval"}
        await saver.aput(config, checkpoint, {"source": "test", "step": 1, "parents": {}}, {})

        # Re-run migrations, e.g. simulating a backend restart against an
        # already-migrated database.
        with patch.object(checkpointer, "get_pool", return_value=self.pool):
            await checkpointer.init_checkpointer()

        restored = await saver.aget_tuple(config)
        self.assertIsNotNone(restored)
        self.assertEqual(
            restored.checkpoint["channel_values"]["__interrupt__"],
            "pending-approval",
        )


if __name__ == "__main__":
    unittest.main()
