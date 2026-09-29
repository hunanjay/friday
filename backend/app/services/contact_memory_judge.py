"""Top-K Merge Judge for Memora-style Contact Memory.

This evaluator retrieves a small, scoped candidate set and emits a validated
structured decision. The write service applies accepted decisions in a
separate authoritative Postgres transaction.
"""

import json
from typing import Literal

from langchain_core.messages import HumanMessage, SystemMessage
from pydantic import BaseModel, Field

from app.core.config import settings
from app.core.llm import make_chat_model
from app.infrastructure.db.repositories import contact_memory as memory_repo
from app.infrastructure.vector import qdrant as vector_store

JUDGE_PROMPT_VERSION = "contact-memory-judge-v1"
JUDGE_TOP_K = 5
JUDGE_MIN_CONFIDENCE = 0.75

_SYSTEM_PROMPT = """You are a conservative contact-memory merge judge.
Compare one proposed memory with only the supplied candidate memories.
Return create when it describes a different topic or event.
Return noop only when it adds no information.
Return merge only when both records describe the same underlying memory and
the merged value can preserve all useful details.
Return conflict when they concern the same memory but cannot safely be
reconciled. Never select a target outside the supplied candidates.
Paraphrases and superficial words such as "currently" are noop when they do
not add a changed value, date, scope, or other durable detail.
Different geographic, organizational, currency, or measurement scopes are
separate memories even when their Primary Abstractions are similar; never
merge distinct numeric scopes into one value.
Temporal state histories such as role, employer, location, and preference
should merge when a dated observation updates or succeeds the prior state,
preserving both dates and values. Separate dynamic events such as conferences
on different dates should normally remain separate memories.
Primary Abstraction identifies the stable topic; Memory Value contains the
specific current or historical details.
"""


class JudgeDecision(BaseModel):
    action: Literal["create", "merge", "noop", "conflict"]
    target_memory_id: str = ""
    merged_abstraction: str = ""
    merged_value: str = ""
    reason: str = ""
    confidence: float = Field(ge=0.0, le=1.0)


def _create_decision(
    abstraction: str,
    value: str,
    reason: str,
    confidence: float = 1.0,
) -> JudgeDecision:
    return JudgeDecision(
        action="create",
        merged_abstraction=abstraction,
        merged_value=value,
        reason=reason,
        confidence=confidence,
    )


class ContactMemoryJudge:
    @classmethod
    async def decide_from_candidates(
        cls,
        *,
        candidate_payload: dict,
        primary_abstraction: str,
        candidates: list[dict],
    ) -> JudgeDecision:
        candidate_ids = {item["memory_id"] for item in candidates}

        if not candidates:
            return _create_decision(
                primary_abstraction,
                candidate_payload.get("fact_value", ""),
                "no scoped retrieval candidates",
            )

        model = make_chat_model(model=settings.DRAFT_MODEL, temperature=0.0)
        structured_model = model.with_structured_output(
            JudgeDecision,
            method="function_calling",
        )
        decision = await structured_model.ainvoke(
            [
                SystemMessage(content=_SYSTEM_PROMPT),
                HumanMessage(
                    content=json.dumps(
                        {
                            "prompt_version": JUDGE_PROMPT_VERSION,
                            "candidate": {
                                **candidate_payload,
                                "primary_abstraction": primary_abstraction,
                            },
                            "retrieved_candidates": candidates,
                        },
                        ensure_ascii=False,
                    )
                ),
            ]
        )
        decision.target_memory_id = decision.target_memory_id.strip()

        if decision.action == "create":
            decision.target_memory_id = ""
        else:
            if not decision.target_memory_id and len(candidate_ids) == 1:
                # With exactly one scoped candidate, the selected non-create
                # action unambiguously identifies its target. Some compatible
                # providers omit the redundant ID despite choosing the action.
                decision.target_memory_id = next(iter(candidate_ids))
            if decision.target_memory_id not in candidate_ids:
                return _create_decision(
                    primary_abstraction,
                    candidate_payload.get("fact_value", ""),
                    "Judge returned a target outside the retrieved candidate set",
                    decision.confidence,
                )
            if decision.confidence < max(
                0.0,
                min(JUDGE_MIN_CONFIDENCE, 1.0),
            ):
                return _create_decision(
                    primary_abstraction,
                    candidate_payload.get("fact_value", ""),
                    "Judge confidence below automatic-decision threshold",
                    decision.confidence,
                )

        if not decision.merged_abstraction:
            decision.merged_abstraction = primary_abstraction
        if not decision.merged_value:
            decision.merged_value = candidate_payload.get("fact_value", "")
        return decision

    @classmethod
    async def evaluate(
        cls,
        *,
        user_id: str,
        contact_id: str,
        candidate_payload: dict,
        primary_abstraction: str,
    ) -> tuple[JudgeDecision, list[str]]:
        hits = await vector_store.search_contact_memory_primary(
            user_id,
            primary_abstraction,
            limit=max(1, min(JUDGE_TOP_K, 20)),
            contact_id=contact_id,
            raise_on_error=True,
        )
        memory_ids = list(
            dict.fromkeys(hit["memory_id"] for hit in hits if hit.get("memory_id"))
        )
        candidates = await memory_repo.get_memory_candidates(
            user_id=user_id,
            contact_id=contact_id,
            memory_ids=memory_ids,
        )
        candidate_ids = {item["memory_id"] for item in candidates}
        ordered_ids = [memory_id for memory_id in memory_ids if memory_id in candidate_ids]
        decision = await cls.decide_from_candidates(
            candidate_payload=candidate_payload,
            primary_abstraction=primary_abstraction,
            candidates=candidates,
        )
        return decision, ordered_ids
