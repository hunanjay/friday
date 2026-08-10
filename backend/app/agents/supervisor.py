import os
from datetime import datetime

from langchain.agents import create_agent
from langchain_core.messages import trim_messages
from langchain_core.messages.utils import count_tokens_approximately
from langchain_core.runnables import RunnableConfig
from langchain_openai import ChatOpenAI
from langgraph.graph import START
from langgraph_supervisor import create_handoff_tool, create_supervisor

from app.agents.checkpointer import get_checkpointer
from app.agents.context import RequireMemosToolMiddleware, ScopedContextMiddleware
from app.agents.hitl import make_hitl_middleware
from app.agents.routing import AGENT_NAMES
from app.agents.tools import make_calendar_tools, make_github_tools, make_mail_tools, make_memos_tools
from app.core.config import settings


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
            model=settings.OPENAI_MODEL,
            temperature=0,
            base_url=settings.OPENAI_BASE_URL or None,
            timeout=60.0,
            max_retries=3,
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


# What each sub-agent actually handles, in terms specific enough for the
# supervisor LLM to route on. This is the handoff tool's `description` (see
# build_supervisor) - langgraph_supervisor's default is just "Ask agent 'X'
# for help", which gives the router nothing to match a request against and is
# why the supervisor's own routing silently missed cases in practice (see the
# api/agent.py comment on the "/agent_name" tag bypass).
_ROUTING_HINTS = {
    "mail_agent": (
        "Route here for anything about the user's email/inbox, contacts, or people/relationships: "
        "looking up who someone is (e.g. '张明是谁', '查一下张明', 'who is Zhang Ming'), finding contact info, "
        "searching contacts/memory facts, listing/reading emails, sending new emails, marking read/unread, or deleting existing ones."
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


def _entry_agent(_state: dict, config: RunnableConfig) -> str:
    """Choose exactly one entry node for a new supervisor turn.

    ``Command(goto=...)`` cannot be used as the input to a graph that already
    has ``START -> supervisor``: LangGraph schedules both destinations, which
    duplicates the user message and runs the domain agent and supervisor in
    parallel.  The API puts its deterministic route in configurable metadata;
    this conditional START edge consumes it without persisting routing hints in
    the conversation.
    """
    configured = (config or {}).get("configurable", {}).get("entry_agent")
    return configured if configured in AGENT_NAMES else "supervisor"


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
    """Build one domain agent with scoped context and official HITL policy."""
    model = _get_model()
    today = _today_str()

    def middleware_for(tools: list) -> list:
        middleware = [ScopedContextMiddleware(name)]
        hitl = make_hitl_middleware({item.name for item in tools})
        if hitl:
            middleware.append(hitl)
        return middleware

    if name == "mail_agent":
        tools = make_mail_tools(user_id, session_id)
        return create_agent(
            model,
            tools=tools,
            name="mail_agent",
            middleware=middleware_for(tools),
            system_prompt=(
                "You handle the user's email and Personal Contact Relationship Brain. "
                "When asked about any person, contact, investor, colleague, or relationship (e.g. '张明是谁', '查一下张明', '谁喜欢喝普洱茶'), "
                "ALWAYS call search_contacts(query) first to look up their identity, company, job title, tags, and memory facts. "
                "Never claim you don't know or don't have access to personal information without calling search_contacts first. "
                "When recording a casual memory fact, use record_contact_fact. "
                "For emails: listing, searching, and reading messages, "
                "sending new ones, and marking read/unread or deleting existing ones. "
                "send_email and delete_email are blocked by official HITL middleware before "
                "they execute. Call the relevant tool once with final values whenever the user "
                "explicitly asks to send or delete. The interrupt creates the confirmation card. "
                "Do not merely draft or ask whether they want to send when the user already "
                "said send. Do not ask for confirmation in plain text; call the tool and let HITL "
                "pause it. Never claim completion until the resumed tool result confirms it. "
                "If a ToolMessage says the user rejected a call or it was not executed, stop: "
                "do not call that tool or any other mutation tool again in the same turn."
            ),
        )
    if name == "calendar_agent":
        tools = make_calendar_tools(user_id, session_id)
        return create_agent(
            model,
            tools=tools,
            name="calendar_agent",
            middleware=middleware_for(tools),
            system_prompt=(
                f"Today is {today}. You handle the user's calendar: listing, creating, and "
                "deleting events, and accepting/declining event invitations. Resolve relative "
                "dates with tools, never by calculating date ranges yourself. For a request about "
                "one natural-language day such as 本周三, 周五, tomorrow, or next Wednesday, always "
                "call list_events_on_day with the user's exact day phrase. Before deleting an event, "
                "call request_delete_event_on_day with the day phrase and optional subject; that tool "
                "does the exact-day lookup and is automatically paused by HITL before execution. "
                "Do not ask for confirmation in plain text: call the tool and let the official "
                "HITL interrupt produce the approval card. "
                "If multiple events match, ask the user which one. Calendar write "
                "tools are blocked before execution; never claim the operation completed until "
                "the resumed tool result says it completed. If a ToolMessage says the user "
                "rejected a call or it was not executed, stop and acknowledge cancellation; "
                "never call that tool or another mutation tool again in the same turn."
            ),
        )
    if name == "memos_agent":
        tools = make_memos_tools(user_id)
        middleware = middleware_for(tools)
        middleware.append(RequireMemosToolMiddleware())
        return create_agent(
            model,
            tools=tools,
            name="memos_agent",
            middleware=middleware,
            system_prompt=(
                "You manage the user's memos. Tools: list_memos (browse all), "
                "search_memos(query) (answer a question from memos), create_memo(title, "
                "content, category) (save something new).\n"
                "Always call exactly one tool before replying. Never answer from "
                "assumption. Never claim something is saved without calling create_memo "
                "first. When the user asks to record/save the current or previous fact, "
                "call create_memo—not list_memos—and infer a concise title and content "
                "from the relevant conversation context. Never claim something was found "
                "without calling search_memos or list_memos first."
            ),
        )
    if name == "github_agent":
        tools = make_github_tools(user_id)
        return create_agent(
            model,
            tools=tools,
            name="github_agent",
            middleware=middleware_for(tools),
            system_prompt=(
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
            "Route each user request to the right agent(s) and relay their results back concisely.\n"
            "- If the user asks about a person, contact, colleague, investor, or relationship (e.g., '张明是谁？', '查一下张明', '谁负责AI'), ALWAYS hand off to mail_agent so it searches the user's contacts database.\n"
            "- Never refuse with generic answers like 'I cannot access external databases or personal info' — you have access to the user's private database via mail_agent (search_contacts) and memos_agent (search_memos).\n"
            "- For email requests that explicitly ask to send, the mail agent must call send_email so a confirmation action is created; never report that an email was sent unless the user has confirmed the action."
            "\n- For memo requests, never claim a note was saved unless memos_agent returned a successful create_memo tool result."
        ),
    )

    # create_supervisor installs START -> supervisor. Replace it with one
    # conditional entry edge so an explicitly routed turn does not also start
    # the supervisor in parallel.
    workflow.edges.discard((START, "supervisor"))
    workflow.set_conditional_entry_point(
        _entry_agent,
        path_map=["supervisor", *AGENT_NAMES],
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
