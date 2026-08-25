from urllib.parse import quote

from fastapi import HTTPException

from app.infrastructure.graph.client import graph_get, graph_get_binary
from app.services.mail_compose import (
    GRAPH_ATTACHMENT_LIMIT,
    assert_attachments_fit,
    parse_recipients,
    render_body,
)
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
    async def _draft_message(cls, user_id: str, to: str, cc: str, bcc: str, subject: str, content: str):
        from msgraph.generated.models.body_type import BodyType
        from msgraph.generated.models.email_address import EmailAddress
        from msgraph.generated.models.item_body import ItemBody
        from msgraph.generated.models.message import Message
        from msgraph.generated.models.recipient import Recipient

        def recipients(field) -> list:
            return [Recipient(email_address=EmailAddress(address=a)) for a in parse_recipients(field)]

        return Message(
            subject=subject,
            body=ItemBody(content_type=BodyType.Html, content=await render_body(user_id, content)),
            to_recipients=recipients(to),
            cc_recipients=recipients(cc),
            bcc_recipients=recipients(bcc),
        )

    @classmethod
    async def create_draft(
        cls, user_id: str, to: str = "", cc: str = "", bcc: str = "", subject: str = "", content: str = ""
    ) -> dict:
        """Create a Graph draft message, so an in-progress compose is a real
        Outlook draft rather than text stranded in this browser's storage."""
        from app.infrastructure.graph.sdk_client import get_graph_sdk_client

        client = get_graph_sdk_client(user_id)
        msg = await cls._draft_message(user_id, to, cc, bcc, subject, content)
        created = await client.me.messages.post(msg)
        return {"id": created.id}

    @classmethod
    async def update_draft(
        cls,
        user_id: str,
        draft_id: str,
        to: str = "",
        cc: str = "",
        bcc: str = "",
        subject: str = "",
        content: str = "",
    ) -> dict:
        from app.infrastructure.graph.sdk_client import get_graph_sdk_client

        client = get_graph_sdk_client(user_id)
        msg = await cls._draft_message(user_id, to, cc, bcc, subject, content)
        await client.me.messages.by_message_id(draft_id).patch(msg)
        return {"status": "ok"}

    @classmethod
    async def mark_read(cls, user_id: str, email_id: str, is_read: bool = True) -> dict:
        from msgraph.generated.models.message import Message

        from app.infrastructure.graph.sdk_client import get_graph_sdk_client

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

    @staticmethod
    def _file_attachments(attachments: list | None) -> list:
        import base64

        from msgraph.generated.models.file_attachment import FileAttachment

        built = []
        for att in attachments or []:
            content_data = att["content"]
            raw_bytes = base64.b64decode(content_data) if isinstance(content_data, str) else content_data
            built.append(FileAttachment(
                name=att.get("name", "attachment"),
                content_type=att.get("contentType", "application/octet-stream"),
                content_bytes=raw_bytes,
            ))
        return built

    @classmethod
    async def send_message(
        cls,
        user_id: str,
        to: str,
        subject: str,
        content: str,
        attachments: list = None,
        cc: str | list[str] | None = None,
        bcc: str | list[str] | None = None,
    ) -> dict:

        from msgraph.generated.models.body_type import BodyType
        from msgraph.generated.models.email_address import EmailAddress
        from msgraph.generated.models.item_body import ItemBody
        from msgraph.generated.models.message import Message
        from msgraph.generated.models.recipient import Recipient
        from msgraph.generated.users.item.send_mail.send_mail_post_request_body import SendMailPostRequestBody

        from app.infrastructure.graph.sdk_client import get_graph_sdk_client

        client = get_graph_sdk_client(user_id)
        html_content = await render_body(user_id, content)

        def recipients(field) -> list:
            return [
                Recipient(email_address=EmailAddress(address=address))
                for address in parse_recipients(field)
            ]

        to_recipients = recipients(to)
        if not to_recipients:
            raise HTTPException(status_code=422, detail="At least one recipient is required")

        msg = Message(
            subject=subject,
            body=ItemBody(
                content_type=BodyType.Html,
                content=html_content
            ),
            to_recipients=to_recipients,
            cc_recipients=recipients(cc),
            bcc_recipients=recipients(bcc),
        )

        assert_attachments_fit(attachments, GRAPH_ATTACHMENT_LIMIT)
        if attachments:
            msg.attachments = cls._file_attachments(attachments)

        request_body = SendMailPostRequestBody(message=msg, save_to_sent_items=True)
        await client.me.send_mail.post(request_body)
        return {"status": "ok"}

    @classmethod
    async def reply_message(
        cls,
        user_id: str,
        email_id: str,
        content: str,
        attachments: list = None,
        reply_all: bool = False,
    ) -> dict:
        from msgraph.generated.models.body_type import BodyType
        from msgraph.generated.models.item_body import ItemBody
        from msgraph.generated.models.message import Message
        from msgraph.generated.users.item.messages.item.reply.reply_post_request_body import ReplyPostRequestBody
        from msgraph.generated.users.item.messages.item.reply_all.reply_all_post_request_body import (
            ReplyAllPostRequestBody,
        )

        from app.infrastructure.graph.sdk_client import get_graph_sdk_client

        client = get_graph_sdk_client(user_id)
        html_content = await render_body(user_id, content)

        msg = Message(
            body=ItemBody(
                content_type=BodyType.Html,
                content=html_content
            )
        )

        assert_attachments_fit(attachments, GRAPH_ATTACHMENT_LIMIT)
        if attachments:
            msg.attachments = cls._file_attachments(attachments)

        # Graph resolves the recipients itself, which is the whole point of
        # replyAll: it keeps everyone on the thread without us re-deriving the
        # list from headers and getting the sender's own address wrong.
        message = client.me.messages.by_message_id(email_id)
        if reply_all:
            await message.reply_all.post(ReplyAllPostRequestBody(message=msg))
        else:
            await message.reply.post(ReplyPostRequestBody(message=msg))
        return {"status": "ok"}

    @classmethod
    async def forward_message(
        cls,
        user_id: str,
        email_id: str,
        to: str,
        content: str = "",
        attachments: list = None,
        cc: str | list[str] | None = None,
        bcc: str | list[str] | None = None,
        subject: str = "",
    ) -> dict:
        """Forward with Graph's own forward action, so the original body and
        its attachments travel along without us rebuilding the message.

        Graph derives the "Fwd:" subject itself; an explicit `subject` overrides
        it, because the compose form lets the user edit that line.
        """
        from msgraph.generated.models.body_type import BodyType
        from msgraph.generated.models.email_address import EmailAddress
        from msgraph.generated.models.item_body import ItemBody
        from msgraph.generated.models.message import Message
        from msgraph.generated.models.recipient import Recipient
        from msgraph.generated.users.item.messages.item.forward.forward_post_request_body import (
            ForwardPostRequestBody,
        )

        from app.infrastructure.graph.sdk_client import get_graph_sdk_client

        to_addrs = parse_recipients(to)
        if not to_addrs:
            raise HTTPException(status_code=422, detail="At least one recipient is required")

        client = get_graph_sdk_client(user_id)
        msg = Message(
            body=ItemBody(content_type=BodyType.Html, content=await render_body(user_id, content)),
            cc_recipients=[
                Recipient(email_address=EmailAddress(address=address))
                for address in parse_recipients(cc)
            ],
            bcc_recipients=[
                Recipient(email_address=EmailAddress(address=address))
                for address in parse_recipients(bcc)
            ],
        )
        if subject:
            msg.subject = subject
        assert_attachments_fit(attachments, GRAPH_ATTACHMENT_LIMIT)
        if attachments:
            msg.attachments = cls._file_attachments(attachments)

        await client.me.messages.by_message_id(email_id).forward.post(
            ForwardPostRequestBody(
                message=msg,
                to_recipients=[
                    Recipient(email_address=EmailAddress(address=address)) for address in to_addrs
                ],
            )
        )
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
