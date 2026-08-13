"""原始邮件（RFC822）→ 前端期望的 Graph 形状转换器（通用 IMAP 版）。

输出契约与 Microsoft Graph 侧保持一致（前端 normalizeMessage 消费）：
    id, provider, subject, bodyPreview, sender{emailAddress{name,address}},
    toRecipients[{emailAddress{name,address}}], receivedDateTime,
    isRead, parentFolderId('inbox'|'sent'|'trash'), conversationId, hasAttachments
详情响应额外带 body{contentType,content} 和 attachments[]。
"""

import datetime
import email
import email.utils
from email.header import decode_header, make_header
from html.parser import HTMLParser

from app.infrastructure.mail.ids import make_email_id
from app.infrastructure.mail.thread import thread_key

_PREVIEW_CHARS = 150

# IMAP 文件夹名 → 前端语义文件夹
_FOLDER_PARENT = {
    "INBOX": "inbox",
    "Sent": "sent",
    "已发送": "sent",
    "Sent Items": "sent",
    "Trash": "trash",
    "已删除": "trash",
    "Deleted Items": "trash",
    "Deleted": "trash",
}


class _TextExtractor(HTMLParser):
    def __init__(self):
        super().__init__()
        self.parts = []

    def handle_data(self, data):
        text = data.strip()
        if text:
            self.parts.append(text)

    def text(self) -> str:
        return " ".join(self.parts)


def _decode_header_value(value: str | None) -> str:
    if not value:
        return ""
    try:
        return str(make_header(decode_header(value)))
    except Exception:
        return value


def _get_recipient(addr: str) -> dict:
    name, address = email.utils.parseaddr(addr)
    return {"emailAddress": {"name": _decode_header_value(name) or "", "address": address}}


def _get_addresses(header_value: str | None) -> list[dict]:
    if not header_value:
        return []
    return [
        {"emailAddress": {"name": _decode_header_value(name) or "", "address": address}}
        for name, address in email.utils.getaddresses([header_value])
    ]


def _body_parts(msg: email.message.Message) -> tuple[str | None, str | None]:
    html_parts, text_parts = [], []
    for part in msg.walk():
        if part.get_content_maintype() == "multipart":
            continue
        ctype = part.get_content_type()
        if ctype == "text/html":
            html_parts.append(part)
        elif ctype == "text/plain":
            text_parts.append(part)
    for parts in (html_parts, text_parts):
        if parts:
            payload = parts[0].get_payload(decode=True)
            if payload:
                charset = parts[0].get_content_charset() or "utf-8"
                try:
                    decoded = payload.decode(charset, errors="replace")
                except LookupError:
                    decoded = payload.decode("utf-8", errors="replace")
                return (decoded, None) if parts is html_parts else (None, decoded)
    return None, None


def _get_attachments(msg: email.message.Message) -> list[dict]:
    attachments = []
    for idx, part in enumerate(msg.walk()):
        if part.get_content_maintype() == "multipart":
            continue
        filename = part.get_filename()
        if not filename:
            continue
        filename = _decode_header_value(filename)
        disposition = (part.get("Content-Disposition") or "").lower()
        content_id = part.get("Content-ID")
        payload = part.get_payload(decode=True) or b""
        attachments.append({
            "id": str(idx),
            "name": filename,
            "contentType": part.get_content_type() or "application/octet-stream",
            "size": len(payload),
            "isInline": "inline" in disposition or bool(content_id),
            "contentId": content_id.strip("<>") if content_id else None,
        })
    return attachments


def to_graph_message(raw: bytes, account_id: str, mailbox: str, uid: int, seen_ids: set[str], full: bool = False) -> dict:
    msg = email.message_from_bytes(raw)

    subject = _decode_header_value(msg.get("Subject"))
    sender = _get_recipient(msg.get("From", ""))
    date_str = msg.get("Date")
    received_at = email.utils.parsedate_to_datetime(date_str) if date_str else None
    if received_at is None:
        received_at = datetime.datetime.now(datetime.timezone.utc)
    received_iso = received_at.astimezone(datetime.timezone.utc).isoformat()

    msg_id = (msg.get("Message-ID") or "").strip("<>") or None
    references = [
        ref.strip("<>")
        for ref in (msg.get("References") or "").replace(",", " ").split()
        if ref.strip("<>")
    ]
    in_reply_to = [ref.strip("<>") for ref in (msg.get("In-Reply-To") or "").split() if ref.strip("<>")]

    if msg_id:
        seen_ids.add(msg_id)

    html, plain = _body_parts(msg)
    if html:
        # HTML 需要剥成纯文本做预览，直接截原始 HTML 会显示标签源码
        extractor = _TextExtractor()
        extractor.feed(html)
        preview = extractor.text()[:_PREVIEW_CHARS]
    elif plain:
        preview = " ".join(plain.split())[:_PREVIEW_CHARS]
    else:
        preview = ""

    attachments = _get_attachments(msg)

    result = {
        "id": make_email_id(account_id, mailbox, uid),
        "provider": "imap",
        "subject": subject,
        "bodyPreview": preview,
        "sender": sender,
        "toRecipients": _get_addresses(msg.get("To")),
        "receivedDateTime": received_iso,
        "isRead": False,  # 由调用方根据 IMAP 标志覆写
        "parentFolderId": _FOLDER_PARENT.get(mailbox, "inbox"),
        "conversationId": thread_key(msg_id, references, in_reply_to, subject, seen_ids),
        "hasAttachments": bool(attachments),
    }
    if full:
        result["body"] = {
            "contentType": "html" if html else "text",
            "content": html or plain or "",
        }
        result["attachments"] = attachments
    return result
