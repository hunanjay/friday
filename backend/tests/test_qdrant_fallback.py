#!/usr/bin/env python3

import os
import sys
import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock, create_autospec, patch

backend_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
sys.path.insert(0, backend_dir)

from qdrant_client import AsyncQdrantClient

from app.infrastructure.vector import qdrant


class TestQdrantSparseFallback(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.original_sparse_unavailable = qdrant._sparse_unavailable
        qdrant._sparse_unavailable = False

    def tearDown(self):
        qdrant._sparse_unavailable = self.original_sparse_unavailable

    async def test_sparse_failure_is_cached_for_the_process(self):
        with (
            patch.object(qdrant, "_SPARSE_ENABLED", True),
            patch.object(qdrant, "_SPARSE_TIMEOUT_SECONDS", 1),
            patch.object(qdrant.asyncio, "to_thread", new_callable=AsyncMock) as to_thread,
        ):
            to_thread.side_effect = OSError("model cache missing")

            self.assertIsNone(await qdrant._try_sparse_vector("first"))
            self.assertIsNone(await qdrant._try_sparse_vector("second"))

        self.assertEqual(to_thread.await_count, 1)
        self.assertTrue(qdrant._sparse_unavailable)

    async def test_upsert_uses_dense_vector_when_sparse_is_unavailable(self):
        # autospec: mocking a method the real client does not have must fail loudly
        client = create_autospec(AsyncQdrantClient, instance=True)
        dense = SimpleNamespace(aembed_query=AsyncMock(return_value=[0.1, 0.2]))

        with (
            patch.object(qdrant, "_get_client", return_value=client),
            patch.object(qdrant, "_get_dense", return_value=dense),
            patch.object(qdrant, "_try_sparse_vector", new=AsyncMock(return_value=None)),
        ):
            await qdrant.upsert_memo("user-1", "29bb11d7-bb15-4281-a8f2-e9d45fd7ece0", "title", "body", "general")

        point = client.upsert.await_args.kwargs["points"][0]
        self.assertEqual(point.vector, {"dense": [0.1, 0.2]})

    async def test_search_skips_hybrid_query_when_sparse_is_unavailable(self):
        client = create_autospec(AsyncQdrantClient, instance=True)
        client.query_points.return_value = SimpleNamespace(points=[])
        dense = SimpleNamespace(aembed_query=AsyncMock(return_value=[0.1, 0.2]))

        with (
            patch.object(qdrant, "_get_client", return_value=client),
            patch.object(qdrant, "_get_dense", return_value=dense),
            patch.object(qdrant, "_try_sparse_vector", new=AsyncMock(return_value=None)),
        ):
            result = await qdrant.search_memos("user-1", "query")

        self.assertEqual(result, [])
        # dense-only still goes through query_points, just without prefetch/fusion
        kwargs = client.query_points.await_args.kwargs
        self.assertEqual(kwargs["using"], "dense")
        self.assertNotIn("prefetch", kwargs)


if __name__ == "__main__":
    unittest.main()
