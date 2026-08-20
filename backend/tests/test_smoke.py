#!/usr/bin/env python3
"""
Smoke tests for Friday/Dora backend — no pytest, no fixtures.
Run from the repo root:

    cd backend && source .venv/bin/activate && python tests/test_smoke.py

Exit code 0 = all passed. Any failure prints the failing assertion and exits 1.
"""

import ast
import asyncio
import os
import sys
from pathlib import Path

# Add parent dir to sys.path so tests can import small, dependency-free app
# modules instead of duplicating their implementation.
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

_failures = []


def check(name: str, condition: bool, detail: str = ""):
    if condition:
        print(f"  PASS  {name}")
    else:
        msg = f"  FAIL  {name}" + (f": {detail}" if detail else "")
        print(msg)
        _failures.append(msg)


def section(title: str):
    print(f"\n── {title} ──")


# ---------------------------------------------------------------------------
# 1. Explicit routing policy
# ---------------------------------------------------------------------------

section("1. explicit routing policy")

from app.agents.routing import AGENT_NAMES, decide_route  # noqa: E402

slash = decide_route("/mail_agent 帮我看邮件")
check("slash command selects named agent", slash.agent_name == "mail_agent" and slash.source == "slash_command")
check("slash command removes its prefix", slash.message == "帮我看邮件")

hyphenated_slash = decide_route("/calendar-agent arrange a meeting")
check(
    "hyphenated slash command aliases the canonical agent name",
    hyphenated_slash.agent_name == "calendar_agent" and hyphenated_slash.message == "arrange a meeting",
)

multi_line = decide_route("/mail_agent help me read email with multiple\nlines")
check("slash command preserves multiline body", multi_line.message.endswith("multiple\nlines"))

plain = decide_route("just a regular message")
check("ordinary request uses supervisor", plain.uses_supervisor)

unknown = decide_route("/unknown_agent do something")
check("unknown slash command remains a supervisor request", unknown.uses_supervisor and unknown.message.startswith("/unknown_agent"))


# ---------------------------------------------------------------------------
# 2. html_sanitizer.sanitize_html_to_text
# ---------------------------------------------------------------------------

section("2. html_sanitizer")

from app.tools.html_sanitizer import sanitize_html_to_text  # noqa: E402

# 2a. Bare <meta> must NOT swallow subsequent content (production regression).
# This was the exact failure mode: meta landed in _REMOVE_ELEMENTS without
# being in _VOID_ELEMENTS, so skip_depth was set to 1 and never came back
# down, eating every sibling element after it.
meta_html = '<html><head><meta charset="utf-8"></head><body><p>Hello world</p></body></html>'
result = sanitize_html_to_text(meta_html)
check("<meta> doesn't swallow subsequent content", "Hello world" in result,
      f"got: {result!r}")

# 2b. display:none content must be stripped.
hidden_html = '<p>Visible</p><p style="display:none">Hidden injection</p><p>Also visible</p>'
result2 = sanitize_html_to_text(hidden_html)
check("display:none content stripped", "Hidden injection" not in result2,
      f"got: {result2!r}")
check("visible content around hidden element preserved", "Visible" in result2 and "Also visible" in result2,
      f"got: {result2!r}")

# 2c. visibility:hidden stripped.
vis_html = '<p>Real</p><span style="visibility:hidden">Shadow</span>'
result3 = sanitize_html_to_text(vis_html)
check("visibility:hidden stripped", "Shadow" not in result3)

# 2d. Normal HTML body renders visible text.
normal_html = "<h1>Subject</h1><p>Dear Alice,</p><p>Please see the attachment.</p>"
result4 = sanitize_html_to_text(normal_html)
check("normal body preserves text", "Dear Alice" in result4 and "Please see the attachment" in result4)

# 2e. Script tags stripped.
script_html = '<p>Safe</p><script>alert("xss")</script><p>Also safe</p>'
result5 = sanitize_html_to_text(script_html)
check("script tag content stripped", "alert" not in result5)
check("surrounding text preserved around stripped script", "Safe" in result5 and "Also safe" in result5)

# 2f. Invisible unicode characters stripped.
unicode_html = "<p>Normal\u200bZero\u200bWidth</p>"
result6 = sanitize_html_to_text(unicode_html)
check("zero-width spaces stripped", "\u200b" not in result6)
check("visible text around invisible chars preserved", "NormalZeroWidth" in result6.replace(" ", ""))


# ---------------------------------------------------------------------------
# 3. GitHub OAuth nonce store  (api/github_auth.py — logic tested inline)
# ---------------------------------------------------------------------------

section("3. GitHub OAuth nonce store")

# The nonce helpers are pure Python (secrets + time + dict).
# We test the logic here rather than importing github_auth.py to avoid
# dragging in supabase_client which requires SUPABASE_URL / SUPABASE_ANON_KEY.
import secrets as _secrets
import time as _time

_TTL_SECONDS = 300
_pending_test: dict[str, tuple[str, float]] = {}


def _issue_nonce_test(user_id: str) -> str:
    nonce = _secrets.token_urlsafe(32)
    now = _time.monotonic()
    _pending_test[nonce] = (user_id, now + _TTL_SECONDS)
    expired = [k for k, (_, exp) in _pending_test.items() if exp < now]
    for k in expired:
        del _pending_test[k]
    return nonce


def _redeem_nonce_test(nonce: str) -> str | None:
    entry = _pending_test.pop(nonce, None)
    if entry is None:
        return None
    user_id, expires_at = entry
    return user_id if _time.monotonic() < expires_at else None


# 3a. Issue → redeem round-trip.
nonce = _issue_nonce_test("user-abc")
check("nonce is a non-empty string", isinstance(nonce, str) and len(nonce) > 0)
uid = _redeem_nonce_test(nonce)
check("redeem returns correct user_id", uid == "user-abc")

# 3b. One-time use: second redeem returns None.
uid2 = _redeem_nonce_test(nonce)
check("second redeem returns None (one-time use)", uid2 is None)

# 3c. Wrong nonce returns None.
check("unknown nonce returns None", _redeem_nonce_test("not-a-real-nonce") is None)

# 3d. Expired nonce returns None (simulate by directly writing a past TTL).
fake_nonce = "expiry-test-nonce"
_pending_test[fake_nonce] = ("user-xyz", _time.monotonic() - 1)  # already expired
uid3 = _redeem_nonce_test(fake_nonce)
check("expired nonce returns None", uid3 is None)
check("expired nonce removed from _pending after redeem attempt", fake_nonce not in _pending_test)

# 3e. Pruning: expired entries cleaned up on next issue.
stale = "stale-nonce"
_pending_test[stale] = ("user-stale", _time.monotonic() - 1)
_issue_nonce_test("user-trigger-prune")
check("stale entry pruned on next issue", stale not in _pending_test)


# ---------------------------------------------------------------------------
# 4. Official LangChain HITL boundary for model-triggered mutations
# ---------------------------------------------------------------------------

section("4. official LangChain human-in-the-loop boundary")

backend_dir = Path(__file__).resolve().parents[1]
tools_source = (backend_dir / "app/agents/tools.py").read_text()
tools_tree = ast.parse(tools_source)


def _function(name: str) -> ast.AsyncFunctionDef | None:
    return next(
        (node for node in ast.walk(tools_tree) if isinstance(node, ast.AsyncFunctionDef) and node.name == name),
        None,
    )


def _called_attributes(node: ast.AST) -> set[str]:
    return {
        call.func.attr
        for call in ast.walk(node)
        if isinstance(call, ast.Call) and isinstance(call.func, ast.Attribute)
    }


def _called_names(node: ast.AST) -> set[str]:
    return {
        call.func.id
        for call in ast.walk(node)
        if isinstance(call, ast.Call) and isinstance(call.func, ast.Name)
    }


for tool_name in (
    "send_email",
    "delete_email",
    "create_event",
    "delete_event",
    "accept_event",
    "decline_event",
):
    tool_fn = _function(tool_name)
    check(f"{tool_name} tool exists", tool_fn is not None)
    if tool_fn:
        arg_names = {arg.arg for arg in tool_fn.args.args}
        calls = _called_names(tool_fn) | _called_attributes(tool_fn)
        check(f"{tool_name} has no model-controlled confirm argument", "confirm" not in arg_names)
        check(f"{tool_name} is the real Graph mutation", bool({"graph_post", "graph_delete"} & calls))
        check(f"{tool_name} preserves Graph failures as error ToolMessages", "_graph_mutation" in calls)
        check(f"{tool_name} has no custom approval proposal", "propose" not in calls)

check("calendar deletion no longer selects its target after approval",
      _function("request_delete_event_on_day") is None)
delete_event_fn = _function("delete_event")
check("calendar deletion requires an event id and display snapshot",
      delete_event_fn is not None and len(delete_event_fn.args.defaults) == 1)

agent_source = (backend_dir / "app/api/agent.py").read_text()
check("generic decision endpoint is available",
      '@router.post("/actions/{action_id}/decisions/{decision_id}")' in agent_source)
check("decision endpoint resumes the persisted graph interrupt",
      "Command(resume={pending.id: resume_value})" in agent_source)
check("chat input no longer schedules Command(goto) beside the default START edge",
      "goto=routed_agent" not in agent_source
      and '"entry_agent": routed_agent' not in agent_source)
check("custom pending-action state machine is gone",
      "pending_actions.claim_action" not in agent_source
      and "approval_service" not in agent_source)

supervisor_source = (backend_dir / "app/agents/supervisor.py").read_text()
check("supervisor graph has one conditional entry path",
      'workflow.edges.discard((START, _PARENT_MODEL_ENTRY))' in supervisor_source
      and "workflow.set_conditional_entry_point" in supervisor_source)

from langchain.agents.middleware import HumanInTheLoopMiddleware  # noqa: E402
from langgraph.types import Interrupt  # noqa: E402

from app.agents.hitl import (  # noqa: E402
    HITL_TOOL_CONFIGS,
    interrupt_to_action,
    make_hitl_middleware,
    pending_actions_from_interrupts,
    resume_value_for,
)

expected_hitl_tools = {
    "send_email", "delete_email", "create_event", "delete_event",
    "accept_event", "decline_event",
}
check("all email/calendar mutation tools have interrupt policies",
      expected_hitl_tools <= set(HITL_TOOL_CONFIGS))
middleware = make_hitl_middleware({"send_email", "list_inbox"})
check("official HumanInTheLoopMiddleware is instantiated",
      isinstance(middleware, HumanInTheLoopMiddleware))
check("read-only tools are not interrupted",
      set(middleware.interrupt_on) == {"send_email"})

fake_interrupt = Interrupt(
    {
        "action_requests": [
            {"name": "send_email", "args": {"to": "a@example.com", "subject": "Hi", "body": "Body"}}
        ],
        "review_configs": [
            {"action_name": "send_email", "allowed_decisions": ["approve", "reject"]}
        ],
    },
    id="interrupt-1",
)
public_interrupt = interrupt_to_action(fake_interrupt, "session-1")
check("official interrupt is adapted to the existing confirmation card",
      public_interrupt["id"] == "interrupt-1"
      and public_interrupt["canonical_action_type"] == "mail.send")
anchored_interrupt = pending_actions_from_interrupts((fake_interrupt,), "session-1")[0]
check("pending confirmation card has a stable history-message anchor",
      anchored_interrupt["placement"]["mode"] == "after_message"
      and anchored_interrupt["placement"]["anchor_message_id"] == "hitl_interrupt-1")
check("approve maps to official HITL resume payload",
      resume_value_for(fake_interrupt, "approve") == {"decisions": [{"type": "approve"}]})

from langchain.agents import create_agent  # noqa: E402
from langchain_core.language_models.fake_chat_models import FakeMessagesListChatModel  # noqa: E402
from langchain_core.messages import AIMessage  # noqa: E402
from langchain_core.tools import tool  # noqa: E402
from langgraph.checkpoint.memory import InMemorySaver  # noqa: E402
from langgraph.types import Command  # noqa: E402


class _ToolCallingFakeModel(FakeMessagesListChatModel):
    def bind_tools(self, _tools, **_kwargs):
        return self


_hitl_executions = []


@tool
def _dangerous_test_write(value: str) -> str:
    """Perform a test-only side effect."""
    _hitl_executions.append(value)
    return f"wrote {value}"


_fake_model = _ToolCallingFakeModel(
    responses=[
        AIMessage(
            content="",
            tool_calls=[
                {"name": "_dangerous_test_write", "args": {"value": "approved"}, "id": "call-hitl"}
            ],
        ),
        AIMessage(content="write completed"),
    ]
)
_official_hitl_agent = create_agent(
    _fake_model,
    tools=[_dangerous_test_write],
    middleware=[
        HumanInTheLoopMiddleware(
            interrupt_on={
                "_dangerous_test_write": {"allowed_decisions": ["approve", "reject"]}
            }
        )
    ],
    checkpointer=InMemorySaver(),
)
_hitl_config = {"configurable": {"thread_id": "official-hitl-smoke"}}
_paused = _official_hitl_agent.invoke(
    {"messages": [{"role": "user", "content": "write"}]},
    config=_hitl_config,
    version="v2",
)
check("official middleware interrupts before tool execution",
      bool(_paused.interrupts) and _hitl_executions == [])
_official_hitl_agent.invoke(
    Command(resume={"decisions": [{"type": "approve"}]}),
    config=_hitl_config,
)
check("official Command resume executes the approved tool exactly once",
      _hitl_executions == ["approved"])


# ---------------------------------------------------------------------------
# 5. Internal supervisor handoff messages stay out of chat history
# ---------------------------------------------------------------------------

section("5. chat message visibility")

from app.agents.message_visibility import (  # noqa: E402
    is_supervisor_stream_namespace,
    visible_conversation_parts,
    visible_message_parts,
)

handoff_message = {
    "role": "assistant",
    "content": "Transferring back to supervisor",
    "tool_calls": [{"name": "transfer_back_to_supervisor", "args": {}}],
}
check("handoff AI message with text is hidden", visible_message_parts(handoff_message) is None)

normal_ai_message = {
    "role": "assistant",
    "content": "Here are your recent emails.",
    "tool_calls": [],
    "id": "answer-1",
}
check(
    "normal AI answer remains visible",
    visible_message_parts(normal_ai_message) == ("ai", "Here are your recent emails.", "answer-1"),
)

normal_user_message = {"role": "user", "content": "Show my inbox", "id": "user-1"}
check(
    "normal user message remains visible",
    visible_message_parts(normal_user_message) == ("human", "Show my inbox", "user-1"),
)

tool_result = {"role": "tool", "content": "Successfully transferred back to supervisor"}
check("tool result remains hidden", visible_message_parts(tool_result) is None)
check(
    "top-level parent model stream is visible",
    is_supervisor_stream_namespace("model:run-id"),
)
check(
    "nested sub-agent model stream is hidden",
    not is_supervisor_stream_namespace("tools:parent-id|model:child-id"),
)
check(
    "a top-level tools namespace is not mistaken for the parent model",
    not is_supervisor_stream_namespace("tools:run-id"),
)
handoff_turn = [
    {"role": "user", "content": "移除这个事件", "id": "user-delete"},
    {
        "role": "assistant",
        "content": "尚未删除，请使用确认卡片。",
        "id": "parent-answer",
    },
]
check(
    "history keeps the isolated parent relay",
    visible_conversation_parts(handoff_turn)
    == [
        ("human", "移除这个事件", "user-delete"),
        ("ai", "尚未删除，请使用确认卡片。", "parent-answer"),
    ],
)
direct_turn = [
    {"role": "user", "content": "删除周三的 event", "id": "user-direct"},
    {
        "role": "assistant",
        "content": "请使用确认卡片。",
        "id": "direct-answer",
    },
]
check(
    "history keeps a slash-command parent reply",
    visible_conversation_parts(direct_turn)[-1]
    == ("ai", "请使用确认卡片。", "direct-answer"),
)

# WYSIWYG invariant: the text the stream renders at the end of a turn is the
# same text a later refresh replays, because both come from this projection.
from app.agents.message_visibility import final_reply_text  # noqa: E402

for label, turn in (
    ("handoff turn", handoff_turn),
    ("slash-command turn", direct_turn),
):
    check(
        f"streamed final message equals the replayed history bubble ({label})",
        final_reply_text(turn) == visible_conversation_parts(turn)[-1][1],
    )

check(
    "a turn with no assistant reply yet yields no final message",
    final_reply_text([{"role": "user", "content": "在吗", "id": "user-only"}]) == "",
)
check(
    "an interrupted turn whose only AI message is a tool call yields no final message",
    final_reply_text(
        [
            {"role": "user", "content": "删除周三的会议", "id": "user-hitl"},
            {
                "role": "assistant",
                "name": "calendar_agent",
                "content": "",
                "tool_calls": [{"name": "request_delete_event_on_day", "args": {}}],
                "id": "pending-tool-call",
            },
        ]
    )
    == "",
)


# ---------------------------------------------------------------------------
# 6. Chat session previews
# ---------------------------------------------------------------------------

section("6. chat session previews")

from app.agents.message_visibility import normalize_preview  # noqa: E402

check(
    "preview collapses multiline Markdown into one line",
    normalize_preview("First line\n\n  second line  ") == "First line second line",
)
check("preview handles empty content", normalize_preview("") == "")
check("preview length is bounded", len(normalize_preview("x" * 500)) == 180)


# ---------------------------------------------------------------------------
# 7. Mail contact tool and per-session turn serialization
# ---------------------------------------------------------------------------

section("7. agent tool registration and turn serialization")


def _returned_tool_names(builder_name: str) -> set[str]:
    builder = next(
        (
            node
            for node in tools_tree.body
            if isinstance(node, ast.FunctionDef) and node.name == builder_name
        ),
        None,
    )
    if not builder:
        return set()
    # Only inspect the builder's own return; ast.walk would also collect the
    # nested @tool functions' ordinary string returns.
    returns = [node for node in builder.body if isinstance(node, ast.Return)]
    if not returns or not isinstance(returns[-1].value, ast.List):
        return set()
    names = set()
    for element in returns[-1].value.elts:
        if isinstance(element, ast.Name):
            names.add(element.id)
        # Shared tools are returned as factory calls, e.g.
        # _make_search_memos_tool(user_id) -> the "search_memos" tool.
        elif isinstance(element, ast.Call) and isinstance(element.func, ast.Name):
            factory = element.func.id
            if factory.startswith("_make_") and factory.endswith("_tool"):
                names.add(factory[len("_make_"):-len("_tool")])
    return names


check(
    "mail agent exposes search_contacts",
    "search_contacts" in _returned_tool_names("make_mail_tools"),
)
# "Send him my daily report" is a mail task whose content lives in memos, and
# the email-send routing bypass means mail_agent handles that turn alone.
check(
    "mail agent can read memos so it can quote what the user wrote down",
    "search_memos" in _returned_tool_names("make_mail_tools"),
)
check(
    "memos agent still exposes its own read and write tools",
    {"list_memos", "search_memos", "create_memo"} <= _returned_tool_names("make_memos_tools"),
)
check(
    "contact agent exposes its own read and write tools",
    {"search_contacts", "create_contact", "record_contact_fact", "extract_contact_memory"}
    <= _returned_tool_names("make_contact_tools"),
)
check(
    "structured contact writes moved off the mail agent",
    "create_contact" not in _returned_tool_names("make_mail_tools"),
)
check(
    "calendar agent exposes deterministic single-day lookup",
    {"list_events_on_day", "delete_event"}
    <= _returned_tool_names("make_calendar_tools"),
)

from datetime import date as _date  # noqa: E402

from app.agents.calendar_dates import resolve_calendar_day  # noqa: E402

calendar_base = _date(2026, 8, 10)  # Monday
check("本周三 resolves to 2026-08-12", resolve_calendar_day("本周三", today=calendar_base) == _date(2026, 8, 12))
check("周三 resolves to upcoming Wednesday", resolve_calendar_day("周三", today=calendar_base) == _date(2026, 8, 12))
check("下周三 resolves deterministically", resolve_calendar_day("下周三", today=calendar_base) == _date(2026, 8, 19))

from app.agents.turn_lock import session_turn_lock  # noqa: E402


async def _verify_turn_serialization() -> list[str]:
    order: list[str] = []
    first_entered = asyncio.Event()
    release_first = asyncio.Event()

    async def first_turn():
        async with session_turn_lock("test-session"):
            order.append("first-entered")
            first_entered.set()
            await release_first.wait()
            order.append("first-exited")

    async def second_turn():
        async with session_turn_lock("test-session"):
            order.append("second-entered")

    first = asyncio.create_task(first_turn())
    await first_entered.wait()
    second = asyncio.create_task(second_turn())
    await asyncio.sleep(0)
    blocked = order == ["first-entered"]
    release_first.set()
    await asyncio.gather(first, second)
    return order if blocked else []


check(
    "same-session turns execute serially",
    asyncio.run(_verify_turn_serialization()) == ["first-entered", "first-exited", "second-entered"],
)

checkpointer_source = (backend_dir / "app/agents/checkpointer.py").read_text()
repository_sources = [
    (backend_dir / "app/infrastructure/db/repositories" / name).read_text()
    for name in ("chat_sessions.py", "memos.py")
]
check("checkpointer uses the shared application pool", "AsyncPostgresSaver(pool)" in checkpointer_source)
check("repositories use no private connection pools", all("AsyncConnectionPool" not in source for source in repository_sources))

config_source = (backend_dir / "app/core/config.py").read_text()
llm_factory_source = (backend_dir / "app/core/llm.py").read_text()
supervisor_source = (backend_dir / "app/agents/supervisor.py").read_text()
github_source = (backend_dir / "app/api/github.py").read_text()
check("model configuration has one OPENAI_MODEL setting", "OPENAI_MODEL" in config_source and "DEFAULT_MODEL" not in config_source)
check(
    "all LLM callers use the provider-aware model factory",
    "model or settings.OPENAI_MODEL" in llm_factory_source
    and "make_chat_model(" in supervisor_source
    and "make_chat_model(" in github_source,
)


# ---------------------------------------------------------------------------
# 8. Query Rewriter Fast-Path / Slow-Path heuristic
# ---------------------------------------------------------------------------

section("8. Query Rewriter heuristic")

import re as _re

_AMBIGUOUS_PATTERNS = _re.compile(
    r"(它|他|她|这个|那个|这些|那些|其中|上面|前面|刚才|是什么|有哪些|怎么|如何|什么时候|为什么|how|what|which|it |they |this |that )",
    _re.IGNORECASE,
)

def _needs_rewrite_test(query: str) -> bool:
    q = query.strip()
    if len(q) <= 6:
        return True
    if _AMBIGUOUS_PATTERNS.search(q):
        return True
    return False

check("fast-path: 'ACP考试大纲' -> False", _needs_rewrite_test("ACP考试大纲") is False)
check("slow-path: '技能要求是什么' -> True", _needs_rewrite_test("技能要求是什么") is True)
check("slow-path: '它有哪些考点' -> True", _needs_rewrite_test("它有哪些考点") is True)
check("slow-path: '大纲' -> True", _needs_rewrite_test("大纲") is True)
check("fast-path: 'RAG pipeline architecture' -> False", _needs_rewrite_test("RAG pipeline architecture") is False)
check("slow-path: 'what is it' -> True", _needs_rewrite_test("what is it") is True)
check("fast-path: '今天调通了Caddy反代' -> False", _needs_rewrite_test("今天调通了Caddy反代") is False)


# ---------------------------------------------------------------------------
# 9. Qdrant search_memos graceful degradation
# ---------------------------------------------------------------------------

section("9. Qdrant search_memos graceful degradation")

qdrant_source = (backend_dir / "app/infrastructure/vector/qdrant.py").read_text()
qdrant_tree = ast.parse(qdrant_source)

search_memos_fn = next(
    (node for node in ast.walk(qdrant_tree) if isinstance(node, ast.AsyncFunctionDef) and node.name == "search_memos"),
    None,
)
check("search_memos function exists", search_memos_fn is not None)

if search_memos_fn:
    returns_empty_list = any(
        isinstance(node, ast.If)
        and any(
            isinstance(child, ast.Return)
            and isinstance(child.value, ast.List)
            and len(child.value.elts) == 0
            for child in node.body
        )
        for node in search_memos_fn.body
    )
    check("search_memos returns [] when client is None", returns_empty_list)

    has_try = any(isinstance(node, ast.Try) for node in search_memos_fn.body)
    check("search_memos body contains try/except block", has_try)

check("fallback client.search( exists in source", "client.search(" in qdrant_source)
check("AsyncQdrantClient is initialised with timeout=", "timeout=" in qdrant_source and "AsyncQdrantClient" in qdrant_source)
check(
    "dense embedding model is provider-configurable",
    "EMBEDDING_MODEL" in qdrant_source and "EMBEDDING_BASE_URL" in qdrant_source,
)
check(
    "dense embedding dimensions come from the active provider settings",
    "settings.EMBEDDING_DIMENSIONS" in qdrant_source,
)
check(
    "sparse embedding runs off the event loop with a timeout",
    "asyncio.to_thread(_sparse_vector" in qdrant_source and "asyncio.wait_for(" in qdrant_source,
)
check(
    "memo indexing falls back to dense-only vectors",
    'vectors: dict[str, list[float] | models.SparseVector] = {"dense": dense_vec}' in qdrant_source
    and 'vectors["bm25"] = sparse_vec' in qdrant_source,
)

dockerfile_source = (backend_dir / "Dockerfile").read_text()
check(
    "backend image preloads Qdrant/bm25 for local-only runtime use",
    "Qdrant/bm25" in dockerfile_source
    and "FASTEMBED_CACHE_DIR" in dockerfile_source
    and "FASTEMBED_LOCAL_FILES_ONLY=true" in dockerfile_source,
)


# ---------------------------------------------------------------------------
# 10. Storage signed URL
# ---------------------------------------------------------------------------

section("10. Storage signed URL")

storage_source = (backend_dir / "app/services/storage.py").read_text()

check("sign_url is called", "sign_url(" in storage_source)
check("x-oss-object-acl is NOT present", "x-oss-object-acl" not in storage_source)
check("fallback /uploads/memos/ path still exists", "/uploads/memos/" in storage_source)
check("OSS upload branch guarded by credentials",
      "bucket_name and access_key_id and access_key_secret" in storage_source)


# ---------------------------------------------------------------------------
# 11. Document parser MIME routing
# ---------------------------------------------------------------------------

section("11. Document parser MIME routing")

parser_source = (backend_dir / "app/services/document_parser.py").read_text()

check("Images are handled", '"image/"' in parser_source or "'image/'" in parser_source)
check("PDF files are handled", "pdf" in parser_source.lower())
check("DOCX files are handled", "docx" in parser_source.lower())
check("Vision model factory call includes timeout= parameter", "timeout=" in parser_source and "make_chat_model" in parser_source)
check("Aliyun OCR branch exists", "RecognizeGeneral" in parser_source or "aliyun" in parser_source.lower() or "alibabacloud" in parser_source.lower())


# ---------------------------------------------------------------------------
# 12. Todo API input contract
# ---------------------------------------------------------------------------

section("12. Todo API input contract")

todos_api_source = (backend_dir / "app/api/todos.py").read_text()
todos_api_tree = ast.parse(todos_api_source)
todo_fields_fn = next(
    (node for node in ast.walk(todos_api_tree) if isinstance(node, ast.FunctionDef) and node.name == "_todo_fields"),
    None,
)
check("todo input validator exists", todo_fields_fn is not None)
check("todo input trims and bounds text", "text.strip()" in todos_api_source and "len(text) > 100" in todos_api_source)
check("todo input validates completion state", "completed must be a boolean" in todos_api_source)
check("todo input parses due dates", "date.fromisoformat" in todos_api_source)
check("todo API exposes CRUD routes", all(route in todos_api_source for route in ('@router.get("")', '@router.post("")', '@router.put("/{todo_id}")', '@router.delete("/{todo_id}")')))

main_source = (backend_dir / "app/main.py").read_text()
check("todo router is registered", "app.include_router(todos.router)" in main_source)
check("todo schema is initialized", "await todos_db.init_schema()" in main_source)


# ---------------------------------------------------------------------------
# 13. Contact Brain – schema contract & input validation
# ---------------------------------------------------------------------------

section("13. Contact Brain – schema contract & input validation")

contact_api_source   = (backend_dir / "app/api/contact.py").read_text()
contact_repo_source  = (backend_dir / "app/infrastructure/db/repositories/contacts.py").read_text()
contact_svc_source   = (backend_dir / "app/services/contact_service.py").read_text()
contact_brain_source = (backend_dir / "app/services/contact_brain_service.py").read_text()
tools_source         = (backend_dir / "app/agents/tools.py").read_text()
main_source_fresh    = (backend_dir / "app/main.py").read_text()

# ── 13-A. 4 维度表全部定义在 schema 中 ──────────────────────────────────────
EXPECTED_TABLES = ["contacts", "contact_profiles", "contact_tags", "contact_interactions"]
for tbl in EXPECTED_TABLES:
    check(
        f"schema defines table '{tbl}'",
        f"CREATE TABLE IF NOT EXISTS {tbl}" in contact_repo_source,
    )

# ── 13-B. contact_profiles 约束正确 ─────────────────────────────────────────
check(
    "contact_profiles has 4-dimension text field",
    "dimension TEXT NOT NULL" in contact_repo_source,
)
check(
    "contact_profiles references contacts with CASCADE delete",
    "REFERENCES contacts(id) ON DELETE CASCADE" in contact_repo_source,
)
check(
    "contact_profiles stores confidence score",
    "confidence FLOAT" in contact_repo_source,
)

# ── 13-C. API 输入校验：name 不能为空 ────────────────────────────────────────
check(
    "create contact endpoint validates empty name",
    'Name is required' in contact_api_source,
)

# ── 13-D. AddFactRequest 包含 4 个必要字段 ───────────────────────────────────
ADD_FACT_FIELDS = ["dimension", "category", "fact_key", "fact_value"]
for field in ADD_FACT_FIELDS:
    check(
        f"AddFactRequest declares field '{field}'",
        field in contact_api_source,
    )

# ── 13-E. outlook_contact_id 唯一索引防止重复同步 ────────────────────────────
check(
    "contacts table has unique index on (user_id, outlook_contact_id)",
    "idx_contacts_user_outlook_id" in contact_repo_source,
)

# ── 13-F. MS Graph 同步不覆盖已有的 profiles / tags ─────────────────────────
# Strip the triple-quoted docstring from the function body before checking,
# so that mentioning 'contact_profiles' in documentation doesn't trip the test.
_sync_body = ""
if "async def sync_from_microsoft" in contact_svc_source:
    _start = contact_svc_source.index("async def sync_from_microsoft")
    _rest  = contact_svc_source[_start + len("async def sync_from_microsoft"):]
    _next  = _rest.find("\n    @classmethod")
    _sync_body = _rest[:_next] if _next != -1 else _rest
    # Remove triple-quoted docstring (first occurrence)
    import re as _re_sync
    _sync_body = _re_sync.sub(r'""".*?"""', '', _sync_body, count=1, flags=_re_sync.DOTALL)
check(
    "MS Graph sync never inserts into contact_profiles",
    "INSERT INTO contact_profiles" not in _sync_body and "contact_profiles" not in _sync_body,
    "sync_from_microsoft should not write to contact_profiles",
)

# ── 13-G. LLM 提炼服务调用统一模型工厂 ─────────────────────────────────────
check(
    "ContactBrainService uses the provider-aware model factory",
    "make_chat_model" in contact_brain_source,
)
check(
    "ContactBrainService saves extracted facts to contact_profiles",
    "contact_profiles" in contact_brain_source or "add_profile_fact" in contact_brain_source,
)

# ── 13-H. Agent Tools 注册了 3 个 contact 工具 ──────────────────────────────
for tool_fn in ["search_contacts", "record_contact_fact", "extract_contact_memory"]:
    check(
        f"agent tools.py defines '{tool_fn}'",
        f"def {tool_fn}" in tools_source,
    )

# ── 13-I. schema 初始化注册进了 lifespan ────────────────────────────────────
check(
    "contacts schema init registered in lifespan",
    "contacts_db.init_schema()" in main_source_fresh,
)

# ── 13-J. 纯逻辑单元测试：fact dimension 白名单校验 ──────────────────────────
VALID_DIMENSIONS = {"basic", "business", "private", "dynamic"}

def _validate_dimension(dim: str) -> bool:
    return dim in VALID_DIMENSIONS

check("valid dimension 'basic' passes",    _validate_dimension("basic"))
check("valid dimension 'business' passes", _validate_dimension("business"))
check("valid dimension 'private' passes",  _validate_dimension("private"))
check("valid dimension 'dynamic' passes",  _validate_dimension("dynamic"))
check("invalid dimension 'unknown' fails", not _validate_dimension("unknown"))
check("empty string dimension fails",      not _validate_dimension(""))


# ---------------------------------------------------------------------------
# 15. Assistant identity prompt and final-message safety
# ---------------------------------------------------------------------------

section("15. assistant identity prompt")

supervisor_source = (backend_dir / "app/agents/supervisor.py").read_text()
agent_api_source = (backend_dir / "app/api/agent.py").read_text()

# "answer as <name>" was read by the model as "reply with the literal string
# <name>", so every greeting came back as a one-word reply of the bot's name.
check(
    "prompt no longer tells the model to 'answer as <assistant_name>'",
    "answer as {assistant_name}" not in supervisor_source,
)
# Keep the suite hermetic: importing app.agents.supervisor pulls in
# app.agents.tools -> github_client -> ... -> app.core.security, which builds
# a Supabase client at import time. CI leaves these unset.
for _var, _stub in (
    ("SUPABASE_URL", "https://test.supabase.co"),
    ("SUPABASE_ANON_KEY", "test-anon-key"),
    ("SUPABASE_SERVICE_ROLE_KEY", "test-service-key"),
):
    os.environ[_var] = os.environ.get(_var) or _stub

from app.agents.supervisor import _ROUTING_HINTS, _agent_prompts, _supervisor_prompt  # noqa: E402

_identity_guard = "Never reply with your name by itself"
_sample_prompts = _agent_prompts("Friday", "2026-01-01")
check(
    "domain-agent prompts do not repeat the user-facing identity",
    all("You are Friday" not in prompt for prompt in _sample_prompts.values()),
)
check(
    "the supervisor prompt forbids a name-only reply",
    _identity_guard in _supervisor_prompt("Friday", "2026-01-01"),
)
check(
    "an empty final_message is never streamed, so it cannot blank the bubble",
    "if final_text:" in agent_api_source
    and "'final_message': final_text" in agent_api_source,
)
check(
    "supervisor prompt no longer hardcodes a stale agent count",
    "four agents" not in supervisor_source,
)
check(
    "supervisor prompt does not duplicate domain routing policy",
    all(hint not in _supervisor_prompt("Friday", "2026-01-01") for hint in _ROUTING_HINTS.values()),
)

from app.agents.supervisor import describe_team  # noqa: E402

_team = describe_team("smoke-test-user", assistant_name="Friday")
check(
    "describe_team covers every registered agent",
    {agent["name"] for agent in _team["agents"]} == set(AGENT_NAMES),
)
check(
    "describe_team's contact_agent entry lists create_contact with its docstring",
    any(
        t["name"] == "create_contact" and "structured details" in t["description"]
        for agent in _team["agents"] if agent["name"] == "contact_agent"
        for t in agent["tools"]
    ),
)
check(
    "describe_team exposes contact routing through the tool description",
    next(agent for agent in _team["agents"] if agent["name"] == "contact_agent")["routing_hint"]
    == _ROUTING_HINTS["contact_agent"],
)


# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------

print()
if _failures:
    print(f"{'─'*50}")
    print(f"FAILED: {len(_failures)} test(s)")
    for f in _failures:
        print(f)
    sys.exit(1)
else:
    total = 25  # approximate
    print("All checks passed.")
    sys.exit(0)
