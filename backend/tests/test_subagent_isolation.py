#!/usr/bin/env python3

import os
import sys
import unittest

backend_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
sys.path.insert(0, backend_dir)

for variable, fallback in (
    ("SUPABASE_URL", "https://test.supabase.co"),
    ("SUPABASE_ANON_KEY", "test-anon-key"),
    ("SUPABASE_SERVICE_ROLE_KEY", "test-service-key"),
):
    os.environ[variable] = os.environ.get(variable) or fallback

from langchain.agents import create_agent  # noqa: E402
from langchain.agents.middleware import HumanInTheLoopMiddleware  # noqa: E402
from langchain_core.language_models.fake_chat_models import FakeMessagesListChatModel  # noqa: E402
from langchain_core.messages import AIMessage, HumanMessage  # noqa: E402
from langchain_core.tools import tool  # noqa: E402
from langgraph.checkpoint.memory import InMemorySaver  # noqa: E402
from langgraph.types import Command  # noqa: E402

from app.agents.supervisor import (  # noqa: E402
    _delegation_tool,
    _parent_entry,
    _trim_history_middleware,
)


class _CapturingSubagent:
    def __init__(self):
        self.input = None

    async def ainvoke(self, value):
        self.input = value
        return {"messages": [*value["messages"], AIMessage(content="isolated result")]}


class _ToolCallingFakeModel(FakeMessagesListChatModel):
    def bind_tools(self, _tools, **_kwargs):
        return self


class TestSubagentIsolation(unittest.IsolatedAsyncioTestCase):
    async def test_parent_history_middleware_accepts_runtime(self):
        graph = create_agent(
            FakeMessagesListChatModel(responses=[AIMessage(content="hello")]),
            tools=[],
            middleware=[_trim_history_middleware],
        )
        result = await graph.ainvoke({"messages": [HumanMessage(content="hello")]})
        self.assertEqual(result["messages"][-1].content, "hello")

    async def test_delegate_passes_only_a_fresh_human_task(self):
        subagent = _CapturingSubagent()
        delegate = _delegation_tool("contact_agent", subagent)

        result = await delegate.ainvoke({"task": "Look up the selected contact."})

        self.assertEqual(result, "isolated result")
        self.assertEqual(len(subagent.input["messages"]), 1)
        self.assertIsInstance(subagent.input["messages"][0], HumanMessage)
        self.assertEqual(subagent.input["messages"][0].content, "Look up the selected contact.")

    async def test_task_schema_requires_self_contained_context(self):
        delegate = _delegation_tool("contact_agent", _CapturingSubagent())
        description = delegate.args_schema.model_json_schema()["properties"]["task"]["description"]
        self.assertIn("self-contained", description)
        self.assertIn("pronouns", description)

    async def test_preseeded_slash_call_enters_tools(self):
        state = {
            "messages": [
                HumanMessage(content="Look up the contact."),
                AIMessage(
                    content="",
                    tool_calls=[
                        {
                            "name": "delegate_to_contact_agent",
                            "args": {"task": "Look up the contact."},
                            "id": "slash-1",
                            "type": "tool_call",
                        }
                    ],
                ),
            ]
        }
        self.assertEqual(_parent_entry(state), "tools")

    async def test_nested_hitl_interrupt_resumes_through_parent(self):
        executions = []

        @tool
        async def protected_write(value: str) -> str:
            """Write a protected test value."""
            executions.append(value)
            return f"wrote {value}"

        subagent = create_agent(
            _ToolCallingFakeModel(
                responses=[
                    AIMessage(
                        content="",
                        tool_calls=[
                            {
                                "name": "protected_write",
                                "args": {"value": "approved"},
                                "id": "write-1",
                                "type": "tool_call",
                            }
                        ],
                    ),
                    AIMessage(content="subagent complete"),
                ]
            ),
            tools=[protected_write],
            middleware=[
                HumanInTheLoopMiddleware(
                    interrupt_on={
                        "protected_write": {"allowed_decisions": ["approve", "reject"]}
                    }
                )
            ],
        )
        delegate = _delegation_tool("contact_agent", subagent)
        parent = create_agent(
            _ToolCallingFakeModel(
                responses=[
                    AIMessage(
                        content="",
                        tool_calls=[
                            {
                                "name": "delegate_to_contact_agent",
                                "args": {"task": "Write the approved value."},
                                "id": "delegate-1",
                                "type": "tool_call",
                            }
                        ],
                    ),
                    AIMessage(content="parent complete"),
                ]
            ),
            tools=[delegate],
            checkpointer=InMemorySaver(),
        )
        config = {"configurable": {"thread_id": "nested-hitl-test"}}

        await parent.ainvoke({"messages": [HumanMessage(content="write")]}, config)
        paused = await parent.aget_state(config)
        self.assertEqual(executions, [])
        self.assertEqual(len(paused.interrupts), 1)

        interrupt = paused.interrupts[0]
        await parent.ainvoke(
            Command(
                resume={
                    interrupt.id: {"decisions": [{"type": "approve"}]},
                }
            ),
            config,
        )
        resumed = await parent.aget_state(config)
        self.assertEqual(executions, ["approved"])
        self.assertEqual(resumed.interrupts, ())


if __name__ == "__main__":
    unittest.main(verbosity=2)
