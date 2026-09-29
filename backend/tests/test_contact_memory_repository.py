import os
import unittest
from datetime import datetime, timezone
from unittest.mock import AsyncMock, MagicMock, patch

os.environ.setdefault("SUPABASE_URL", "https://example.supabase.co")
os.environ.setdefault("SUPABASE_ANON_KEY", "test-key")
os.environ.setdefault("SUPABASE_SERVICE_ROLE_KEY", "test-service-key")
os.environ.setdefault("CHECKPOINT_DB_URL", "postgresql://friday:friday@localhost:5438/friday")

from app.infrastructure.db.repositories import contact_memory  # noqa: E402


class TestContactMemoryRepository(unittest.IsolatedAsyncioTestCase):
    @staticmethod
    def _pool_with_connection(conn):
        pool = MagicMock()
        pool.connection.return_value.__aenter__.return_value = conn
        return pool

    async def test_record_shadow_write_is_scoped_and_returns_artifact_ids(self):
        memory_cursor = AsyncMock()
        memory_cursor.fetchone.return_value = (
            "张三的任职经历",
            "2026 年晋升为技术总监",
            2,
        )
        evidence_cursor = AsyncMock()
        evidence_cursor.fetchone.return_value = ("evidence-1",)
        revision_cursor = AsyncMock()
        revision_cursor.fetchone.return_value = ("revision-1",)
        conn = AsyncMock()
        conn.execute.side_effect = [evidence_cursor, memory_cursor, revision_cursor]

        with patch(
            "app.infrastructure.db.repositories.contact_memory.get_pool",
            return_value=self._pool_with_connection(conn),
        ):
            result = await contact_memory.record_shadow_write(
                user_id="user-1",
                contact_id="contact-1",
                memory_id="memory-1",
                primary_abstraction="张三的任职经历",
                observed_value="晋升为技术总监",
                next_value="2026 年晋升为技术总监",
                source_type="memo",
                source_id="memo-1",
                occurred_at=datetime(2026, 8, 1, tzinfo=timezone.utc),
                confidence=0.9,
                outcome="updated",
                requested_action="update",
                previous={
                    "primary_abstraction": "张三的任职经历",
                    "fact_value": "2025 年任技术经理",
                },
            )

        self.assertEqual(result["version"], 2)
        self.assertEqual(result["evidence_id"], "evidence-1")
        self.assertEqual(result["revision_id"], "revision-1")
        self.assertEqual(conn.execute.await_count, 3)

        evidence_params = conn.execute.await_args_list[0].args[1]
        self.assertEqual(evidence_params[-3:], ("memory-1", "contact-1", "user-1"))

        update_params = conn.execute.await_args_list[1].args[1]
        self.assertEqual(update_params[-3:], ("memory-1", "contact-1", "user-1"))
        self.assertEqual(update_params[2], 1)

        revision_params = conn.execute.await_args_list[2].args[1]
        self.assertEqual(revision_params[0:4], ("user-1", "memory-1", 2, "correct"))
        self.assertIn('"mode": "shadow"', revision_params[-1])

    async def test_replayed_source_does_not_increment_version_or_add_revision(self):
        duplicate_cursor = AsyncMock()
        duplicate_cursor.fetchone.return_value = None
        existing_cursor = AsyncMock()
        existing_cursor.fetchone.return_value = ("张三的饮食偏好", "喜欢普洱茶", 3)
        conn = AsyncMock()
        conn.execute.side_effect = [duplicate_cursor, existing_cursor]

        with patch(
            "app.infrastructure.db.repositories.contact_memory.get_pool",
            return_value=self._pool_with_connection(conn),
        ):
            result = await contact_memory.record_shadow_write(
                user_id="user-1",
                contact_id="contact-1",
                memory_id="memory-1",
                primary_abstraction="张三的饮食偏好",
                observed_value="喜欢普洱茶",
                next_value="喜欢普洱茶",
                source_type="memo",
                source_id="memo-1",
                occurred_at=None,
                confidence=1.0,
                outcome="created",
                requested_action="new",
            )

        self.assertEqual(result["version"], 3)
        self.assertIsNone(result["revision_id"])
        self.assertEqual(conn.execute.await_count, 2)

    async def test_duplicate_evidence_is_scoped_to_user_contact_and_memory(self):
        cursor = AsyncMock()
        cursor.fetchone.return_value = ("evidence-1",)
        conn = AsyncMock()
        conn.execute.return_value = cursor

        with patch(
            "app.infrastructure.db.repositories.contact_memory.get_pool",
            return_value=self._pool_with_connection(conn),
        ):
            evidence_id = await contact_memory.record_shadow_evidence(
                user_id="user-1",
                contact_id="contact-1",
                memory_id="memory-1",
                observed_value="喜欢普洱茶",
                source_type="chat",
                source_id="session-1",
                occurred_at=None,
                confidence=1.0,
            )

        self.assertEqual(evidence_id, "evidence-1")
        params = conn.execute.await_args.args[1]
        self.assertEqual(params[-3:], ("memory-1", "contact-1", "user-1"))

    def test_only_real_chat_paste_uuid_becomes_interaction_foreign_key(self):
        interaction_id = "0de17d43-9d43-4c02-a581-07d2e46d8b72"
        self.assertEqual(
            contact_memory._interaction_id("chat_paste", interaction_id),
            interaction_id,
        )
        self.assertIsNone(contact_memory._interaction_id("chat_paste", "not-a-uuid"))
        self.assertIsNone(contact_memory._interaction_id("memo", interaction_id))

    def test_default_primary_abstraction_is_stable_and_value_free(self):
        abstraction = contact_memory.default_primary_abstraction("张三", "tea_preference")
        self.assertEqual(abstraction, "张三 · tea preference")
        self.assertNotIn("普洱茶", abstraction)

    def test_default_cues_are_value_free_and_offer_alternate_recall_phrases(self):
        cues = contact_memory.default_cue_anchors("张三", "tea_preference", "preference")
        self.assertEqual(
            [cue["cue_text"] for cue in cues],
            ["张三 tea preference", "张三 preference", "tea preference"],
        )
        self.assertNotIn("普洱茶", " ".join(cue["cue_text"] for cue in cues))

    async def test_backfill_is_user_scoped_and_returns_indexable_rows(self):
        select_cursor = AsyncMock()
        select_cursor.fetchall.return_value = [
            (
                "memory-1",
                "contact-1",
                "张三",
                "private",
                "preference",
                "tea_preference",
                "喜欢普洱茶",
                0.9,
                "memo",
                "memo-1",
                None,
                "active",
                1,
            )
        ]
        update_cursor = AsyncMock()
        update_cursor.fetchone.return_value = ("memory-1",)
        conn = AsyncMock()
        conn.execute.side_effect = [
            select_cursor,
            update_cursor,
            AsyncMock(),
            AsyncMock(),
        ]

        with patch(
            "app.infrastructure.db.repositories.contact_memory.get_pool",
            return_value=self._pool_with_connection(conn),
        ):
            rows = await contact_memory.backfill_missing_memories(user_id="user-1", limit=10)

        self.assertEqual(rows[0]["primary_abstraction"], "张三 · tea preference")
        self.assertEqual(rows[0]["user_id"], "user-1")
        select_sql, select_params = conn.execute.await_args_list[0].args
        self.assertIn("p.user_id = %s", select_sql)
        self.assertIn("skip locked", select_sql.lower())
        self.assertEqual(select_params, ("user-1", 10))
        update_params = conn.execute.await_args_list[1].args[1]
        self.assertEqual(update_params[-3:], ("memory-1", "contact-1", "user-1"))

    async def test_historical_cue_backfill_is_resumable_and_user_scoped(self):
        select_cursor = AsyncMock()
        select_cursor.fetchall.return_value = [
            (
                "memory-1",
                "contact-1",
                "张三",
                "tea_preference",
                "preference",
                "张三 · tea preference",
            )
        ]
        cue_cursors = []
        link_cursors = []
        side_effect = [select_cursor]
        for index in range(3):
            cue_cursor = AsyncMock()
            cue_cursor.fetchone.return_value = (f"cue-{index}",)
            link_cursor = AsyncMock()
            link_cursor.fetchone.return_value = (f"cue-{index}",)
            cue_cursors.append(cue_cursor)
            link_cursors.append(link_cursor)
            side_effect.extend([cue_cursor, link_cursor])
        conn = AsyncMock()
        conn.execute.side_effect = side_effect

        with patch(
            "app.infrastructure.db.repositories.contact_memory.get_pool",
            return_value=self._pool_with_connection(conn),
        ):
            linked = await contact_memory.backfill_missing_cues(user_id="user-1", limit=10)

        self.assertEqual(linked, 3)
        select_sql, select_params = conn.execute.await_args_list[0].args
        self.assertIn("p.user_id = %s", select_sql)
        self.assertIn("not exists", select_sql.lower())
        self.assertIn("skip locked", select_sql.lower())
        self.assertEqual(select_params, ("user-1", 10))

    async def test_soft_delete_appends_revision_without_removing_memory(self):
        target_cursor = AsyncMock()
        target_cursor.fetchone.return_value = (
            "memory-1",
            "private",
            "preference",
            "tea_preference",
            "喜欢普洱茶",
            1.0,
            None,
            "manual",
            None,
            "张三的饮食偏好",
            2,
            "active",
        )
        update_cursor = AsyncMock()
        update_cursor.fetchone.return_value = target_cursor.fetchone.return_value[:9]
        conn = AsyncMock()
        conn.execute.side_effect = [target_cursor, update_cursor, AsyncMock()]

        with patch(
            "app.infrastructure.db.repositories.contact_memory.get_pool",
            return_value=self._pool_with_connection(conn),
        ):
            result = await contact_memory.set_memory_deleted(
                user_id="user-1",
                contact_id="contact-1",
                memory_id="memory-1",
                deleted=True,
                reason="user delete",
            )

        self.assertEqual(result["memory"]["memory_status"], "deleted")
        select_sql, select_params = conn.execute.await_args_list[0].args
        self.assertIn("memory_status <> 'deleted'", select_sql)
        self.assertEqual(select_params, ("memory-1", "contact-1", "user-1"))
        update_params = conn.execute.await_args_list[1].args[1]
        self.assertEqual(update_params[:2], ("deleted", 3))
        revision_params = conn.execute.await_args_list[2].args[1]
        self.assertEqual(revision_params[0:4], ("user-1", "memory-1", 3, "delete"))

    async def test_memory_history_is_fully_user_and_contact_scoped(self):
        now = datetime(2026, 9, 18, tzinfo=timezone.utc)
        memory_cursor = AsyncMock()
        memory_cursor.fetchone.return_value = (
            "memory-1",
            "张三的饮食偏好",
            "喜欢普洱茶",
            "private",
            "preference",
            "tea_preference",
            "active",
            2,
            None,
            1.0,
            now,
            now,
        )
        evidence_cursor = AsyncMock()
        evidence_cursor.fetchall.return_value = [
            ("evidence-1", "喜欢普洱茶", "memo", "memo-1", None, 1.0, now)
        ]
        revision_cursor = AsyncMock()
        revision_cursor.fetchall.return_value = [
            (
                "revision-1",
                2,
                "merge",
                "主题",
                "主题",
                "旧值",
                "喜欢普洱茶",
                "merge",
                now,
            )
        ]
        conn = AsyncMock()
        conn.execute.side_effect = [memory_cursor, evidence_cursor, revision_cursor]

        with patch(
            "app.infrastructure.db.repositories.contact_memory.get_pool",
            return_value=self._pool_with_connection(conn),
        ):
            history = await contact_memory.get_memory_history(
                user_id="user-1",
                contact_id="contact-1",
                memory_id="memory-1",
            )

        self.assertEqual(history["memory"]["version"], 2)
        self.assertEqual(history["evidence"][0]["source_id"], "memo-1")
        self.assertEqual(history["revisions"][0]["operation"], "merge")
        self.assertEqual(
            conn.execute.await_args_list[0].args[1],
            ("memory-1", "contact-1", "user-1"),
        )

    async def test_primary_index_queue_and_marker_are_user_scoped(self):
        list_cursor = AsyncMock()
        list_cursor.fetchall.return_value = [
            (
                "memory-1",
                "contact-1",
                "张三的任职经历",
                "business",
                "event",
                "active",
            )
        ]
        mark_cursor = AsyncMock()
        mark_cursor.fetchone.return_value = ("memory-1",)
        conn = AsyncMock()
        conn.execute.side_effect = [list_cursor, mark_cursor]

        with patch(
            "app.infrastructure.db.repositories.contact_memory.get_pool",
            return_value=self._pool_with_connection(conn),
        ):
            pending = await contact_memory.list_primary_index_pending(user_id="user-1", limit=25)
            marked = await contact_memory.mark_primary_indexed(
                user_id="user-1",
                memory_id="memory-1",
            )

        self.assertEqual(pending[0]["memory_id"], "memory-1")
        self.assertTrue(marked)
        self.assertEqual(conn.execute.await_args_list[0].args[1], ("user-1", 25))
        self.assertEqual(conn.execute.await_args_list[1].args[1], ("memory-1", "user-1"))

    async def test_judge_candidates_are_scoped_and_keep_retrieval_order(self):
        profiles_cursor = AsyncMock()
        profiles_cursor.fetchall.return_value = [
            ("memory-1", "主题一", "值一", "basic", "other", "active", 1, None, 1.0),
            ("memory-2", "主题二", "值二", "basic", "other", "active", 1, None, 0.9),
        ]
        evidence_cursor = AsyncMock()
        evidence_cursor.fetchall.return_value = [
            ("memory-2", "旧值二", "memo", "memo-1", None, 0.8),
        ]
        conn = AsyncMock()
        conn.execute.side_effect = [profiles_cursor, evidence_cursor]

        with patch(
            "app.infrastructure.db.repositories.contact_memory.get_pool",
            return_value=self._pool_with_connection(conn),
        ):
            candidates = await contact_memory.get_memory_candidates(
                user_id="user-1",
                contact_id="contact-1",
                memory_ids=["memory-2", "memory-1"],
            )

        self.assertEqual([item["memory_id"] for item in candidates], ["memory-2", "memory-1"])
        self.assertEqual(candidates[0]["recent_evidence"][0]["observed_value"], "旧值二")
        sql, params = conn.execute.await_args_list[0].args
        self.assertIn("user_id = %s and contact_id = %s", sql)
        self.assertEqual(params, ("user-1", "contact-1", ["memory-2", "memory-1"]))
        evidence_sql, evidence_params = conn.execute.await_args_list[1].args
        self.assertIn("rank <= 3", evidence_sql)
        self.assertEqual(evidence_params, params)

    async def test_shadow_decision_rejects_target_outside_scope(self):
        target_cursor = AsyncMock()
        target_cursor.fetchone.return_value = None
        conn = AsyncMock()
        conn.execute.return_value = target_cursor

        with patch(
            "app.infrastructure.db.repositories.contact_memory.get_pool",
            return_value=self._pool_with_connection(conn),
        ):
            with self.assertRaisesRegex(ValueError, "outside"):
                await contact_memory.record_shadow_decision(
                    user_id="user-1",
                    contact_id="contact-1",
                    source_type="manual",
                    source_id=None,
                    candidate_payload={"fact_value": "值"},
                    retrieved_memory_ids=["memory-1"],
                    v1_requested_action="new",
                    v1_outcome="created",
                    judge_action="merge",
                    target_memory_id="memory-other",
                    merged_abstraction="主题",
                    merged_value="值",
                    reason="same topic",
                    confidence=0.9,
                    prompt_version="judge-v1",
                )

        self.assertEqual(conn.execute.await_count, 1)
        self.assertEqual(
            conn.execute.await_args.args[1],
            ("memory-other", "contact-1", "user-1"),
        )

    def test_cue_normalization_is_nfkc_case_and_space_stable(self):
        self.assertEqual(contact_memory.normalize_cue("  张三   AI  "), "张三 ai")
        self.assertEqual(contact_memory.normalize_cue("ＡＩ"), "ai")

    async def test_cue_upsert_is_scoped_deduplicated_and_linked(self):
        target_cursor = AsyncMock()
        target_cursor.fetchone.return_value = (1,)
        cue_cursor = AsyncMock()
        cue_cursor.fetchone.return_value = ("cue-1", "张三 晋升", "semantic", None)
        conn = AsyncMock()
        conn.execute.side_effect = [target_cursor, cue_cursor, AsyncMock()]

        with patch(
            "app.infrastructure.db.repositories.contact_memory.get_pool",
            return_value=self._pool_with_connection(conn),
        ):
            cues = await contact_memory.upsert_memory_cues(
                user_id="user-1",
                contact_id="contact-1",
                memory_id="memory-1",
                cues=[
                    {"cue_text": "张三  晋升", "cue_type": "semantic"},
                    {"cue_text": "张三 晋升", "cue_type": "semantic"},
                ],
            )

        self.assertEqual(len(cues), 1)
        self.assertEqual(cues[0]["cue_id"], "cue-1")
        self.assertEqual(conn.execute.await_args_list[0].args[1], ("memory-1", "contact-1", "user-1"))
        self.assertEqual(
            conn.execute.await_args_list[2].args[1],
            ("user-1", "cue-1", "memory-1", "contact-1"),
        )

    async def test_resolve_cue_links_keeps_user_and_contact_scope(self):
        cursor = AsyncMock()
        cursor.fetchall.return_value = [("cue-1", "memory-1", "contact-1")]
        conn = AsyncMock()
        conn.execute.return_value = cursor

        with patch(
            "app.infrastructure.db.repositories.contact_memory.get_pool",
            return_value=self._pool_with_connection(conn),
        ):
            links = await contact_memory.resolve_cue_links(
                user_id="user-1",
                cue_ids=["cue-1"],
                contact_id="contact-1",
            )

        self.assertEqual(links[0]["memory_id"], "memory-1")
        sql, params = conn.execute.await_args.args
        self.assertIn("user_id = %s", sql)
        self.assertIn("contact_id = %s", sql)
        self.assertEqual(params, ("user-1", ["cue-1"], "contact-1"))


if __name__ == "__main__":
    unittest.main()
