import os
import unittest
from unittest.mock import AsyncMock, MagicMock, patch

os.environ.setdefault("SUPABASE_URL", "https://example.supabase.co")
os.environ.setdefault("SUPABASE_ANON_KEY", "test-key")
os.environ.setdefault("SUPABASE_SERVICE_ROLE_KEY", "test-service-key")

from app.services.contact_memory_judge import (  # noqa: E402
    ContactMemoryJudge,
    JudgeDecision,
)


class TestContactMemoryJudge(unittest.IsolatedAsyncioTestCase):
    async def test_no_scoped_candidates_returns_create_without_llm(self):
        with (
            patch(
                "app.services.contact_memory_judge.vector_store.search_contact_memory_primary",
                new_callable=AsyncMock,
                return_value=[],
            ) as search,
            patch(
                "app.services.contact_memory_judge.memory_repo.get_memory_candidates",
                new_callable=AsyncMock,
                return_value=[],
            ),
            patch("app.services.contact_memory_judge.make_chat_model") as make_model,
        ):
            decision, memory_ids = await ContactMemoryJudge.evaluate(
                user_id="user-1",
                contact_id="contact-1",
                candidate_payload={"fact_value": "喜欢普洱茶"},
                primary_abstraction="张三的饮食偏好",
            )

        self.assertEqual(decision.action, "create")
        self.assertEqual(memory_ids, [])
        search.assert_awaited_once()
        self.assertEqual(search.await_args.kwargs["contact_id"], "contact-1")
        make_model.assert_not_called()

    async def test_valid_merge_must_target_retrieved_scoped_candidate(self):
        candidate = {
            "memory_id": "memory-1",
            "primary_abstraction": "张三的饮食偏好",
            "memory_value": "喜欢普洱茶",
        }
        structured = MagicMock()
        structured.ainvoke = AsyncMock(
            return_value=JudgeDecision(
                action="merge",
                target_memory_id="memory-1",
                merged_abstraction="张三的饮食偏好",
                merged_value="过去喜欢普洱茶，目前偏好红茶",
                reason="same preference changed over time",
                confidence=0.92,
            )
        )
        model = MagicMock()
        model.with_structured_output.return_value = structured

        with (
            patch(
                "app.services.contact_memory_judge.vector_store.search_contact_memory_primary",
                new_callable=AsyncMock,
                return_value=[{"memory_id": "memory-1"}],
            ),
            patch(
                "app.services.contact_memory_judge.memory_repo.get_memory_candidates",
                new_callable=AsyncMock,
                return_value=[candidate],
            ),
            patch("app.services.contact_memory_judge.make_chat_model", return_value=model),
        ):
            decision, memory_ids = await ContactMemoryJudge.evaluate(
                user_id="user-1",
                contact_id="contact-1",
                candidate_payload={"fact_value": "目前偏好红茶"},
                primary_abstraction="张三的饮食偏好",
            )

        self.assertEqual(decision.action, "merge")
        self.assertEqual(decision.target_memory_id, "memory-1")
        self.assertEqual(memory_ids, ["memory-1"])

    async def test_out_of_set_target_degrades_to_create(self):
        structured = MagicMock()
        structured.ainvoke = AsyncMock(
            return_value=JudgeDecision(
                action="noop",
                target_memory_id="other-user-memory",
                reason="bad target",
                confidence=0.99,
            )
        )
        model = MagicMock()
        model.with_structured_output.return_value = structured

        with (
            patch(
                "app.services.contact_memory_judge.vector_store.search_contact_memory_primary",
                new_callable=AsyncMock,
                return_value=[{"memory_id": "memory-1"}],
            ),
            patch(
                "app.services.contact_memory_judge.memory_repo.get_memory_candidates",
                new_callable=AsyncMock,
                return_value=[{"memory_id": "memory-1"}],
            ),
            patch("app.services.contact_memory_judge.make_chat_model", return_value=model),
        ):
            decision, _ = await ContactMemoryJudge.evaluate(
                user_id="user-1",
                contact_id="contact-1",
                candidate_payload={"fact_value": "新事实"},
                primary_abstraction="张三的任职经历",
            )

        self.assertEqual(decision.action, "create")
        self.assertEqual(decision.target_memory_id, "")
        self.assertIn("outside", decision.reason)


if __name__ == "__main__":
    unittest.main()
