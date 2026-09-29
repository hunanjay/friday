import os
import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock, create_autospec, patch

os.environ.setdefault("SUPABASE_URL", "https://example.supabase.co")
os.environ.setdefault("SUPABASE_ANON_KEY", "test-key")
os.environ.setdefault("SUPABASE_SERVICE_ROLE_KEY", "test-service-key")

from qdrant_client import AsyncQdrantClient  # noqa: E402

from app.infrastructure.vector import qdrant  # noqa: E402


class TestContactMemoryPrimaryIndex(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.original_sparse_unavailable = qdrant._sparse_unavailable
        qdrant._sparse_unavailable = False

    def tearDown(self):
        qdrant._sparse_unavailable = self.original_sparse_unavailable

    async def test_upsert_embeds_only_primary_abstraction(self):
        client = create_autospec(AsyncQdrantClient, instance=True)
        dense = SimpleNamespace(aembed_query=AsyncMock(return_value=[0.1, 0.2]))

        with (
            patch.object(qdrant, "_get_client", return_value=client),
            patch.object(qdrant, "_get_dense", return_value=dense),
            patch.object(qdrant, "_try_sparse_vector", new=AsyncMock(return_value=None)),
        ):
            await qdrant.upsert_contact_memory_primary(
                user_id="user-1",
                contact_id="contact-1",
                memory_id="29bb11d7-bb15-4281-a8f2-e9d45fd7ece0",
                primary_abstraction="张三的任职经历",
                dimension="business",
                category="event",
            )

        dense.aembed_query.assert_awaited_once_with("张三的任职经历")
        kwargs = client.upsert.await_args.kwargs
        self.assertEqual(kwargs["collection_name"], qdrant.CONTACT_MEMORY_COLLECTION)
        point = kwargs["points"][0]
        self.assertEqual(point.payload["index_kind"], "primary")
        self.assertEqual(point.payload["user_id"], "user-1")
        self.assertNotIn("fact_value", point.payload)

    async def test_hybrid_search_scopes_every_branch_to_user_and_contact(self):
        point = SimpleNamespace(
            id="29bb11d7-bb15-4281-a8f2-e9d45fd7ece0",
            score=0.9,
            payload={
                "user_id": "user-1",
                "contact_id": "contact-1",
                "memory_id": "29bb11d7-bb15-4281-a8f2-e9d45fd7ece0",
                "primary_abstraction": "张三的任职经历",
                "dimension": "business",
                "category": "event",
            },
        )
        client = create_autospec(AsyncQdrantClient, instance=True)
        client.query_points.return_value = SimpleNamespace(points=[point])
        dense = SimpleNamespace(aembed_query=AsyncMock(return_value=[0.1]))
        sparse = qdrant.models.SparseVector(indices=[1], values=[1.0])

        with (
            patch.object(qdrant, "_get_client", return_value=client),
            patch.object(qdrant, "_get_dense", return_value=dense),
            patch.object(qdrant, "_try_sparse_vector", new=AsyncMock(return_value=sparse)),
        ):
            hits = await qdrant.search_contact_memory_primary(
                "user-1",
                "谁最近晋升",
                contact_id="contact-1",
            )

        kwargs = client.query_points.await_args.kwargs
        for prefetch in kwargs["prefetch"]:
            conditions = prefetch.filter.must
            self.assertTrue(any(c.key == "user_id" and c.match.value == "user-1" for c in conditions))
            self.assertTrue(
                any(c.key == "contact_id" and c.match.value == "contact-1" for c in conditions)
            )
        self.assertEqual(hits[0]["memory_id"], point.payload["memory_id"])

    async def test_defensive_check_drops_cross_tenant_point(self):
        point = SimpleNamespace(
            id="29bb11d7-bb15-4281-a8f2-e9d45fd7ece0",
            score=0.9,
            payload={"user_id": "user-2", "contact_id": "contact-1"},
        )
        client = create_autospec(AsyncQdrantClient, instance=True)
        client.query_points.return_value = SimpleNamespace(points=[point])
        dense = SimpleNamespace(aembed_query=AsyncMock(return_value=[0.1]))

        with (
            patch.object(qdrant, "_get_client", return_value=client),
            patch.object(qdrant, "_get_dense", return_value=dense),
            patch.object(qdrant, "_try_sparse_vector", new=AsyncMock(return_value=None)),
        ):
            hits = await qdrant.search_contact_memory_primary("user-1", "query")

        self.assertEqual(hits, [])

    async def test_fact_deletion_removes_v1_and_v2_points(self):
        client = create_autospec(AsyncQdrantClient, instance=True)
        with patch.object(qdrant, "_get_client", return_value=client):
            await qdrant.delete_contact_docs(["memory-1"])

        collections = [call.kwargs["collection_name"] for call in client.delete.await_args_list]
        self.assertEqual(collections, [qdrant.CONTACTS_COLLECTION, qdrant.CONTACT_MEMORY_COLLECTION])

    async def test_strict_shadow_search_reports_outage_instead_of_false_miss(self):
        with patch.object(qdrant, "_get_client", return_value=None):
            with self.assertRaisesRegex(RuntimeError, "Qdrant not configured"):
                await qdrant.search_contact_memory_primary(
                    "user-1",
                    "query",
                    raise_on_error=True,
                )

    async def test_cue_upsert_embeds_cue_without_memory_value_or_link_payload(self):
        client = create_autospec(AsyncQdrantClient, instance=True)
        dense = SimpleNamespace(aembed_documents=AsyncMock(return_value=[[0.1, 0.2]]))
        cues = [
            {
                "cue_id": "29bb11d7-bb15-4281-a8f2-e9d45fd7ece0",
                "user_id": "user-1",
                "cue_text": "张三 技术管理",
                "cue_type": "semantic",
            }
        ]
        with (
            patch.object(qdrant, "_get_client", return_value=client),
            patch.object(qdrant, "_get_dense", return_value=dense),
            patch.object(qdrant, "_try_sparse_vector", new=AsyncMock(return_value=None)),
        ):
            await qdrant.upsert_contact_memory_cues(cues)

        point = client.upsert.await_args.kwargs["points"][0]
        self.assertEqual(point.payload["index_kind"], "cue")
        self.assertEqual(point.payload["cue_text"], "张三 技术管理")
        self.assertNotIn("memory_id", point.payload)
        self.assertNotIn("fact_value", point.payload)

    async def test_cue_upsert_respects_qwen_twenty_item_embedding_limit(self):
        client = create_autospec(AsyncQdrantClient, instance=True)
        dense = SimpleNamespace(
            aembed_documents=AsyncMock(
                side_effect=[[[0.1]] * 20, [[0.1]]]
            )
        )
        cues = [
            {
                "cue_id": f"00000000-0000-0000-0000-{index:012d}",
                "user_id": "user-1",
                "cue_text": f"cue {index}",
                "cue_type": "semantic",
            }
            for index in range(21)
        ]
        with (
            patch.object(qdrant, "_get_client", return_value=client),
            patch.object(qdrant, "_get_dense", return_value=dense),
            patch.object(qdrant, "_try_sparse_vector", new=AsyncMock(return_value=None)),
        ):
            await qdrant.upsert_contact_memory_cues(cues)

        self.assertEqual(dense.aembed_documents.await_count, 2)
        self.assertEqual(len(dense.aembed_documents.await_args_list[0].args[0]), 20)
        self.assertEqual(len(dense.aembed_documents.await_args_list[1].args[0]), 1)
        self.assertEqual(client.upsert.await_count, 2)

    async def test_cue_search_has_hard_user_filter_and_defensive_check(self):
        leaked = SimpleNamespace(
            id="cue-1",
            score=0.9,
            payload={"user_id": "user-2", "cue_id": "cue-1", "cue_text": "leak"},
        )
        client = create_autospec(AsyncQdrantClient, instance=True)
        client.query_points.return_value = SimpleNamespace(points=[leaked])
        dense = SimpleNamespace(aembed_query=AsyncMock(return_value=[0.1]))
        with (
            patch.object(qdrant, "_get_client", return_value=client),
            patch.object(qdrant, "_get_dense", return_value=dense),
            patch.object(qdrant, "_try_sparse_vector", new=AsyncMock(return_value=None)),
        ):
            hits = await qdrant.search_contact_memory_cues("user-1", "技术管理")

        conditions = client.query_points.await_args.kwargs["query_filter"].must
        self.assertTrue(any(c.key == "user_id" and c.match.value == "user-1" for c in conditions))
        self.assertEqual(hits, [])


if __name__ == "__main__":
    unittest.main()
