#!/usr/bin/env python3

import os
import sys
import unittest
from unittest.mock import AsyncMock, patch

backend_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
sys.path.insert(0, backend_dir)

for variable, fallback in (
    ("SUPABASE_URL", "https://test.supabase.co"),
    ("SUPABASE_ANON_KEY", "test-anon-key"),
    ("SUPABASE_SERVICE_ROLE_KEY", "test-service-key"),
):
    os.environ[variable] = os.environ.get(variable) or fallback

from app.agents.tools import make_memos_tools  # noqa: E402


class TestUpdateMemoTool(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.tool = {tool.name: tool for tool in make_memos_tools("user-1")}["update_memo"]
        self.existing = {
            "id": "memo-1",
            "title": "Old title",
            "content": "Old content",
            "category": "notes",
            "color": "beige",
            "pinned": True,
            "attachments": [{"name": "brief.pdf", "extracted_text": "brief"}],
            "agent_maintained": False,
        }

    async def test_updates_only_supplied_fields_and_reindexes(self):
        updated = {**self.existing, "title": "New title", "content": "New content"}
        get_memo = AsyncMock(return_value=self.existing)
        update_memo = AsyncMock(return_value=updated)
        upsert_memo = AsyncMock()

        with (
            patch("app.agents.tools.memos_db.get_memo", get_memo),
            patch("app.agents.tools.memos_db.update_memo", update_memo),
            patch("app.agents.tools.vector_store.upsert_memo", upsert_memo),
        ):
            result = await self.tool.ainvoke(
                {"memo_id": "memo-1", "title": "New title", "content": "New content"}
            )

        get_memo.assert_awaited_once_with("user-1", "memo-1")
        update_memo.assert_awaited_once_with(
            "user-1",
            "memo-1",
            title="New title",
            content="New content",
            category="notes",
            color="beige",
            pinned=True,
            attachments=self.existing["attachments"],
            agent_maintained=False,
        )
        upsert_memo.assert_awaited_once_with(
            "user-1",
            "memo-1",
            "New title",
            "New content",
            "notes",
            self.existing["attachments"],
        )
        self.assertEqual(result, "Memo updated: id=memo-1 title='New title'")

    async def test_rejects_empty_update_without_touching_database(self):
        get_memo = AsyncMock()
        with patch("app.agents.tools.memos_db.get_memo", get_memo):
            result = await self.tool.ainvoke({"memo_id": "memo-1"})

        self.assertEqual(result, "Error: provide at least one memo field to update.")
        get_memo.assert_not_awaited()

    async def test_returns_not_found_without_updating(self):
        get_memo = AsyncMock(return_value=None)
        update_memo = AsyncMock()
        with (
            patch("app.agents.tools.memos_db.get_memo", get_memo),
            patch("app.agents.tools.memos_db.update_memo", update_memo),
        ):
            result = await self.tool.ainvoke({"memo_id": "missing", "content": "New content"})

        self.assertEqual(result, "Error: memo id=missing was not found.")
        update_memo.assert_not_awaited()


if __name__ == "__main__":
    unittest.main()
