"""LangChain HumanInTheLoopMiddleware policy and execution adapter."""

import json
from typing import Any

from langchain.agents.middleware import HumanInTheLoopMiddleware
from langchain_core.messages import ToolMessage
from langgraph.types import Interrupt

HITL_TOOL_CONFIGS: dict[str, dict[str, Any]] = {
    "send_email": {
        "allowed_decisions": ["approve", "reject"],
        "description": "Review and approve this email before it is sent.",
    },
    "delete_email": {
        "allowed_decisions": ["approve", "reject"],
        "description": "Review and approve moving this email to Deleted Items.",
    },
    "create_event": {
        "allowed_decisions": ["approve", "reject"],
        "description": "Review and approve creating this calendar event.",
    },
    "delete_event": {
        "allowed_decisions": ["approve", "reject"],
        "description": "Review and approve deleting this calendar event.",
    },
    "accept_event": {
        "allowed_decisions": ["approve", "reject"],
        "description": "Review and approve accepting this calendar invitation.",
    },
    "decline_event": {
        "allowed_decisions": ["approve", "reject"],
        "description": "Review and approve declining this calendar invitation.",
    },
}

_ACTION_UI = {
    "send_email": ("mail.send", "email", "chat.reviewEmail", "chat.approvalStatusSent", "chat.confirmSend"),
    "delete_email": (
        "mail.move_to_trash",
        "email_delete",
        "chat.reviewDelete",
        "chat.approvalStatusDeleted",
        "chat.confirmDelete",
    ),
    "create_event": (
        "calendar.create",
        "calendar",
        "chat.reviewCalendarCreate",
        "chat.approvalStatusCreated",
        "chat.confirmCreate",
    ),
    "delete_event": (
        "calendar.delete",
        "calendar",
        "chat.reviewCalendarDelete",
        "chat.approvalStatusDeleted",
        "chat.confirmDelete",
    ),
    "accept_event": (
        "calendar.accept",
        "calendar",
        "chat.reviewCalendarAccept",
        "chat.approvalStatusCompleted",
        "common.confirm",
    ),
    "decline_event": (
        "calendar.decline",
        "calendar",
        "chat.reviewCalendarDecline",
        "chat.approvalStatusCompleted",
        "common.confirm",
    ),
}


def make_hitl_middleware(tool_names: set[str]) -> HumanInTheLoopMiddleware | None:
    policies = {name: config for name, config in HITL_TOOL_CONFIGS.items() if name in tool_names}
    if not policies:
        return None
    return HumanInTheLoopMiddleware(interrupt_on=policies)


def interrupt_to_action(
    interrupt: Interrupt,
    session_id: str,
    *,
    status: str = "pending",
    anchor_message_id: str | None = None,
) -> dict:
    value = interrupt.value if isinstance(interrupt.value, dict) else {}
    requests = value.get("action_requests") or []
    configs = value.get("review_configs") or []
    first = requests[0] if requests else {"name": "unknown", "args": {}}
    tool_name = first.get("name", "unknown")
    canonical, renderer, title_key, completed_key, approve_key = _ACTION_UI.get(
        tool_name,
        (tool_name, "generic", "chat.reviewAction", "chat.approvalStatusCompleted", "common.confirm"),
    )
    is_danger = tool_name in {
        "delete_email",
        "delete_event",
        "decline_event",
    }
    payload = dict(first.get("args") or {})
    if len(requests) > 1:
        canonical = "batch"
        renderer = "generic"
        payload = {"actions": requests}

    allowed = set(configs[0].get("allowed_decisions") or []) if configs else {"approve", "reject"}
    decisions = []
    if "reject" in allowed:
        decisions.append(
            {"id": "reject", "outcome": "reject", "label_key": "common.cancel", "style": "secondary"}
        )
    if "approve" in allowed:
        decisions.append(
            {
                "id": "approve",
                "outcome": "approve",
                "label_key": approve_key,
                "style": "danger" if is_danger else "primary",
            }
        )

    return {
        "id": interrupt.id,
        "session_id": session_id,
        "action_type": canonical,
        "canonical_action_type": canonical,
        "tool_name": tool_name,
        "payload": payload,
        "status": status,
        "presentation": {
            "renderer": renderer,
            "title_key": title_key,
            "subtitle_key": "chat.approvalRequired",
            "pending_status_key": "chat.approvalStatusPending",
            "completed_status_key": completed_key,
        },
        "decisions": decisions,
        "placement": {
            "surface": "chat",
            "mode": "after_message",
            "anchor_message_id": anchor_message_id,
            "priority": 0,
        },
        "request_count": len(requests),
    }


def pending_actions_from_interrupts(
    interrupts: tuple[Interrupt, ...],
    session_id: str,
) -> list[dict]:
    return [
        interrupt_to_action(
            item,
            session_id,
            anchor_message_id=f"hitl_{item.id}",
        )
        for item in interrupts
    ]


def resume_value_for(interrupt: Interrupt, decision: str) -> dict:
    value = interrupt.value if isinstance(interrupt.value, dict) else {}
    configs = value.get("review_configs") or []
    if decision not in {"approve", "reject"}:
        raise ValueError("Unsupported HITL decision")
    for config in configs:
        if decision not in (config.get("allowed_decisions") or []):
            raise ValueError(f"Decision {decision!r} is not allowed for this action")
    count = len(value.get("action_requests") or [])
    if not count:
        raise ValueError("Interrupt contains no action requests")
    if decision == "approve":
        decisions = [{"type": "approve"} for _ in range(count)]
    else:
        decisions = [
            {
                "type": "reject",
                "message": "The user rejected this action. It was not executed. Do not retry it.",
            }
            for _ in range(count)
        ]
    return {"decisions": decisions}


def _tool_message_fields(message) -> tuple[str | None, str | None, str | None, str]:
    if isinstance(message, dict):
        content = message.get("content", "")
        return (
            message.get("name"),
            message.get("tool_call_id"),
            message.get("status"),
            content if isinstance(content, str) else json.dumps(content),
        )
    content = getattr(message, "content", "")
    return (
        getattr(message, "name", None),
        getattr(message, "tool_call_id", None),
        getattr(message, "status", None),
        content if isinstance(content, str) else json.dumps(content),
    )


def _is_tool_message(message) -> bool:
    return isinstance(message, ToolMessage) or (
        isinstance(message, dict)
        and (
            message.get("type") == "tool"
            or message.get("role") == "tool"
            or (message.get("name") and message.get("tool_call_id"))
        )
    )


def approved_tool_error(
    interrupt: Interrupt,
    before_messages: list,
    after_messages: list,
    tool_results: list | None = None,
) -> str | None:
    """Return a safe failure reason unless every approved tool reported success."""
    value = interrupt.value if isinstance(interrupt.value, dict) else {}
    expected_names = [request.get("name") for request in value.get("action_requests") or []]
    before_ids = {
        tool_call_id
        for message in before_messages
        if _is_tool_message(message)
        for _name, tool_call_id, _status, _content in [_tool_message_fields(message)]
        if tool_call_id
    }
    results = []
    for message in [*after_messages, *(tool_results or [])]:
        if not _is_tool_message(message):
            continue
        name, tool_call_id, status, content = _tool_message_fields(message)
        if name in expected_names and tool_call_id not in before_ids:
            results.append((status, content))
    failures = [content for status, content in results if status == "error"]
    if failures:
        return failures[0][:500]
    if len(results) < len(expected_names):
        return "The approved tool did not produce a verifiable execution result."
    return None
