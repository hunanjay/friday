"""Render a plain-text mail body to HTML with the sender's signature.

Outbound mail leaves through five places (the agent's `send_email` tool, Graph
compose and reply, IMAP compose and reply), each of which used to inline the
same newline-to-`<br>` conversion. They all call `render_body` instead, so a
signature cannot be attached on some send routes and silently missed on others.
"""

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
    signed = apply_signature(content, await user_settings.get_signature(user_id))
    return signed.replace("\n", "<br>")
