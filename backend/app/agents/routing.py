"""The single, explicit policy for choosing an agent entry path."""

import re
from dataclasses import dataclass

AGENT_NAMES = ("mail_agent", "contact_agent", "calendar_agent", "memos_agent", "github_agent")

_TAG_RE = re.compile(r"^/([\w-]+)\s+(.*)", re.DOTALL)


@dataclass(frozen=True)
class RouteDecision:
    """A normalized message plus the selected execution path."""

    message: str
    agent_name: str | None
    source: str

    @property
    def uses_supervisor(self) -> bool:
        return self.agent_name is None


def decide_route(message: str) -> RouteDecision:
    """Apply routing precedence consistently for every chat request.

    1. An explicit slash command always wins.
    2. All other requests go to the parent agent, whose delegation tool
       descriptions are the single source of routing policy.
    """
    tagged = _TAG_RE.match(message.strip())
    tagged_agent = tagged.group(1).replace("-", "_") if tagged else None
    if tagged and tagged_agent in AGENT_NAMES:
        return RouteDecision(
            message=tagged.group(2).strip(),
            agent_name=tagged_agent,
            source="slash_command",
        )
    return RouteDecision(message=message, agent_name=None, source="supervisor")
