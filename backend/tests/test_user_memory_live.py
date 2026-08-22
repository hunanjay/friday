#!/usr/bin/env python3
"""
Live PostgreSQL integration test for user long-term memory (profile /
preference / topic facts, plus agent-maintained "area" memos).
"""

import os
import sys
import unittest
import uuid

backend_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
sys.path.insert(0, backend_dir)

try:
    from dotenv import load_dotenv
    load_dotenv(os.path.join(backend_dir, ".env"))
except ImportError:
    pass

os.environ["CHECKPOINT_DB_URL"] = "postgresql://friday:friday@localhost:5438/friday"

from app.infrastructure.db.pool import close_db_pool, init_db_pool
from app.infrastructure.db.repositories import memos as memos_repo, user_memory as user_memory_repo


class TestUserMemoryLivePostgres(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.user_id = f"test-user-{uuid.uuid4()}"
        self.pool = await init_db_pool()
        if self.pool is None:
            self.skipTest("Database pool not available")
        await user_memory_repo.init_schema()
        await memos_repo.init_schema()

    async def asyncTearDown(self):
        if self.pool:
            async with self.pool.connection() as conn:
                await conn.execute("DELETE FROM user_memory WHERE user_id = %s", (self.user_id,))
                await conn.execute("DELETE FROM memos WHERE user_id = %s", (self.user_id,))
            await close_db_pool()

    async def test_remember_and_inject(self):
        await user_memory_repo.remember_fact(self.user_id, "profile", "job_title", "Engineer")
        await user_memory_repo.remember_fact(self.user_id, "preference", "reply_tone", "Concise")
        await user_memory_repo.remember_fact(
            self.user_id, "topic", "mail_habit", "Always CC manager", topic="Mail Habits"
        )

        profile_rows, preference_rows = await user_memory_repo.get_injectable_memory(self.user_id)
        self.assertEqual(len(profile_rows), 1)
        self.assertEqual(profile_rows[0]["fact_key"], "job_title")
        self.assertEqual(len(preference_rows), 1)
        self.assertEqual(preference_rows[0]["fact_value"], "Concise")
        print("  ✓ profile/preference facts injectable, topic fact excluded")

        # topic label normalization mirrors contacts.normalize_facet
        matches = await user_memory_repo.search_facts(self.user_id, "cc manager", category="topic")
        self.assertEqual(len(matches), 1)
        self.assertEqual(matches[0]["topic"], "mail_habits")
        print("  ✓ search_facts finds the topic fact via ILIKE, topic label normalized")

    async def test_remember_upserts_and_forget_deletes(self):
        f1 = await user_memory_repo.remember_fact(self.user_id, "profile", "diet", "no spicy food")
        f2 = await user_memory_repo.remember_fact(self.user_id, "profile", "diet", "spicy is fine now")
        self.assertEqual(f1["id"], f2["id"], "same key must update in place, not duplicate")

        profile_rows, _ = await user_memory_repo.get_injectable_memory(self.user_id)
        self.assertEqual(len(profile_rows), 1)
        self.assertEqual(profile_rows[0]["fact_value"], "spicy is fine now")
        print("  ✓ remember_fact upserts by (category, topic, fact_key) instead of duplicating")

        deleted = await user_memory_repo.forget_fact(self.user_id, "profile", "diet")
        self.assertTrue(deleted)
        missing = await user_memory_repo.forget_fact(self.user_id, "profile", "diet")
        self.assertFalse(missing, "second forget on an already-gone fact reports nothing deleted")
        profile_rows, _ = await user_memory_repo.get_injectable_memory(self.user_id)
        self.assertEqual(len(profile_rows), 0)
        print("  ✓ forget_fact deletes the fact and is safely idempotent")

    async def test_injectable_cap(self):
        for i in range(user_memory_repo._INJECT_LIMIT + 5):
            await user_memory_repo.remember_fact(self.user_id, "profile", f"fact_{i}", f"value_{i}")
        profile_rows, _ = await user_memory_repo.get_injectable_memory(self.user_id)
        self.assertEqual(len(profile_rows), user_memory_repo._INJECT_LIMIT)
        print(f"  ✓ injectable profile facts capped at {user_memory_repo._INJECT_LIMIT}")

    async def test_track_area_upserts(self):
        from app.agents.tools import make_memos_tools

        tools = {t.name: t for t in make_memos_tools(self.user_id)}
        track_area = tools["track_area"]

        await track_area.ainvoke({"name": "Q3 Hiring", "notes": "Started sourcing candidates"})
        await track_area.ainvoke({"name": "Q3 Hiring", "notes": "Two offers extended"})

        areas = [
            m for m in await memos_repo.list_memos(self.user_id)
            if m["agent_maintained"] and m["title"] == "Q3 Hiring"
        ]
        self.assertEqual(len(areas), 1, "second call must update, not duplicate")
        self.assertEqual(areas[0]["content"], "Two offers extended")
        self.assertEqual(areas[0]["category"], "area")
        print("  ✓ track_area upserts by name instead of duplicating")


if __name__ == "__main__":
    unittest.main()
