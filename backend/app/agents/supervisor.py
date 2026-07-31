import os
from datetime import datetime, timedelta, timezone

from langchain_core.messages import trim_messages
from langchain_core.messages.utils import count_tokens_approximately
from langchain_openai import ChatOpenAI
from langgraph.prebuilt import create_react_agent
from langgraph_supervisor import create_handoff_tool, create_supervisor

from app.agents.checkpointer import get_checkpointer
from app.agents.tools import make_calendar_tools, make_github_tools, make_mail_tools, make_memos_tools

class _ProxyCompatChatOpenAI(ChatOpenAI):
    # ponytail: langgraph-supervisor tags handoff-back messages with a `name`
    # field (standard OpenAI Chat Completions syntax) so the model knows which
    # sub-agent said what. Our OPENAI_BASE_URL proxy 400s on it once replayed
    # history reaches it ("Unknown parameter: input[N].name"). Drop it here,
    # right before serialization, since it's cosmetic context for the model,
    # not something our graph logic depends on. Remove once the proxy accepts
    # `name`, or if we move to a provider that does.
    def _get_request_payload(self, input_, *, stop=None, **kwargs):
        payload = super()._get_request_payload(input_, stop=stop, **kwargs)
        for msg in payload.get("messages") or payload.get("input") or []:
            if isinstance(msg, dict):
                msg.pop("name", None)
        return payload


_model: ChatOpenAI | None = None


def _get_model() -> ChatOpenAI:
    global _model
    if _model is None:
        _model = _ProxyCompatChatOpenAI(
            model=os.environ.get("OPENAI_MODEL", "gpt-4o-mini"),
            temperature=0,
            base_url=os.environ.get("OPENAI_BASE_URL") or None,
        )
    return _model


def _today_str() -> str:
    # Timezone is configurable via the TIMEZONE env var (default Asia/Shanghai).
    # Must match the Windows tz id used by create_event/list_events (see
    # agents/tools.py's _GRAPH_TZ), so relative dates ("tomorrow") resolve
    # against the user's actual calendar day.
    import zoneinfo
    tz_name = os.environ.get("TIMEZONE", "Asia/Shanghai")
    try:
        tz = zoneinfo.ZoneInfo(tz_name)
    except Exception:
        import logging
        logging.warning("Invalid TIMEZONE %r, falling back to Asia/Shanghai", tz_name)
        tz = zoneinfo.ZoneInfo("Asia/Shanghai")
    return datetime.now(tz).strftime(f"%Y-%m-%d (%A), {tz_name} time")


AGENT_NAMES = ("mail_agent", "calendar_agent", "memos_agent", "github_agent")

# What each sub-agent actually handles, in terms specific enough for the
# supervisor LLM to route on. This is the handoff tool's `description` (see
# build_supervisor) - langgraph_supervisor's default is just "Ask agent 'X'
# for help", which gives the router nothing to match a request against and is
# why the supervisor's own routing silently missed cases in practice (see the
# api/agent.py comment on the "/agent_name" tag bypass).
_ROUTING_HINTS = {
    "mail_agent": (
        "Route here for anything about the user's email/inbox or contacts: listing, searching, or "
        "reading messages, searching/looking up contacts, sending new emails, marking read/unread, or deleting existing ones."
    ),
    "calendar_agent": (
        "Route here for anything about scheduling: listing, creating, or deleting "
        "calendar events, or accepting/declining event invitations."
    ),
    "memos_agent": (
        "Route here when the user wants to save an idea/note, or find or recall "
        "something they previously wrote down."
    ),
    "github_agent": (
        "Route here when the user asks for a work report, daily report, 日报, "
        "or a summary of today's GitHub commit activity."
    ),
}

_MAX_HISTORY_TOKENS = 20000


def _trim_history(state: dict) -> dict:
    """pre_model_hook: caps what each LLM call sees so a long-running chat
    session doesn't grow the prompt (and cost/latency) without bound. Only
    trims the model's input, not what's persisted - the full history stays in
    the Postgres checkpoint via `messages`."""
    trimmed = trim_messages(
        state["messages"],
        strategy="last",
        token_counter=count_tokens_approximately,
        max_tokens=_MAX_HISTORY_TOKENS,
        start_on="human",
        end_on=("human", "tool"),
        include_system=True,
    )
    return {"llm_input_messages": trimmed}


def build_agent(user_id: str, name: str, session_id: str | None = None):
    """Builds one domain sub-agent standalone. Used both as a node inside
    build_supervisor()'s graph, and to route a "/agent_name ..." tagged chat
    message directly to it, bypassing the supervisor LLM's own routing
    decision (see api/agent.py's chat route)."""
    model = _get_model()
    today = _today_str()
    if name == "mail_agent":
        return create_react_agent(
            model,
            tools=make_mail_tools(user_id, session_id),
            name="mail_agent",
            pre_model_hook=_trim_history,
            prompt=(
                "You handle the user's email: listing, searching, and reading messages, "
                "sending new ones, and marking read/unread or deleting existing ones. "
                "send_email and delete_email never perform the action directly. They create "
                "a server-side approval request shown in the chat UI. Call the relevant tool "
                "once with final values whenever the user explicitly asks to send or delete. "
                "Do not merely draft or ask whether they want to send when the user already "
                "said send. After calling the tool, tell the user nothing happened yet and "
                "ask them to use the confirmation card. Never claim you can approve an action "
                "yourself."
            ),
        )
    if name == "calendar_agent":
        return create_react_agent(
            model,
            tools=make_calendar_tools(user_id),
            name="calendar_agent",
            pre_model_hook=_trim_history,
            prompt=(
                f"Today is {today}. You handle the user's calendar: listing, creating, and "
                "deleting events, and accepting/declining event invitations. Resolve relative "
                "dates (\"tomorrow\", \"next Wednesday\") against today's date."
            ),
        )
    if name == "memos_agent":
        return create_react_agent(
            model,
            tools=make_memos_tools(user_id),
            name="memos_agent",
            pre_model_hook=_trim_history,
            prompt=(
                "You manage the user's memos. Tools: list_memos (browse all), "
                "search_memos(query) (answer a question from memos), create_memo(title, "
                "content, category) (save something new).\n"
                "Always call exactly one tool before replying. Never answer from "
                "assumption. Never claim something is saved without calling create_memo "
                "first. Never claim something was found without calling search_memos or "
                "list_memos first."
            ),
        )
    if name == "github_agent":
        return create_react_agent(
            model,
            tools=make_github_tools(user_id),
            name="github_agent",
            pre_model_hook=_trim_history,
            prompt=(
                f"Today is {today}. You generate the user's daily work report (日报) from "
                "GitHub commit activity on their project repo. On every turn, call "
                "list_todays_commits before you reply - do not ask for permission first, "
                "just call it immediately. Write a concise report (grouped bullet points, "
                "matching the language the user asked in) based only on the commit messages "
                "the tool actually returned - never invent commits. Then call create_memo "
                "with category='work', a title like 'Daily Report - <date>', and the "
                "synthesized report as content. Confirm to the user once saved. If there "
                "were no commits today, tell them that instead of saving an empty report."
            ),
        )
    raise ValueError(f"Unknown agent: {name}")


def build_supervisor(user_id: str, session_id: str | None = None):
    """Builds a fresh supervisor graph per request, its tools closed over
    this user's id so each sub-agent only ever touches this user's mailbox
    and calendar."""
    model = _get_model()
    today = _today_str()
    agents = [build_agent(user_id, name, session_id) for name in AGENT_NAMES]

    # Custom handoff tools carrying task-specific descriptions (_ROUTING_HINTS)
    # instead of langgraph_supervisor's default "Ask agent 'X' for help" -
    # that default gives the router nothing to match a request against, which
    # is why routing silently missed cases in practice (see api/agent.py's
    # "/agent_name" tag bypass).
    handoff_tools = [
        create_handoff_tool(agent_name=name, description=_ROUTING_HINTS[name])
        for name in AGENT_NAMES
    ]
    agent_lines = "\n".join(f"- {name}: {hint}" for name, hint in _ROUTING_HINTS.items())

    workflow = create_supervisor(
        agents,
        model=model,
        tools=handoff_tools,
        pre_model_hook=_trim_history,
        prompt=(
            f"Today is {today}. You are a supervisor coordinating four agents:\n"
            f"{agent_lines}\n"
            "Route each user request to the right agent(s) and relay their results "
            "back concisely. For email requests that explicitly ask to send, the mail "
            "agent must call send_email so a confirmation action is created; never report "
            "that an email was sent unless the user has confirmed the action."
            # Note: explicit "/agent_name ..." tags are intercepted and routed
            # deterministically in code (api/agent.py) before this graph ever
            # runs, so the supervisor LLM never has to parse them itself.
        ),
    )
    return workflow.compile(checkpointer=get_checkpointer())


async def generate_session_title(message: str) -> str:
    """One-shot short title for a freshly created chat, generated from the
    first user message - the same "summarize it into a title" step Claude's
    and ChatGPT's UIs do, done here with a single cheap LLM call."""
    resp = await _get_model().ainvoke([
        {
            "role": "system",
            "content": (
                "Summarize the user's message into a short chat title (max 6 "
                "words, no trailing punctuation, same language as the "
                "message). Reply with only the title, nothing else."
            ),
        },
        {"role": "user", "content": message},
    ])
    return resp.content.strip().strip('"')


def make_graph(config: dict | None = None):
    """Entry point for `langgraph dev` / Studio, which can't pass a real
    user_id via the API route. Pass one via the Studio "configurable" panel
    (key: user_id) to test against a real logged-in user's tokens."""
    user_id = (config or {}).get("configurable", {}).get("user_id", "studio-user")
    session_id = (config or {}).get("configurable", {}).get("thread_id")
    return build_supervisor(user_id, session_id)
