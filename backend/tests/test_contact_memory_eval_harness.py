import json
import os
import unittest

os.environ.setdefault("SUPABASE_URL", "https://example.supabase.co")
os.environ.setdefault("SUPABASE_ANON_KEY", "test-key")
os.environ.setdefault("SUPABASE_SERVICE_ROLE_KEY", "test-service-key")

from tests.eval_contact_memory_judge import EVAL_SET, by_kind, compute_metrics  # noqa: E402

REQUIRED_KINDS = {
    "duplicate",
    "temporal_update",
    "conflict",
    "distinct_event",
    "numeric_scope",
    "distinct_topic",
}


def _outcome(expected: str, predicted: str, *, target: str = "", predicted_target: str = ""):
    return {
        "kind": "test",
        "expected_action": expected,
        "expected_target": target,
        "predicted_action": predicted,
        "predicted_target": predicted_target,
    }


class TestContactMemoryJudgeMetrics(unittest.TestCase):
    def test_perfect_predictions(self):
        metrics = compute_metrics(
            [
                _outcome("create", "create"),
                _outcome("merge", "merge", target="m1", predicted_target="m1"),
            ]
        )
        self.assertEqual(metrics["action_accuracy"], 1.0)
        self.assertEqual(metrics["target_accuracy"], 1.0)
        self.assertEqual(metrics["unsafe_merge_rate"], 0.0)

    def test_unsafe_merge_is_separate_from_conservative_false_create(self):
        metrics = compute_metrics(
            [
                _outcome("create", "merge"),
                _outcome("conflict", "noop", target="m1", predicted_target="m1"),
                _outcome("merge", "create", target="m2"),
            ]
        )
        self.assertAlmostEqual(metrics["unsafe_merge_rate"], 2 / 3)
        self.assertEqual(metrics["false_create_rate"], 1.0)
        self.assertEqual(metrics["action_accuracy"], 0.0)

    def test_empty_input_is_defined(self):
        self.assertEqual(compute_metrics([])["n"], 0)

    def test_by_kind_partitions_cases(self):
        outcomes = [
            {**_outcome("create", "create"), "kind": "distinct"},
            {**_outcome("merge", "create"), "kind": "update"},
        ]
        grouped = by_kind(outcomes)
        self.assertEqual(grouped["distinct"]["action_accuracy"], 1.0)
        self.assertEqual(grouped["update"]["action_accuracy"], 0.0)


class TestContactMemoryJudgeGoldset(unittest.TestCase):
    def setUp(self):
        self.data = json.loads(EVAL_SET.read_text())

    def test_covers_high_risk_merge_categories(self):
        self.assertEqual(REQUIRED_KINDS, {case["kind"] for case in self.data["cases"]})

    def test_case_ids_are_unique(self):
        ids = [case["id"] for case in self.data["cases"]]
        self.assertEqual(len(ids), len(set(ids)))

    def test_every_non_create_target_is_in_candidate_set(self):
        for case in self.data["cases"]:
            expected = case["expected"]
            candidate_ids = {item["memory_id"] for item in case["candidates"]}
            if expected["action"] == "create":
                self.assertEqual(expected["target_memory_id"], "")
            else:
                self.assertIn(expected["target_memory_id"], candidate_ids)


if __name__ == "__main__":
    unittest.main()
