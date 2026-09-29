import os
import unittest
from unittest.mock import AsyncMock, patch

os.environ.setdefault("SUPABASE_URL", "https://example.supabase.co")
os.environ.setdefault("SUPABASE_ANON_KEY", "test-key")
os.environ.setdefault("SUPABASE_SERVICE_ROLE_KEY", "test-service-key")
os.environ.setdefault("CHECKPOINT_DB_URL", "postgresql://friday:friday@localhost:5438/friday")

from app.services.contact_memory_judge import JudgeDecision  # noqa: E402
from app.services.contact_memory_service import (  # noqa: E402
    ContactMemoryCandidate,
    ContactMemoryService,
    MemorySource,
)


class TestContactMemoryService(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        # Contact Memory is always on. Keep unit tests hermetic by replacing its
        # external DB/Qdrant/Judge collaborators; focused tests override these
        # patches inside their own context managers.
        patchers = [
            patch(
                "app.services.contact_memory_service.ContactMemoryService._evaluate_shadow_decision",
                new_callable=AsyncMock,
                return_value=None,
            ),
            patch(
                "app.services.contact_memory_service.memory_repo.get_contact_name",
                new_callable=AsyncMock,
                return_value="张三",
            ),
            patch(
                "app.services.contact_memory_service.memory_repo.get_memory_snapshot",
                new_callable=AsyncMock,
                return_value=None,
            ),
            patch(
                "app.services.contact_memory_service.memory_repo.record_shadow_write",
                new_callable=AsyncMock,
                return_value={"primary_abstraction": "张三 · note"},
            ),
            patch(
                "app.services.contact_memory_service.memory_repo.record_shadow_evidence",
                new_callable=AsyncMock,
            ),
            patch(
                "app.services.contact_memory_service.vector_store.upsert_contact_memory_primary",
                new_callable=AsyncMock,
            ),
            patch(
                "app.services.contact_memory_service.memory_repo.mark_primary_indexed",
                new_callable=AsyncMock,
                return_value=True,
            ),
        ]
        for patcher in patchers:
            patcher.start()
            self.addCleanup(patcher.stop)

    async def test_new_fact_uses_shared_create_path_with_provenance(self):
        created = {
            "id": "fact-1",
            "dimension": "private",
            "category": "preference",
            "fact_key": "tea_preference",
            "fact_value": "喜欢普洱茶",
        }
        with patch(
            "app.services.contact_memory_service.contacts_repo.add_contact_profile",
            new_callable=AsyncMock,
            return_value=created,
        ) as add_fact:
            result = await ContactMemoryService.write(
                user_id="user-1",
                contact_id="contact-1",
                candidate=ContactMemoryCandidate(
                    dimension="private",
                    category="preference",
                    fact_key="tea_preference",
                    fact_value="  喜欢普洱茶  ",
                ),
                source=MemorySource(source_type="memo", source_id="memo-1"),
            )

        self.assertEqual(result.outcome, "created")
        self.assertEqual(result.fact, created)
        add_fact.assert_awaited_once_with(
            user_id="user-1",
            contact_id="contact-1",
            dimension="private",
            category="preference",
            fact_key="tea_preference",
            fact_value="喜欢普洱茶",
            source_type="memo",
            source_id="memo-1",
        )

    async def test_update_uses_existing_fact_when_it_is_valid(self):
        updated = {"id": "fact-1", "fact_value": "改喝正山小种"}
        with (
            patch(
                "app.services.contact_memory_service.contacts_repo.update_contact_profile",
                new_callable=AsyncMock,
                return_value=updated,
            ) as update_fact,
            patch(
                "app.services.contact_memory_service.contacts_repo.add_contact_profile",
                new_callable=AsyncMock,
            ) as add_fact,
        ):
            result = await ContactMemoryService.write(
                user_id="user-1",
                contact_id="contact-1",
                candidate=ContactMemoryCandidate(
                    action="update",
                    existing_fact_id="fact-1",
                    dimension="private",
                    category="preference",
                    fact_key="tea_preference",
                    fact_value="改喝正山小种",
                ),
                source=MemorySource(source_type="chat_paste", source_id="interaction-1"),
            )

        self.assertEqual(result.outcome, "updated")
        self.assertEqual(result.fact, updated)
        update_fact.assert_awaited_once()
        add_fact.assert_not_awaited()

    async def test_stale_update_target_falls_back_to_create(self):
        created = {"id": "fact-new", "fact_value": "新事实"}
        with (
            patch(
                "app.services.contact_memory_service.contacts_repo.update_contact_profile",
                new_callable=AsyncMock,
                return_value=None,
            ),
            patch(
                "app.services.contact_memory_service.contacts_repo.add_contact_profile",
                new_callable=AsyncMock,
                return_value=created,
            ) as add_fact,
        ):
            result = await ContactMemoryService.write(
                user_id="user-1",
                contact_id="contact-1",
                candidate=ContactMemoryCandidate(
                    action="update",
                    existing_fact_id="stale-id",
                    fact_key="note",
                    fact_value="新事实",
                ),
                source=MemorySource(source_type="chat"),
            )

        self.assertEqual(result.outcome, "created")
        self.assertIn("update target was missing", result.reason)
        add_fact.assert_awaited_once()

    async def test_skip_and_empty_value_do_not_touch_repository(self):
        with (
            patch(
                "app.services.contact_memory_service.contacts_repo.add_contact_profile",
                new_callable=AsyncMock,
            ) as add_fact,
            patch(
                "app.services.contact_memory_service.contacts_repo.update_contact_profile",
                new_callable=AsyncMock,
            ) as update_fact,
            patch(
                "app.services.contact_memory_service.contacts_repo.delete_contact_profile",
                new_callable=AsyncMock,
            ) as delete_fact,
        ):
            skipped = await ContactMemoryService.write(
                user_id="user-1",
                contact_id="contact-1",
                candidate=ContactMemoryCandidate(action="skip"),
                source=MemorySource(source_type="chat"),
            )
            empty = await ContactMemoryService.write(
                user_id="user-1",
                contact_id="contact-1",
                candidate=ContactMemoryCandidate(fact_value="  "),
                source=MemorySource(source_type="manual"),
            )

        self.assertEqual(skipped.outcome, "skipped")
        self.assertEqual(empty.outcome, "skipped")
        add_fact.assert_not_awaited()
        update_fact.assert_not_awaited()
        delete_fact.assert_not_awaited()

    async def test_delete_is_scoped_through_repository(self):
        deleted = {
            "fact": {"id": "fact-1", "fact_value": "旧事实"},
            "memory": {
                "memory_id": "fact-1",
                "user_id": "user-1",
                "contact_id": "contact-1",
                "primary_abstraction": "张三 · note",
                "dimension": "basic",
                "category": "other",
                "memory_status": "deleted",
            },
        }
        with (
            patch(
                "app.services.contact_memory_service.memory_repo.set_memory_deleted",
                new_callable=AsyncMock,
                return_value=deleted,
            ) as delete_fact,
            patch(
                "app.services.contact_memory_service.contacts_repo.unindex_contact_profile",
                new_callable=AsyncMock,
            ) as unindex,
        ):
            result = await ContactMemoryService.write(
                user_id="user-1",
                contact_id="contact-1",
                candidate=ContactMemoryCandidate(
                    action="delete",
                    existing_fact_id="fact-1",
                ),
                source=MemorySource(source_type="chat_paste"),
            )

        self.assertEqual(result.outcome, "deleted")
        delete_fact.assert_awaited_once_with(
            user_id="user-1",
            contact_id="contact-1",
            memory_id="fact-1",
            deleted=True,
            reason="memory deleted by user",
        )
        unindex.assert_awaited_once_with("fact-1")

    async def test_manual_correction_bypasses_judge_and_records_revision(self):
        updated = {"id": "fact-1", "fact_value": "用户纠正后的事实"}
        with (
            patch(
                "app.services.contact_memory_service.ContactMemoryService._evaluate_shadow_decision",
                new_callable=AsyncMock,
            ) as evaluate,
            patch(
                "app.services.contact_memory_service.contacts_repo.update_contact_profile",
                new_callable=AsyncMock,
                return_value=updated,
            ),
        ):
            result = await ContactMemoryService.write(
                user_id="user-1",
                contact_id="contact-1",
                candidate=ContactMemoryCandidate(
                    action="update",
                    existing_fact_id="fact-1",
                    fact_value="用户纠正后的事实",
                ),
                source=MemorySource(source_type="manual_correction"),
            )

        self.assertEqual(result.outcome, "updated")
        evaluate.assert_not_awaited()

    async def test_restore_reindexes_legacy_and_primary_points(self):
        restored = {
            "fact": {"id": "fact-1", "fact_value": "恢复的事实"},
            "memory": {
                "memory_id": "fact-1",
                "user_id": "user-1",
                "contact_id": "contact-1",
                "primary_abstraction": "张三 · note",
                "dimension": "basic",
                "category": "other",
                "memory_status": "active",
            },
        }
        with (
            patch(
                "app.services.contact_memory_service.memory_repo.set_memory_deleted",
                new_callable=AsyncMock,
                return_value=restored,
            ),
            patch(
                "app.services.contact_memory_service.contacts_repo.reindex_contact_profile",
                new_callable=AsyncMock,
            ) as reindex,
        ):
            fact = await ContactMemoryService.restore(
                user_id="user-1",
                contact_id="contact-1",
                memory_id="fact-1",
            )

        self.assertEqual(fact, restored["fact"])
        reindex.assert_awaited_once_with("user-1", "contact-1", restored["fact"])

    async def test_restore_revision_reindexes_both_projections(self):
        restored = {
            "fact": {"id": "fact-1", "fact_value": "旧版本事实"},
            "memory": {
                "memory_id": "fact-1",
                "user_id": "user-1",
                "contact_id": "contact-1",
                "primary_abstraction": "张三 · note",
                "dimension": "basic",
                "category": "other",
                "memory_status": "active",
            },
        }
        with (
            patch(
                "app.services.contact_memory_service.memory_repo.restore_memory_revision",
                new_callable=AsyncMock,
                return_value=restored,
            ) as restore_revision,
            patch(
                "app.services.contact_memory_service.contacts_repo.reindex_contact_profile",
                new_callable=AsyncMock,
            ) as reindex,
        ):
            fact = await ContactMemoryService.restore_revision(
                user_id="user-1",
                contact_id="contact-1",
                memory_id="fact-1",
                revision_version=2,
            )

        self.assertEqual(fact["fact_value"], "旧版本事实")
        restore_revision.assert_awaited_once_with(
            user_id="user-1",
            contact_id="contact-1",
            memory_id="fact-1",
            revision_version=2,
            reason="memory revision restored by user",
        )
        reindex.assert_awaited_once()

    async def test_shadow_write_records_primary_abstraction_and_audit_artifacts(self):
        created = {
            "id": "fact-1",
            "fact_value": "喜欢普洱茶",
        }
        with (
            patch(
                "app.services.contact_memory_service.contacts_repo.add_contact_profile",
                new_callable=AsyncMock,
                return_value=created,
            ),
            patch(
                "app.services.contact_memory_service.memory_repo.get_contact_name",
                new_callable=AsyncMock,
                return_value="张三",
            ) as get_name,
            patch(
                "app.services.contact_memory_service.memory_repo.record_shadow_write",
                new_callable=AsyncMock,
            ) as record_shadow,
        ):
            result = await ContactMemoryService.write(
                user_id="user-1",
                contact_id="contact-1",
                candidate=ContactMemoryCandidate(
                    fact_key="tea_preference",
                    fact_value="喜欢普洱茶",
                    confidence=0.9,
                ),
                source=MemorySource(source_type="memo", source_id="memo-1"),
            )

        self.assertEqual(result.outcome, "created")
        get_name.assert_awaited_once_with("user-1", "contact-1")
        record_shadow.assert_awaited_once()
        kwargs = record_shadow.call_args.kwargs
        self.assertEqual(kwargs["primary_abstraction"], "张三 · tea preference")
        self.assertEqual(kwargs["observed_value"], "喜欢普洱茶")
        self.assertEqual(kwargs["confidence"], 0.9)
        self.assertEqual(kwargs["outcome"], "created")

    async def test_shadow_failure_never_rolls_back_authoritative_write(self):
        created = {"id": "fact-1", "fact_value": "新事实"}
        with (
            patch(
                "app.services.contact_memory_service.contacts_repo.add_contact_profile",
                new_callable=AsyncMock,
                return_value=created,
            ),
            patch(
                "app.services.contact_memory_service.memory_repo.get_contact_name",
                new_callable=AsyncMock,
                side_effect=RuntimeError("shadow database unavailable"),
            ),
        ):
            with self.assertLogs("app.services.contact_memory_service", level="WARNING"):
                result = await ContactMemoryService.write(
                    user_id="user-1",
                    contact_id="contact-1",
                    candidate=ContactMemoryCandidate(fact_value="新事实"),
                    source=MemorySource(source_type="manual"),
                )

        self.assertEqual(result.outcome, "created")
        self.assertEqual(result.fact, created)

    async def test_duplicate_shadow_write_adds_evidence_without_revision(self):
        with (
            patch(
                "app.services.contact_memory_service.memory_repo.record_shadow_evidence",
                new_callable=AsyncMock,
            ) as record_evidence,
            patch(
                "app.services.contact_memory_service.memory_repo.record_shadow_write",
                new_callable=AsyncMock,
            ) as record_revision,
        ):
            result = await ContactMemoryService.write(
                user_id="user-1",
                contact_id="contact-1",
                candidate=ContactMemoryCandidate(
                    action="skip",
                    existing_fact_id="fact-1",
                    fact_value="喜欢普洱茶",
                ),
                source=MemorySource(source_type="chat_paste", source_id="not-a-uuid"),
            )

        self.assertEqual(result.outcome, "skipped")
        record_evidence.assert_awaited_once()
        record_revision.assert_not_awaited()

    async def test_v2_index_is_marked_only_after_qdrant_upsert(self):
        created = {
            "id": "fact-1",
            "dimension": "private",
            "category": "preference",
            "fact_value": "喜欢普洱茶",
        }
        with (
            patch(
                "app.services.contact_memory_service.contacts_repo.add_contact_profile",
                new_callable=AsyncMock,
                return_value=created,
            ),
            patch(
                "app.services.contact_memory_service.memory_repo.get_contact_name",
                new_callable=AsyncMock,
                return_value="张三",
            ),
            patch(
                "app.services.contact_memory_service.memory_repo.record_shadow_write",
                new_callable=AsyncMock,
                return_value={"primary_abstraction": "张三的饮食偏好"},
            ),
            patch(
                "app.services.contact_memory_service.vector_store.upsert_contact_memory_primary",
                new_callable=AsyncMock,
            ) as upsert,
            patch(
                "app.services.contact_memory_service.memory_repo.mark_primary_indexed",
                new_callable=AsyncMock,
                return_value=True,
            ) as mark,
        ):
            result = await ContactMemoryService.write(
                user_id="user-1",
                contact_id="contact-1",
                candidate=ContactMemoryCandidate(
                    fact_key="tea_preference",
                    fact_value="喜欢普洱茶",
                ),
                source=MemorySource(source_type="manual"),
            )

        self.assertEqual(result.outcome, "created")
        upsert.assert_awaited_once()
        self.assertEqual(upsert.await_args.kwargs["primary_abstraction"], "张三的饮食偏好")
        mark.assert_awaited_once_with(user_id="user-1", memory_id="fact-1")

    async def test_v2_failure_leaves_primary_index_pending(self):
        memory = {
            "memory_id": "fact-1",
            "user_id": "user-1",
            "contact_id": "contact-1",
            "primary_abstraction": "张三的任职经历",
            "dimension": "business",
            "category": "event",
            "memory_status": "active",
        }
        with (
            patch(
                "app.services.contact_memory_service.vector_store.upsert_contact_memory_primary",
                new_callable=AsyncMock,
                side_effect=RuntimeError("qdrant down"),
            ),
            patch(
                "app.services.contact_memory_service.memory_repo.mark_primary_indexed",
                new_callable=AsyncMock,
            ) as mark,
        ):
            with self.assertLogs("app.services.contact_memory_service", level="WARNING"):
                indexed = await ContactMemoryService._index_primary(memory)

        self.assertFalse(indexed)
        mark.assert_not_awaited()

    async def test_backfill_retries_pending_primary_indexes(self):
        pending = {
            "memory_id": "fact-1",
            "user_id": "user-1",
            "contact_id": "contact-1",
            "primary_abstraction": "张三的任职经历",
            "dimension": "business",
            "category": "event",
            "memory_status": "active",
        }
        with (
            patch(
                "app.services.contact_memory_service.memory_repo.backfill_missing_memories",
                new_callable=AsyncMock,
                return_value=[pending],
            ),
            patch(
                "app.services.contact_memory_service.memory_repo.backfill_missing_cues",
                new_callable=AsyncMock,
                return_value=3,
            ),
            patch(
                "app.services.contact_memory_service.memory_repo.list_primary_index_pending",
                new_callable=AsyncMock,
                return_value=[pending],
            ),
            patch(
                "app.services.contact_memory_service.ContactMemoryService._index_primary",
                new_callable=AsyncMock,
                return_value=True,
            ) as index_primary,
            patch(
                "app.services.contact_memory_service.memory_repo.count_backfill_pending",
                new_callable=AsyncMock,
                return_value=4,
            ),
            patch(
                "app.services.contact_memory_service.memory_repo.count_primary_index_pending",
                new_callable=AsyncMock,
                return_value=2,
            ),
            patch(
                "app.services.contact_memory_service.memory_repo.list_cue_index_pending",
                new_callable=AsyncMock,
                return_value=[],
            ),
            patch(
                "app.services.contact_memory_service.memory_repo.count_cue_index_pending",
                new_callable=AsyncMock,
                return_value=0,
            ),
        ):
            result = await ContactMemoryService.backfill(user_id="user-1", limit=25)

        self.assertEqual(result["backfilled"], 1)
        self.assertEqual(result["cue_backfilled"], 3)
        self.assertEqual(result["indexed"], 1)
        self.assertEqual(result["pending"], 4)
        self.assertEqual(result["index_pending"], 2)
        self.assertEqual(result["cue_index_pending"], 0)
        index_primary.assert_awaited_once_with(pending)

    async def test_high_confidence_judge_merge_is_authoritative_and_audited(self):
        merged = {
            "id": "fact-old",
            "dimension": "private",
            "category": "preference",
            "fact_key": "tea_preference",
            "fact_value": "过去喜欢普洱茶，目前偏好红茶",
        }
        evaluation = (
            JudgeDecision(
                action="merge",
                target_memory_id="fact-old",
                merged_abstraction="张三的饮食偏好",
                merged_value="过去喜欢普洱茶，目前偏好红茶",
                reason="same preference changed over time",
                confidence=0.92,
            ),
            ["fact-old"],
        )
        with (
            patch(
                "app.services.contact_memory_service.memory_repo.apply_authoritative_judge_action",
                new_callable=AsyncMock,
                return_value={
                    "outcome": "updated",
                    "fact": merged,
                    "affected_memories": [
                        {
                            "memory_id": "fact-old",
                            "user_id": "user-1",
                            "contact_id": "contact-1",
                            "primary_abstraction": "张三的饮食偏好",
                            "dimension": "private",
                            "category": "preference",
                            "memory_status": "active",
                        }
                    ],
                    "reason": "same preference changed over time",
                },
            ) as apply_decision,
            patch(
                "app.services.contact_memory_service.ContactMemoryService._evaluate_shadow_decision",
                new_callable=AsyncMock,
                return_value=evaluation,
            ),
            patch(
                "app.services.contact_memory_service.contacts_repo.reindex_contact_profile",
                new_callable=AsyncMock,
            ) as reindex,
            patch(
                "app.services.contact_memory_service.memory_repo.record_shadow_decision",
                new_callable=AsyncMock,
            ) as record_decision,
        ):
            result = await ContactMemoryService.write(
                user_id="user-1",
                contact_id="contact-1",
                candidate=ContactMemoryCandidate(
                    action="new",
                    dimension="private",
                    category="preference",
                    fact_key="tea_preference",
                    fact_value="目前偏好红茶",
                ),
                source=MemorySource(source_type="manual"),
            )

        self.assertEqual(result.outcome, "updated")
        self.assertEqual(result.fact["id"], "fact-old")
        apply_decision.assert_awaited_once()
        reindex.assert_awaited_once_with("user-1", "contact-1", merged)
        record_decision.assert_awaited_once()
        kwargs = record_decision.await_args.kwargs
        self.assertEqual(kwargs["v1_outcome"], "updated")
        self.assertEqual(kwargs["judge_action"], "merge")
        self.assertEqual(kwargs["target_memory_id"], "fact-old")

    async def test_judge_noop_adds_evidence_without_legacy_reindex(self):
        existing = {"id": "fact-old", "fact_value": "喜欢普洱茶"}
        evaluation = (
            JudgeDecision(
                action="noop",
                target_memory_id="fact-old",
                merged_abstraction="张三的饮食偏好",
                merged_value="喜欢普洱茶",
                reason="same observation",
                confidence=0.98,
            ),
            ["fact-old"],
        )
        with (
            patch(
                "app.services.contact_memory_service.ContactMemoryService._evaluate_shadow_decision",
                new_callable=AsyncMock,
                return_value=evaluation,
            ),
            patch(
                "app.services.contact_memory_service.memory_repo.apply_authoritative_judge_action",
                new_callable=AsyncMock,
                return_value={
                    "outcome": "skipped",
                    "fact": existing,
                    "affected_memories": [],
                    "reason": "same observation",
                },
            ) as apply_decision,
            patch(
                "app.services.contact_memory_service.contacts_repo.reindex_contact_profile",
                new_callable=AsyncMock,
            ) as reindex,
            patch(
                "app.services.contact_memory_service.memory_repo.record_shadow_decision",
                new_callable=AsyncMock,
            ),
        ):
            result = await ContactMemoryService.write(
                user_id="user-1",
                contact_id="contact-1",
                candidate=ContactMemoryCandidate(
                    fact_key="tea_preference",
                    fact_value="喜欢普洱茶",
                ),
                source=MemorySource(source_type="memo", source_id="memo-1"),
            )

        self.assertEqual(result.outcome, "skipped")
        apply_decision.assert_awaited_once()
        reindex.assert_not_awaited()

    async def test_stale_judge_target_falls_back_to_safe_create(self):
        evaluation = (
            JudgeDecision(
                action="merge",
                target_memory_id="fact-gone",
                merged_abstraction="张三的饮食偏好",
                merged_value="偏好红茶",
                reason="same topic",
                confidence=0.91,
            ),
            ["fact-gone"],
        )
        created = {"id": "fact-new", "fact_value": "偏好红茶"}
        with (
            patch(
                "app.services.contact_memory_service.ContactMemoryService._evaluate_shadow_decision",
                new_callable=AsyncMock,
                return_value=evaluation,
            ),
            patch(
                "app.services.contact_memory_service.memory_repo.apply_authoritative_judge_action",
                new_callable=AsyncMock,
                side_effect=ValueError("target disappeared"),
            ),
            patch(
                "app.services.contact_memory_service.contacts_repo.add_contact_profile",
                new_callable=AsyncMock,
                return_value=created,
            ) as add_fact,
            patch(
                "app.services.contact_memory_service.memory_repo.record_shadow_decision",
                new_callable=AsyncMock,
            ),
        ):
            with self.assertLogs("app.services.contact_memory_service", level="WARNING"):
                result = await ContactMemoryService.write(
                    user_id="user-1",
                    contact_id="contact-1",
                    candidate=ContactMemoryCandidate(fact_value="偏好红茶"),
                    source=MemorySource(source_type="manual"),
                )

        self.assertEqual(result.outcome, "created")
        add_fact.assert_awaited_once()

    async def test_cue_anchors_exclude_primary_repeat_and_sensitive_values(self):
        stored = [
            {
                "cue_id": "cue-1",
                "user_id": "user-1",
                "cue_text": "张三 技术管理",
                "cue_type": "semantic",
                "indexed_at": None,
            }
        ]
        with (
            patch(
                "app.services.contact_memory_service.memory_repo.upsert_memory_cues",
                new_callable=AsyncMock,
                return_value=stored,
            ) as upsert_cues,
            patch(
                "app.services.contact_memory_service.vector_store.upsert_contact_memory_cues",
                new_callable=AsyncMock,
            ) as index_cues,
            patch(
                "app.services.contact_memory_service.memory_repo.mark_cues_indexed",
                new_callable=AsyncMock,
            ) as mark_cues,
        ):
            await ContactMemoryService._record_cues(
                user_id="user-1",
                contact_id="contact-1",
                memory_id="memory-1",
                primary_abstraction="张三的任职经历",
                cue_texts=["张三的任职经历", "张三 技术管理", "身份证号 123456789"],
            )

        submitted = upsert_cues.await_args.kwargs["cues"]
        self.assertEqual(submitted, [{"cue_text": "张三 技术管理", "cue_type": "semantic"}])
        index_cues.assert_awaited_once_with(stored)
        mark_cues.assert_awaited_once_with(user_id="user-1", cue_ids=["cue-1"])


if __name__ == "__main__":
    unittest.main()
