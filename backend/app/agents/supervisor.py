import os

from langchain_openai import ChatOpenAI
from langgraph.prebuilt import create_react_agent
from langgraph_supervisor import create_supervisor

from app.agents.checkpointer import get_checkpointer
from app.agents.tools import make_calendar_tools, make_mail_tools, make_memos_tools

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


def build_supervisor(user_id: str):
    """Builds a fresh supervisor graph per request, its tools closed over
    this user's id so each sub-agent only ever touches this user's mailbox
    and calendar."""
    model = _get_model()
    mail_agent = create_react_agent(
        model,
        tools=make_mail_tools(user_id),
        name="mail_agent",
        prompt=(
            "You handle the user's email: listing, searching, and reading messages, "
            "sending new ones, and marking read/unread or deleting existing ones."
        ),
    )
    calendar_agent = create_react_agent(
        model,
        tools=make_calendar_tools(user_id),
        name="calendar_agent",
        prompt=(
            "You handle the user's calendar: listing, creating, and deleting events, "
            "and accepting/declining event invitations."
        ),
    )
    memos_agent = create_react_agent(
        model,
        tools=make_memos_tools(user_id),
        name="memos_agent",
        prompt="You handle the user's memos/notes.",
    )

    workflow = create_supervisor(
        [mail_agent, calendar_agent, memos_agent],
        model=model,
        prompt=(
            "You are a supervisor coordinating three agents: mail_agent (email), "
            "calendar_agent (scheduling), and memos_agent (notes). Route each user "
            "request to the right agent(s) and relay their results back concisely."
        ),
    )
    return workflow.compile(checkpointer=get_checkpointer())


def make_graph(config: dict | None = None):
    """Entry point for `langgraph dev` / Studio, which can't pass a real
    user_id via the API route. Pass one via the Studio "configurable" panel
    (key: user_id) to test against a real logged-in user's tokens."""
    user_id = (config or {}).get("configurable", {}).get("user_id", "studio-user")
    return build_supervisor(user_id)
