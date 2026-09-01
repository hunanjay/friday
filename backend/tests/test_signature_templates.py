#!/usr/bin/env python3
"""Tests for named signature templates.

Runs against a disposable database only:

    SIGNATURES_TEST_DB_URL=postgresql://.../friday_test python tests/test_signature_templates.py
"""

import os
import sys
import unittest
import uuid
from unittest.mock import patch
from urllib.parse import urlparse

from psycopg_pool import AsyncConnectionPool

backend_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
sys.path.insert(0, backend_dir)

from app.infrastructure.db.repositories import signature_templates
from app.services.mail_compose import apply_signature

TEST_DB_URL = os.environ.get("SIGNATURES_TEST_DB_URL")


class TestApplySignature(unittest.TestCase):
    """No database needed - the body-shaping rule is pure."""

    def test_appends_after_a_blank_line(self):
        self.assertEqual(apply_signature("hi", "-- Jane"), "hi\n\n-- Jane")

    def test_is_idempotent_so_an_edited_card_is_not_double_signed(self):
        once = apply_signature("hi", "-- Jane")
        self.assertEqual(apply_signature(once, "-- Jane"), once)

    def test_empty_signature_leaves_the_body_alone(self):
        self.assertEqual(apply_signature("hi\r\nthere", "  "), "hi\nthere")


@unittest.skipUnless(TEST_DB_URL, "SIGNATURES_TEST_DB_URL is not configured")
class TestSignatureTemplates(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        database_name = urlparse(TEST_DB_URL).path.removeprefix("/")
        if "test" not in database_name.casefold():
            raise RuntimeError("SIGNATURES_TEST_DB_URL must point to a disposable test database")
        self.pool = AsyncConnectionPool(TEST_DB_URL, open=False, min_size=1, max_size=4)
        await self.pool.open()
        async with self.pool.connection() as conn:
            await conn.execute("drop table if exists signature_templates")
            await conn.execute(signature_templates._SCHEMA)
        self.user = f"u-{uuid.uuid4().hex}"
        self.patcher = patch.object(signature_templates, "get_pool", return_value=self.pool)
        self.patcher.start()

    async def asyncTearDown(self):
        self.patcher.stop()
        await self.pool.close()

    async def _create(self, name, content):
        return await signature_templates.create_template(self.user, name, content)

    async def test_first_template_becomes_the_default(self):
        first = await self._create("Work", "-- Jane, Acme")
        self.assertTrue(first["is_default"])
        second = await self._create("Personal", "-- Jane")
        self.assertFalse(second["is_default"])
        self.assertEqual(await signature_templates.get_default_content(self.user), "-- Jane, Acme")

    async def test_switching_the_default_changes_what_mail_is_signed_with(self):
        await self._create("Work", "-- Jane, Acme")
        personal = await self._create("Personal", "-- Jane")
        self.assertTrue(await signature_templates.set_default(self.user, personal["id"]))
        self.assertEqual(await signature_templates.get_default_content(self.user), "-- Jane")
        defaults = [t for t in await signature_templates.list_templates(self.user) if t["is_default"]]
        self.assertEqual(len(defaults), 1)

    async def test_deleting_the_default_promotes_the_oldest_survivor(self):
        work = await self._create("Work", "-- Jane, Acme")
        await self._create("Personal", "-- Jane")
        self.assertTrue(await signature_templates.delete_template(self.user, work["id"]))
        # Never leave a user with templates but nothing signing their mail.
        self.assertEqual(await signature_templates.get_default_content(self.user), "-- Jane")

    async def test_deleting_the_last_template_leaves_no_signature(self):
        only = await self._create("Work", "-- Jane")
        await signature_templates.delete_template(self.user, only["id"])
        self.assertEqual(await signature_templates.get_default_content(self.user), "")
        self.assertEqual(await signature_templates.list_templates(self.user), [])

    async def test_another_users_template_is_neither_readable_nor_mutable(self):
        mine = await self._create("Work", "-- Jane")
        stranger = f"u-{uuid.uuid4().hex}"
        self.assertEqual(await signature_templates.get_default_content(stranger), "")
        self.assertIsNone(await signature_templates.update_template(stranger, mine["id"], "x", "y"))
        self.assertFalse(await signature_templates.set_default(stranger, mine["id"]))
        self.assertFalse(await signature_templates.delete_template(stranger, mine["id"]))
        self.assertEqual(await signature_templates.get_default_content(self.user), "-- Jane")

    async def test_defaults_are_per_user(self):
        await self._create("Work", "-- Jane")
        other = f"u-{uuid.uuid4().hex}"
        await signature_templates.create_template(other, "Theirs", "-- Sam")
        self.assertEqual(await signature_templates.get_default_content(self.user), "-- Jane")
        self.assertEqual(await signature_templates.get_default_content(other), "-- Sam")

    async def test_listing_puts_the_default_first(self):
        await self._create("Work", "-- Jane, Acme")
        personal = await self._create("Personal", "-- Jane")
        await signature_templates.set_default(self.user, personal["id"])
        names = [t["name"] for t in await signature_templates.list_templates(self.user)]
        self.assertEqual(names, ["Personal", "Work"])

    async def test_missing_template_reports_not_found(self):
        self.assertFalse(await signature_templates.set_default(self.user, str(uuid.uuid4())))
        self.assertFalse(await signature_templates.delete_template(self.user, str(uuid.uuid4())))


if __name__ == "__main__":
    unittest.main(verbosity=2)
