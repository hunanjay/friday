from urllib.parse import quote

from fastapi import APIRouter, Depends, HTTPException

from app.db.supabase_client import get_user_id
from app.tools.graph_client import graph_get, graph_patch, graph_post
from app.tools.mail_queries import MAIL_FOLDERS, search_path

router = APIRouter(prefix="/api/graph/mail", tags=["mail"])

# Fields fetched for list views (inbox / search). Full body is intentionally
# omitted - it can be hundreds of KB of HTML per message and would blow the
# browser's 5 MB localStorage quota. Callers request the full body
# separately via GET /{email_id} when the user opens a message.
_LIST_SELECT = (
    "id,subject,bodyPreview,sender,toRecipients,"
    "receivedDateTime,isRead,parentFolderId"
)


def _paged(data: dict) -> dict:
    """Reshapes a raw Graph list response into {value, next_cursor} - the
    frontend passes next_cursor straight back as `cursor` to fetch the next
    page, without needing to know it's really Graph's @odata.nextLink.

    # ponytail: Graph's nextLink here is offset-based ($skip / $skiptoken), not
    # a keyset on id+receivedDateTime, so mid-scroll inserts/deletes can shift
    # pages (a duplicated or skipped row). The frontend dedupes by id to absorb
    # duplicates; the occasional skip is accepted. Upgrade to real keyset
    # pagination (filter on receivedDateTime + id) only if that becomes a
    # problem in practice.
    """
    return {"value": data.get("value", []), "next_cursor": data.get("@odata.nextLink")}


@router.get("/inbox")
async def inbox(top: int = 25, cursor: str | None = None, user_id: str = Depends(get_user_id)):
    path = cursor or (
        f"/me/mailFolders/inbox/messages"
        f"?$top={min(top, 50)}&$orderby=receivedDateTime desc&$select={_LIST_SELECT}"
    )
    return _paged(await graph_get(user_id, path))


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
    path = cursor or search_path(folder, query, unread_only, has_attachments, top, select=_LIST_SELECT)
    return _paged(await graph_get(user_id, path))


@router.get("/folders/{folder}")
async def folder_counts(folder: str, user_id: str = Depends(get_user_id)):
    """Authoritative unread/total counts straight from Graph's folder metadata -
    the whole mailbox, not just the pages the client has loaded."""
    graph_folder = MAIL_FOLDERS.get(folder, "inbox")
    data = await graph_get(user_id, f"/me/mailFolders/{graph_folder}?$select=unreadItemCount,totalItemCount")
    return {"unread": data.get("unreadItemCount", 0), "total": data.get("totalItemCount", 0)}


@router.get("/{email_id}")
async def read(email_id: str, user_id: str = Depends(get_user_id)):
    return await graph_get(user_id, f"/me/messages/{quote(email_id)}")


@router.patch("/{email_id}/read")
async def mark_read(email_id: str, body: dict, user_id: str = Depends(get_user_id)):
    is_read = body.get("is_read", True)
    await graph_patch(user_id, f"/me/messages/{quote(email_id)}", {"isRead": is_read})
    return {"status": "ok"}


@router.delete("/{email_id}")
async def delete(email_id: str, permanent: bool = False, user_id: str = Depends(get_user_id)):
    if permanent:
        await graph_post(user_id, f"/me/messages/{quote(email_id)}/permanentDelete", {})
    else:
        await graph_post(user_id, f"/me/messages/{quote(email_id)}/move", {"destinationId": "deleteditems"})
    return {"status": "ok"}


@router.post("/send")
async def send(body: dict, user_id: str = Depends(get_user_id)):
    to = body.get("to")
    subject = body.get("subject")
    content = body.get("body")
    if not to or not subject or not content:
        raise HTTPException(status_code=400, detail="to, subject and body are required")
    await graph_post(
        user_id,
        "/me/sendMail",
        {
            "message": {
                "subject": subject,
                "body": {"contentType": "Text", "content": content},
                "toRecipients": [{"emailAddress": {"address": to}}],
            },
            "saveToSentItems": True,
        },
    )
    return {"status": "ok"}


@router.post("/{email_id}/reply")
async def reply(email_id: str, body: dict, user_id: str = Depends(get_user_id)):
    """Graph's own reply endpoint - handles In-Reply-To/threading/quoting the
    original message, so this only needs to pass the new comment text."""
    comment = body.get("body") or ""
    await graph_post(user_id, f"/me/messages/{quote(email_id)}/reply", {"comment": comment})
    return {"status": "ok"}
