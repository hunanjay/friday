import logging
import os

from fastembed import SparseTextEmbedding
from langchain_openai import OpenAIEmbeddings
from qdrant_client import AsyncQdrantClient, models

logger = logging.getLogger(__name__)

COLLECTION = "memos"
_DENSE_SIZE = 1536

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
        )
    return _client


def _get_dense() -> OpenAIEmbeddings:
    global _dense_embedder
    if _dense_embedder is None:
        _dense_embedder = OpenAIEmbeddings(
            model="text-embedding-3-large",
            dimensions=_DENSE_SIZE,
            base_url=os.environ.get("OPENAI_BASE_URL") or None,
        )
    return _dense_embedder


def _get_sparse() -> SparseTextEmbedding:
    global _sparse_embedder
    if _sparse_embedder is None:
        _sparse_embedder = SparseTextEmbedding(model_name="Qdrant/bm25")
    return _sparse_embedder


def _memo_text(title: str, content: str) -> str:
    return f"{title}\n\n{content}"


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


async def upsert_memo(user_id: str, memo_id: str, title: str, content: str, category: str) -> None:
    client = _get_client()
    if client is None:
        raise RuntimeError("Qdrant not configured (QDRANT_URL missing)")
    text = _memo_text(title, content)
    dense_vec = await _get_dense().aembed_query(text)
    await client.upsert(
        collection_name=COLLECTION,
        points=[
            models.PointStruct(
                id=memo_id,
                vector={"dense": dense_vec, "bm25": _sparse_vector(text)},
                payload={"user_id": user_id, "title": title, "content": content, "category": category},
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
        raise RuntimeError("Qdrant not configured (QDRANT_URL missing)")
    dense_vec = await _get_dense().aembed_query(query)
    user_filter = models.Filter(must=[models.FieldCondition(key="user_id", match=models.MatchValue(value=user_id))])
    result = await client.query_points(
        collection_name=COLLECTION,
        prefetch=[
            models.Prefetch(query=dense_vec, using="dense", limit=20, filter=user_filter),
            models.Prefetch(query=_sparse_vector(query), using="bm25", limit=20, filter=user_filter),
        ],
        query=models.FusionQuery(fusion=models.Fusion.RRF),
        limit=limit,
    )
    return [
        {
            "id": str(p.id),
            "title": p.payload.get("title"),
            "content": p.payload.get("content"),
            "category": p.payload.get("category"),
            "score": p.score,
        }
        for p in result.points
    ]
