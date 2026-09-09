#!/usr/bin/env python3
"""
Live PostgreSQL test for the memos list_memos_page filter/pagination query
(added alongside the Memos page pagination + category-color UI work).
Tests against actual PostgreSQL instance (localhost:5438), same convention
as test_contact_db_live.py.
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

os.environ.setdefault("CHECKPOINT_DB_URL", "postgresql://friday:friday@localhost:5438/friday")

from app.infrastructure.db.pool import close_db_pool, init_db_pool
from app.infrastructure.db.repositories import memos as memos_db


class TestMemosPaginationLivePostgres(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.user_id = f"test-user-{uuid.uuid4()}"
        self.pool = await init_db_pool()
        if self.pool is None:
            self.skipTest("Database pool not available")
        await memos_db.init_schema()

    async def asyncTearDown(self):
        if self.pool:
            async with self.pool.connection() as conn:
                await conn.execute("DELETE FROM memos WHERE user_id = %s", (self.user_id,))
            await close_db_pool()

    async def test_pagination_category_and_search(self):
        # Created in order; updated_at desc means later creates sort first
        # among non-pinned memos.
        m1 = await memos_db.create_memo(self.user_id, "Alpha", "first note", "notes", "beige")
        m2 = await memos_db.create_memo(self.user_id, "Beta project plan", "budget review", "work", "beige")
        m3 = await memos_db.create_memo(
            self.user_id, "Gamma idea", "random idea", "ideas", "beige",
            attachments=[{"name": "scan.pdf", "extracted_text": "quarterly roadmap secret"}],
        )
        m4 = await memos_db.create_memo(self.user_id, "Delta snippet", "code snippet here", "snippets", "beige")
        m5 = await memos_db.create_memo(self.user_id, "Epsilon", "another work note", "work", "beige")
        await memos_db.update_memo(
            self.user_id, m5["id"], title="Epsilon", content="another work note",
            category="work", color="beige", pinned=True,
        )

        # Pinned first, then updated_at desc -> m5, m4, m3, m2, m1
        page1, has_more1 = await memos_db.list_memos_page(self.user_id, limit=2, offset=0)
        self.assertEqual([m["id"] for m in page1], [m5["id"], m4["id"]])
        self.assertTrue(has_more1)

        page2, has_more2 = await memos_db.list_memos_page(self.user_id, limit=2, offset=2)
        self.assertEqual([m["id"] for m in page2], [m3["id"], m2["id"]])
        self.assertTrue(has_more2)

        page3, has_more3 = await memos_db.list_memos_page(self.user_id, limit=2, offset=4)
        self.assertEqual([m["id"] for m in page3], [m1["id"]])
        self.assertFalse(has_more3)

        # Category filter
        work_only, _ = await memos_db.list_memos_page(self.user_id, category="work", limit=10)
        self.assertEqual([m["id"] for m in work_only], [m5["id"], m2["id"]])

        # Search across title, content, and attachment extracted_text
        by_content, _ = await memos_db.list_memos_page(self.user_id, search="budget", limit=10)
        self.assertEqual([m["id"] for m in by_content], [m2["id"]])

        by_title, _ = await memos_db.list_memos_page(self.user_id, search="Alpha", limit=10)
        self.assertEqual([m["id"] for m in by_title], [m1["id"]])

        by_attachment_text, _ = await memos_db.list_memos_page(self.user_id, search="roadmap", limit=10)
        self.assertEqual([m["id"] for m in by_attachment_text], [m3["id"]])

        # list_memos (the unpaginated, agent-tool path) must still return
        # everything regardless of the new pagination default.
        everything = await memos_db.list_memos(self.user_id)
        self.assertEqual(len(everything), 5)


if __name__ == "__main__":
    unittest.main()
