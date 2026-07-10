import logging
from urllib.parse import quote

from langchain_core.messages import HumanMessage, SystemMessage
from pydantic import BaseModel, Field

from app.agents.supervisor import _get_model
from app.tools.graph_client import graph_get
from app.tools.html_sanitizer import sanitize_html_to_text

logger = logging.getLogger(__name__)

_SYSTEM_PROMPT = """Please write a polite, concise, and professional reply email according to the language/style of the invitation email"""


class _ReplyDraft(BaseModel):
    body: str = Field(
        description=(
            "The full reply email content: greeting line, body paragraphs, and "
            "a short closing phrase at the end (e.g. 'Best regards,'). Do NOT "
            "include a subject line, a signature/name after the closing "
            "phrase, or any commentary about the reply itself."
        )
    )


# ponytail: structured output (forcing the model to fill one schema field
# instead of writing a free chat message) is what stops preamble chatter like
# "Sure, here's your reply:" - regex-cleaning a free-form chat response was
# only ever a patch over that. This regex is a much narrower safety net: even
# in structured mode the model can't be trusted to write the user's real name
# correctly, so the signature is always replaced in code.
_CLOSING_WORDS = ("regards", "sincerely", "best", "cheers", "祝好", "此致", "顺祝", "敬礼", "谨上", "祝商祺")


def _apply_signature(text: str, my_name: str) -> str:
    lines = text.rstrip().splitlines()
    for i in range(len(lines) - 1, -1, -1):
        stripped = lines[i].strip().rstrip(",:，：").lower()
        if len(stripped.split()) <= 4 and any(w in stripped for w in _CLOSING_WORDS):
            body = "\n".join(lines[: i + 1]).rstrip()
            return f"{body}\n{my_name}" if my_name else body
    body = text.rstrip()
    return f"{body}\n\n{my_name}" if my_name else body


async def draft_reply(user_id: str, email_id: str, intent: str, my_name: str = "") -> str:
    """Fetches the original email (sanitized to visible text - the same
    prompt-injection guard as read_email), then asks the model to fill a
    single-field structured schema rather than write a free-form chat reply -
    see _apply_signature's comment for why that's what actually stops the
    preamble chatter, not regex cleanup."""
    data = await graph_get(
        user_id, f"/me/messages/{quote(email_id)}?$select=subject,from,body,bodyPreview"
    )
    sender = data.get("from", {}).get("emailAddress", {})
    body = data.get("body") or {}
    content = body.get("content", data.get("bodyPreview", ""))
    original = sanitize_html_to_text(content) if body.get("contentType") == "html" else content

    human = (
        f"[Incoming Email]\n"
        f"From: {sender.get('name')} <{sender.get('address')}>\n"
        f"Subject: {data.get('subject')}\n"
        f"Body:\n{original}\n\n"
        f"Please help me reply to this email using the incoming email's main language.\n\n"
        f"[User Intent]\n\"{intent}\""
    )
    logger.info("draft_reply input: user_id=%s email_id=%s\n%s", user_id, email_id, human)
    structured_model = _get_model().with_structured_output(_ReplyDraft)
    result: _ReplyDraft = await structured_model.ainvoke([SystemMessage(_SYSTEM_PROMPT), HumanMessage(human)])
    draft = _apply_signature(result.body.strip(), my_name)
    logger.info("draft_reply output: user_id=%s email_id=%s\n%s", user_id, email_id, draft)
    return draft
