"""Joint Primary Abstraction + Cue Anchor retrieval for Contact Memory v2."""

import asyncio
import logging

from app.infrastructure.db.repositories import contact_memory as memory_repo
from app.infrastructure.vector import qdrant as vector_store

logger = logging.getLogger(__name__)


class ContactMemoryRetrievalService:
    @classmethod
    async def expand_from_memories(
        cls,
        *,
        user_id: str,
        memory_ids: list[str],
        cue_ids: list[str],
        limit: int = 10,
        contact_id: str | None = None,
    ) -> list[dict]:
        """Follow selected cue anchors from a working set to linked memories."""

        if not memory_ids or not cue_ids:
            return []
        frontier = await memory_repo.list_memory_cues(
            user_id=user_id,
            memory_ids=memory_ids,
            contact_id=contact_id,
        )
        allowed_cues = {item["cue_id"] for item in frontier}
        selected = list(dict.fromkeys(cue_id for cue_id in cue_ids if cue_id in allowed_cues))
        if not selected:
            return []
        links = await memory_repo.resolve_cue_links(
            user_id=user_id,
            cue_ids=selected,
            contact_id=contact_id,
        )
        existing = set(memory_ids)
        by_contact: dict[str, list[str]] = {}
        for link in links:
            if link["memory_id"] not in existing:
                by_contact.setdefault(link["contact_id"], []).append(link["memory_id"])
        if not by_contact:
            return []
        batches = await asyncio.gather(
            *(
                memory_repo.get_memory_candidates(
                    user_id=user_id,
                    contact_id=scoped_contact_id,
                    memory_ids=list(dict.fromkeys(scoped_memory_ids)),
                )
                for scoped_contact_id, scoped_memory_ids in by_contact.items()
            )
        )
        expanded = []
        for scoped_contact_id, batch in zip(by_contact, batches, strict=True):
            for memory in batch:
                if memory.get("memory_status") != "active":
                    continue
                expanded.append(
                    {
                        **memory,
                        "contact_id": scoped_contact_id,
                        "score": 0.0,
                        "primary_score": 0.0,
                        "cue_score": 0.0,
                        "matched_cue_ids": selected,
                    }
                )
                if len(expanded) == limit:
                    return expanded
        return expanded

    @classmethod
    async def search(
        cls,
        *,
        user_id: str,
        query: str,
        limit: int = 10,
        contact_id: str | None = None,
    ) -> list[dict]:
        limit = max(1, min(limit, 50))
        primary_hits, cue_hits = await asyncio.gather(
            vector_store.search_contact_memory_primary(
                user_id,
                query,
                limit=limit * 2,
                contact_id=contact_id,
            ),
            vector_store.search_contact_memory_cues(
                user_id,
                query,
                limit=limit * 2,
            ),
        )

        cue_ids = [hit["cue_id"] for hit in cue_hits if hit.get("cue_id")]
        try:
            cue_links = await memory_repo.resolve_cue_links(
                user_id=user_id,
                cue_ids=cue_ids,
                contact_id=contact_id,
            )
        except Exception:
            logger.warning("failed to resolve Contact Memory cue links", exc_info=True)
            return []
        cue_scores = {hit["cue_id"]: hit.get("score", 0.0) for hit in cue_hits}

        scores: dict[str, dict] = {}
        for hit in primary_hits:
            memory_id = hit.get("memory_id")
            if not memory_id:
                continue
            scores[memory_id] = {
                "contact_id": hit.get("contact_id", ""),
                "primary_score": hit.get("score", 0.0),
                "cue_score": 0.0,
                "matched_cue_ids": [],
            }
        for link in cue_links:
            memory_id = link["memory_id"]
            item = scores.setdefault(
                memory_id,
                {
                    "contact_id": link["contact_id"],
                    "primary_score": 0.0,
                    "cue_score": 0.0,
                    "matched_cue_ids": [],
                },
            )
            item["cue_score"] = max(item["cue_score"], cue_scores.get(link["cue_id"], 0.0))
            item["matched_cue_ids"].append(link["cue_id"])

        if not scores:
            return []

        by_contact: dict[str, list[str]] = {}
        for memory_id, item in scores.items():
            if item["contact_id"]:
                by_contact.setdefault(item["contact_id"], []).append(memory_id)
        try:
            batches = await asyncio.gather(
                *(
                    memory_repo.get_memory_candidates(
                        user_id=user_id,
                        contact_id=scoped_contact_id,
                        memory_ids=memory_ids,
                    )
                    for scoped_contact_id, memory_ids in by_contact.items()
                )
            )
        except Exception:
            logger.warning("failed to load Contact Memory retrieval values", exc_info=True)
            return []
        memories = {memory["memory_id"]: memory for batch in batches for memory in batch}

        ranked = []
        for memory_id, item in scores.items():
            memory = memories.get(memory_id)
            if memory is None or memory.get("memory_status") != "active":
                continue
            both_bonus = 0.1 if item["primary_score"] and item["cue_score"] else 0.0
            score = max(item["primary_score"], item["cue_score"]) + both_bonus
            ranked.append(
                {
                    **memory,
                    "contact_id": item["contact_id"],
                    "score": score,
                    "primary_score": item["primary_score"],
                    "cue_score": item["cue_score"],
                    "matched_cue_ids": list(dict.fromkeys(item["matched_cue_ids"])),
                }
            )
        ranked.sort(key=lambda item: item["score"], reverse=True)
        return ranked[:limit]
