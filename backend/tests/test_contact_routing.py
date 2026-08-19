#!/usr/bin/env python3

import os
import sys
import unittest

backend_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
sys.path.insert(0, backend_dir)

from langchain_core.messages import AIMessage, HumanMessage, ToolMessage

from app.agents.context import (
    _drop_historical_ai_text,
    _strip_foreign_tool_pairs,
    _WRITE_GUARDS,
    contact_tool_choice,
    verify_contact_claims,
)
from app.agents.routing import is_contact_lookup_request, is_contact_write_request


class TestContactLookupVsFactDetection(unittest.TestCase):
    def test_question_phrasing_is_lookup(self):
        for message in ["张明是谁", "查一下张明", "who is Zhang Ming", "谁喜欢喝普洱茶"]:
            self.assertTrue(is_contact_lookup_request(message), message)

    def test_narrated_fact_is_not_lookup_or_explicit_create(self):
        message = "昨天我和他聊天 听他说他上周五考了一个阿里云大模型ACP认证"
        self.assertFalse(is_contact_lookup_request(message))
        self.assertFalse(is_contact_write_request(message))

    def test_explicit_create_phrasing(self):
        self.assertTrue(is_contact_write_request("帮我添加联系人，姓名张三"))


class TestContactToolChoice(unittest.TestCase):
    def _handoff_tail(self):
        return [
            AIMessage(content="", tool_calls=[{"name": "transfer_to_contact_agent", "args": {}, "id": "call_1"}]),
            ToolMessage(content="Successfully transferred to contact_agent", name="transfer_to_contact_agent", tool_call_id="call_1"),
        ]

    def test_lookup_question_stays_auto(self):
        messages = [HumanMessage(content="张明是谁"), *self._handoff_tail()]
        self.assertEqual(contact_tool_choice(messages), "auto")

    def test_narrated_fact_forces_a_tool(self):
        messages = [
            HumanMessage(content="昨天我和他聊天 听他说他上周五考了一个阿里云大模型ACP认证"),
            *self._handoff_tail(),
        ]
        self.assertEqual(contact_tool_choice(messages), "required")

    def test_stops_forcing_once_a_write_tool_ran(self):
        messages = [
            HumanMessage(content="昨天我和他聊天 听他说他上周五考了一个阿里云大模型ACP认证"),
            *self._handoff_tail(),
            AIMessage(content="", tool_calls=[{"name": "record_contact_fact", "args": {}, "id": "call_2"}]),
            ToolMessage(content="Successfully recorded memory fact for 罗剑", name="record_contact_fact", tool_call_id="call_2"),
        ]
        self.assertEqual(contact_tool_choice(messages), "none")


class TestStripForeignToolPairs(unittest.TestCase):
    def test_drops_handoff_pair_not_in_bound_tools(self):
        messages = [
            HumanMessage(content="hi"),
            AIMessage(content="", tool_calls=[{"name": "transfer_to_contact_agent", "args": {}, "id": "call_1"}]),
            ToolMessage(content="ok", name="transfer_to_contact_agent", tool_call_id="call_1"),
        ]
        stripped = _strip_foreign_tool_pairs(messages, {"create_contact", "record_contact_fact"})
        self.assertEqual([type(m).__name__ for m in stripped], ["HumanMessage"])

    def test_keeps_bound_tool_call_and_result(self):
        messages = [
            HumanMessage(content="hi"),
            AIMessage(content="", tool_calls=[{"name": "record_contact_fact", "args": {}, "id": "call_1"}]),
            ToolMessage(content="ok", name="record_contact_fact", tool_call_id="call_1"),
        ]
        stripped = _strip_foreign_tool_pairs(messages, {"create_contact", "record_contact_fact"})
        self.assertEqual(len(stripped), 3)


class TestDropHistoricalAiText(unittest.TestCase):
    def test_drops_ai_replies_from_completed_turns_keeps_human_turns_and_active_turn(self):
        messages = [
            HumanMessage(content="name:罗剑\ncompany:hkuszri"),
            AIMessage(content="Contact '罗剑' added successfully."),
            HumanMessage(content="他的邮箱是 x@y.com"),
            AIMessage(content="Updated."),
            HumanMessage(content="他喜欢吃西瓜"),
        ]
        result = _drop_historical_ai_text(messages)
        self.assertEqual(
            [(type(m).__name__, m.content) for m in result],
            [
                ("HumanMessage", "name:罗剑\ncompany:hkuszri"),
                ("HumanMessage", "他的邮箱是 x@y.com"),
                ("HumanMessage", "他喜欢吃西瓜"),
            ],
        )


class TestVerifyClaimsRetryCap(unittest.TestCase):
    """A sub-agent stuck ignoring tool_choice can keep repeating the same
    false "done" claim forever; verify_contact_claims must stop forcing a
    retry after _WRITE_GUARDS["contact_agent"]'s cap instead of looping."""

    def _forced_handoff(self, n):
        return AIMessage(
            content="",
            tool_calls=[
                {"name": "transfer_to_contact_agent", "args": {}, "id": f"forced_contact_agent_verify_{n}"}
            ],
        )

    def _claim_message(self):
        return AIMessage(content="联系人张三已成功添加。")

    def test_forces_retry_below_cap(self):
        messages = [HumanMessage(content="帮我建个联系人张三"), self._forced_handoff(1), self._claim_message()]
        result = verify_contact_claims({"messages": messages})
        self.assertIn("messages", result)

    def test_stops_forcing_once_cap_reached(self):
        messages = [
            HumanMessage(content="帮我建个联系人张三"),
            self._forced_handoff(1),
            self._forced_handoff(2),
            self._claim_message(),
        ]
        self.assertEqual(verify_contact_claims({"messages": messages}), {})


class TestRequireWriteToolNeverEmptiesMessages(unittest.TestCase):
    def test_stripping_a_foreign_pair_never_drops_the_human_message(self):
        # Regression: on the endpoint used in this deployment, a payload with
        # no human turn at all returned HTTP 400. Confirm the guard's own
        # pipeline (strip -> maybe drop historical AI text) can't produce one
        # for a normal single-turn call.
        guard = _WRITE_GUARDS["contact_agent"]
        messages = [
            HumanMessage(content="name:罗剑\ncompany:hkuszri"),
            AIMessage(content="", tool_calls=[{"name": "transfer_to_contact_agent", "args": {}, "id": "call_1"}]),
            ToolMessage(content="ok", name="transfer_to_contact_agent", tool_call_id="call_1"),
        ]
        stripped = _strip_foreign_tool_pairs(messages, {"create_contact", "record_contact_fact"})
        trimmed = _drop_historical_ai_text(stripped)
        self.assertTrue(any(isinstance(m, HumanMessage) for m in trimmed))


if __name__ == "__main__":
    unittest.main()
