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


def is_duplicate_agent_reply(
    previous: tuple[str, str, str | None] | None,
    current: tuple[str, str, str | None],
) -> bool:
    """Hide the supervisor echo of an immediately preceding agent answer.

    A supervisor handoff persists both the domain agent's final AI message and
    the supervisor's relay.  They have different LangGraph ids but can carry
    identical visible text, which otherwise becomes two Dora messages after a
    history reload.  User turns still delimit replies, so intentionally
    repeated answers in separate turns are preserved.
    """
    if not previous:
        return False
    previous_type, previous_content, _ = previous
    current_type, current_content, _ = current
    return (
        previous_type == current_type == "ai"
        and " ".join(previous_content.split()) == " ".join(current_content.split())
    )


def is_supervisor_stream_namespace(checkpoint_ns: str) -> bool:
    """Only expose the top-level supervisor model, not a nested sub-agent."""
    parts = checkpoint_ns.split("|")
    return (
        len(parts) == 2
        and parts[0].startswith("supervisor:")
        and parts[1].startswith("agent:")
    )


def _message_name(message) -> str | None:
    if isinstance(message, dict):
        return message.get("name")
    return getattr(message, "name", None)


def visible_conversation_parts(messages: list) -> list[tuple[str, str, str | None]]:
    """Project checkpoint messages into one user-visible answer per handoff turn.

    LangGraph Supervisor persists both a domain agent's answer and its own
    final relay.  If a turn contains a named supervisor reply, that is the
    authoritative UI answer; the nested agent reply is execution trace.  A
    directly routed turn has no supervisor reply, so its domain-agent answer
    remains visible.
    """
    results: list[tuple[str, str, str | None]] = []
    pending_ai: list[tuple[tuple[str, str, str | None], str | None]] = []

    def flush_ai() -> None:
        if not pending_ai:
            return
        supervisor_replies = [parts for parts, name in pending_ai if name == "supervisor"]
        # A supervisor can produce intermediate text between handoffs and then
        # a final relay. Only the last visible supervisor reply is authoritative
        # for the turn. If there is no supervisor reply (a standalone agent
        # graph), keep that agent's last response.
        parts = supervisor_replies[-1] if supervisor_replies else pending_ai[-1][0]
        previous = results[-1] if results else None
        if not is_duplicate_agent_reply(previous, parts):
            results.append(parts)
        pending_ai.clear()

    for message in messages:
        parts = visible_message_parts(message)
        if not parts:
            continue
        if parts[0] == "human":
            flush_ai()
            previous = results[-1] if results else None
            # The old Command(goto=...) entry bug could reduce the same input
            # twice before any AI response. Collapse only adjacent identical
            # human messages; repeated requests in separate turns remain.
            is_adjacent_duplicate = bool(
                previous
                and previous[0] == "human"
                and " ".join(previous[1].split()) == " ".join(parts[1].split())
            )
            if not is_adjacent_duplicate:
                results.append(parts)
        else:
            pending_ai.append((parts, _message_name(message)))
    flush_ai()
    return results
