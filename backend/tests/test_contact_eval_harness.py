#!/usr/bin/env python3
"""CI-side checks for the retrieval eval harness (issue #13, acceptance #7).

The eval itself needs a live Qdrant, so CI verifies the scoring maths and the
goldset's coverage instead — a harness that miscounts would hide regressions.
"""

import json
import os
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
for _var, _stub in (
    ("SUPABASE_URL", "https://test.supabase.co"),
    ("SUPABASE_ANON_KEY", "test-anon-key"),
    ("SUPABASE_SERVICE_ROLE_KEY", "test-service-key"),
):
    # set, not setdefault: CI leaves these unset, .env may leave them empty
    os.environ[_var] = os.environ.get(_var) or _stub

from tests.eval_contacts_retrieval import EVAL_SET, by_kind, compute_metrics  # noqa: E402

REQUIRED_KINDS = {"zh_name", "en_name", "company", "vague"}


def _outcome(kind, ranked, expected="A"):
    return {"kind": kind, "ranked_ids": ranked, "expected": expected}


class TestMetrics(unittest.TestCase):
    def test_perfect_retrieval(self):
        m = compute_metrics([_outcome("zh_name", ["A", "B"]), _outcome("vague", ["A"])], k=5)
        self.assertEqual(m["recall_at_k"], 1.0)
        self.assertEqual(m["mrr"], 1.0)
        self.assertEqual(m["wrong_top1_rate"], 0.0)
        self.assertEqual(m["no_result_rate"], 0.0)

    def test_mrr_discounts_by_rank(self):
        m = compute_metrics([_outcome("vague", ["X", "A"])], k=5)
        self.assertAlmostEqual(m["mrr"], 0.5)
        self.assertEqual(m["recall_at_k"], 1.0)
        self.assertEqual(m["wrong_top1_rate"], 1.0, "right person at rank 2 still means a wrong top-1")

    def test_hit_outside_k_is_not_recall(self):
        m = compute_metrics([_outcome("vague", ["X", "Y", "Z", "A"])], k=3)
        self.assertEqual(m["recall_at_k"], 0.0)
        self.assertEqual(m["mrr"], 0.0)

    def test_no_result_is_tracked_apart_from_a_wrong_hit(self):
        m = compute_metrics([_outcome("vague", []), _outcome("vague", ["X"])], k=5)
        self.assertEqual(m["no_result_rate"], 0.5)
        self.assertEqual(m["wrong_top1_rate"], 0.5, "an empty result must not also count as a wrong hit")
        self.assertEqual(m["recall_at_k"], 0.0)

    def test_empty_input_does_not_divide_by_zero(self):
        self.assertEqual(compute_metrics([], k=5)["n"], 0)

    def test_by_kind_partitions_the_outcomes(self):
        grouped = by_kind([_outcome("zh_name", ["A"]), _outcome("vague", ["X"]), _outcome("vague", ["A"])], k=5)
        self.assertEqual(grouped["zh_name"]["n"], 1)
        self.assertEqual(grouped["vague"]["n"], 2)
        self.assertEqual(grouped["vague"]["recall_at_k"], 0.5)


class TestGoldset(unittest.TestCase):
    def setUp(self):
        self.data = json.loads(EVAL_SET.read_text())

    def test_covers_every_query_kind_the_issue_calls_for(self):
        self.assertEqual(REQUIRED_KINDS, {q["kind"] for q in self.data["queries"]})

    def test_every_query_points_at_a_seeded_contact(self):
        ids = {c["id"] for c in self.data["contacts"]}
        for q in self.data["queries"]:
            self.assertIn(q["expect"], ids, q["query"])

    def test_vague_queries_never_contain_the_contact_name(self):
        """Otherwise they measure keyword matching, not semantic recall."""
        names = {c["id"]: c["name"] for c in self.data["contacts"]}
        for q in (q for q in self.data["queries"] if q["kind"] == "vague"):
            self.assertNotIn(names[q["expect"]], q["query"])

    def test_ids_are_unique_across_contacts_and_facts(self):
        ids = [c["id"] for c in self.data["contacts"]]
        ids += [f["id"] for c in self.data["contacts"] for f in c.get("facts", [])]
        self.assertEqual(len(ids), len(set(ids)))


if __name__ == "__main__":
    unittest.main()
