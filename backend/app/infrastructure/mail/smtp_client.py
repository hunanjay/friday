"""通用 SMTP 客户端（支持任意 SMTP 服务器）。

security ∈ {ssl(465), starttls(587), none(25)}。
build_message 返回原始 bytes——发送成功后由服务层 IMAP APPEND 归档。
"""

import base64
import email.utils
from email.message import EmailMessage

import aiosmtplib


def _normalize_bytes(content) -> bytes:
    """附件 content 兼容 bytes 与 base64 字符串。"""
    if isinstance(content, str):
        return base64.b64decode(content)
    return content


def build_message(
    *,
    from_addr: str,
    to: str | list[str],
    subject: str,
    html_body: str,
    attachments: list[dict] | None = None,
    references: list[str] | None = None,
    in_reply_to: str | None = None,
    msg_id: str | None = None,
    cc: list[str] | None = None,
) -> bytes:
    """组装 MIME 邮件并返回原始 bytes。回复时传 references/in_reply_to
    让收件方及我们自己的线程键能归组。

    密送不在这里：Bcc 只走信封收件人（见 send_mail 的 recipients），
    写进邮件头会让其他收件人看见。"""
    msg = EmailMessage()
    msg["From"] = from_addr
    msg["To"] = ", ".join(to) if isinstance(to, list) else to
    if cc:
        msg["Cc"] = ", ".join(cc)
    msg["Subject"] = subject
    msg["Date"] = email.utils.formatdate(localtime=True)
    if msg_id:
        msg["Message-ID"] = msg_id
    if references:
        msg["References"] = " ".join(references)
    if in_reply_to:
        msg["In-Reply-To"] = in_reply_to
    msg.set_content("")
    msg.add_alternative(html_body, subtype="html")
    for att in attachments or []:
        content_type = att.get("contentType") or "application/octet-stream"
        maintype, _, subtype = content_type.partition("/")
        msg.add_attachment(
            _normalize_bytes(att["content"]),
            maintype=maintype or "application",
            subtype=subtype or "octet-stream",
            filename=att.get("name", "attachment"),
        )
    return msg.as_bytes()


async def send_mail(
    host: str,
    port: int,
    security: str,
    username: str,
    password: str,
    raw_message: bytes,
    sender: str,
    recipients: list[str],
) -> None:
    """通过 SMTP 发送。失败抛异常（由调用方转 HTTP 错误）。

    注意：aiosmtplib 发送原始 bytes 消息时必须显式提供 sender 和
    recipients（无法从原始消息解析，否则抛 ValueError）。
    """
    use_tls = security == "ssl"
    start_tls = security == "starttls"
    await aiosmtplib.send(
        raw_message,
        hostname=host,
        port=port,
        username=username,
        password=password,
        use_tls=use_tls,
        start_tls=start_tls,
        sender=sender,
        recipients=recipients,
    )
