"""The single, explicit policy for choosing an agent entry path."""

from dataclasses import dataclass
import re


AGENT_NAMES = ("mail_agent", "calendar_agent", "memos_agent", "github_agent")

_TAG_RE = re.compile(r"^/(\w+)\s+(.*)", re.DOTALL)
EMAIL_ADDRESS_RE = re.compile(r"[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}", re.IGNORECASE)
_EMAIL_SEND_RE = re.compile(
    r"(?:发送|发一封|发封|发一条|再发|寄一封|send\s+(?:an?\s+)?(?:email|mail)|email\s+to)",
    re.IGNORECASE,
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


def decide_route(message: str) -> RouteDecision:
    """Apply routing precedence consistently for every chat request.

    1. An explicit slash command always wins.
    2. An explicit email-send request is routed to the mail agent so it creates
       an approval action.
    3. All other requests go to the LangGraph supervisor.
    """
    tagged = _TAG_RE.match(message.strip())
    if tagged and tagged.group(1) in AGENT_NAMES:
        return RouteDecision(
            message=tagged.group(2).strip(),
            agent_name=tagged.group(1),
            source="slash_command",
        )
    if is_email_send_request(message):
        return RouteDecision(message=message, agent_name="mail_agent", source="email_send")
    return RouteDecision(message=message, agent_name=None, source="supervisor")
