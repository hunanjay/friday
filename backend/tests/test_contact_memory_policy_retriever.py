import os
import unittest
from unittest.mock import AsyncMock, patch

os.environ.setdefault("SUPABASE_URL", "https://example.supabase.co")
os.environ.setdefault("SUPABASE_ANON_KEY", "test-key")
os.environ.setdefault("SUPABASE_SERVICE_ROLE_KEY", "test-service-key")

from app.services.contact_memory_policy_retriever import (  # noqa: E402
    ContactMemoryPolicyRetriever,
    RetrievalPolicyDecision,
)


def _memory(memory_id: str, score: float) -> dict:
    return {
        "memory_id": memory_id,
        "contact_id": "contact-1",
        "primary_abstraction": f"主题 {memory_id}",
        "memory_value": f"值 {memory_id}",
        "memory_status": "active",
        "score": score,
    }


class TestContactMemoryPolicyRetriever(unittest.IsolatedAsyncioTestCase):
    async def test_simple_query_stays_on_single_semantic_retrieval(self):
        with (
            patch(
                "app.services.contact_memory_policy_retriever.ContactMemoryRetrievalService.search",
                new_callable=AsyncMock,
                return_value=[_memory("memory-1", 0.9)],
            ) as semantic,
            patch(
                "app.services.contact_memory_policy_retriever.ContactMemoryPolicyRetriever._decide",
                new_callable=AsyncMock,
            ) as decide,
        ):
            results = await ContactMemoryPolicyRetriever.search(
                user_id="user-1",
                query="张三职位",
                limit=5,
            )

        self.assertEqual([item["memory_id"] for item in results], ["memory-1"])
        semantic.assert_awaited_once()
        decide.assert_not_awaited()

    async def test_complex_query_can_rewrite_then_stop(self):
        with (
            patch(
                "app.services.contact_memory_policy_retriever.ContactMemoryRetrievalService.search",
                new_callable=AsyncMock,
                side_effect=[[_memory("memory-1", 0.9)], [_memory("memory-2", 0.8)]],
            ) as semantic,
            patch(
                "app.services.contact_memory_policy_retriever.memory_repo.list_memory_cues",
                new_callable=AsyncMock,
                return_value=[],
            ),
            patch(
                "app.services.contact_memory_policy_retriever.ContactMemoryPolicyRetriever._decide",
                new_callable=AsyncMock,
                side_effect=[
                    RetrievalPolicyDecision(
                        action="RE_QUERY",
                        query="张三 任职历史",
                        reason="retrieve prior roles",
                    ),
                    RetrievalPolicyDecision(action="STOP", reason="sufficient"),
                ],
            ) as decide,
        ):
            results = await ContactMemoryPolicyRetriever.search(
                user_id="user-1",
                query="张三之前和现在的职位怎么变化",
                limit=5,
            )

        self.assertEqual({item["memory_id"] for item in results}, {"memory-1", "memory-2"})
        self.assertEqual(semantic.await_count, 2)
        self.assertEqual(decide.await_count, 2)

    async def test_complex_query_can_expand_only_supplied_cues(self):
        cue = {
            "cue_id": "cue-1",
            "cue_text": "张三 技术管理",
            "memory_id": "memory-1",
            "contact_id": "contact-1",
        }
        with (
            patch(
                "app.services.contact_memory_policy_retriever.ContactMemoryRetrievalService.search",
                new_callable=AsyncMock,
                return_value=[_memory("memory-1", 0.9)],
            ),
            patch(
                "app.services.contact_memory_policy_retriever.memory_repo.list_memory_cues",
                new_callable=AsyncMock,
                return_value=[cue],
            ),
            patch(
                "app.services.contact_memory_policy_retriever.ContactMemoryPolicyRetriever._decide",
                new_callable=AsyncMock,
                side_effect=[
                    RetrievalPolicyDecision(
                        action="EXPAND",
                        cue_ids=["invented-cue", "cue-1"],
                        reason="follow shared management cue",
                    ),
                    RetrievalPolicyDecision(action="STOP", reason="sufficient"),
                ],
            ),
            patch(
                "app.services.contact_memory_policy_retriever.ContactMemoryRetrievalService.expand_from_memories",
                new_callable=AsyncMock,
                return_value=[_memory("memory-2", 0.0)],
            ) as expand,
        ):
            results = await ContactMemoryPolicyRetriever.search(
                user_id="user-1",
                query="张三过去和现在的技术管理经历有什么关联",
                limit=5,
            )

        self.assertEqual({item["memory_id"] for item in results}, {"memory-1", "memory-2"})
        self.assertEqual(expand.await_args.kwargs["cue_ids"], ["cue-1"])

    async def test_policy_failure_degrades_to_initial_results(self):
        with (
            patch(
                "app.services.contact_memory_policy_retriever.ContactMemoryRetrievalService.search",
                new_callable=AsyncMock,
                return_value=[_memory("memory-1", 0.9)],
            ),
            patch(
                "app.services.contact_memory_policy_retriever.memory_repo.list_memory_cues",
                new_callable=AsyncMock,
                return_value=[],
            ),
            patch(
                "app.services.contact_memory_policy_retriever.ContactMemoryPolicyRetriever._decide",
                new_callable=AsyncMock,
                side_effect=RuntimeError("model unavailable"),
            ),
        ):
            with self.assertLogs(
                "app.services.contact_memory_policy_retriever",
                level="WARNING",
            ):
                results = await ContactMemoryPolicyRetriever.search(
                    user_id="user-1",
                    query="张三过去和现在的职位为什么变化",
                    limit=5,
                )

        self.assertEqual([item["memory_id"] for item in results], ["memory-1"])


if __name__ == "__main__":
    unittest.main()
