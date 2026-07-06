from langchain_openai import ChatOpenAI
from langgraph.prebuilt import create_react_agent
from langgraph_supervisor import create_supervisor

from app.agents.tools import make_calendar_tools, make_mail_tools, make_memos_tools

_model: ChatOpenAI | None = None


def _get_model() -> ChatOpenAI:
    global _model
    if _model is None:
        _model = ChatOpenAI(model="gpt-4o-mini", temperature=0)
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
        prompt="You handle the user's email: reading the inbox and sending messages.",
    )
    calendar_agent = create_react_agent(
        model,
        tools=make_calendar_tools(user_id),
        name="calendar_agent",
        prompt="You handle the user's calendar: listing, creating, and deleting events.",
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
    return workflow.compile()
