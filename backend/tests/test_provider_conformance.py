#!/usr/bin/env python3

import os
import sys
import unittest

backend_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
sys.path.insert(0, backend_dir)

from langchain_core.messages import AIMessage, HumanMessage, ToolMessage  # noqa: E402
from langchain_core.tools import tool  # noqa: E402

from app.core.config import settings  # noqa: E402
from app.core.llm import make_chat_model  # noqa: E402


@tool
def conformance_alpha(value: str) -> str:
    """Return the supplied value through the alpha test tool."""
    return value


@tool
def conformance_beta(value: str) -> str:
    """Return the supplied value through the beta test tool."""
    return value


def _tool_names(message: AIMessage) -> set[str]:
    return {call.get("name", "") for call in message.tool_calls}


@unittest.skipUnless(settings.OPENAI_API_KEY, "OPENAI_API_KEY is not configured")
class TestProviderConformance(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.model = make_chat_model(
            temperature=0,
            timeout=60,
            max_retries=0,
            max_tokens=64,
        )
        cls.tools = [conformance_alpha, conformance_beta]

    def test_named_tool_choice_is_honored(self):
        response = self.model.bind_tools(
            self.tools,
            tool_choice={
                "type": "function",
                "function": {"name": "conformance_beta"},
            },
        ).invoke("Call the selected tool with value 'named'.")
        self.assertEqual(_tool_names(response), {"conformance_beta"})

    def test_message_name_is_accepted(self):
        response = self.model.invoke(
            [
                HumanMessage(content="Remember this greeting."),
                AIMessage(content="Greeting remembered.", name="conformance_agent"),
                HumanMessage(content="Reply with OK."),
            ]
        )
        self.assertIsInstance(response, AIMessage)

    def test_foreign_tool_pair_does_not_disable_named_choice(self):
        messages = [
            HumanMessage(content="Run an earlier unrelated operation."),
            AIMessage(
                content="",
                tool_calls=[
                    {
                        "name": "unbound_historical_tool",
                        "args": {"value": "old"},
                        "id": "foreign-call-1",
                        "type": "tool_call",
                    }
                ],
            ),
            ToolMessage(
                content="Earlier operation complete.",
                name="unbound_historical_tool",
                tool_call_id="foreign-call-1",
            ),
        ]
        response = self.model.bind_tools(
            self.tools,
            tool_choice={
                "type": "function",
                "function": {"name": "conformance_alpha"},
            },
        ).invoke(messages)
        self.assertEqual(_tool_names(response), {"conformance_alpha"})

    def test_required_survives_plain_text_history(self):
        messages = []
        for index in range(4):
            messages.extend(
                [
                    HumanMessage(content=f"Conversation turn {index}."),
                    AIMessage(content=f"Plain text answer {index}."),
                ]
            )
        messages.append(HumanMessage(content="Use one available tool with value 'required'."))
        response = self.model.bind_tools(self.tools, tool_choice="required").invoke(messages)
        self.assertTrue(response.tool_calls)
        self.assertTrue(_tool_names(response) <= {"conformance_alpha", "conformance_beta"})


if __name__ == "__main__":
    unittest.main(verbosity=2)
