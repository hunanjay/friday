import logging
import os
import uuid

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile

from app.core.security import get_user_id
from app.infrastructure.db.repositories import memos as memos_db
from app.services.document_parser import DocumentParser
from app.tools import vector_store

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/memos", tags=["memos"])

from app.services.storage import save_attachment_file

UPLOAD_DIR = os.path.join(os.getcwd(), "uploads", "memos")
os.makedirs(UPLOAD_DIR, exist_ok=True)


async def _index(
    user_id: str, memo_id: str, title: str, content: str, category: str, attachments: list | None = None
) -> None:
    """Best-effort: the memo row is the source of truth and must survive even
    if the embedding call/Qdrant is down. Search just won't find it until the
    next successful write."""
    try:
        await vector_store.upsert_memo(user_id, memo_id, title, content, category, attachments)
    except Exception:
        logger.exception("failed to index memo %s in Qdrant", memo_id)


@router.post("/upload")
async def upload_attachment(
    file: UploadFile = File(...),
    user_id: str = Depends(get_user_id),
):
    """Upload a document or image attachment to Aliyun OSS or disk, parse text, and return URL."""
    file_id = str(uuid.uuid4())
    safe_filename = f"{file_id}_{file.filename}"

    try:
        content_bytes = await file.read()
        file_url, file_path = save_attachment_file(content_bytes, safe_filename, file.content_type)

        # Parse text content from file (via Aliyun OCR / Vision LLM / pypdf / text)
        extracted_text = await DocumentParser.parse_file(file_path, file.content_type, file.filename)

        return {
            "id": file_id,
            "name": file.filename,
            "url": file_url,
            "type": file.content_type,
            "size": len(content_bytes),
            "extracted_text": extracted_text,
        }
    except Exception as exc:
        logger.exception("Failed to process uploaded memo file %s: %s", file.filename, exc)
        raise HTTPException(status_code=500, detail=f"Failed to process file: {str(exc)}")


@router.get("")
async def list_memos(
    category: str | None = None,
    search: str | None = None,
    limit: int = 24,
    offset: int = 0,
    user_id: str = Depends(get_user_id),
):
    memos, has_more = await memos_db.list_memos_page(
        user_id,
        category=category,
        search=search,
        limit=max(1, min(limit, 100)),
        offset=max(0, offset),
    )
    return {"memos": memos, "has_more": has_more}


@router.post("")
async def create_memo(body: dict, user_id: str = Depends(get_user_id)):
    title = body.get("title") or "Untitled Memo"
    content = body.get("content") or ""
    category = body.get("category") or "ideas"
    color = body.get("color") or "beige"
    attachments = body.get("attachments") or []

    memo = await memos_db.create_memo(user_id, title, content, category, color, attachments)
    await _index(user_id, memo["id"], title, content, category, attachments)
    return memo


@router.put("/{memo_id}")
async def update_memo(memo_id: str, body: dict, user_id: str = Depends(get_user_id)):
    title = body.get("title") or "Untitled Memo"
    content = body.get("content") or ""
    category = body.get("category") or "ideas"
    color = body.get("color") or "beige"
    pinned = bool(body.get("pinned"))
    attachments = body.get("attachments") or []
    existing = await memos_db.get_memo(user_id, memo_id)
    agent_maintained = existing["agent_maintained"] if existing else False

    memo = await memos_db.update_memo(
        user_id,
        memo_id,
        title=title,
        content=content,
        category=category,
        color=color,
        pinned=pinned,
        attachments=attachments,
        agent_maintained=agent_maintained,
    )
    if not memo:
        raise HTTPException(status_code=404, detail="Memo not found")
    await _index(user_id, memo_id, memo["title"], memo["content"], memo["category"], memo["attachments"])
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
