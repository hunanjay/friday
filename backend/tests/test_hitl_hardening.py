#!/usr/bin/env python3

import os
import sys
import unittest
from unittest.mock import patch

backend_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
sys.path.insert(0, backend_dir)

from langchain_core.messages import ToolMessage
from langgraph.types import Interrupt

from app.agents.hitl import approved_tool_error
from app.infrastructure.db.repositories import hitl_audit


class _Cursor:
    def __init__(self, row=None):
        self.row = row

    async def fetchone(self):
        return self.row


class _Connection:
    def __init__(self, rows):
        self.rows = iter(rows)
        self.statements = []

    async def execute(self, sql, params=()):
        self.statements.append((sql, params))
        return _Cursor(next(self.rows, None))


class _ConnectionContext:
    def __init__(self, connection):
        self.connection = connection

    async def __aenter__(self):
        return self.connection

    async def __aexit__(self, _exc_type, _exc, _tb):
        return False


class _Pool:
    def __init__(self, connection):
        self._connection = connection

    def connection(self):
        return _ConnectionContext(self._connection)


class TestHitlAtomicClaim(unittest.IsolatedAsyncioTestCase):
    async def test_first_pending_claim_wins(self):
        connection = _Connection([None, ("executing",)])
        with patch.object(hitl_audit, "get_pool", return_value=_Pool(connection)):
            status = await hitl_audit.claim_action(
                "user-1", "00000000-0000-0000-0000-000000000001", "action-1", "approve"
            )

        self.assertEqual(status, "claimed")
        self.assertIn("status = 'pending'", connection.statements[1][0])

    async def test_second_claim_observes_existing_executor(self):
        connection = _Connection([None, None, ("executing",)])
        with patch.object(hitl_audit, "get_pool", return_value=_Pool(connection)):
            status = await hitl_audit.claim_action(
                "user-1", "00000000-0000-0000-0000-000000000001", "action-1", "approve"
            )

        self.assertEqual(status, "executing")

    async def test_expired_claim_is_not_reopened(self):
        connection = _Connection([None, None, ("expired",)])
        with patch.object(hitl_audit, "get_pool", return_value=_Pool(connection)):
            status = await hitl_audit.claim_action(
                "user-1", "00000000-0000-0000-0000-000000000001", "action-1", "approve"
            )

        self.assertEqual(status, "expired")

    async def test_finish_only_updates_the_claimed_executor(self):
        connection = _Connection([("action-1",)])
        action = {"id": "action-1", "payload": {}}
        with patch.object(hitl_audit, "get_pool", return_value=_Pool(connection)):
            await hitl_audit.finish_action(
                "user-1",
                "00000000-0000-0000-0000-000000000001",
                action,
                "succeeded",
            )

        self.assertIn("status = 'executing'", connection.statements[0][0])


class TestApprovedExecutionResult(unittest.TestCase):
    def setUp(self):
        self.interrupt = Interrupt(
            {
                "action_requests": [{"name": "send_email", "args": {}}],
                "review_configs": [],
            },
            id="interrupt-1",
        )

    def test_success_requires_a_new_successful_tool_message(self):
        result = ToolMessage(
            content="Email sent.",
            name="send_email",
            tool_call_id="call-new",
            status="success",
        )
        self.assertIsNone(approved_tool_error(self.interrupt, [result]))

    def test_error_tool_message_marks_execution_failed(self):
        result = ToolMessage(
            content="Microsoft account is not connected",
            name="send_email",
            tool_call_id="call-new",
            status="error",
        )
        self.assertEqual(
            approved_tool_error(self.interrupt, [result]),
            "Microsoft account is not connected",
        )

    def test_missing_tool_result_is_not_reported_as_success(self):
        self.assertIn("verifiable", approved_tool_error(self.interrupt, []))

    def test_nested_tool_event_counts_as_execution_result(self):
        self.assertIsNone(
            approved_tool_error(
                self.interrupt,
                [
                    {
                        "name": "send_email",
                        "tool_call_id": "event-result-1",
                        "status": "success",
                        "content": "Email sent.",
                    }
                ],
            )
        )


if __name__ == "__main__":
    unittest.main()
