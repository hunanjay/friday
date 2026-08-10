"""LangChain HumanInTheLoopMiddleware policy and UI adapter."""

from typing import Any

from langchain.agents.middleware import HumanInTheLoopMiddleware
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
    "request_delete_event_on_day": {
        "allowed_decisions": ["approve", "reject"],
        "description": "Review and approve finding and deleting the matching event on this day.",
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
    "request_delete_event_on_day": (
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
        "request_delete_event_on_day",
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
