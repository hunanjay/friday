"""Budgeted policy-guided retrieval over Primary Abstractions and Cue Anchors."""

import json
import logging
import re
from typing import Literal

from langchain_core.messages import HumanMessage, SystemMessage
from pydantic import BaseModel, Field

from app.core.config import settings
from app.core.llm import make_chat_model
from app.infrastructure.db.repositories import contact_memory as memory_repo
from app.services.contact_memory_retrieval_service import ContactMemoryRetrievalService

logger = logging.getLogger(__name__)

POLICY_PROMPT_VERSION = "contact-memory-retrieval-policy-v1"
POLICY_MAX_STEPS = 2
POLICY_WORKING_SET_LIMIT = 20

_COMPLEX_MARKERS = (
    "为什么",
    "怎么变化",
    "后来",
    "之前",
    "过去",
    "现在",
    "历史",
    "关系",
    "关联",
    "对比",
    "compare",
    "why",
    "history",
    "changed",
    "before",
    "after",
)

_SYSTEM_PROMPT = """You control a bounded contact-memory retriever.
Use STOP when the working set already covers the question.
Use EXPAND to follow one or more supplied cue IDs when another linked memory is
needed. Use RE_QUERY only when a clearer semantic query is likely to retrieve a
missing memory. Never invent cue IDs. Prefer STOP over speculative expansion.
"""


class RetrievalPolicyDecision(BaseModel):
    action: Literal["EXPAND", "RE_QUERY", "STOP"]
    query: str = ""
    cue_ids: list[str] = Field(default_factory=list, max_length=5)
    reason: str = ""


class ContactMemoryPolicyRetriever:
    """Run semantic retrieval, then a small autonomous expansion loop."""

    @staticmethod
    def _needs_policy(query: str) -> bool:
        folded = query.strip().lower()
        if any(marker in folded for marker in _COMPLEX_MARKERS):
            return True
        terms = [term for term in re.split(r"[\s,，。？?、;；]+", folded) if term]
        return len(folded) >= 24 or len(terms) >= 7

    @staticmethod
    def _absorb(working: dict[str, dict], memories: list[dict], *, bonus: float) -> int:
        added = 0
        for memory in memories:
            memory_id = memory.get("memory_id")
            if not memory_id:
                continue
            scored = {**memory, "score": float(memory.get("score", 0.0)) + bonus}
            current = working.get(memory_id)
            if current is None:
                working[memory_id] = scored
                added += 1
            elif scored["score"] > float(current.get("score", 0.0)):
                working[memory_id] = scored
            if len(working) >= POLICY_WORKING_SET_LIMIT:
                break
        return added

    @classmethod
    async def _decide(
        cls,
        *,
        query: str,
        working: list[dict],
        cues: list[dict],
        consumed_cue_ids: set[str],
    ) -> RetrievalPolicyDecision:
        model = make_chat_model(model=settings.DRAFT_MODEL, temperature=0.0)
        structured = model.with_structured_output(
            RetrievalPolicyDecision,
            method="function_calling",
        )
        decision = await structured.ainvoke(
            [
                SystemMessage(content=_SYSTEM_PROMPT),
                HumanMessage(
                    content=json.dumps(
                        {
                            "prompt_version": POLICY_PROMPT_VERSION,
                            "question": query,
                            "working_set": [
                                {
                                    "memory_id": item.get("memory_id"),
                                    "primary_abstraction": item.get("primary_abstraction"),
                                    "memory_value": item.get("memory_value"),
                                }
                                for item in working[:POLICY_WORKING_SET_LIMIT]
                            ],
                            "available_cues": [
                                {
                                    "cue_id": cue["cue_id"],
                                    "cue_text": cue["cue_text"],
                                }
                                for cue in cues
                                if cue["cue_id"] not in consumed_cue_ids
                            ][:20],
                        },
                        ensure_ascii=False,
                    )
                ),
            ]
        )
        return decision

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
        initial = await ContactMemoryRetrievalService.search(
            user_id=user_id,
            query=query,
            limit=min(POLICY_WORKING_SET_LIMIT, max(limit * 2, limit)),
            contact_id=contact_id,
        )
        if not initial or not cls._needs_policy(query):
            return initial[:limit]

        working: dict[str, dict] = {}
        cls._absorb(working, initial, bonus=0.0)
        consumed_cue_ids: set[str] = set()
        rewritten_queries = {query.strip().lower()}

        for step in range(POLICY_MAX_STEPS):
            current = sorted(working.values(), key=lambda item: item.get("score", 0.0), reverse=True)
            try:
                cues = await memory_repo.list_memory_cues(
                    user_id=user_id,
                    memory_ids=[item["memory_id"] for item in current],
                    contact_id=contact_id,
                )
                decision = await cls._decide(
                    query=query,
                    working=current,
                    cues=cues,
                    consumed_cue_ids=consumed_cue_ids,
                )
            except Exception:
                logger.warning("Contact Memory retrieval policy failed; using current results", exc_info=True)
                break

            if decision.action == "STOP":
                break

            added = 0
            if decision.action == "EXPAND":
                allowed = {cue["cue_id"] for cue in cues} - consumed_cue_ids
                selected = [cue_id for cue_id in decision.cue_ids if cue_id in allowed]
                if not selected:
                    break
                consumed_cue_ids.update(selected)
                try:
                    expanded = await ContactMemoryRetrievalService.expand_from_memories(
                        user_id=user_id,
                        memory_ids=list(working),
                        cue_ids=selected,
                        limit=POLICY_WORKING_SET_LIMIT - len(working),
                        contact_id=contact_id,
                    )
                except Exception:
                    logger.warning("Contact Memory cue expansion failed", exc_info=True)
                    break
                added = cls._absorb(working, expanded, bonus=max(0.01, 0.05 - step * 0.01))

            elif decision.action == "RE_QUERY":
                rewritten = " ".join(decision.query.split())[:240]
                rewritten_key = rewritten.lower()
                if not rewritten or rewritten_key in rewritten_queries:
                    break
                rewritten_queries.add(rewritten_key)
                try:
                    recalled = await ContactMemoryRetrievalService.search(
                        user_id=user_id,
                        query=rewritten,
                        limit=POLICY_WORKING_SET_LIMIT,
                        contact_id=contact_id,
                    )
                except Exception:
                    logger.warning("Contact Memory policy re-query failed", exc_info=True)
                    break
                added = cls._absorb(working, recalled, bonus=max(0.01, 0.04 - step * 0.01))

            if added == 0 or len(working) >= POLICY_WORKING_SET_LIMIT:
                break

        ranked = sorted(working.values(), key=lambda item: item.get("score", 0.0), reverse=True)
        return ranked[:limit]
