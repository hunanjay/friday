def normalize_preview(text: str, limit: int = 180) -> str:
    """Collapse Markdown/newlines into a compact, single-line sidebar preview."""
    return " ".join((text or "").split())[:limit]


def visible_message_parts(message) -> tuple[str, str, str | None] | None:
    """Extract a user-visible chat message from a LangChain message or dict.

    AI messages carrying tool calls are execution/control messages, even when
    the provider gives them text such as "Transferring back to supervisor".
    They must never be rendered as conversation history.
    """
    if isinstance(message, dict):
        message_type = message.get("type") or message.get("role")
        content = message.get("content")
        message_id = message.get("id")
        tool_calls = message.get("tool_calls") or (message.get("additional_kwargs") or {}).get("tool_calls")
    else:
        message_type = getattr(message, "type", None)
        content = getattr(message, "content", None)
        message_id = getattr(message, "id", None)
        tool_calls = getattr(message, "tool_calls", None)
        if not tool_calls:
            tool_calls = (getattr(message, "additional_kwargs", None) or {}).get("tool_calls")

    message_type = {"user": "human", "assistant": "ai"}.get(message_type, message_type)
    if message_type not in {"human", "ai"} or not isinstance(content, str) or not content:
        return None
    if message_type == "ai" and tool_calls:
        return None
    return message_type, content, message_id
