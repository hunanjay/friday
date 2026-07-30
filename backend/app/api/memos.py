import logging

from fastapi import APIRouter, Depends, HTTPException

from app.core.security import get_user_id
from app.infrastructure.db.repositories import memos as memos_db
from app.tools import vector_store

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/memos", tags=["memos"])


async def _index(user_id: str, memo_id: str, title: str, content: str, category: str) -> None:
    """Best-effort: the memo row is the source of truth and must survive even
    if the embedding call/Qdrant is down. Search just won't find it until the
    next successful write."""
    try:
        await vector_store.upsert_memo(user_id, memo_id, title, content, category)
    except Exception:
        logger.exception("failed to index memo %s in Qdrant", memo_id)


@router.get("")
async def list_memos(user_id: str = Depends(get_user_id)):
    return {"memos": await memos_db.list_memos(user_id)}


@router.post("")
async def create_memo(body: dict, user_id: str = Depends(get_user_id)):
    title = body.get("title") or "Untitled Memo"
    content = body.get("content") or ""
    category = body.get("category") or "ideas"
    color = body.get("color") or "beige"
    memo = await memos_db.create_memo(user_id, title, content, category, color)
    await _index(user_id, memo["id"], title, content, category)
    return memo


@router.put("/{memo_id}")
async def update_memo(memo_id: str, body: dict, user_id: str = Depends(get_user_id)):
    memo = await memos_db.update_memo(
        user_id,
        memo_id,
        title=body.get("title") or "Untitled Memo",
        content=body.get("content") or "",
        category=body.get("category") or "ideas",
        color=body.get("color") or "beige",
        pinned=bool(body.get("pinned")),
    )
    if not memo:
        raise HTTPException(status_code=404, detail="Memo not found")
    await _index(user_id, memo_id, memo["title"], memo["content"], memo["category"])
    return memo


@router.delete("/{memo_id}")
async def delete_memo(memo_id: str, user_id: str = Depends(get_user_id)):
    deleted = await memos_db.delete_memo(user_id, memo_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Memo not found")
    try:
        await vector_store.delete_memo(memo_id)
    except Exception:
        logger.exception("failed to delete memo %s from Qdrant", memo_id)
    return {"status": "ok"}
