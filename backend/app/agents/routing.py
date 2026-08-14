"""The single, explicit policy for choosing an agent entry path."""

import re
from dataclasses import dataclass

AGENT_NAMES = ("mail_agent", "calendar_agent", "memos_agent", "github_agent")

_TAG_RE = re.compile(r"^/([\w-]+)\s+(.*)", re.DOTALL)
EMAIL_ADDRESS_RE = re.compile(r"[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}", re.IGNORECASE)
_EMAIL_SEND_RE = re.compile(
    r"(?:"
    r"发送(?:\s*(?:电子)?邮件)?|"
    r"(?:再)?发\s*(?:(?:一|1)\s*)?(?:个|封|条)?\s*(?:电子)?(?:邮件|mail|email)|"
    r"发\s*(?:(?:一|1)\s*)封|发给|"
    r"寄\s*(?:(?:一|1)\s*)?(?:个|封)?\s*(?:电子)?邮件|寄给|"
    r"send\s+(?:an?\s+)?(?:email|mail)|email\s+to"
    r")",
    re.IGNORECASE,
)
_CALENDAR_MUTATION_RE = re.compile(
    r"(?=.*(?:event|events|calendar|meeting|日历|日程|事件|会议))"
    r"(?=.*(?:delete|remove|cancel|create|add|schedule|accept|decline|删除|移除|取消|创建|新建|添加|安排|接受|拒绝))",
    re.IGNORECASE | re.DOTALL,
)
_CALENDAR_FOLLOWUP_MUTATION_RE = re.compile(
    r"(?:"
    r"(?=.*(?:取消了|取消掉|不办了|不举行了|cancelled|canceled))"
    r"(?=.*(?:删除|移除|去掉|remove|delete))|"
    r"(?:这个|这件|该)(?:事情|活动|安排).*(?:删除|移除|取消|remove|delete|cancel)"
    r")",
    re.IGNORECASE | re.DOTALL,
)
_MEMO_WRITE_RE = re.compile(
    r"(?:"
    r"(?:帮我|请|给我|替我|把.{0,80})?"
    r"(?:记录下来|记下来|记录一下|记一下|保存下来|保存一下|存下来|记到备忘录|保存到备忘录|记住)|"
    r"(?:加|添加|加入)(?:到|入)?\s*(?:memos?|备忘录)|"
    r"(?:save|record|write|note|add)\s+(?:this|that|it|down|to\s+(?:my\s+)?(?:memo|notes?))"
    r")",
    re.IGNORECASE | re.DOTALL,
)


@dataclass(frozen=True)
class RouteDecision:
    """A normalized message plus the selected execution path."""

    message: str
    agent_name: str | None
    source: str

    @property
    def uses_supervisor(self) -> bool:
        return self.agent_name is None


def is_email_send_request(message: str) -> bool:
    """Recognize an explicit send request that must use the mail agent."""
    return bool(EMAIL_ADDRESS_RE.search(message) and _EMAIL_SEND_RE.search(message))


def is_calendar_mutation_request(message: str) -> bool:
    """Recognize calendar writes that must use the approval-aware agent path.

    Follow-up requests often refer to the event as "this thing" instead of
    repeating "calendar" or "event".  A cancellation plus an explicit remove
    verb is strong enough evidence to keep that turn on the guarded calendar
    path.
    """
    return bool(
        _CALENDAR_MUTATION_RE.search(message)
        or _CALENDAR_FOLLOWUP_MUTATION_RE.search(message)
    )


def is_memo_write_request(message: str) -> bool:
    """Recognize an explicit request to persist the current fact as a memo."""
    return bool(_MEMO_WRITE_RE.search(message))


def decide_route(message: str) -> RouteDecision:
    """Apply routing precedence consistently for every chat request.

    1. An explicit slash command always wins.
    2. An explicit email-send request is routed to the mail agent so it creates
       an approval action.
    3. Explicit calendar mutations go directly to the calendar agent.
    4. Explicit memo writes go directly to the memos agent.
    5. All other requests go to the LangGraph supervisor.
    """
    tagged = _TAG_RE.match(message.strip())
    tagged_agent = tagged.group(1).replace("-", "_") if tagged else None
    if tagged and tagged_agent in AGENT_NAMES:
        return RouteDecision(
            message=tagged.group(2).strip(),
            agent_name=tagged_agent,
            source="slash_command",
        )
    if is_email_send_request(message):
        return RouteDecision(message=message, agent_name="mail_agent", source="email_send")
    if is_calendar_mutation_request(message):
        return RouteDecision(message=message, agent_name="calendar_agent", source="calendar_mutation")
    if is_memo_write_request(message):
        return RouteDecision(message=message, agent_name="memos_agent", source="memo_write")
    return RouteDecision(message=message, agent_name=None, source="supervisor")
