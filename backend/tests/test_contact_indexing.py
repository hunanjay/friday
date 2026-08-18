#!/usr/bin/env python3
"""Incremental contact indexing into Qdrant (issue #13, acceptance #1)."""

import os
import sys
import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock, create_autospec, patch

backend_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
sys.path.insert(0, backend_dir)

# Keep the suite hermetic: importing app.agents.tools builds a Supabase client.
for _var, _stub in (
    ("SUPABASE_URL", "https://test.supabase.co"),
    ("SUPABASE_ANON_KEY", "test-anon-key"),
    ("SUPABASE_SERVICE_ROLE_KEY", "test-service-key"),
):
    # set, not setdefault: CI leaves these unset, .env may leave them empty
    os.environ[_var] = os.environ.get(_var) or _stub

from qdrant_client import AsyncQdrantClient

from app.infrastructure.db.repositories import contacts as contacts_repo
from app.infrastructure.vector import qdrant

CONTACT = {
    "id": "1f0f2f6e-0000-4000-8000-000000000001",
    "user_id": "user-1",
    "name": "张明",
    "company": "北极光创投",
    "jobTitle": "合伙人",
    "location": "北京",
    "ai_summary": "消费领域投资人",
}


class TestContactDocs(unittest.TestCase):
    def test_identity_doc_embeds_values_and_filters_on_payload(self):
        doc = qdrant.contact_identity_doc(CONTACT, ["投资人", "消费"])

        self.assertEqual(doc["id"], CONTACT["id"])
        # point id == row id is what makes update/delete idempotent
        self.assertEqual(doc["payload"]["source_id"], CONTACT["id"])
        self.assertEqual(doc["payload"]["doc_type"], "identity")
        self.assertEqual(doc["payload"]["user_id"], "user-1")
        for value in ("张明", "北极光创投", "合伙人", "消费领域投资人", "投资人"):
            self.assertIn(value, doc["text"])

    def test_phone_and_email_never_reach_the_embedded_text(self):
        doc = qdrant.contact_identity_doc({**CONTACT, "email": "z@a.com", "phone": "13800000000"})
        self.assertNotIn("13800000000", doc["text"])
        self.assertNotIn("z@a.com", doc["text"])

    def test_fact_doc_carries_contact_name_for_keyword_recall(self):
        doc = qdrant.contact_fact_doc(
            "user-1",
            CONTACT["id"],
            "张明",
            {"id": "fact-1", "fact_key": "tea_preference", "fact_value": "喜欢普洱茶", "dimension": "private", "category": "preference"},
        )
        self.assertEqual(doc["id"], "fact-1")
        self.assertEqual(doc["payload"]["contact_id"], CONTACT["id"])
        self.assertEqual(doc["payload"]["doc_type"], "profile")
        self.assertIn("张明", doc["text"])
        self.assertIn("喜欢普洱茶", doc["text"])


class TestUpsertContactDocs(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.original_sparse_unavailable = qdrant._sparse_unavailable
        qdrant._sparse_unavailable = False

    def tearDown(self):
        qdrant._sparse_unavailable = self.original_sparse_unavailable

    async def test_dense_vectors_are_embedded_in_one_batched_call(self):
        # autospec: mocking a method the real client does not have must fail loudly
        client = create_autospec(AsyncQdrantClient, instance=True)
        dense = SimpleNamespace(aembed_documents=AsyncMock(return_value=[[0.1], [0.2]]))
        docs = [
            qdrant.contact_identity_doc(CONTACT),
            qdrant.contact_fact_doc("user-1", CONTACT["id"], "张明", {"id": "fact-1", "fact_key": "k", "fact_value": "v"}),
        ]

        with (
            patch.object(qdrant, "_get_client", return_value=client),
            patch.object(qdrant, "_get_dense", return_value=dense),
            patch.object(qdrant, "_try_sparse_vector", new=AsyncMock(return_value=None)),
        ):
            await qdrant.upsert_contact_docs(docs)

        dense.aembed_documents.assert_awaited_once()
        points = client.upsert.await_args.kwargs["points"]
        self.assertEqual(client.upsert.await_args.kwargs["collection_name"], qdrant.CONTACTS_COLLECTION)
        self.assertEqual([p.id for p in points], [CONTACT["id"], "fact-1"])
        self.assertEqual(points[0].vector, {"dense": [0.1]})

    async def test_empty_text_docs_are_skipped_without_touching_qdrant(self):
        client = create_autospec(AsyncQdrantClient, instance=True)
        with patch.object(qdrant, "_get_client", return_value=client):
            await qdrant.upsert_contact_docs([{"id": "x", "text": "", "payload": {}}])
        client.upsert.assert_not_awaited()


class TestIndexFailureIsRecoverable(unittest.IsolatedAsyncioTestCase):
    async def test_indexed_at_stays_null_when_qdrant_write_fails(self):
        """DB write must survive; the row stays pickable by a compensation job."""
        pool_used = []

        with (
            patch.object(qdrant, "upsert_contact_docs", new=AsyncMock(side_effect=RuntimeError("qdrant down"))),
            patch.object(contacts_repo, "_db_pool", side_effect=lambda: pool_used.append(1)),
        ):
            await contacts_repo._index_docs([{"id": "a"}], "contacts", "a")

        self.assertEqual(pool_used, [], "must not mark indexed_at after a failed index write")

    async def test_unknown_table_is_rejected(self):
        with self.assertRaises(ValueError):
            await contacts_repo._index_docs([{"id": "a"}], "users; DROP TABLE contacts", "a")


class TestContactSearch(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.original_sparse_unavailable = qdrant._sparse_unavailable
        qdrant._sparse_unavailable = False

    def tearDown(self):
        qdrant._sparse_unavailable = self.original_sparse_unavailable

    @staticmethod
    def _point(user_id="user-1", contact_id="c-1", doc_type="profile"):
        return SimpleNamespace(
            id="p-1",
            score=0.9,
            payload={
                "user_id": user_id,
                "contact_id": contact_id,
                "contact_name": "张明",
                "doc_type": doc_type,
                "source_id": "p-1",
                "snippet": "喜欢普洱茶",
            },
        )

    async def test_hybrid_rrf_filters_both_branches_by_user_id(self):
        client = create_autospec(AsyncQdrantClient, instance=True)
        client.query_points.return_value = SimpleNamespace(points=[self._point()])
        dense = SimpleNamespace(aembed_query=AsyncMock(return_value=[0.1]))
        sparse = qdrant.models.SparseVector(indices=[1], values=[1.0])

        with (
            patch.object(qdrant, "_get_client", return_value=client),
            patch.object(qdrant, "_get_dense", return_value=dense),
            patch.object(qdrant, "_try_sparse_vector", new=AsyncMock(return_value=sparse)),
        ):
            hits = await qdrant.search_contact_docs("user-1", "喜欢喝茶的人")

        kwargs = client.query_points.await_args.kwargs
        self.assertEqual(kwargs["query"].fusion, qdrant.models.Fusion.RRF)
        self.assertEqual([pf.using for pf in kwargs["prefetch"]], ["dense", "bm25"])
        for prefetch in kwargs["prefetch"]:
            conditions = prefetch.filter.must
            self.assertTrue(
                any(c.key == "user_id" and c.match.value == "user-1" for c in conditions),
                "every prefetch branch must be scoped to the caller",
            )
        self.assertEqual(hits[0]["snippet"], "喜欢普洱茶")

    async def test_dense_only_fallback_keeps_the_user_filter(self):
        client = create_autospec(AsyncQdrantClient, instance=True)
        client.query_points.return_value = SimpleNamespace(points=[self._point()])
        dense = SimpleNamespace(aembed_query=AsyncMock(return_value=[0.1]))

        with (
            patch.object(qdrant, "_get_client", return_value=client),
            patch.object(qdrant, "_get_dense", return_value=dense),
            patch.object(qdrant, "_try_sparse_vector", new=AsyncMock(return_value=None)),
        ):
            hits = await qdrant.search_contact_docs("user-1", "q")

        # dense-only is query_points without prefetch/fusion, not the removed client.search
        kwargs = client.query_points.await_args.kwargs
        self.assertEqual(kwargs["using"], "dense")
        self.assertNotIn("prefetch", kwargs)
        conditions = kwargs["query_filter"].must
        self.assertTrue(any(c.key == "user_id" and c.match.value == "user-1" for c in conditions))
        self.assertEqual(len(hits), 1)

    async def test_points_leaking_another_tenant_are_dropped(self):
        client = create_autospec(AsyncQdrantClient, instance=True)
        client.query_points.return_value = SimpleNamespace(points=[self._point(user_id="user-2")])
        dense = SimpleNamespace(aembed_query=AsyncMock(return_value=[0.1]))

        with (
            patch.object(qdrant, "_get_client", return_value=client),
            patch.object(qdrant, "_get_dense", return_value=dense),
            patch.object(qdrant, "_try_sparse_vector", new=AsyncMock(return_value=None)),
        ):
            self.assertEqual(await qdrant.search_contact_docs("user-1", "q"), [])

    async def test_search_returns_empty_when_qdrant_is_unreachable(self):
        with patch.object(qdrant, "_get_client", return_value=None):
            self.assertEqual(await qdrant.search_contact_docs("user-1", "q"), [])


class TestSearchContactsTool(unittest.IsolatedAsyncioTestCase):
    def _tool(self):
        from app.agents import tools

        return tools, tools._make_search_contacts_tool("user-1")

    async def test_sql_hit_skips_the_embedding_call(self):
        tools, search = self._tool()
        contact = {**CONTACT, "profiles": [], "tags": [], "timeline": []}

        with (
            patch("app.services.contact_service.ContactService.get_contacts", new=AsyncMock(return_value=[contact])),
            patch.object(qdrant, "search_contact_docs", new=AsyncMock()) as vec,
        ):
            out = await search.ainvoke({"query": "张明"})

        vec.assert_not_awaited()
        self.assertIn("张明", out)

    async def test_vague_query_falls_back_to_vector_and_reports_the_match(self):
        tools, search = self._tool()
        contact = {**CONTACT, "profiles": [], "tags": [], "timeline": []}
        hit = {"contact_id": CONTACT["id"], "doc_type": "profile", "snippet": "喜欢普洱茶", "score": 0.9}

        with (
            patch("app.services.contact_service.ContactService.get_contacts", new=AsyncMock(return_value=[])),
            patch("app.services.contact_service.ContactService.get_contact_by_id", new=AsyncMock(return_value=contact)),
            patch.object(qdrant, "search_contact_docs", new=AsyncMock(return_value=[hit])) as vec,
        ):
            out = await search.ainvoke({"query": "喜欢喝茶的那个投资人"})

        vec.assert_awaited_once()
        self.assertIn("张明", out)
        self.assertIn("Semantically matched on:", out)
        self.assertIn("喜欢普洱茶", out)

    async def test_no_sql_and_no_vector_hit_returns_the_miss_message(self):
        tools, search = self._tool()
        with (
            patch("app.services.contact_service.ContactService.get_contacts", new=AsyncMock(return_value=[])),
            patch.object(qdrant, "search_contact_docs", new=AsyncMock(return_value=[])),
        ):
            out = await search.ainvoke({"query": "nobody"})
        self.assertIn("No contacts matched", out)


class TestProvenance(unittest.TestCase):
    def test_fact_doc_payload_carries_upstream_source(self):
        doc = qdrant.contact_fact_doc(
            "user-1", CONTACT["id"], "张明",
            {"id": "fact-1", "fact_key": "tea", "fact_value": "普洱茶",
             "source_type": "chat_paste", "source_id": "interaction-9"},
        )
        # point id identifies the row; source_* identifies where the fact was learned
        self.assertEqual(doc["id"], "fact-1")
        self.assertEqual(doc["payload"]["source_type"], "chat_paste")
        self.assertEqual(doc["payload"]["source_id"], "interaction-9")

    def test_fact_without_provenance_is_marked_unknown_not_manual(self):
        """Pre-migration rows have no recorded source; claiming 'manual' would invent one."""
        doc = qdrant.contact_fact_doc("user-1", CONTACT["id"], "张明", {"id": "f", "fact_key": "k", "fact_value": "v"})
        self.assertEqual(doc["payload"]["source_type"], "unknown")

    def test_rendered_fact_cites_the_interaction_it_came_from(self):
        from app.agents import tools

        out = tools._format_contact({
            **CONTACT,
            "tags": [],
            "profiles": [{"dimension": "private", "category": "preference", "fact_key": "tea",
                          "fact_value": "普洱茶", "source_type": "chat_paste", "source_id": "i-1"}],
            "timeline": [{"id": "i-1", "source_type": "chat_paste", "summary": "微信聊天记录",
                          "event_date": "2026-08-01T10:00:00"}],
        })
        self.assertIn("source: chat_paste on 2026-08-01", out)
        self.assertIn("微信聊天记录", out)

    def test_rendered_fact_without_a_known_origin_says_so(self):
        from app.agents import tools

        out = tools._format_contact({
            **CONTACT, "tags": [], "timeline": [],
            "profiles": [{"dimension": "basic", "category": "other", "fact_key": "k",
                          "fact_value": "v", "source_type": "manual", "source_id": ""}],
        })
        self.assertIn("(source: manual)", out)


class TestReindexScoping(unittest.IsolatedAsyncioTestCase):
    async def test_full_rebuild_resets_only_the_callers_rows(self):
        executed = []

        class Conn:
            async def execute(self, sql, args=()):
                executed.append((" ".join(sql.split()), args))

            async def __aenter__(self):
                return self

            async def __aexit__(self, *a):
                return False

        with patch.object(contacts_repo, "_db_pool", return_value=SimpleNamespace(connection=lambda: Conn())):
            await contacts_repo.reset_index_state("user-1")

        self.assertEqual(len(executed), 3)
        for sql, args in executed:
            self.assertIn("SET indexed_at = NULL WHERE user_id = %s", sql)
            self.assertEqual(args, ("user-1",))


if __name__ == "__main__":
    unittest.main()
