from urllib.parse import quote
from app.infrastructure.graph.client import graph_get, graph_get_binary, graph_post, graph_patch, graph_delete
from app.tools.mail_queries import MAIL_FOLDERS, search_path

LIST_SELECT_FIELDS = (
    "id,subject,bodyPreview,sender,toRecipients,"
    "receivedDateTime,isRead,parentFolderId,conversationId,hasAttachments"
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
            # contentId is defined on fileAttachment, not the base attachment
            # type, so qualify the derived property in the OData $select.
            f"&$expand=attachments($select=id,name,size,contentType,isInline,microsoft.graph.fileAttachment/contentId)"
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
        from app.infrastructure.graph.sdk_client import get_graph_sdk_client
        from msgraph.generated.models.message import Message

        client = get_graph_sdk_client(user_id)
        msg = Message(is_read=is_read)
        await client.me.messages.by_message_id(email_id).patch(msg)
        return {"status": "ok"}

    @classmethod
    async def delete_message(cls, user_id: str, email_id: str, permanent: bool = False) -> dict:
        from app.infrastructure.graph.sdk_client import get_graph_sdk_client
        client = get_graph_sdk_client(user_id)

        if permanent:
            await client.me.messages.by_message_id(email_id).delete()
        else:
            from msgraph.generated.users.item.messages.item.move.move_post_request_body import MovePostRequestBody
            body = MovePostRequestBody(destination_id="deleteditems")
            await client.me.messages.by_message_id(email_id).move.post(body)
        return {"status": "ok"}

    @classmethod
    async def send_message(cls, user_id: str, to: str, subject: str, content: str, attachments: list = None) -> dict:
        from app.infrastructure.graph.sdk_client import get_graph_sdk_client
        from msgraph.generated.models.message import Message
        from msgraph.generated.models.item_body import ItemBody
        from msgraph.generated.models.body_type import BodyType
        from msgraph.generated.models.recipient import Recipient
        from msgraph.generated.models.email_address import EmailAddress
        from msgraph.generated.models.file_attachment import FileAttachment
        from msgraph.generated.users.item.send_mail.send_mail_post_request_body import SendMailPostRequestBody
        import base64

        client = get_graph_sdk_client(user_id)
        html_content = content.replace("\r\n", "\n").replace("\n", "<br>")

        msg = Message(
            subject=subject,
            body=ItemBody(
                content_type=BodyType.Html,
                content=html_content
            ),
            to_recipients=[
                Recipient(email_address=EmailAddress(address=to))
            ]
        )

        if attachments:
            msg.attachments = []
            for att in attachments:
                import base64
                content_data = att["content"]
                raw_bytes = base64.b64decode(content_data) if isinstance(content_data, str) else content_data
                msg.attachments.append(FileAttachment(
                    name=att.get("name", "attachment"),
                    content_type=att.get("contentType", "application/octet-stream"),
                    content_bytes=raw_bytes
                ))

        request_body = SendMailPostRequestBody(message=msg, save_to_sent_items=True)
        await client.me.send_mail.post(request_body)
        return {"status": "ok"}

    @classmethod
    async def reply_message(cls, user_id: str, email_id: str, content: str, attachments: list = None) -> dict:
        from app.infrastructure.graph.sdk_client import get_graph_sdk_client
        from msgraph.generated.models.message import Message
        from msgraph.generated.models.item_body import ItemBody
        from msgraph.generated.models.body_type import BodyType
        from msgraph.generated.models.file_attachment import FileAttachment
        from msgraph.generated.users.item.messages.item.reply.reply_post_request_body import ReplyPostRequestBody
        import base64

        client = get_graph_sdk_client(user_id)
        html_content = content.replace("\r\n", "\n").replace("\n", "<br>")

        msg = Message(
            body=ItemBody(
                content_type=BodyType.Html,
                content=html_content
            )
        )

        if attachments:
            msg.attachments = []
            for att in attachments:
                import base64
                content_data = att["content"]
                raw_bytes = base64.b64decode(content_data) if isinstance(content_data, str) else content_data
                msg.attachments.append(FileAttachment(
                    name=att.get("name", "attachment"),
                    content_type=att.get("contentType", "application/octet-stream"),
                    content_bytes=raw_bytes
                ))

        request_body = ReplyPostRequestBody(message=msg)
        await client.me.messages.by_message_id(email_id).reply.post(request_body)
        return {"status": "ok"}

    @classmethod
    async def list_attachments(cls, user_id: str, email_id: str) -> dict:
        # Graph includes contentBytes by default, which makes even a metadata
        # listing download and deserialize every attachment. Restrict the
        # response to the fields needed by the UI.
        data = await graph_get(
            user_id,
            f"/me/messages/{quote(email_id, safe='')}/attachments"
            "?$select=id,name,contentType,size,isInline,microsoft.graph.fileAttachment/contentId",
        )
        return {"value": data.get("value", [])}

    @classmethod
    async def download_attachment(cls, user_id: str, email_id: str, attachment_id: str) -> dict:
        # $value returns the original byte stream. The SDK's model endpoint
        # first expands it as Base64 and had already decoded content_bytes;
        # decoding that value a second time corrupted downloaded files.
        raw = await graph_get_binary(
            user_id,
            f"/me/messages/{quote(email_id, safe='')}/attachments/"
            f"{quote(attachment_id, safe='')}/$value",
        )
        return {
            "content_type": raw.content_type,
            "content_disposition": raw.content_disposition,
            "content": raw.content,
        }
