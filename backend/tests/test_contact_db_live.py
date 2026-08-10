#!/usr/bin/env python3
"""
Live PostgreSQL Integration Test for Friday Contact Relationship Brain.
Tests against actual PostgreSQL instance (localhost:5438).
"""

import os
import sys
import unittest
import uuid

backend_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
sys.path.insert(0, backend_dir)

try:
    from dotenv import load_dotenv
    load_dotenv(os.path.join(backend_dir, ".env"))
except ImportError:
    pass

os.environ["CHECKPOINT_DB_URL"] = "postgresql://friday:friday@localhost:5438/friday"

from app.infrastructure.db.pool import close_db_pool, init_db_pool
from app.infrastructure.db.repositories import contacts as contacts_repo
from app.services.contact_service import ContactService


class TestContactLivePostgres(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.user_id = f"test-user-{uuid.uuid4()}"
        self.pool = await init_db_pool()
        if self.pool is None:
            self.skipTest("Database pool not available")
        await contacts_repo.init_schema()

    async def asyncTearDown(self):
        if self.pool:
            async with self.pool.connection() as conn:
                await conn.execute("DELETE FROM contacts WHERE user_id = %s", (self.user_id,))
            await close_db_pool()

    async def test_live_contact_full_lifecycle(self):
        print(f"\n[Live DB] Testing Full Contact Lifecycle for User: {self.user_id}")

        # 1. Create Contact
        contact = await ContactService.create_contact(
            user_id=self.user_id,
            name="张明",
            email="zhangming@huachuang.com",
            phone="13800138000",
            company="华创资本",
            job_title="主管合伙人",
            location="北京"
        )
        contact_id = contact["id"]
        self.assertIsNotNone(contact_id)
        self.assertEqual(contact["name"], "张明")
        print("  ✓ 1. Contact created successfully:", contact_id)

        # 2. Add 4-Dimension Atomic Facts (Profiles)
        p1 = await contacts_repo.add_contact_profile(
            user_id=self.user_id,
            contact_id=contact_id,
            dimension="business",
            category="demand",
            fact_key="investment_focus",
            fact_value="重点关注医疗器械和AI Infra投资"
        )
        p2 = await contacts_repo.add_contact_profile(
            user_id=self.user_id,
            contact_id=contact_id,
            dimension="private",
            category="preference",
            fact_key="tea_preference",
            fact_value="只喝2010年以前的老班章普洱茶"
        )
        await contacts_repo.add_contact_profile(
            user_id=self.user_id,
            contact_id=contact_id,
            dimension="dynamic",
            category="event",
            fact_key="trip_plan",
            fact_value="下周二下午从上海飞北京参加闭门会"
        )
        await contacts_repo.add_contact_profile(
            user_id=self.user_id,
            contact_id=contact_id,
            dimension="basic",
            category="family",
            fact_key="hometown",
            fact_value="湖南长沙"
        )
        self.assertIsNotNone(p1["id"])
        self.assertIsNotNone(p2["id"])
        print("  ✓ 2. 4-Dimension Facts inserted into contact_profiles (Business, Private, Dynamic, Basic)")

        # 3. Add Tags
        await contacts_repo.add_contact_tag(self.user_id, contact_id, "医疗", "industry")
        await contacts_repo.add_contact_tag(self.user_id, contact_id, "投资人", "role")
        await contacts_repo.add_contact_tag(self.user_id, contact_id, "华创资本", "company")
        print("  ✓ 3. Structured tags attached to contact_tags")

        # 4. Add Interaction Timeline
        interaction = await contacts_repo.add_contact_interaction(
            user_id=self.user_id,
            contact_id=contact_id,
            source_type="chat_paste",
            summary="微信对话中讨论了医疗AI项目投资计划",
            raw_snippet="张总：我们最近在看医疗大模型..."
        )
        self.assertIsNotNone(interaction["id"])
        print("  ✓ 4. Interaction timeline saved")

        # 5. Fetch Full Contact & Verify aggregation
        full_contact = await ContactService.get_contact_by_id(self.user_id, contact_id)
        self.assertEqual(len(full_contact["profiles"]), 4)
        self.assertEqual(set(full_contact["tags"]), {"医疗", "投资人", "华创资本"})
        self.assertEqual(len(full_contact["timeline"]), 1)
        print("  ✓ 5. Full contact record correctly joined profiles, tags, and timeline")

        # 6. Test Search & Tag Filtering
        # 6a. Search by company
        search_company = await ContactService.get_contacts(self.user_id, query="华创")
        self.assertEqual(len(search_company), 1)
        self.assertEqual(search_company[0]["id"], contact_id)

        # 6b. Search by tag
        search_tag = await ContactService.get_contacts(self.user_id, tag="投资人")
        self.assertEqual(len(search_tag), 1)
        self.assertEqual(search_tag[0]["name"], "张明")

        # 6c. Get all distinct tags
        all_tags = await contacts_repo.get_all_user_tags(self.user_id)
        self.assertEqual(set(all_tags), {"华创资本", "医疗", "投资人"})
        print("  ✓ 6. Search by name/company and tag filtering verified")

        # 7. Test MS Graph incremental sync simulation
        updated_c, is_new = await contacts_repo.upsert_contact_from_microsoft(
            user_id=self.user_id,
            outlook_contact_id="ms-mock-uuid-999",
            name="张明 (MS Sync)",
            email="zhangming@huachuang.com",
            phone="13800138000",
            company="华创资本集团",
            job_title="合伙人"
        )
        self.assertFalse(is_new, "Should update existing contact matched by email")
        self.assertEqual(updated_c["company"], "华创资本集团")

        # Verify profiles and tags are INTACT after MS sync
        after_sync_c = await ContactService.get_contact_by_id(self.user_id, contact_id)
        self.assertEqual(len(after_sync_c["profiles"]), 4, "Profiles must not be wiped by MS sync")
        self.assertEqual(len(after_sync_c["tags"]), 3, "Tags must not be wiped by MS sync")
        print("  ✓ 7. Outlook incremental sync updated metadata while safely preserving all AI profiles & tags")

        # 8. Test Fact Deletion
        del_ok = await contacts_repo.delete_contact_profile(self.user_id, contact_id, p1["id"])
        self.assertTrue(del_ok)
        after_del_c = await ContactService.get_contact_by_id(self.user_id, contact_id)
        self.assertEqual(len(after_del_c["profiles"]), 3)
        print("  ✓ 8. Single fact deletion succeeded")

        # 9. Test Cascade Delete Contact
        del_res = await ContactService.delete_contact(self.user_id, contact_id)
        self.assertEqual(del_res["status"], "ok")
        gone_c = await ContactService.get_contact_by_id(self.user_id, contact_id)
        self.assertIsNone(gone_c)

        # Check cascading deletion on child tables
        async with self.pool.connection() as conn:
            cur1 = await conn.execute("SELECT count(*) FROM contact_profiles WHERE contact_id = %s", (contact_id,))
            c_p = (await cur1.fetchone())[0]
            cur2 = await conn.execute("SELECT count(*) FROM contact_tags WHERE contact_id = %s", (contact_id,))
            c_t = (await cur2.fetchone())[0]
            cur3 = await conn.execute("SELECT count(*) FROM contact_interactions WHERE contact_id = %s", (contact_id,))
            c_i = (await cur3.fetchone())[0]

        self.assertEqual(c_p, 0, "Profiles must be deleted on CASCADE")
        self.assertEqual(c_t, 0, "Tags must be deleted on CASCADE")
        self.assertEqual(c_i, 0, "Interactions must be deleted on CASCADE")
        print("  ✓ 9. Cascade deletion on PostgreSQL foreign keys verified")


if __name__ == "__main__":
    unittest.main()
