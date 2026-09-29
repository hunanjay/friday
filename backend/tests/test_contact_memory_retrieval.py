import os
import unittest
from unittest.mock import AsyncMock, patch

os.environ.setdefault("SUPABASE_URL", "https://example.supabase.co")
os.environ.setdefault("SUPABASE_ANON_KEY", "test-key")
os.environ.setdefault("SUPABASE_SERVICE_ROLE_KEY", "test-service-key")

from app.services.contact_memory_retrieval_service import (  # noqa: E402
    ContactMemoryRetrievalService,
)


class TestContactMemoryRetrievalService(unittest.IsolatedAsyncioTestCase):
    async def test_primary_and_cue_hits_are_jointly_ranked_and_deduplicated(self):
        primary_hits = [
            {"memory_id": "memory-1", "contact_id": "contact-1", "score": 0.7}
        ]
        cue_hits = [{"cue_id": "cue-1", "score": 0.8}]
        links = [
            {"cue_id": "cue-1", "memory_id": "memory-1", "contact_id": "contact-1"},
            {"cue_id": "cue-1", "memory_id": "memory-2", "contact_id": "contact-1"},
        ]
        memories = [
            {"memory_id": "memory-1", "memory_status": "active", "memory_value": "值一"},
            {"memory_id": "memory-2", "memory_status": "active", "memory_value": "值二"},
        ]
        with (
            patch(
                "app.services.contact_memory_retrieval_service.vector_store.search_contact_memory_primary",
                new_callable=AsyncMock,
                return_value=primary_hits,
            ),
            patch(
                "app.services.contact_memory_retrieval_service.vector_store.search_contact_memory_cues",
                new_callable=AsyncMock,
                return_value=cue_hits,
            ),
            patch(
                "app.services.contact_memory_retrieval_service.memory_repo.resolve_cue_links",
                new_callable=AsyncMock,
                return_value=links,
            ) as resolve_links,
            patch(
                "app.services.contact_memory_retrieval_service.memory_repo.get_memory_candidates",
                new_callable=AsyncMock,
                return_value=memories,
            ),
        ):
            results = await ContactMemoryRetrievalService.search(
                user_id="user-1",
                query="谁做技术管理",
                contact_id="contact-1",
            )

        self.assertEqual([item["memory_id"] for item in results], ["memory-1", "memory-2"])
        self.assertAlmostEqual(results[0]["score"], 0.9)
        self.assertEqual(results[0]["matched_cue_ids"], ["cue-1"])
        resolve_links.assert_awaited_once_with(
            user_id="user-1",
            cue_ids=["cue-1"],
            contact_id="contact-1",
        )

    async def test_inactive_memory_is_not_returned(self):
        with (
            patch(
                "app.services.contact_memory_retrieval_service.vector_store.search_contact_memory_primary",
                new_callable=AsyncMock,
                return_value=[
                    {"memory_id": "memory-1", "contact_id": "contact-1", "score": 0.9}
                ],
            ),
            patch(
                "app.services.contact_memory_retrieval_service.vector_store.search_contact_memory_cues",
                new_callable=AsyncMock,
                return_value=[],
            ),
            patch(
                "app.services.contact_memory_retrieval_service.memory_repo.resolve_cue_links",
                new_callable=AsyncMock,
                return_value=[],
            ),
            patch(
                "app.services.contact_memory_retrieval_service.memory_repo.get_memory_candidates",
                new_callable=AsyncMock,
                return_value=[{"memory_id": "memory-1", "memory_status": "disputed"}],
            ),
        ):
            results = await ContactMemoryRetrievalService.search(
                user_id="user-1",
                query="query",
            )

        self.assertEqual(results, [])

    async def test_cue_database_failure_degrades_to_empty_v2_results(self):
        with (
            patch(
                "app.services.contact_memory_retrieval_service.vector_store.search_contact_memory_primary",
                new_callable=AsyncMock,
                return_value=[],
            ),
            patch(
                "app.services.contact_memory_retrieval_service.vector_store.search_contact_memory_cues",
                new_callable=AsyncMock,
                return_value=[{"cue_id": "cue-1", "score": 0.9}],
            ),
            patch(
                "app.services.contact_memory_retrieval_service.memory_repo.resolve_cue_links",
                new_callable=AsyncMock,
                side_effect=RuntimeError("database unavailable"),
            ),
        ):
            with self.assertLogs(
                "app.services.contact_memory_retrieval_service",
                level="WARNING",
            ):
                results = await ContactMemoryRetrievalService.search(
                    user_id="user-1",
                    query="query",
                )

        self.assertEqual(results, [])


if __name__ == "__main__":
    unittest.main()
