#!/usr/bin/env python3

import asyncio
import os
import sys
import unittest
from unittest.mock import AsyncMock, patch

backend_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
sys.path.insert(0, backend_dir)

from app.infrastructure.graph import client as graph_client


class _FakeResponse:
    def __init__(self, status_code: int):
        self.status_code = status_code
        self.headers: dict = {}
        self.content = b""
        self.text = ""

    def json(self):
        return {}


class _FakeHttpClient:
    """Always returns 401, simulating an expired Graph access token."""

    async def request(self, method, url, headers=None, json=None):
        return _FakeResponse(401)


class TestGraphTokenRefreshRace(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        graph_client._ms_token_cache.clear()
        graph_client._refresh_locks.clear()

    async def test_concurrent_401s_refresh_only_once(self):
        # Simulates the real trigger: WorkspaceContext fires several parallel
        # authed fetches on load, which can all hit an expired Graph token at
        # once. Azure AD rotates refresh tokens on use, so if each concurrent
        # request called refresh_ms_token independently, only the first would
        # succeed - this test guards against that regression.
        async def fake_refresh(user_id):
            await asyncio.sleep(0.05)
            graph_client.cache_ms_token(user_id, "new-token")
            return "new-token"

        refresh = AsyncMock(side_effect=fake_refresh)

        with (
            patch.object(graph_client, "_get_client", return_value=_FakeHttpClient()),
            patch.object(graph_client, "refresh_ms_token", refresh),
            patch(
                "app.infrastructure.graph.client.get_ms_token",
                return_value="initial-token",
            ),
        ):
            results = await asyncio.gather(
                graph_client._graph_request("user-1", "GET", "/me"),
                graph_client._graph_request("user-1", "GET", "/me"),
                return_exceptions=True,
            )

        self.assertEqual(refresh.await_count, 1)
        for result in results:
            self.assertIsInstance(result, Exception)


if __name__ == "__main__":
    unittest.main()
