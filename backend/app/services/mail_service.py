from urllib.parse import quote
from app.infrastructure.graph.client import graph_get, graph_post, graph_patch, graph_delete
from app.tools.mail_queries import MAIL_FOLDERS, search_path

LIST_SELECT_FIELDS = (
    "id,subject,bodyPreview,sender,toRecipients,"
    "receivedDateTime,isRead,parentFolderId,conversationId"
)


class MailService:
    @staticmethod
    def format_paged_response(data: dict) -> dict:
        return {"value": data.get("value", []), "next_cursor": data.get("@odata.nextLink")}

    @classmethod
    async def get_inbox(cls, user_id: str, top: int = 25, cursor: str | None = None) -> dict:
        path = cursor or (
            f"/me/mailFolders/inbox/messages"
            f"?$top={min(top, 50)}&$orderby=receivedDateTime desc&$select={LIST_SELECT_FIELDS}"
        )
        data = await graph_get(user_id, path)
        return cls.format_paged_response(data)

    @classmethod
    async def get_sent(cls, user_id: str, top: int = 25, cursor: str | None = None) -> dict:
        path = cursor or (
            f"/me/mailFolders/sentitems/messages"
            f"?$top={min(top, 50)}&$orderby=receivedDateTime desc&$select={LIST_SELECT_FIELDS}"
        )
        data = await graph_get(user_id, path)
        return cls.format_paged_response(data)

    @classmethod
    async def search(
        cls,
        user_id: str,
        query: str = "",
        folder: str = "inbox",
        unread_only: bool = False,
        has_attachments: bool = False,
        top: int = 25,
        cursor: str | None = None,
    ) -> dict:
        path = cursor or search_path(folder, query, unread_only, has_attachments, top, select=LIST_SELECT_FIELDS)
        data = await graph_get(user_id, path)
        return cls.format_paged_response(data)

    @classmethod
    async def get_folder_counts(cls, user_id: str, folder: str) -> dict:
        graph_folder = MAIL_FOLDERS.get(folder, "inbox")
        data = await graph_get(user_id, f"/me/mailFolders/{graph_folder}?$select=unreadItemCount,totalItemCount")
        return {"unread": data.get("unreadItemCount", 0), "total": data.get("totalItemCount", 0)}

    @classmethod
    async def get_conversation_thread(cls, user_id: str, conversation_id: str) -> dict:
        select = LIST_SELECT_FIELDS + ",body"
        path = (
            f"/me/messages"
            f"?$filter=conversationId eq '{quote(conversation_id)}'"
            f"&$top=50"
            f"&$select={select}"
        )
        data = await graph_get(user_id, path)
        messages = data.get("value", [])
        messages.sort(key=lambda m: m.get("receivedDateTime", ""))
        return {"value": messages}

    @classmethod
    async def get_message(cls, user_id: str, email_id: str) -> dict:
        return await graph_get(user_id, f"/me/messages/{quote(email_id)}")

    @classmethod
    async def mark_read(cls, user_id: str, email_id: str, is_read: bool = True) -> dict:
        await graph_patch(user_id, f"/me/messages/{quote(email_id)}", {"isRead": is_read})
        return {"status": "ok"}

    @classmethod
    async def delete_message(cls, user_id: str, email_id: str, permanent: bool = False) -> dict:
        if permanent:
            await graph_post(user_id, f"/me/messages/{quote(email_id)}/permanentDelete", {})
        else:
            await graph_post(user_id, f"/me/messages/{quote(email_id)}/move", {"destinationId": "deleteditems"})
        return {"status": "ok"}

    @classmethod
    async def send_message(cls, user_id: str, to: str, subject: str, content: str) -> dict:
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

    @classmethod
    async def reply_message(cls, user_id: str, email_id: str, content: str) -> dict:
        await graph_post(user_id, f"/me/messages/{quote(email_id)}/reply", {"comment": content})
        return {"status": "ok"}
