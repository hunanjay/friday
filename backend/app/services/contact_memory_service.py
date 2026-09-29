"""Single authoritative write boundary for Contact Relationship Brain memories.

Every production entry point shares this create/update/delete/skip boundary.
The always-on Memora path applies high-confidence Judge decisions while keeping
``contact_profiles`` as the current-value projection read by the existing UI.
"""

import logging
import re
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

from app.infrastructure.db.repositories import contact_memory as memory_repo, contacts as contacts_repo
from app.infrastructure.vector import qdrant as vector_store
from app.services.contact_memory_judge import (
    JUDGE_PROMPT_VERSION,
    ContactMemoryJudge,
    JudgeDecision,
)

logger = logging.getLogger(__name__)

MemoryWriteAction = Literal["new", "update", "delete", "skip"]
MemoryWriteOutcome = Literal["created", "updated", "deleted", "skipped"]


class ContactMemoryCandidate(BaseModel):
    """One normalized fact proposal produced by a user or an extractor."""

    action: MemoryWriteAction = "new"
    existing_fact_id: str = ""
    dimension: str = "basic"
    category: str = "other"
    fact_key: str = "note"
    fact_value: str = ""
    primary_abstraction: str = ""
    cues: list[str] = Field(default_factory=list)
    occurred_at: datetime | None = None
    confidence: float = Field(default=1.0, ge=0.0, le=1.0)


class MemorySource(BaseModel):
    """Provenance attached to the resulting ``contact_profiles`` row."""

    source_type: str
    source_id: str | None = None


class MemoryWriteResult(BaseModel):
    """Stable result contract shared by API, agent, and extraction callers."""

    outcome: MemoryWriteOutcome
    fact: dict | None = None
    requested_action: MemoryWriteAction
    reason: str = ""


class ContactMemoryService:
    """Apply an authoritative memory write and maintain its retrieval indexes."""

    @staticmethod
    async def _primary_abstraction(
        *, user_id: str, contact_id: str, candidate: ContactMemoryCandidate
    ) -> str:
        explicit = candidate.primary_abstraction.strip()
        if explicit:
            return explicit
        contact_name = await memory_repo.get_contact_name(user_id, contact_id)
        return memory_repo.default_primary_abstraction(contact_name, candidate.fact_key)

    @staticmethod
    async def _index_primary(memory: dict) -> bool:
        """Best-effort v2 write; NULL indexed_at is the compensation queue."""

        try:
            await vector_store.upsert_contact_memory_primary(
                user_id=memory["user_id"],
                contact_id=memory["contact_id"],
                memory_id=memory["memory_id"],
                primary_abstraction=memory["primary_abstraction"],
                dimension=memory.get("dimension") or "basic",
                category=memory.get("category") or "other",
                memory_status=memory.get("memory_status") or "active",
            )
            await memory_repo.mark_primary_indexed(
                user_id=memory["user_id"],
                memory_id=memory["memory_id"],
            )
            return True
        except Exception:
            logger.warning(
                "failed to index Contact Memory primary abstraction %s",
                memory.get("memory_id"),
                exc_info=True,
            )
            return False

    @staticmethod
    async def _record_cues(
        *,
        user_id: str,
        contact_id: str,
        memory_id: str,
        primary_abstraction: str,
        cue_texts: list[str],
    ) -> None:
        if not cue_texts:
            return
        abstraction_key = memory_repo.normalize_cue(primary_abstraction)
        cues = []
        for value in cue_texts:
            text = " ".join(str(value).split())
            normalized = memory_repo.normalize_cue(text)
            if not normalized or normalized == abstraction_key:
                continue
            if re.search(r"\d{5,}", text) or any(
                marker in text for marker in ("身份证号", "银行卡号", "完整住址", "诊断为")
            ):
                continue
            cues.append({"cue_text": text, "cue_type": "semantic"})
            if len(cues) == 3:
                break
        if not cues:
            return

        try:
            stored = await memory_repo.upsert_memory_cues(
                user_id=user_id,
                contact_id=contact_id,
                memory_id=memory_id,
                cues=cues,
            )
        except Exception:
            logger.warning("failed to store Contact Memory cue anchors for %s", memory_id, exc_info=True)
            return

        try:
            pending = [cue for cue in stored if cue["indexed_at"] is None]
            await vector_store.upsert_contact_memory_cues(pending)
            await memory_repo.mark_cues_indexed(
                user_id=user_id,
                cue_ids=[cue["cue_id"] for cue in pending],
            )
        except Exception:
            logger.warning("failed to index Contact Memory cue anchors for %s", memory_id, exc_info=True)

    @classmethod
    async def _record_shadow_write(
        cls,
        *,
        user_id: str,
        contact_id: str,
        candidate: ContactMemoryCandidate,
        source: MemorySource,
        result: MemoryWriteResult,
        previous: dict | None = None,
    ) -> None:
        if result.fact is None:
            return
        try:
            abstraction = await cls._primary_abstraction(
                user_id=user_id,
                contact_id=contact_id,
                candidate=candidate,
            )
            shadow = await memory_repo.record_shadow_write(
                user_id=user_id,
                contact_id=contact_id,
                memory_id=result.fact["id"],
                primary_abstraction=abstraction,
                observed_value=candidate.fact_value.strip(),
                next_value=result.fact.get("fact_value") or candidate.fact_value.strip(),
                source_type=source.source_type,
                source_id=source.source_id,
                occurred_at=candidate.occurred_at,
                confidence=candidate.confidence,
                outcome=result.outcome,
                requested_action=result.requested_action,
                previous=previous,
            )
        except Exception:
            # Shadow data must never make the authoritative v1 write fail.
            logger.warning(
                "failed to record Contact Memory shadow artifacts for fact %s",
                result.fact.get("id"),
                exc_info=True,
            )
            return

        await cls._record_cues(
            user_id=user_id,
            contact_id=contact_id,
            memory_id=result.fact["id"],
            primary_abstraction=shadow["primary_abstraction"],
            cue_texts=candidate.cues,
        )
        await cls._index_primary(
            {
                "user_id": user_id,
                "contact_id": contact_id,
                "memory_id": result.fact["id"],
                "primary_abstraction": shadow["primary_abstraction"],
                "dimension": result.fact.get("dimension") or candidate.dimension,
                "category": result.fact.get("category") or candidate.category,
                "memory_status": "active",
            }
        )

    @classmethod
    async def _evaluate_shadow_decision(
        cls,
        *,
        user_id: str,
        contact_id: str,
        candidate: ContactMemoryCandidate,
    ) -> tuple[JudgeDecision, list[str]] | None:
        try:
            abstraction = await cls._primary_abstraction(
                user_id=user_id,
                contact_id=contact_id,
                candidate=candidate,
            )
            return await ContactMemoryJudge.evaluate(
                user_id=user_id,
                contact_id=contact_id,
                candidate_payload=candidate.model_dump(mode="json"),
                primary_abstraction=abstraction,
            )
        except Exception:
            logger.warning("Contact Memory shadow Judge evaluation failed", exc_info=True)
            return None

    @staticmethod
    async def _record_shadow_decision(
        *,
        user_id: str,
        contact_id: str,
        candidate: ContactMemoryCandidate,
        source: MemorySource,
        result: MemoryWriteResult,
        evaluation: tuple[JudgeDecision, list[str]] | None,
    ) -> None:
        if evaluation is None:
            return
        decision, retrieved_ids = evaluation
        try:
            await memory_repo.record_shadow_decision(
                user_id=user_id,
                contact_id=contact_id,
                source_type=source.source_type,
                source_id=source.source_id,
                candidate_payload=candidate.model_dump(mode="json"),
                retrieved_memory_ids=retrieved_ids,
                v1_requested_action=result.requested_action,
                v1_outcome=result.outcome,
                judge_action=decision.action,
                target_memory_id=decision.target_memory_id or None,
                merged_abstraction=decision.merged_abstraction,
                merged_value=decision.merged_value,
                reason=decision.reason,
                confidence=decision.confidence,
                prompt_version=JUDGE_PROMPT_VERSION,
            )
        except Exception:
            logger.warning("failed to persist Contact Memory shadow Judge decision", exc_info=True)

    @classmethod
    async def _apply_judge_decision(
        cls,
        *,
        user_id: str,
        contact_id: str,
        candidate: ContactMemoryCandidate,
        source: MemorySource,
        evaluation: tuple[JudgeDecision, list[str]],
    ) -> MemoryWriteResult | None:
        decision, _ = evaluation
        if decision.action == "create":
            return None

        try:
            applied = await memory_repo.apply_authoritative_judge_action(
                user_id=user_id,
                contact_id=contact_id,
                action=decision.action,
                target_memory_id=decision.target_memory_id,
                primary_abstraction=await cls._primary_abstraction(
                    user_id=user_id,
                    contact_id=contact_id,
                    candidate=candidate,
                ),
                merged_abstraction=decision.merged_abstraction,
                merged_value=decision.merged_value,
                dimension=candidate.dimension,
                category=candidate.category,
                fact_key=candidate.fact_key,
                observed_value=candidate.fact_value.strip(),
                source_type=source.source_type,
                source_id=source.source_id,
                occurred_at=candidate.occurred_at,
                confidence=candidate.confidence,
                reason=decision.reason,
                prompt_version=JUDGE_PROMPT_VERSION,
            )
        except ValueError:
            # A retrieved target can disappear between Judge evaluation and the
            # locked transaction. Preserve the observation by using create.
            logger.warning(
                "Contact Memory Judge target became invalid; falling back to create",
                exc_info=True,
            )
            return None

        result = MemoryWriteResult(
            outcome=applied["outcome"],
            fact=applied["fact"],
            requested_action=candidate.action,
            reason=applied.get("reason") or decision.reason,
        )

        if result.outcome in {"created", "updated"} and result.fact:
            await contacts_repo.reindex_contact_profile(user_id, contact_id, result.fact)

        for memory in applied.get("affected_memories", []):
            await cls._index_primary(memory)

        if result.fact:
            abstraction = next(
                (
                    item["primary_abstraction"]
                    for item in applied.get("affected_memories", [])
                    if item["memory_id"] == result.fact["id"]
                ),
                decision.merged_abstraction,
            )
            await cls._record_cues(
                user_id=user_id,
                contact_id=contact_id,
                memory_id=result.fact["id"],
                primary_abstraction=abstraction,
                cue_texts=candidate.cues,
            )

        await cls._record_shadow_decision(
            user_id=user_id,
            contact_id=contact_id,
            candidate=candidate,
            source=source,
            result=result,
            evaluation=evaluation,
        )
        return result

    @classmethod
    async def backfill(cls, *, user_id: str, limit: int = 500) -> dict:
        """Backfill shadow artifacts, then compensate pending v2 index writes."""

        rows = await memory_repo.backfill_missing_memories(user_id=user_id, limit=limit)
        cue_backfilled = await memory_repo.backfill_missing_cues(user_id=user_id, limit=limit)
        indexed = 0
        pending = await memory_repo.list_primary_index_pending(user_id=user_id, limit=limit)
        for memory in pending:
            if await cls._index_primary(memory):
                indexed += 1

        cue_indexed = 0
        pending_cues = await memory_repo.list_cue_index_pending(user_id=user_id, limit=limit)
        if pending_cues:
            try:
                await vector_store.upsert_contact_memory_cues(pending_cues)
                cue_indexed = await memory_repo.mark_cues_indexed(
                    user_id=user_id,
                    cue_ids=[cue["cue_id"] for cue in pending_cues],
                )
            except Exception:
                logger.warning("failed to rebuild Contact Memory cue index", exc_info=True)

        return {
            "backfilled": len(rows),
            "cue_backfilled": cue_backfilled,
            "pending": await memory_repo.count_backfill_pending(user_id),
            "indexed": indexed,
            "index_pending": await memory_repo.count_primary_index_pending(user_id),
            "cue_indexed": cue_indexed,
            "cue_index_pending": await memory_repo.count_cue_index_pending(user_id),
        }

    @classmethod
    async def restore(
        cls,
        *,
        user_id: str,
        contact_id: str,
        memory_id: str,
    ) -> dict | None:
        restored = await memory_repo.set_memory_deleted(
            user_id=user_id,
            contact_id=contact_id,
            memory_id=memory_id,
            deleted=False,
            reason="memory restored by user",
        )
        if restored is None:
            return None
        await contacts_repo.reindex_contact_profile(user_id, contact_id, restored["fact"])
        await cls._index_primary(restored["memory"])
        return restored["fact"]

    @classmethod
    async def restore_revision(
        cls,
        *,
        user_id: str,
        contact_id: str,
        memory_id: str,
        revision_version: int,
    ) -> dict | None:
        restored = await memory_repo.restore_memory_revision(
            user_id=user_id,
            contact_id=contact_id,
            memory_id=memory_id,
            revision_version=revision_version,
            reason="memory revision restored by user",
        )
        if restored is None:
            return None
        await contacts_repo.reindex_contact_profile(user_id, contact_id, restored["fact"])
        await cls._index_primary(restored["memory"])
        return restored["fact"]

    @classmethod
    async def write(
        cls,
        *,
        user_id: str,
        contact_id: str,
        candidate: ContactMemoryCandidate,
        source: MemorySource,
    ) -> MemoryWriteResult:
        if candidate.action == "skip":
            if candidate.existing_fact_id and candidate.fact_value.strip():
                try:
                    await memory_repo.record_shadow_evidence(
                        user_id=user_id,
                        contact_id=contact_id,
                        memory_id=candidate.existing_fact_id,
                        observed_value=candidate.fact_value.strip(),
                        source_type=source.source_type,
                        source_id=source.source_id,
                        occurred_at=candidate.occurred_at,
                        confidence=candidate.confidence,
                    )
                except Exception:
                    logger.warning(
                        "failed to record duplicate Contact Memory evidence for fact %s",
                        candidate.existing_fact_id,
                        exc_info=True,
                    )
            return MemoryWriteResult(
                outcome="skipped",
                requested_action=candidate.action,
                reason="candidate marked as duplicate",
            )

        if candidate.action == "delete":
            if not candidate.existing_fact_id:
                return MemoryWriteResult(
                    outcome="skipped",
                    requested_action=candidate.action,
                    reason="delete candidate has no existing_fact_id",
                )
            deleted = await memory_repo.set_memory_deleted(
                user_id=user_id,
                contact_id=contact_id,
                memory_id=candidate.existing_fact_id,
                deleted=True,
                reason="memory deleted by user",
            )
            if deleted:
                await contacts_repo.unindex_contact_profile(candidate.existing_fact_id)
                await cls._index_primary(deleted["memory"])
            return MemoryWriteResult(
                outcome="deleted" if deleted else "skipped",
                fact=None,
                requested_action=candidate.action,
                reason="" if deleted else "target fact was not found",
            )

        fact_value = candidate.fact_value.strip()
        if not fact_value:
            return MemoryWriteResult(
                outcome="skipped",
                requested_action=candidate.action,
                reason="fact_value is empty",
            )

        judge_evaluation = None
        if source.source_type != "manual_correction":
            judge_evaluation = await cls._evaluate_shadow_decision(
                user_id=user_id,
                contact_id=contact_id,
                candidate=candidate,
            )
        if judge_evaluation is not None:
            judged_result = await cls._apply_judge_decision(
                user_id=user_id,
                contact_id=contact_id,
                candidate=candidate,
                source=source,
                evaluation=judge_evaluation,
            )
            if judged_result is not None:
                return judged_result

        previous = None
        if candidate.action == "update" and candidate.existing_fact_id:
            try:
                previous = await memory_repo.get_memory_snapshot(
                    user_id,
                    contact_id,
                    candidate.existing_fact_id,
                )
            except Exception:
                logger.warning(
                    "failed to load Contact Memory shadow snapshot for fact %s",
                    candidate.existing_fact_id,
                    exc_info=True,
                )

        if candidate.action == "update" and candidate.existing_fact_id:
            updated = await contacts_repo.update_contact_profile(
                user_id=user_id,
                contact_id=contact_id,
                fact_id=candidate.existing_fact_id,
                dimension=candidate.dimension,
                category=candidate.category,
                fact_key=candidate.fact_key.strip() or "note",
                fact_value=fact_value,
                source_type=source.source_type,
                source_id=source.source_id,
            )
            if updated is not None:
                result = MemoryWriteResult(
                    outcome="updated",
                    fact=updated,
                    requested_action=candidate.action,
                )
                await cls._record_shadow_write(
                    user_id=user_id,
                    contact_id=contact_id,
                    candidate=candidate,
                    source=source,
                    result=result,
                    previous=previous,
                )
                await cls._record_shadow_decision(
                    user_id=user_id,
                    contact_id=contact_id,
                    candidate=candidate,
                    source=source,
                    result=result,
                    evaluation=judge_evaluation,
                )
                return result

        # Preserve the previous safe fallback: an absent/stale update target is
        # appended as a new fact instead of silently losing the observation.
        created = await contacts_repo.add_contact_profile(
            user_id=user_id,
            contact_id=contact_id,
            dimension=candidate.dimension,
            category=candidate.category,
            fact_key=candidate.fact_key.strip() or "note",
            fact_value=fact_value,
            source_type=source.source_type,
            source_id=source.source_id,
        )
        result = MemoryWriteResult(
            outcome="created",
            fact=created,
            requested_action=candidate.action,
            reason=(
                "update target was missing; created a new fact"
                if candidate.action == "update"
                else ""
            ),
        )
        await cls._record_shadow_write(
            user_id=user_id,
            contact_id=contact_id,
            candidate=candidate,
            source=source,
            result=result,
            previous=previous,
        )
        await cls._record_shadow_decision(
            user_id=user_id,
            contact_id=contact_id,
            candidate=candidate,
            source=source,
            result=result,
            evaluation=judge_evaluation,
        )
        return result
