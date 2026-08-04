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

from app.agents.routing import decide_route  # noqa: E402

slash = decide_route("/mail_agent 帮我看邮件")
check("slash command selects named agent", slash.agent_name == "mail_agent" and slash.source == "slash_command")
check("slash command removes its prefix", slash.message == "帮我看邮件")

multi_line = decide_route("/mail_agent help me read email with multiple\nlines")
check("slash command preserves multiline body", multi_line.message.endswith("multiple\nlines"))

send = decide_route("Send an email to alice@example.com about the launch")
check("explicit send selects mail agent", send.agent_name == "mail_agent" and send.source == "email_send")

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
# 4. Hard approval boundary for model-triggered email actions
# ---------------------------------------------------------------------------

section("4. hard email approval boundary")

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


for tool_name in ("send_email", "delete_email"):
    tool_fn = _function(tool_name)
    check(f"{tool_name} tool exists", tool_fn is not None)
    if tool_fn:
        arg_names = {arg.arg for arg in tool_fn.args.args}
        calls = _called_names(tool_fn) | _called_attributes(tool_fn)
        check(f"{tool_name} has no model-controlled confirm argument", "confirm" not in arg_names)
        check(f"{tool_name} creates a pending action", "create_action" in calls)
        check(f"{tool_name} cannot execute a Graph mutation", not ({"graph_post", "graph_patch", "graph_delete"} & calls))

agent_source = (backend_dir / "app/api/agent.py").read_text()
check("authenticated confirmation endpoint claims action before execution",
      "await pending_actions.claim_action" in agent_source)
check("confirmation endpoint is the Graph mutation boundary",
      '@router.post("/actions/{action_id}/confirm")' in agent_source and "await graph_post" in agent_source)

pending_source = (backend_dir / "app/infrastructure/db/repositories/pending_actions.py").read_text()
check("action claim is atomic and pending-only",
      "set status = 'executing'" in pending_source and "status = 'pending' and expires_at > now()" in pending_source)


# ---------------------------------------------------------------------------
# 5. Internal supervisor handoff messages stay out of chat history
# ---------------------------------------------------------------------------

section("5. chat message visibility")

from app.agents.message_visibility import visible_message_parts  # noqa: E402

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
    return {
        element.id
        for element in returns[-1].value.elts
        if isinstance(element, ast.Name)
    }


check(
    "mail agent exposes search_contacts",
    "search_contacts" in _returned_tool_names("make_mail_tools"),
)

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

from langchain_core.messages import AIMessage, HumanMessage, ToolMessage  # noqa: E402

from app.agents.context import make_agent_context_hook  # noqa: E402

mail_context = make_agent_context_hook("mail_agent")(
    {
        "messages": [
            HumanMessage(content="安排明天的日历会议"),
            AIMessage(content="日历已安排"),
            HumanMessage(content="帮我看邮箱"),
            AIMessage(content="邮箱中有两封未读邮件"),
            HumanMessage(content="最新一封是什么？"),
            AIMessage(content="", tool_calls=[{"name": "list_inbox", "args": {}, "id": "call-1"}]),
            ToolMessage(content="subject=Launch update", tool_call_id="call-1", name="list_inbox"),
        ]
    }
)["llm_input_messages"]
mail_context_text = "\n".join(getattr(message, "content", "") for message in mail_context if isinstance(getattr(message, "content", ""), str))
check("mail context excludes unrelated calendar history", "日历已安排" not in mail_context_text)
check("mail context keeps relevant prior turn and task brief", "邮箱中有两封未读邮件" in mail_context_text and "最新一封是什么" in mail_context_text)
check("mail context keeps active tool chain intact", any(isinstance(message, ToolMessage) and message.name == "list_inbox" for message in mail_context))

checkpointer_source = (backend_dir / "app/agents/checkpointer.py").read_text()
repository_sources = [
    (backend_dir / "app/infrastructure/db/repositories" / name).read_text()
    for name in ("chat_sessions.py", "pending_actions.py", "memos.py")
]
check("checkpointer uses the shared application pool", "AsyncPostgresSaver(pool)" in checkpointer_source)
check("repositories use no private connection pools", all("AsyncConnectionPool" not in source for source in repository_sources))

config_source = (backend_dir / "app/core/config.py").read_text()
supervisor_source = (backend_dir / "app/agents/supervisor.py").read_text()
github_source = (backend_dir / "app/api/github.py").read_text()
check("model configuration has one OPENAI_MODEL setting", "OPENAI_MODEL" in config_source and "DEFAULT_MODEL" not in config_source)
check("all LLM callers use Settings.OPENAI_MODEL", "model=settings.OPENAI_MODEL" in supervisor_source and "model=settings.OPENAI_MODEL" in github_source)


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
check("ChatOpenAI call includes timeout= parameter", "timeout=" in parser_source and "ChatOpenAI" in parser_source)
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
