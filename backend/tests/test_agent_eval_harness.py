#!/usr/bin/env python3
"""CI-side checks for the agent behaviour eval.

The eval itself needs an LLM, so CI verifies the scoring maths and the goldset
instead - a goldset naming a tool that no longer exists, or scoring that counts
a forbidden call as a pass, would hide exactly the regressions it is meant to
catch.
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

from app.agents.routing import AGENT_NAMES  # noqa: E402
from app.agents.supervisor import describe_team  # noqa: E402
from tests.eval_agent_behavior import (  # noqa: E402
    CANNED,
    EVAL_SET,
    by_kind,
    compute_metrics,
    render_html,
    score_case,
)

CASE = {"id": "c", "kind": "mail", "turns": ["x"], "expect_agents": ["mail_agent"],
        "expect_tools": ["list_inbox"], "forbid_tools": ["send_email"]}


def trace(agents=("mail_agent",), tools=("list_inbox",), judge=None):
    t = {"agents": list(agents), "reply": "ok",
         "tool_calls": [{"agent": "mail_agent", "tool": name, "args": {}} for name in tools]}
    if judge is not None:
        t["judge"] = judge
    return t


class TestScoring(unittest.TestCase):
    def test_clean_run_passes(self):
        self.assertTrue(score_case(CASE, trace())["ok"])

    def test_wrong_agent_fails(self):
        s = score_case(CASE, trace(agents=("memos_agent",)))
        self.assertFalse(s["routing_ok"])
        self.assertFalse(s["ok"])

    def test_no_delegation_when_one_was_expected_fails(self):
        self.assertFalse(score_case(CASE, trace(agents=()))["ok"])

    def test_forbidden_write_fails_even_with_everything_else_right(self):
        s = score_case(CASE, trace(tools=("list_inbox", "send_email")))
        self.assertEqual(s["forbidden_called"], ["send_email"])
        self.assertFalse(s["ok"])

    def test_missing_required_tool_fails(self):
        s = score_case(CASE, trace(tools=()))
        self.assertEqual(s["missing_tools"], ["list_inbox"])
        self.assertFalse(s["ok"])

    def test_judge_verdict_gates_the_case(self):
        self.assertFalse(score_case(CASE, trace(judge={"pass": False, "reason": "r"}))["ok"])
        self.assertTrue(score_case(CASE, trace(judge={"pass": True}))["ok"])

    def test_unjudged_case_is_not_counted_as_a_judge_pass(self):
        m = compute_metrics([score_case(CASE, trace())])
        self.assertEqual(m["judge_pass_rate"], 0.0, "no judged cases must not read as 100%")
        self.assertEqual(m["pass_rate"], 1.0)

    def test_metrics_are_independent_of_each_other(self):
        m = compute_metrics([
            score_case(CASE, trace()),
            score_case(CASE, trace(tools=("list_inbox", "send_email"))),
        ])
        self.assertEqual(m["routing_accuracy"], 1.0)
        self.assertEqual(m["required_tool_recall"], 1.0)
        self.assertEqual(m["unwanted_write_rate"], 0.5)
        self.assertEqual(m["pass_rate"], 0.5)

    def test_empty_input_does_not_divide_by_zero(self):
        self.assertEqual(compute_metrics([])["n"], 0)

    def test_by_kind_partitions_the_cases(self):
        scored = [score_case(CASE, trace()), score_case({**CASE, "kind": "smalltalk"}, trace(agents=()))]
        grouped = by_kind(scored)
        self.assertEqual(grouped["mail"]["pass_rate"], 1.0)
        self.assertEqual(grouped["smalltalk"]["pass_rate"], 0.0)


class TestGoldset(unittest.TestCase):
    def setUp(self):
        self.cases = json.loads(EVAL_SET.read_text())["cases"]
        team = describe_team("harness-user")
        self.real_tools = {t["name"] for a in team["agents"] for t in a["tools"]}

    def test_ids_are_unique(self):
        ids = [c["id"] for c in self.cases]
        self.assertEqual(len(ids), len(set(ids)))

    def test_every_referenced_tool_still_exists_in_production(self):
        for case in self.cases:
            for name in case.get("expect_tools", []) + case.get("forbid_tools", []) + list(case.get("tool_results", {})):
                self.assertIn(name, self.real_tools, f"{case['id']} references a tool that no longer exists")

    def test_every_canned_response_maps_to_a_real_tool(self):
        self.assertEqual(set(CANNED) - self.real_tools, set())

    def test_every_expected_agent_is_registered(self):
        for case in self.cases:
            for agent in case.get("expect_agents", []):
                self.assertIn(agent, AGENT_NAMES, case["id"])

    def test_expected_and_forbidden_tools_never_overlap(self):
        for case in self.cases:
            overlap = set(case.get("expect_tools", [])) & set(case.get("forbid_tools", []))
            self.assertEqual(overlap, set(), case["id"])

    def test_small_talk_cases_forbid_every_write(self):
        """The regression this suite was built for: a memo saved during chitchat."""
        writes = {"create_memo", "create_contact", "record_contact_fact", "send_email", "create_event"}
        smalltalk = [c for c in self.cases if c["kind"] == "smalltalk"]
        self.assertTrue(smalltalk)
        for case in smalltalk:
            self.assertEqual(case.get("expect_agents"), [], case["id"])
            self.assertTrue(set(case.get("forbid_tools", [])) & writes, case["id"])

    def test_every_case_has_turns_and_a_rubric(self):
        for case in self.cases:
            self.assertTrue(case.get("turns"), case["id"])
            self.assertTrue(case.get("rubric"), case["id"])


class TestReport(unittest.TestCase):
    def test_report_escapes_case_content_and_marks_failures(self):
        cases = [{**CASE, "rubric": "r", "turns": ["<script>alert(1)</script>"]}]
        traces = [trace(tools=("list_inbox", "send_email"))]
        out = render_html(cases, traces, [score_case(cases[0], traces[0])],
                          {"model": "m", "elapsed": 1.0, "when": "now"})
        self.assertNotIn("<script>alert", out)
        self.assertIn("unwanted write: send_email", out)
        self.assertIn('class="case fail"', out)


if __name__ == "__main__":
    unittest.main()
