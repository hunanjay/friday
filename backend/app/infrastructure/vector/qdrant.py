import logging
import os

from fastembed import SparseTextEmbedding
from langchain_openai import OpenAIEmbeddings
from qdrant_client import AsyncQdrantClient, models

logger = logging.getLogger(__name__)

COLLECTION = "memos"


def _embedding_base_url() -> str | None:
    return os.environ.get("EMBEDDING_BASE_URL") or os.environ.get("OPENAI_BASE_URL") or None


def _embedding_model() -> str:
    configured = os.environ.get("EMBEDDING_MODEL")
    if configured:
        return configured
    base_url = (_embedding_base_url() or "").lower()
    return "embedding-3" if "bigmodel.cn" in base_url else "text-embedding-3-large"


_DENSE_SIZE = int(os.environ.get("EMBEDDING_DIMENSIONS", "1536"))

_client: AsyncQdrantClient | None = None
_dense_embedder: OpenAIEmbeddings | None = None
_sparse_embedder: SparseTextEmbedding | None = None


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
        _dense_embedder = OpenAIEmbeddings(
            model=_embedding_model(),
            dimensions=_DENSE_SIZE,
            base_url=_embedding_base_url(),
            api_key=os.environ.get("EMBEDDING_API_KEY") or os.environ.get("OPENAI_API_KEY"),
            request_timeout=60.0,
            max_retries=3,
        )
    return _dense_embedder


def _get_sparse() -> SparseTextEmbedding:
    global _sparse_embedder
    if _sparse_embedder is None:
        _sparse_embedder = SparseTextEmbedding(model_name="Qdrant/bm25")
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


async def init_collection():
    client = _get_client()
    if client is None:
        logger.warning("QDRANT_URL not set - Qdrant vector search disabled")
        return
    try:
        if not await client.collection_exists(COLLECTION):
            await client.create_collection(
                collection_name=COLLECTION,
                vectors_config={"dense": models.VectorParams(size=_DENSE_SIZE, distance=models.Distance.COSINE)},
                sparse_vectors_config={"bm25": models.SparseVectorParams()},
            )
        await client.create_payload_index(
            collection_name=COLLECTION,
            field_name="user_id",
            field_schema=models.PayloadSchemaType.KEYWORD,
        )
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
    await client.upsert(
        collection_name=COLLECTION,
        points=[
            models.PointStruct(
                id=memo_id,
                vector={"dense": dense_vec, "bm25": _sparse_vector(text)},
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

        points = []
        # 1. Try Hybrid Fusion Query (RRF)
        try:
            result = await client.query_points(
                collection_name=COLLECTION,
                prefetch=[
                    models.Prefetch(query=dense_vec, using="dense", limit=20, filter=user_filter),
                    models.Prefetch(query=_sparse_vector(query), using="bm25", limit=20, filter=user_filter),
                ],
                query=models.FusionQuery(fusion=models.Fusion.RRF),
                limit=limit,
            )
            points = result.points
        except Exception as err:
            logger.warning("Qdrant RRF query_points failed, falling back to dense search: %s", err)
            # 2. Fallback to standard dense search
            points = await client.search(
                collection_name=COLLECTION,
                query_vector=("dense", dense_vec),
                query_filter=user_filter,
                limit=limit,
            )

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
