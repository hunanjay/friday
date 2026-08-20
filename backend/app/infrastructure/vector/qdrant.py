import asyncio
import logging
import os

from fastembed import SparseTextEmbedding
from langchain_openai import OpenAIEmbeddings
from qdrant_client import AsyncQdrantClient, models

from app.core.config import settings

logger = logging.getLogger(__name__)

COLLECTION = "memos"
CONTACTS_COLLECTION = "contacts"


def _embedding_base_url() -> str | None:
    return settings.EMBEDDING_BASE_URL or None


def _embedding_model() -> str:
    return settings.EMBEDDING_MODEL


_DENSE_SIZE = settings.EMBEDDING_DIMENSIONS
_SPARSE_MODEL = os.environ.get("SPARSE_EMBEDDING_MODEL", "Qdrant/bm25")
_SPARSE_CACHE_DIR = os.environ.get("FASTEMBED_CACHE_DIR") or None
_SPARSE_TIMEOUT_SECONDS = float(os.environ.get("SPARSE_EMBEDDING_TIMEOUT_SECONDS", "5"))
_SPARSE_ENABLED = os.environ.get("ENABLE_SPARSE_EMBEDDING", "true").lower() in {"1", "true", "yes", "on"}
_SPARSE_LOCAL_FILES_ONLY = os.environ.get("FASTEMBED_LOCAL_FILES_ONLY", "false").lower() in {
    "1",
    "true",
    "yes",
    "on",
}

_client: AsyncQdrantClient | None = None
_dense_embedder: OpenAIEmbeddings | None = None
_sparse_embedder: SparseTextEmbedding | None = None
_sparse_unavailable = False


def _get_client() -> AsyncQdrantClient | None:
    global _client
    if _client is None:
        url = os.environ.get("QDRANT_URL")
        if not url:
            return None
        _client = AsyncQdrantClient(
            url=url,
            api_key=os.environ.get("QDRANT_API_KEY") or None,
            timeout=30.0,
        )
    return _client


def _get_dense() -> OpenAIEmbeddings:
    global _dense_embedder
    if _dense_embedder is None:
        if settings.LLM_PROVIDER in {"qwen", "zhipu"} and not settings.EMBEDDING_API_KEY:
            key_name = f"{settings.LLM_PROVIDER.upper()}_EMBEDDING_API_KEY"
            raise RuntimeError(
                f"{key_name} (or the provider API key) is required for dense embeddings"
            )
        _dense_embedder = OpenAIEmbeddings(
            model=_embedding_model(),
            dimensions=_DENSE_SIZE,
            base_url=_embedding_base_url(),
            api_key=settings.EMBEDDING_API_KEY,
            # OpenAI-compatible providers such as Qwen expect an array of
            # strings. LangChain otherwise tokenizes unknown model names and
            # sends arrays of token IDs, which qwen3.7-text-embedding rejects.
            check_embedding_ctx_length=False,
            request_timeout=60.0,
            max_retries=3,
        )
    return _dense_embedder


def _get_sparse() -> SparseTextEmbedding:
    global _sparse_embedder
    if _sparse_embedder is None:
        _sparse_embedder = SparseTextEmbedding(
            model_name=_SPARSE_MODEL,
            cache_dir=_SPARSE_CACHE_DIR,
            local_files_only=_SPARSE_LOCAL_FILES_ONLY,
        )
    return _sparse_embedder


def _memo_text(title: str, content: str, attachments: list | None = None) -> str:
    text_parts = [title, content]
    if attachments and isinstance(attachments, list):
        for att in attachments:
            if isinstance(att, dict):
                att_name = att.get("name") or "attachment"
                extracted = att.get("extracted_text") or ""
                if extracted:
                    text_parts.append(f"[Attachment: {att_name}]\n{extracted}")
    return "\n\n".join(part for part in text_parts if part)


def _sparse_vector(text: str) -> models.SparseVector:
    embedding = next(iter(_get_sparse().embed([text])))
    return models.SparseVector(indices=embedding.indices.tolist(), values=embedding.values.tolist())


async def _try_sparse_vector(text: str) -> models.SparseVector | None:
    """Build a sparse vector without letting model I/O block user requests.

    FastEmbed downloads a missing model during initialisation. Production images
    preload the model and run in local-only mode, but this fallback keeps memo
    writes and searches usable if the cache is ever missing or corrupt.
    """
    global _sparse_unavailable

    if not _SPARSE_ENABLED or _sparse_unavailable:
        return None

    try:
        return await asyncio.wait_for(
            asyncio.to_thread(_sparse_vector, text),
            timeout=_SPARSE_TIMEOUT_SECONDS,
        )
    except Exception:
        _sparse_unavailable = True
        logger.warning(
            "Sparse embedding unavailable; using dense-only vectors for this process",
            exc_info=True,
        )
        return None


async def _ensure_collection(client, name: str, payload_indexes: tuple[str, ...]) -> None:
    if not await client.collection_exists(name):
        await client.create_collection(
            collection_name=name,
            vectors_config={"dense": models.VectorParams(size=_DENSE_SIZE, distance=models.Distance.COSINE)},
            sparse_vectors_config={"bm25": models.SparseVectorParams()},
        )
    for field in payload_indexes:
        await client.create_payload_index(
            collection_name=name,
            field_name=field,
            field_schema=models.PayloadSchemaType.KEYWORD,
        )


async def init_collection():
    client = _get_client()
    if client is None:
        logger.warning("QDRANT_URL not set - Qdrant vector search disabled")
        return
    try:
        await _ensure_collection(client, COLLECTION, ("user_id",))
        await _ensure_collection(client, CONTACTS_COLLECTION, ("user_id", "contact_id", "doc_type"))
    except Exception:
        logger.warning("Qdrant init failed - vector search unavailable", exc_info=True)


async def upsert_memo(
    user_id: str, memo_id: str, title: str, content: str, category: str, attachments: list | None = None
) -> None:
    client = _get_client()
    if client is None:
        raise RuntimeError("Qdrant not configured (QDRANT_URL missing)")
    text = _memo_text(title, content, attachments)
    dense_vec = await _get_dense().aembed_query(text)
    vectors: dict[str, list[float] | models.SparseVector] = {"dense": dense_vec}
    sparse_vec = await _try_sparse_vector(text)
    if sparse_vec is not None:
        vectors["bm25"] = sparse_vec
    await client.upsert(
        collection_name=COLLECTION,
        points=[
            models.PointStruct(
                id=memo_id,
                vector=vectors,
                payload={
                    "user_id": user_id,
                    "title": title,
                    "content": content,
                    "category": category,
                    "has_attachments": bool(attachments),
                    "attachments": attachments or [],
                },
            )
        ],
    )


async def delete_memo(memo_id: str) -> None:
    client = _get_client()
    if client is None:
        raise RuntimeError("Qdrant not configured (QDRANT_URL missing)")
    await client.delete(collection_name=COLLECTION, points_selector=models.PointIdsList(points=[memo_id]))


async def search_memos(user_id: str, query: str, limit: int = 5) -> list[dict]:
    client = _get_client()
    if client is None:
        return []

    try:
        dense_vec = await _get_dense().aembed_query(query)
        user_filter = models.Filter(must=[models.FieldCondition(key="user_id", match=models.MatchValue(value=user_id))])

        points = None
        sparse_vec = await _try_sparse_vector(query)
        if sparse_vec is not None:
            try:
                result = await client.query_points(
                    collection_name=COLLECTION,
                    prefetch=[
                        models.Prefetch(query=dense_vec, using="dense", limit=20, filter=user_filter),
                        models.Prefetch(query=sparse_vec, using="bm25", limit=20, filter=user_filter),
                    ],
                    query=models.FusionQuery(fusion=models.Fusion.RRF),
                    limit=limit,
                )
                points = result.points
            except Exception as err:
                logger.warning("Qdrant RRF query_points failed, falling back to dense search: %s", err)

        if points is None:
            # client.search() was removed in qdrant-client 1.18; query_points without
            # prefetch/fusion is the dense-only equivalent.
            result = await client.query_points(
                collection_name=COLLECTION,
                query=dense_vec,
                using="dense",
                query_filter=user_filter,
                limit=limit,
            )
            points = result.points

        return [
            {
                "id": str(p.id),
                "title": p.payload.get("title") if hasattr(p, "payload") and p.payload else "",
                "content": p.payload.get("content") if hasattr(p, "payload") and p.payload else "",
                "category": p.payload.get("category") if hasattr(p, "payload") and p.payload else "",
                "attachments": p.payload.get("attachments") if hasattr(p, "payload") and p.payload else [],
                "score": getattr(p, "score", 0.0),
            }
            for p in points
        ]
    except Exception as exc:
        logger.warning("Qdrant search_memos failed completely: %s", exc)
        return []


# --- Contacts collection -----------------------------------------------------
#
# One point per source row, never one point per contact: the point id IS the
# Postgres row id, so incremental upsert, correction and delete are all a single
# idempotent call, and every hit carries its own provenance.
#
#   doc_type "identity"    -> contacts.id
#   doc_type "profile"     -> contact_profiles.id
#   doc_type "interaction" -> contact_interactions.id
#
# The point id identifies the row a hit came from; source_type/source_id carry the
# upstream provenance of that row (which email, memo, chat session or manual entry
# the fact was learned from), which is what an answer must be able to cite.


def _joined(*parts: str) -> str:
    return "\n".join(p.strip() for p in parts if p and p.strip())


def contact_identity_doc(contact: dict, tags: list[str] | None = None) -> dict:
    """Vector doc for who a contact is. Structured fields stay in the payload for
    filtering; only the ones worth matching on go into the embedded text."""
    tags = tags or []
    return {
        "id": contact["id"],
        "text": _joined(
            contact.get("name", ""),
            contact.get("company", ""),
            contact.get("jobTitle", ""),
            contact.get("location", ""),
            contact.get("ai_summary", ""),
            " ".join(tags),
        ),
        "payload": {
            "user_id": contact["user_id"],
            "contact_id": contact["id"],
            "contact_name": contact.get("name", ""),
            "doc_type": "identity",
            "source_type": "contact",
            "source_id": contact["id"],
            "company": contact.get("company", ""),
            "job_title": contact.get("jobTitle", ""),
            "tags": tags,
            "snippet": contact.get("ai_summary", ""),
        },
    }


def contact_fact_doc(user_id: str, contact_id: str, contact_name: str, fact: dict) -> dict:
    fact_key = fact.get("fact_key", "")
    fact_value = fact.get("fact_value", "")
    return {
        "id": fact["id"],
        "text": _joined(contact_name, f"{fact_key}: {fact_value}" if fact_key else fact_value),
        "payload": {
            "user_id": user_id,
            "contact_id": contact_id,
            "contact_name": contact_name,
            "doc_type": "profile",
            "source_type": fact.get("source_type") or "unknown",
            "source_id": fact.get("source_id") or "",
            "dimension": fact.get("dimension", ""),
            "category": fact.get("category", ""),
            "confidence": fact.get("confidence", 1.0),
            "snippet": fact_value,
        },
    }


def contact_interaction_doc(user_id: str, contact_id: str, contact_name: str, interaction: dict) -> dict:
    return {
        "id": interaction["id"],
        "text": _joined(contact_name, interaction.get("summary", "")),
        "payload": {
            "user_id": user_id,
            "contact_id": contact_id,
            "contact_name": contact_name,
            "doc_type": "interaction",
            # an interaction row is its own provenance: it holds the raw snippet
            "source_type": interaction.get("source_type", ""),
            "source_id": interaction["id"],
            "event_date": interaction.get("event_date"),
            "snippet": interaction.get("raw_snippet") or interaction.get("summary", ""),
        },
    }


async def upsert_contact_docs(docs: list[dict]) -> None:
    """Index contact docs built by the `contact_*_doc` helpers.

    Dense vectors are embedded in one batched call so a multi-fact extraction
    costs one round trip instead of one per fact.
    """
    docs = [d for d in docs if d.get("text")]
    if not docs:
        return
    client = _get_client()
    if client is None:
        raise RuntimeError("Qdrant not configured (QDRANT_URL missing)")

    dense_vecs = await _get_dense().aembed_documents([d["text"] for d in docs])

    points = []
    for doc, dense_vec in zip(docs, dense_vecs, strict=True):
        vectors: dict[str, list[float] | models.SparseVector] = {"dense": dense_vec}
        sparse_vec = await _try_sparse_vector(doc["text"])
        if sparse_vec is not None:
            vectors["bm25"] = sparse_vec
        points.append(models.PointStruct(id=doc["id"], vector=vectors, payload=doc["payload"]))

    await client.upsert(collection_name=CONTACTS_COLLECTION, points=points)


async def delete_contact_docs(doc_ids: list[str]) -> None:
    """Drop points by source row id (a corrected or deleted fact/interaction)."""
    if not doc_ids:
        return
    client = _get_client()
    if client is None:
        raise RuntimeError("Qdrant not configured (QDRANT_URL missing)")
    await client.delete(
        collection_name=CONTACTS_COLLECTION,
        points_selector=models.PointIdsList(points=doc_ids),
    )


async def delete_contact_points(user_id: str, contact_id: str) -> None:
    """Drop every point belonging to one contact, mirroring the Postgres cascade."""
    client = _get_client()
    if client is None:
        raise RuntimeError("Qdrant not configured (QDRANT_URL missing)")
    await client.delete(
        collection_name=CONTACTS_COLLECTION,
        points_selector=models.FilterSelector(
            filter=models.Filter(
                must=[
                    models.FieldCondition(key="user_id", match=models.MatchValue(value=user_id)),
                    models.FieldCondition(key="contact_id", match=models.MatchValue(value=contact_id)),
                ]
            )
        ),
    )


async def search_contact_docs(
    user_id: str,
    query: str,
    limit: int = 10,
    doc_types: list[str] | None = None,
) -> list[dict]:
    """Hybrid dense+BM25 recall over contact docs, RRF-fused, dense-only on fallback.

    user_id is a hard filter on every prefetch branch, so isolation holds on the
    hybrid path and the degraded path alike. Returns [] rather than raising:
    callers keep their SQL results when the vector store is down.
    """
    client = _get_client()
    if client is None:
        return []

    try:
        must: list[models.Condition] = [
            models.FieldCondition(key="user_id", match=models.MatchValue(value=user_id))
        ]
        if doc_types:
            must.append(models.FieldCondition(key="doc_type", match=models.MatchAny(any=doc_types)))
        scope = models.Filter(must=must)

        dense_vec = await _get_dense().aembed_query(query)

        points = None
        sparse_vec = await _try_sparse_vector(query)
        if sparse_vec is not None:
            try:
                result = await client.query_points(
                    collection_name=CONTACTS_COLLECTION,
                    prefetch=[
                        models.Prefetch(query=dense_vec, using="dense", limit=limit * 4, filter=scope),
                        models.Prefetch(query=sparse_vec, using="bm25", limit=limit * 4, filter=scope),
                    ],
                    query=models.FusionQuery(fusion=models.Fusion.RRF),
                    limit=limit,
                )
                points = result.points
            except Exception as err:
                logger.warning("Qdrant contacts RRF query failed, falling back to dense search: %s", err)

        if points is None:
            result = await client.query_points(
                collection_name=CONTACTS_COLLECTION,
                query=dense_vec,
                using="dense",
                query_filter=scope,
                limit=limit,
            )
            points = result.points

        hits = []
        for p in points:
            payload = getattr(p, "payload", None) or {}
            # Defence in depth: a stale point must never cross tenants even if the
            # filter above is ever mis-built.
            if payload.get("user_id") != user_id:
                continue
            hits.append(
                {
                    "contact_id": payload.get("contact_id", ""),
                    "contact_name": payload.get("contact_name", ""),
                    "doc_type": payload.get("doc_type", ""),
                    "row_id": str(p.id),
                    "source_type": payload.get("source_type", ""),
                    "source_id": payload.get("source_id", ""),
                    "snippet": payload.get("snippet", ""),
                    "score": getattr(p, "score", 0.0),
                }
            )
        return hits
    except Exception as exc:
        logger.warning("Qdrant search_contact_docs failed completely: %s", exc)
        return []
