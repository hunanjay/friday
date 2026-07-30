from fastapi import APIRouter, Depends, HTTPException

from app.core.security import get_user_id
from app.services.mail_service import MailService

router = APIRouter(prefix="/api/graph/mail", tags=["mail"])


@router.get("/inbox")
async def inbox(top: int = 25, cursor: str | None = None, user_id: str = Depends(get_user_id)):
    return await MailService.get_inbox(user_id=user_id, top=top, cursor=cursor)


@router.get("/sent")
async def sent(top: int = 25, cursor: str | None = None, user_id: str = Depends(get_user_id)):
    return await MailService.get_sent(user_id=user_id, top=top, cursor=cursor)


@router.get("/search")
async def search(
    query: str = "",
    folder: str = "inbox",
    unread_only: bool = False,
    has_attachments: bool = False,
    top: int = 25,
    cursor: str | None = None,
    user_id: str = Depends(get_user_id),
):
    return await MailService.search(
        user_id=user_id,
        query=query,
        folder=folder,
        unread_only=unread_only,
        has_attachments=has_attachments,
        top=top,
        cursor=cursor,
    )


@router.get("/folders/{folder}")
async def folder_counts(folder: str, user_id: str = Depends(get_user_id)):
    return await MailService.get_folder_counts(user_id=user_id, folder=folder)


@router.get("/conversation/{conversation_id}")
async def conversation_thread(conversation_id: str, user_id: str = Depends(get_user_id)):
    return await MailService.get_conversation_thread(user_id=user_id, conversation_id=conversation_id)


@router.get("/{email_id}")
async def read(email_id: str, user_id: str = Depends(get_user_id)):
    return await MailService.get_message(user_id=user_id, email_id=email_id)


@router.patch("/{email_id}/read")
async def mark_read(email_id: str, body: dict, user_id: str = Depends(get_user_id)):
    is_read = body.get("is_read", True)
    return await MailService.mark_read(user_id=user_id, email_id=email_id, is_read=is_read)


@router.delete("/{email_id}")
async def delete(email_id: str, permanent: bool = False, user_id: str = Depends(get_user_id)):
    return await MailService.delete_message(user_id=user_id, email_id=email_id, permanent=permanent)


@router.post("/send")
async def send(body: dict, user_id: str = Depends(get_user_id)):
    to = body.get("to")
    subject = body.get("subject")
    content = body.get("body")
    if not to or not subject or not content:
        raise HTTPException(status_code=400, detail="to, subject and body are required")
    return await MailService.send_message(user_id=user_id, to=to, subject=subject, content=content)


@router.post("/{email_id}/reply")
async def reply(email_id: str, body: dict, user_id: str = Depends(get_user_id)):
    comment = body.get("body") or ""
    return await MailService.reply_message(user_id=user_id, email_id=email_id, content=comment)
