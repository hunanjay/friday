import logging
from urllib.parse import quote

from langchain_core.messages import HumanMessage, SystemMessage
from pydantic import BaseModel, Field

from app.agents.supervisor import _get_model
from app.infrastructure.db.repositories import user_settings
from app.tools.graph_client import graph_get
from app.tools.html_sanitizer import sanitize_html_to_text

logger = logging.getLogger(__name__)

_SYSTEM_PROMPT = """Please write a polite, concise, and professional reply email according to the language and tone of the incoming email.

CRITICAL FORMATTING INSTRUCTIONS:
- You MUST format the email using proper line breaks and empty lines between sections.
- Greeting line MUST be on its own line, followed by a blank line (e.g. "Dear [Name],\n\n" or "你好，\n\n").
- Separate each body paragraph with a blank line (\n\n).
- {closing}
- Do NOT output everything on a single line!
"""

_WRITE_CLOSING = 'Closing phrase MUST be on its own line (e.g. "Best regards," or "祝好！\n").'

_SKIP_CLOSING = (
    "End at the last sentence of the message. Do NOT write a closing phrase "
    "such as \"Best regards\", \"祝好\" or \"此致\", and do NOT write a name, a "
    "title, or a company: the user's saved signature is appended automatically, "
    "so writing one would sign the email twice."
)


class _ReplyDraft(BaseModel):
    body: str = Field(
        description=(
            "The full reply email content formatted with line breaks and empty lines between sections: "
            "greeting line, then body paragraphs separated by blank lines, then whatever ending the "
            "system instructions call for. Do NOT put everything on a single line. "
            "Do NOT include a subject line or commentary."
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
    # method="function_calling" rather than the langchain_openai 1.x default of
    # "json_schema": the Qwen-compatible endpoint behind OPENAI_BASE_URL rejects
    # a json response_format ("'messages' must contain the word 'json'"), while
    # tool calling is what every agent in this app already runs on.
    # A saved signature already carries the sign-off and name, and is appended
    # to every send, so the drafter must not write one of its own.
    signature = await user_settings.get_signature(user_id)
    system_prompt = _SYSTEM_PROMPT.format(closing=_SKIP_CLOSING if signature else _WRITE_CLOSING)
    structured_model = _get_model().with_structured_output(_ReplyDraft, method="function_calling")
    result: _ReplyDraft = await structured_model.ainvoke([SystemMessage(system_prompt), HumanMessage(human)])
    draft = result.body.strip() if signature else _apply_signature(result.body.strip(), my_name)
    logger.info("draft_reply output: user_id=%s email_id=%s\n%s", user_id, email_id, draft)
    return draft
