"""Shared shaping of an outgoing message: its body and its recipients.

Outbound mail leaves through five places (the agent's `send_email` tool, Graph
compose and reply, IMAP compose and reply), each of which used to inline the
same newline-to-`<br>` conversion. They all call `render_body` instead, so a
signature cannot be attached on some send routes and silently missed on others,
and `parse_recipients` gives them one answer for what an address field means.
"""

import html
import re

from fastapi import HTTPException

from app.infrastructure.db.repositories import user_settings


def apply_signature(content: str, signature: str) -> str:
    """Append the signature to a plain-text body, unless it is already there.

    Bodies can arrive pre-signed - the user edits an approval card, or resends
    a draft - so appending is idempotent rather than unconditional.
    """
    text = (content or "").replace("\r\n", "\n")
    block = (signature or "").strip()
    if not block or text.rstrip().endswith(block):
        return text
    return f"{text.rstrip()}\n\n{block}"


async def render_body(user_id: str, content: str) -> str:
    """Plain-text body (plus signature) rendered as the HTML Graph/SMTP send.

    The text is escaped before the newline conversion: bodies are written as
    plain text, so an unescaped "a < b" or "<notes>" reaches the recipient as
    markup and is swallowed by their mail client.
    """
    signed = apply_signature(content, await user_settings.get_signature(user_id))
    return html.escape(signed).replace("\n", "<br>")


_ANGLE_ADDRESS = re.compile(r"<([^>]+)>")


def parse_recipients(value: str | list[str] | None) -> list[str]:
    """Normalize a recipient field into a list of addresses.

    Accepts what each caller actually has: a list, or the single string the
    form fields and the agent's tool arguments carry, where people separate
    addresses with commas or semicolons and paste "Name <addr>" forms.
    Duplicates are dropped so a cc that repeats a to does not send twice.
    """
    if value is None:
        return []
    items = value if isinstance(value, list) else re.split(r"[,;]", value)
    addresses: list[str] = []
    for item in items:
        address = (item or "").strip()
        angled = _ANGLE_ADDRESS.search(address)
        if angled:
            address = angled.group(1).strip()
        if address and address not in addresses:
            addresses.append(address)
    return addresses


# Graph rejects a sendMail request over 4MB and base64 inflates attachment bytes
# by about a third, so the raw ceiling is well under it. SMTP has no single
# limit - 163, QQ and Gmail sit between 25MB and 50MB - so this is a
# conservative floor, not a protocol maximum. Mirrored in EmailPage.jsx, which
# checks before uploading; a smoke test asserts the two agree.
GRAPH_ATTACHMENT_LIMIT = 3 * 1024 * 1024
SMTP_ATTACHMENT_LIMIT = 20 * 1024 * 1024


def assert_attachments_fit(attachments: list | None, limit: int) -> None:
    """Reject an oversized batch with a size, not with the provider's 500.

    The total is what matters, not any one file: the whole batch travels in a
    single request.
    """
    total = sum(len(att.get("content") or b"") for att in attachments or [])
    if total > limit:
        raise HTTPException(
            status_code=413,
            detail=(
                f"Attachments total {total / 1048576:.1f}MB, over this mailbox's "
                f"{limit / 1048576:.0f}MB limit for one message. "
                "Compress them or send a share link instead."
            ),
        )
