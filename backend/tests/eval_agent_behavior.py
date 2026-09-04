#!/usr/bin/env python3
"""Behaviour eval for the supervisor and its domain agents.

Runs the real graph over a goldset with the tool *bodies* stubbed out, so what
is measured is the system prompts and tool descriptions - routing, which tools
get called, which writes fire when they should not - plus an LLM judge on the
final reply. Writes a self-contained HTML report.

    cd backend && .venv/bin/python tests/eval_agent_behavior.py [-o report.html] [--only smalltalk]

Needs an LLM key (backend/.env). No Postgres, Qdrant, Graph, or GitHub: the
checkpointer is in-memory, the approval middleware is off, and every tool
returns canned data. Scoring is pure so CI can verify it without a live stack
(see test_agent_eval_harness.py).
"""

import argparse
import asyncio
import html
import json
import os
import sys
import time
from datetime import datetime, timedelta
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND_DIR))

# The live scripts load .env themselves; only app/main.py does it for the server.
from dotenv import load_dotenv  # noqa: E402

load_dotenv(BACKEND_DIR / ".env")

EVAL_SET = Path(__file__).parent / "data" / "agent_eval_set.json"
ASSISTANT_NAME = "Dora"

# What each stubbed tool returns. The eval only replaces tool *bodies*, so the
# canned text mirrors the real formatters (_format_email_row, format_event_rows,
# _format_memo_row, _format_contact in app/agents/tools.py) - the agent picks its
# next step from this text, and a different shape would make it behave
# differently here than it does in production. A case can override any entry.
#
# Dates are relative to the day the eval runs: absolute dates in a goldset rot
# overnight and show up as failures that are really just staleness.
def _tz():
    import zoneinfo

    return zoneinfo.ZoneInfo(os.environ.get("TIMEZONE", "Asia/Shanghai"))


TODAY = datetime.now(_tz()).date()
TOMORROW = TODAY + timedelta(days=1)

CANNED = {
    "list_inbox": (
        f"- [UNREAD] id=AAMkAGI1 from=lina@example.com subject=[季度预算确认](/email/AAMkAGI1?folder=inbox) "
        f"received={TODAY}T09:12:00Z preview='想跟你确认下周的预算数字'\n"
        f"- id=AAMkAGI2 from=wq@example.com subject=[周会纪要](/email/AAMkAGI2?folder=inbox) "
        f"received={TODAY}T08:40:00Z preview='附上昨天的纪要'"
    ),
    "search_emails": (
        f"- id=AAMkAGI1 from=lina@example.com subject=[季度预算确认](/email/AAMkAGI1?folder=inbox) "
        f"received={TODAY}T09:12:00Z preview='想跟你确认下周的预算数字'"
    ),
    "read_email": "From: 李娜 <lina@example.com>\nSubject: 季度预算确认\n\n下周的预算数字麻烦确认一下。",
    "mark_email_read": "Email AAMkAGI1 marked as read.",
    "send_email": "Email sent.",
    "reply_email": "Replied to email AAMkAGI1.",
    "forward_email": "Email forwarded to wang.zong@example.com.",
    "delete_email": "Moved to Deleted Items.",
    "search_contacts": (
        "=== Contact: 李娜 (id=cid-lina) ===\n"
        "Email: lina@example.com | Phone: 138-0000-1111 | Company: 明远科技 | "
        "Job Title: 产品总监 | Location: 深圳\n"
        "[private / preference] tea_preference = 喜欢喝普洱茶 (source: chat)\n"
        "[business / demand] pricing_project = 负责下半年定价项目 (source: note)"
    ),
    "create_contact": "Contact saved.",
    "record_contact_fact": (
        "Successfully recorded memory fact. "
        "Dimensions now in use: basic, business, dynamic, private. "
        "Categories now in use: event, other, preference."
    ),
    "extract_contact_memory": "Extracted 1 profile, 2 facts.",
    "list_events": (
        f"- internal_event_id=AAMkEV1 subject=[产品评审](/calendar/AAMkEV1) "
        f"start={TOMORROW}T10:00:00 end={TOMORROW}T11:00:00 location='会议室 A'"
    ),
    "list_events_on_day": (
        f"- internal_event_id=AAMkEV1 subject=[产品评审](/calendar/AAMkEV1) "
        f"start={TOMORROW}T10:00:00 end={TOMORROW}T11:00:00 location='会议室 A'"
    ),
    "create_event": "Event created.",
    "update_event": "Event updated: 产品评审.",
    "delete_event": "Event deleted: 产品评审.",
    "accept_event": "Accepted.",
    "decline_event": "Declined.",
    "list_memos": (
        "- id=m1 category=ideas title='定价思路': '按席位收费，团队版打包，年付九折。'\n"
        f"- id=m2 category=work title='Daily Report - {TODAY}': '修复邮件路由；更新向量模型'"
    ),
    "search_memos": (
        "- id=m1 category=ideas title='定价思路': '按席位收费，团队版打包，年付九折。'\n"
        f"- id=m2 category=work title='Daily Report - {TODAY}': '修复邮件路由；更新向量模型'"
    ),
    "create_memo": "Memo saved.",
    "list_todays_commits": (
        "friday: fix(mail): route per-message calls by email id\n"
        "friday: refactor(agents): isolate subagents and centralize model providers"
    ),
}

JUDGE_SYSTEM = (
    "You grade one assistant turn against one expectation. Answer with JSON only: "
    '{"pass": true|false, "reason": "<one short sentence>"}. '
    "Judge only the expectation given; ignore style and length otherwise. "
    "You are shown the tools the assistant actually called, so an expectation about "
    "what it looked up is satisfied by the tool chain even when the reply does not "
    "mention it."
)


# --------------------------------------------------------------------------
# scoring - pure functions, unit-tested in test_agent_eval_harness.py
# --------------------------------------------------------------------------
def format_chain(tool_calls: list[dict], with_args: bool = True) -> str:
    """agent.tool(arg=value, ...) for each call, arguments truncated."""
    if not tool_calls:
        return "(no tools)"
    parts = []
    for call in tool_calls:
        text = f"{call['agent']}.{call['tool']}"
        if with_args and call.get("args"):
            args = ", ".join(f"{k}={str(v)[:60]!r}" for k, v in call["args"].items())
            text += f"({args})"
        parts.append(text)
    return " -> ".join(parts)


def score_case(case: dict, trace: dict) -> dict:
    """case + one run's trace -> per-case verdict."""
    agents = set(trace["agents"])
    tools = {call["tool"] for call in trace["tool_calls"]}
    expect_agents = set(case.get("expect_agents", []))
    # extra hops a case tolerates, e.g. resolving a person before sending mail
    agents -= set(case.get("allow_agents", []))
    expect_tools = set(case.get("expect_tools", []))
    forbidden = sorted(tools & set(case.get("forbid_tools", [])))
    missing = sorted(expect_tools - tools)
    judge = trace.get("judge")
    return {
        "id": case["id"],
        "kind": case["kind"],
        "routing_ok": agents == expect_agents,
        "missing_tools": missing,
        "forbidden_called": forbidden,
        "judge_pass": None if judge is None else bool(judge.get("pass")),
        "ok": agents == expect_agents and not missing and not forbidden
        and (judge is None or bool(judge.get("pass"))),
    }


def compute_metrics(scored: list[dict]) -> dict:
    total = len(scored)
    if not total:
        return {"n": 0, "pass_rate": 0.0, "routing_accuracy": 0.0,
                "required_tool_recall": 0.0, "unwanted_write_rate": 0.0, "judge_pass_rate": 0.0}
    judged = [s for s in scored if s["judge_pass"] is not None]
    return {
        "n": total,
        "pass_rate": sum(s["ok"] for s in scored) / total,
        "routing_accuracy": sum(s["routing_ok"] for s in scored) / total,
        "required_tool_recall": sum(not s["missing_tools"] for s in scored) / total,
        # the regression this suite exists for: a write nobody asked for
        "unwanted_write_rate": sum(bool(s["forbidden_called"]) for s in scored) / total,
        "judge_pass_rate": (sum(s["judge_pass"] for s in judged) / len(judged)) if judged else 0.0,
    }


def by_kind(scored: list[dict]) -> dict:
    return {k: compute_metrics([s for s in scored if s["kind"] == k])
            for k in sorted({s["kind"] for s in scored})}


# --------------------------------------------------------------------------
# running one case against the real graph with stubbed tools
# --------------------------------------------------------------------------
def _patch_for_eval(recorder: list, overrides: dict):
    """Swap the three things that would otherwise need a live stack. Tool
    name/description/args_schema stay exactly as production builds them -
    those are what the eval is measuring."""
    from langchain_core.tools import StructuredTool
    from langgraph.checkpoint.memory import InMemorySaver

    from app.agents import supervisor

    real_factories = dict(supervisor._AGENT_TOOL_FACTORIES)

    def stub_factory(agent_name, real):
        def build(user_id, session_id):
            stubs = []
            for t in real(user_id, session_id):
                async def call(_t=t, **kwargs):
                    recorder.append({"agent": agent_name, "tool": _t.name, "args": kwargs})
                    return overrides.get(_t.name, CANNED.get(_t.name, "ok"))
                stubs.append(StructuredTool(
                    name=t.name, description=t.description,
                    args_schema=t.args_schema, coroutine=call,
                ))
            return stubs
        return build

    supervisor._AGENT_TOOL_FACTORIES = {
        name: stub_factory(name, real) for name, real in real_factories.items()
    }
    supervisor.get_checkpointer = lambda: InMemorySaver()
    supervisor.make_hitl_middleware = lambda _names: None
    return real_factories


async def run_case(case: dict, judge_model) -> dict:
    from langchain_core.messages import AIMessage, HumanMessage

    from app.agents import supervisor

    calls: list[dict] = []
    saved = _patch_for_eval(calls, case.get("tool_results", {}))
    try:
        graph = supervisor.build_supervisor(
            user_id=f"eval-{case['id']}", session_id=case["id"], assistant_name=ASSISTANT_NAME
        )
        config = {"configurable": {"thread_id": f"eval-{case['id']}-{time.time()}"}}
        agents, reply, seen = [], "", 0
        for turn in case["turns"]:
            state = await graph.ainvoke({"messages": [HumanMessage(content=turn)]}, config)
            for m in state["messages"][seen:]:
                if isinstance(m, AIMessage):
                    for tc in m.tool_calls or []:
                        name = tc.get("name", "")
                        if name.startswith("delegate_to_"):
                            agents.append(name[len("delegate_to_"):])
            seen = len(state["messages"])
            reply = state["messages"][-1].content
    finally:
        supervisor._AGENT_TOOL_FACTORIES = saved

    trace = {"agents": agents, "tool_calls": calls, "reply": reply if isinstance(reply, str) else str(reply)}
    if case.get("rubric") and judge_model is not None:
        trace["judge"] = await _judge(judge_model, case, trace)
    return trace


async def _judge(model, case: dict, trace: dict) -> dict:
    chain = format_chain(trace["tool_calls"])
    prompt = (
        f"Today is {TODAY} ({TODAY.strftime('%A')}).\n\n"
        f"User said: {case['turns'][-1]}\n\n"
        f"Expectation: {case['rubric']}\n\n"
        f"Tools the assistant called: {chain}\n\n"
        f"Assistant reply:\n{trace['reply']}"
    )
    try:
        resp = await model.ainvoke(
            [{"role": "system", "content": JUDGE_SYSTEM}, {"role": "user", "content": prompt}]
        )
        text = resp.content.strip().removeprefix("```json").removeprefix("```").removesuffix("```")
        return json.loads(text)
    except Exception as exc:  # a judge that fails must not look like a pass
        return {"pass": False, "reason": f"judge error: {exc}"}


# --------------------------------------------------------------------------
# report
# --------------------------------------------------------------------------
def render_html(cases: list[dict], traces: list[dict], scored: list[dict], meta: dict) -> str:
    e = html.escape
    overall = compute_metrics(scored)
    tiles = [("pass", overall["pass_rate"]), ("routing", overall["routing_accuracy"]),
             ("tool recall", overall["required_tool_recall"]), ("judge", overall["judge_pass_rate"]),
             ("unwanted writes", overall["unwanted_write_rate"])]
    def bad(label, v):
        return v > 0 if label == "unwanted writes" else v < 1

    tile_html = "".join(
        f'<div class="tile{" bad" if bad(label, v) else ""}">'
        f'<b>{v:.0%}</b><span>{e(label)}</span></div>' for label, v in tiles
    )
    kind_rows = "".join(
        f"<tr><td>{e(k)}</td><td>{m['n']}</td><td>{m['pass_rate']:.0%}</td>"
        f"<td>{m['routing_accuracy']:.0%}</td><td>{m['required_tool_recall']:.0%}</td>"
        f"<td>{m['judge_pass_rate']:.0%}</td><td>{m['unwanted_write_rate']:.0%}</td></tr>"
        for k, m in by_kind(scored).items()
    )

    rows = []
    for case, trace, s in zip(cases, traces, scored, strict=False):
        problems = []
        if not s["routing_ok"]:
            problems.append(f"routed to {trace['agents'] or ['(none)']}, expected {case.get('expect_agents') or ['(none)']}")
        if s["missing_tools"]:
            problems.append("never called " + ", ".join(s["missing_tools"]))
        if s["forbidden_called"]:
            problems.append("unwanted write: " + ", ".join(s["forbidden_called"]))
        if s["judge_pass"] is False:
            problems.append("judge: " + trace.get("judge", {}).get("reason", ""))
        chain = format_chain(trace["tool_calls"])
        rows.append(
            f'<details class="case {"ok" if s["ok"] else "fail"}">'
            f'<summary><span class="dot"></span><code>{e(case["id"])}</code>'
            f'<span class="kind">{e(case["kind"])}</span>'
            f'<span class="why">{e("; ".join(problems))}</span></summary>'
            f'<div class="body"><p class="turns">{e(" ⏎ ".join(case["turns"]))}</p>'
            f'<p class="chain">{e(chain)}</p>'
            f'<pre>{e(trace["reply"])}</pre>'
            f'<p class="rubric">{e(case.get("rubric", ""))}</p></div></details>'
        )

    return f"""<title>Agent Behaviour Eval</title>
<style>
:root {{ --bg:#fff; --fg:#1a1a1a; --mut:#666; --line:#e5e5e5; --ok:#16794a; --bad:#c0392b; --card:#fafafa; }}
:root:not([data-theme="light"]) {{ }}
@media (prefers-color-scheme: dark) {{ :root:not([data-theme="light"]) {{ --bg:#131313; --fg:#eee; --mut:#999; --line:#2c2c2c; --ok:#4ade80; --bad:#f87171; --card:#1c1c1c; }} }}
:root[data-theme="dark"] {{ --bg:#131313; --fg:#eee; --mut:#999; --line:#2c2c2c; --ok:#4ade80; --bad:#f87171; --card:#1c1c1c; }}
body {{ background:var(--bg); color:var(--fg); font:15px/1.6 ui-sans-serif,system-ui,"PingFang SC",sans-serif; margin:0 auto; padding:2rem 1.25rem; max-width:60rem; }}
h1 {{ font-size:1.4rem; margin:0 0 .25rem; }} .meta {{ color:var(--mut); font-size:.85rem; margin:0 0 1.5rem; }}
.tiles {{ display:flex; gap:.75rem; flex-wrap:wrap; margin-bottom:1.5rem; }}
.tile {{ flex:1 1 8rem; background:var(--card); border:1px solid var(--line); border-radius:.6rem; padding:.75rem .9rem; }}
.tile b {{ display:block; font-size:1.5rem; color:var(--ok); }} .tile.bad b {{ color:var(--bad); }}
.tile span {{ color:var(--mut); font-size:.8rem; }}
table {{ width:100%; border-collapse:collapse; margin-bottom:2rem; font-size:.9rem; }}
th,td {{ text-align:left; padding:.4rem .5rem; border-bottom:1px solid var(--line); }} th {{ color:var(--mut); font-weight:500; }}
.case {{ border:1px solid var(--line); border-radius:.6rem; margin-bottom:.5rem; background:var(--card); }}
summary {{ cursor:pointer; padding:.6rem .8rem; display:flex; align-items:center; gap:.6rem; flex-wrap:wrap; }}
.dot {{ width:.55rem; height:.55rem; border-radius:50%; background:var(--ok); flex:none; }}
.fail .dot {{ background:var(--bad); }}
code {{ font:.85rem ui-monospace,monospace; }}
.kind {{ color:var(--mut); font-size:.78rem; border:1px solid var(--line); border-radius:1rem; padding:0 .5rem; }}
.why {{ color:var(--bad); font-size:.82rem; }}
.body {{ padding:0 .8rem .8rem; border-top:1px solid var(--line); }}
.turns {{ font-weight:600; }} .chain {{ font:.85rem ui-monospace,monospace; color:var(--mut); overflow-x:auto; }}
.rubric {{ color:var(--mut); font-size:.85rem; }}
pre {{ background:var(--bg); border:1px solid var(--line); border-radius:.4rem; padding:.7rem; white-space:pre-wrap; font-size:.88rem; }}
</style>
<h1>Agent Behaviour Eval</h1>
<p class="meta">{e(meta['model'])} · {overall['n']} cases · {meta['elapsed']:.0f}s · {e(meta['when'])}</p>
<div class="tiles">{tile_html}</div>
<table><tr><th>kind</th><th>n</th><th>pass</th><th>routing</th><th>tool recall</th><th>judge</th><th>unwanted writes</th></tr>{kind_rows}</table>
{"".join(rows)}
"""


async def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("-o", "--out", default=str(Path(__file__).parent / "agent_eval_report.html"))
    parser.add_argument("--only", help="run one kind, or one case id")
    parser.add_argument("--no-judge", action="store_true", help="skip the LLM judge")
    args = parser.parse_args()

    cases = json.loads(EVAL_SET.read_text())["cases"]
    if args.only:
        cases = [c for c in cases if args.only in (c["id"], c["kind"])]
    if not cases:
        print("no cases matched --only")
        return 2

    from app.core.config import settings
    from app.core.llm import make_chat_model

    judge = None if args.no_judge else make_chat_model(temperature=0, timeout=60.0)
    started = time.time()
    traces = []
    for i, case in enumerate(cases, 1):
        print(f"[{i}/{len(cases)}] {case['id']} ...", flush=True)
        traces.append(await run_case(case, judge))
    scored = [score_case(c, t) for c, t in zip(cases, traces, strict=False)]

    overall = compute_metrics(scored)
    print(f"\n== overall (n={overall['n']}) ==")
    for key in ("pass_rate", "routing_accuracy", "required_tool_recall", "judge_pass_rate", "unwanted_write_rate"):
        print(f"  {key:<22} {overall[key]:.3f}")
    for s in scored:
        if not s["ok"]:
            print(f"  FAIL {s['id']}: routing_ok={s['routing_ok']} missing={s['missing_tools']} "
                  f"forbidden={s['forbidden_called']} judge={s['judge_pass']}")

    meta = {"model": settings.OPENAI_MODEL, "elapsed": time.time() - started,
            "when": time.strftime("%Y-%m-%d %H:%M")}
    Path(args.out).write_text(render_html(cases, traces, scored, meta))
    print(f"\nreport: {args.out}")
    return 0 if overall["pass_rate"] == 1.0 else 1


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
