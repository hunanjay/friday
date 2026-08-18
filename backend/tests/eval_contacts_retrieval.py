#!/usr/bin/env python3
"""Offline retrieval eval for the contacts RAG (issue #13, acceptance #7).

Seeds the goldset into Qdrant under a throwaway user_id, runs the real hybrid
search, reports recall@k / MRR / no-result rate / wrong-contact rate, then cleans
up. Needs QDRANT_URL and an embedding key; no Postgres involved.

    cd backend && .venv/bin/python tests/eval_contacts_retrieval.py [-k 5]

Scoring is a pure function so CI can verify the harness without a live stack
(see test_contact_eval_harness.py).
"""

import argparse
import asyncio
import json
import os
import sys
import uuid
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.infrastructure.vector import qdrant  # noqa: E402

EVAL_SET = Path(__file__).parent / "data" / "contacts_eval_set.json"


def compute_metrics(outcomes: list[dict], k: int) -> dict:
    """outcomes: [{kind, ranked_ids, expected}] -> retrieval metrics.

    ranked_ids is the contact_id of each hit, best first, already deduped.
    """
    total = len(outcomes)
    if not total:
        return {"n": 0, "recall_at_k": 0.0, "mrr": 0.0, "no_result_rate": 0.0, "wrong_top1_rate": 0.0}

    hits = 0
    reciprocal = 0.0
    empty = 0
    wrong_top1 = 0
    for o in outcomes:
        ranked = o["ranked_ids"][:k]
        if not o["ranked_ids"]:
            empty += 1
            continue
        if o["expected"] in ranked:
            hits += 1
            reciprocal += 1.0 / (ranked.index(o["expected"]) + 1)
        if o["ranked_ids"][0] != o["expected"]:
            wrong_top1 += 1

    return {
        "n": total,
        "recall_at_k": hits / total,
        "mrr": reciprocal / total,
        "no_result_rate": empty / total,
        # a confident hit on the wrong person is worse than no hit: track it apart
        "wrong_top1_rate": wrong_top1 / total,
    }


def by_kind(outcomes: list[dict], k: int) -> dict:
    kinds = sorted({o["kind"] for o in outcomes})
    return {kind: compute_metrics([o for o in outcomes if o["kind"] == kind], k) for kind in kinds}


def _docs_for(contact: dict, user_id: str) -> list[dict]:
    docs = [qdrant.contact_identity_doc({**contact, "user_id": user_id}, contact.get("tags"))]
    for fact in contact.get("facts", []):
        docs.append(qdrant.contact_fact_doc(user_id, contact["id"], contact["name"], fact))
    return docs


async def run(k: int) -> int:
    data = json.loads(EVAL_SET.read_text())
    user_id = f"eval-{uuid.uuid4()}"

    if qdrant._get_client() is None:
        print("QDRANT_URL is not set — cannot run the retrieval eval.")
        return 2

    docs = [d for c in data["contacts"] for d in _docs_for(c, user_id)]
    print(f"seeding {len(docs)} docs as {user_id} ...")
    await qdrant.upsert_contact_docs(docs)

    try:
        outcomes = []
        for case in data["queries"]:
            hits = await qdrant.search_contact_docs(user_id, case["query"], limit=k * 2)
            ranked, seen = [], set()
            for h in hits:
                if h["contact_id"] not in seen:
                    seen.add(h["contact_id"])
                    ranked.append(h["contact_id"])
            outcomes.append({"kind": case["kind"], "query": case["query"], "ranked_ids": ranked, "expected": case["expect"]})

        overall = compute_metrics(outcomes, k)
        print(f"\n== overall (k={k}, n={overall['n']}) ==")
        for key in ("recall_at_k", "mrr", "no_result_rate", "wrong_top1_rate"):
            print(f"  {key:<16} {overall[key]:.3f}")

        print("\n== by query kind ==")
        for kind, m in by_kind(outcomes, k).items():
            print(f"  {kind:<10} n={m['n']:<3} recall@{k}={m['recall_at_k']:.2f}  mrr={m['mrr']:.2f}  miss={m['no_result_rate']:.2f}")

        misses = [o for o in outcomes if o["expected"] not in o["ranked_ids"][:k]]
        if misses:
            print("\n== misses ==")
            for o in misses:
                print(f"  [{o['kind']}] {o['query']}")
    finally:
        client = qdrant._get_client()
        await client.delete(
            collection_name=qdrant.CONTACTS_COLLECTION,
            points_selector=qdrant.models.FilterSelector(
                filter=qdrant.models.Filter(
                    must=[qdrant.models.FieldCondition(key="user_id", match=qdrant.models.MatchValue(value=user_id))]
                )
            ),
        )
        print(f"\ncleaned up {user_id}")

    return 0


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("-k", type=int, default=int(os.environ.get("EVAL_K", "5")))
    sys.exit(asyncio.run(run(parser.parse_args().k)))
