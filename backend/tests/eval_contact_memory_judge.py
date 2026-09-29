#!/usr/bin/env python3
"""Run the structured Contact Memory Merge Judge on a hand-authored goldset.

This isolates Judge quality from retrieval quality by supplying the expected
Top-K candidates directly. It needs the configured chat model, but no Postgres
or Qdrant:

    cd backend && .venv/bin/python tests/eval_contact_memory_judge.py
"""

import asyncio
import json
import sys
from pathlib import Path

from dotenv import load_dotenv

BACKEND_DIR = Path(__file__).resolve().parent.parent
load_dotenv(BACKEND_DIR / ".env")
sys.path.insert(0, str(BACKEND_DIR))

from app.services.contact_memory_judge import ContactMemoryJudge  # noqa: E402

EVAL_SET = Path(__file__).parent / "data" / "contact_memory_judge_eval.json"


def compute_metrics(outcomes: list[dict]) -> dict:
    total = len(outcomes)
    if not total:
        return {
            "n": 0,
            "action_accuracy": 0.0,
            "target_accuracy": 0.0,
            "unsafe_merge_rate": 0.0,
            "false_create_rate": 0.0,
        }

    action_correct = sum(o["predicted_action"] == o["expected_action"] for o in outcomes)
    target_cases = [o for o in outcomes if o["expected_target"]]
    target_correct = sum(
        o["predicted_action"] == o["expected_action"]
        and o["predicted_target"] == o["expected_target"]
        for o in target_cases
    )
    unsafe = sum(
        o["expected_action"] in {"create", "conflict"}
        and o["predicted_action"] in {"merge", "noop"}
        for o in outcomes
    )
    merge_cases = [o for o in outcomes if o["expected_action"] in {"merge", "noop"}]
    false_create = sum(o["predicted_action"] == "create" for o in merge_cases)

    return {
        "n": total,
        "action_accuracy": action_correct / total,
        "target_accuracy": target_correct / len(target_cases) if target_cases else 0.0,
        "unsafe_merge_rate": unsafe / total,
        "false_create_rate": false_create / len(merge_cases) if merge_cases else 0.0,
    }


def by_kind(outcomes: list[dict]) -> dict:
    return {
        kind: compute_metrics([outcome for outcome in outcomes if outcome["kind"] == kind])
        for kind in sorted({outcome["kind"] for outcome in outcomes})
    }


async def run() -> int:
    data = json.loads(EVAL_SET.read_text())
    outcomes = []
    try:
        for case in data["cases"]:
            decision = await ContactMemoryJudge.decide_from_candidates(
                candidate_payload=case["candidate"],
                primary_abstraction=case["primary_abstraction"],
                candidates=case["candidates"],
            )
            expected = case["expected"]
            outcomes.append(
                {
                    "id": case["id"],
                    "kind": case["kind"],
                    "expected_action": expected["action"],
                    "expected_target": expected["target_memory_id"],
                    "predicted_action": decision.action,
                    "predicted_target": decision.target_memory_id,
                    "confidence": decision.confidence,
                    "reason": decision.reason,
                }
            )
    except Exception as exc:
        print(f"Judge eval could not start: {exc}")
        print("Configure the selected LLM provider credentials and run again.")
        return 2

    overall = compute_metrics(outcomes)
    print(f"== Contact Memory Judge (n={overall['n']}) ==")
    for key in ("action_accuracy", "target_accuracy", "unsafe_merge_rate", "false_create_rate"):
        print(f"  {key:<20} {overall[key]:.3f}")

    print("\n== by kind ==")
    for kind, metrics in by_kind(outcomes).items():
        print(
            f"  {kind:<16} n={metrics['n']:<2} "
            f"action={metrics['action_accuracy']:.2f} "
            f"unsafe={metrics['unsafe_merge_rate']:.2f}"
        )

    errors = [o for o in outcomes if o["predicted_action"] != o["expected_action"]]
    if errors:
        print("\n== disagreements ==")
        for outcome in errors:
            print(
                f"  {outcome['id']}: expected={outcome['expected_action']} "
                f"predicted={outcome['predicted_action']} "
                f"confidence={outcome['confidence']:.2f} — {outcome['reason']}"
            )
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(run()))
