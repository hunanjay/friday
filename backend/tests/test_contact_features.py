#!/usr/bin/env python3
"""
Comprehensive Test Suite for Contact & Personal Relationship Brain Features:
1. Outlook 通讯录增量同步 (Incremental Sync from MS Graph)
2. 微信聊天记录/随手记文本 AI 提炼 (AI Fact & NER Extraction)
3. 4 大维度原子事实表 (Memory Profiles: Business, Private, Dynamic, Basic)
4. 姓名/公司/标签/事实 模糊搜索与标签过滤 (Search & Tag Filtering)
5. Agent 工具: search_contacts, record_contact_fact, extract_contact_memory
"""

import os
import sys
import unittest
from unittest.mock import AsyncMock, MagicMock, patch

# Set up paths and load environment variables
backend_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
sys.path.insert(0, backend_dir)

try:
    from dotenv import load_dotenv
    load_dotenv(os.path.join(backend_dir, ".env"))
except ImportError:
    pass

# Ensure test fallback values if not present
os.environ.setdefault("SUPABASE_URL", "https://sbqgivaqomoyobfamwxt.supabase.co")
os.environ.setdefault("SUPABASE_ANON_KEY", "sb_publishable_placeholder_for_test")
os.environ.setdefault("CHECKPOINT_DB_URL", "postgresql://friday:friday@localhost:5438/friday")

from app.agents.tools import make_contact_tools
from app.infrastructure.db.repositories import contacts as contacts_repo
from app.services.contact_brain_service import ContactBrainService
from app.services.contact_service import ContactService


class TestContactFeatures(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.test_user_id = "test-user-uuid-123"

    # =========================================================================
    # 1. Outlook 通讯录增量同步
    # =========================================================================
    async def test_1_outlook_incremental_sync(self):
        """Test MS Graph contact sync with new, updated, and existing contacts."""
        mock_graph_response = {
            "value": [
                {
                    "id": "ms-outlook-id-1",
                    "displayName": "张明",
                    "emailAddresses": [{"address": "zhangming@huachuang.com"}],
                    "mobilePhone": "+86 13800138000",
                    "companyName": "华创资本",
                    "jobTitle": "合伙人",
                },
                {
                    "id": "ms-outlook-id-2",
                    "givenName": "李",
                    "surname": "雷",
                    "emailAddresses": [{"address": "lilei@example.com"}],
                    "businessPhones": ["010-88888888"],
                    "companyName": "未来科技",
                    "jobTitle": "CTO",
                }
            ]
        }

        # Mock graph_get and repository
        with patch("app.services.contact_service.graph_get", new_callable=AsyncMock) as mock_graph_get, \
             patch("app.infrastructure.db.repositories.contacts.upsert_contact_from_microsoft", new_callable=AsyncMock) as mock_upsert:

            mock_graph_get.return_value = mock_graph_response
            # 1st is new, 2nd is updated
            mock_upsert.side_effect = [
                ({"id": "cid-1", "name": "张明"}, True),
                ({"id": "cid-2", "name": "李 雷"}, False),
            ]

            result = await ContactService.sync_from_microsoft(self.test_user_id)

            self.assertEqual(result["status"], "ok")
            self.assertEqual(result["total"], 2)
            self.assertEqual(result["created"], 1)
            self.assertEqual(result["updated"], 1)

            # Verify upsert parameters
            self.assertEqual(mock_upsert.call_count, 2)
            first_call_kwargs = mock_upsert.call_args_list[0].kwargs
            self.assertEqual(first_call_kwargs["user_id"], self.test_user_id)
            self.assertEqual(first_call_kwargs["name"], "张明")
            self.assertEqual(first_call_kwargs["email"], "zhangming@huachuang.com")
            self.assertEqual(first_call_kwargs["company"], "华创资本")

    async def test_1_outlook_sync_error_handling(self):
        """Test graceful failure when Microsoft Graph API call errors."""
        with patch("app.services.contact_service.graph_get", new_callable=AsyncMock) as mock_graph_get:
            mock_graph_get.side_effect = Exception("401 Unauthorized / Token Expired")
            result = await ContactService.sync_from_microsoft(self.test_user_id)
            self.assertEqual(result["status"], "error")
            self.assertIn("拉取微软通讯录失败", result["message"])

    # =========================================================================
    # 2. 微信聊天记录 / 随手记文本 AI 提炼
    # =========================================================================
    async def test_2_ai_chat_log_extraction_and_save(self):
        """Test extracting structured 4-dimension profiles, tags, and timeline from chat log."""
        sample_raw_text = """
        今天和华创资本的张明总聊了下，他目前在看医疗和AI领域，公司是华创资本，职位是主管合伙人。
        张总平时特别喜欢喝普洱茶，座驾是一辆问界M9。计划下个月初来北京出差拜访我们。
        邮箱是 zhangming@huachuang.com，电话 13800138000。
        """

        mock_llm_json_response = {
            "name": "张明",
            "email": "zhangming@huachuang.com",
            "phone": "13800138000",
            "company": "华创资本",
            "job_title": "主管合伙人",
            "location": "北京",
            "ai_summary": "华创资本主管合伙人，重点关注医疗和AI领域，偏好普洱茶，近期出差北京。",
            "tags": ["医疗", "AI", "投资人", "华创资本"],
            "profiles": [
                {
                    "dimension": "business",
                    "category": "demand",
                    "fact_key": "investment_focus",
                    "fact_value": "重点看医疗和AI领域投资"
                },
                {
                    "dimension": "private",
                    "category": "preference",
                    "fact_key": "tea_preference",
                    "fact_value": "特别喜欢喝普洱茶"
                },
                {
                    "dimension": "private",
                    "category": "other",
                    "fact_key": "vehicle",
                    "fact_value": "座驾是问界M9"
                },
                {
                    "dimension": "dynamic",
                    "category": "event",
                    "fact_key": "business_trip",
                    "fact_value": "下个月初来北京出差拜访"
                }
            ],
            "interaction_summary": "交流了医疗和AI投资方向及北京拜访计划"
        }

        mock_ai_message = MagicMock()
        mock_ai_message.content = f"```json\n{import_json_str(mock_llm_json_response)}\n```"

        with patch("app.services.contact_brain_service.make_chat_model") as mock_chat_cls, \
             patch("app.infrastructure.db.repositories.contacts.list_contacts", new_callable=AsyncMock) as mock_list_contacts, \
             patch("app.infrastructure.db.repositories.contacts.create_contact", new_callable=AsyncMock) as mock_create_contact, \
             patch("app.infrastructure.db.repositories.contacts.add_contact_profile", new_callable=AsyncMock) as mock_add_profile, \
             patch("app.infrastructure.db.repositories.contacts.add_contact_tag", new_callable=AsyncMock) as mock_add_tag, \
             patch("app.infrastructure.db.repositories.contacts.add_contact_interaction", new_callable=AsyncMock) as mock_add_interaction, \
             patch("app.infrastructure.db.repositories.contacts.get_contact_by_id", new_callable=AsyncMock) as mock_get_contact:

            mock_llm_instance = MagicMock()
            mock_llm_instance.ainvoke = AsyncMock(return_value=mock_ai_message)
            mock_chat_cls.return_value = mock_llm_instance

            mock_list_contacts.return_value = []
            mock_create_contact.return_value = {
                "id": "cid-zhangming-100",
                "name": "张明",
                "email": "zhangming@huachuang.com",
                "company": "华创资本"
            }
            mock_add_profile.side_effect = lambda user_id, contact_id, dimension, category, fact_key, fact_value, **_provenance: {
                "id": f"fact-{fact_key}", "dimension": dimension, "category": category, "fact_key": fact_key, "fact_value": fact_value
            }
            mock_add_interaction.return_value = {"id": "interaction-1"}
            mock_get_contact.return_value = {
                "id": "cid-zhangming-100",
                "name": "张明",
                "company": "华创资本",
                "ai_summary": "华创资本主管合伙人..."
            }

            result = await ContactBrainService.extract_and_save(self.test_user_id, sample_raw_text)

            self.assertIsNotNone(result)
            self.assertEqual(result["contact"]["name"], "张明")
            self.assertEqual(len(result["extracted_profiles"]), 4)

            # Check dimensions extracted
            extracted_dims = [p["dimension"] for p in result["extracted_profiles"]]
            self.assertIn("business", extracted_dims)
            self.assertIn("private", extracted_dims)
            self.assertIn("dynamic", extracted_dims)

            # Check tags added
            self.assertEqual(mock_add_tag.call_count, 4)
            # Check interaction timeline logged
            mock_add_interaction.assert_called_once()
            interaction_kwargs = mock_add_interaction.call_args.kwargs
            self.assertEqual(interaction_kwargs["source_type"], "chat_paste")
            self.assertEqual(interaction_kwargs["contact_id"], "cid-zhangming-100")

    # =========================================================================
    # 3. 4 大维度原子事实表 (CRUD & Whitelisting)
    # =========================================================================
    async def test_3_four_dimension_profiles_crud(self):
        """Test adding, listing, and deleting atomic facts in 4 dimensions."""
        with (
            patch("app.infrastructure.db.repositories.contacts._db_pool") as mock_pool_getter,
            patch(
                "app.infrastructure.db.repositories.contacts._index_docs",
                new_callable=AsyncMock,
            ),
            patch(
                "app.infrastructure.db.repositories.contacts._unindex",
                new_callable=AsyncMock,
            ),
        ):
            mock_pool = MagicMock()
            mock_conn = AsyncMock()
            mock_cur = AsyncMock()

            # Simulate return of fetchone / fetchall
            mock_cur.fetchone.return_value = (
                "fact-id-1", "private", "preference", "tea_preference", "喜欢喝普洱茶", 1.0, None, "manual", None
            )
            mock_cur.fetchall.return_value = [
                ("fact-id-1", "private", "preference", "tea_preference", "喜欢喝普洱茶", 1.0, None, "manual", None),
                ("fact-id-2", "business", "demand", "target_scale", "寻找A轮融资", 1.0, None, "manual", None),
                ("fact-id-3", "dynamic", "event", "next_meeting", "周三下午2点", 1.0, None, "manual", None),
                ("fact-id-4", "basic", "family", "hometown", "湖南长沙", 1.0, None, "manual", None),
            ]

            mock_conn.execute.return_value = mock_cur
            mock_pool.connection.return_value.__aenter__.return_value = mock_conn
            mock_pool_getter.return_value = mock_pool

            # 3a. Add fact
            fact = await contacts_repo.add_contact_profile(
                user_id=self.test_user_id,
                contact_id="cid-1",
                dimension="private",
                category="preference",
                fact_key="tea_preference",
                fact_value="喜欢喝普洱茶"
            )
            self.assertEqual(fact["dimension"], "private")
            self.assertEqual(fact["fact_key"], "tea_preference")
            self.assertEqual(fact["fact_value"], "喜欢喝普洱茶")

            # 3b. List facts
            profiles = await contacts_repo.get_contact_profiles(self.test_user_id, "cid-1")
            self.assertEqual(len(profiles), 4)
            dims_found = {p["dimension"] for p in profiles}
            self.assertEqual(dims_found, {"basic", "business", "private", "dynamic"})

            # 3c. Delete fact
            mock_cur.fetchone.return_value = ("fact-id-1",)
            deleted = await contacts_repo.delete_contact_profile(self.test_user_id, "cid-1", "fact-id-1")
            self.assertTrue(deleted)

    # =========================================================================
    # 4. 检索过滤 (姓名/公司/标签/事实 模糊搜索与标签过滤)
    # =========================================================================
    async def test_4_search_and_tag_filtering(self):
        """Test contact fuzzy search by query and tag filter."""
        sample_contacts = [
            {
                "id": "c-1",
                "name": "张明",
                "email": "zhangming@huachuang.com",
                "company": "华创资本",
                "jobTitle": "合伙人",
                "tags": ["医疗", "AI", "投资人"],
                "profiles": [{"fact_key": "tea_preference", "fact_value": "喜欢喝普洱茶"}]
            },
            {
                "id": "c-2",
                "name": "李雷",
                "email": "lilei@future.com",
                "company": "未来医疗",
                "jobTitle": "CTO",
                "tags": ["医疗", "技术专家"],
                "profiles": []
            }
        ]

        # 4a. Search by name / company / tag
        with patch("app.infrastructure.db.repositories.contacts.list_contacts", new_callable=AsyncMock) as mock_list:
            mock_list.return_value = [sample_contacts[0]]
            res = await ContactService.get_contacts(self.test_user_id, query="华创")
            self.assertEqual(len(res), 1)
            self.assertEqual(res[0]["name"], "张明")

            mock_list.return_value = sample_contacts
            res_tag = await ContactService.get_contacts(self.test_user_id, tag="医疗")
            self.assertEqual(len(res_tag), 2)

        # 4b. List all distinct tags
        with patch("app.infrastructure.db.repositories.contacts.get_all_user_tags", new_callable=AsyncMock) as mock_tags:
            mock_tags.return_value = ["AI", "投资人", "技术专家", "医疗"]
            tags = await contacts_repo.get_all_user_tags(self.test_user_id)
            self.assertIn("AI", tags)
            self.assertIn("医疗", tags)
            self.assertIn("投资人", tags)

    # =========================================================================
    # 5. Agent 工具: search_contacts, record_contact_fact, extract_contact_memory
    # =========================================================================
    async def test_5_agent_tools_contact_brain(self):
        """Test the 3 LangChain Agent tools that interact with Personal Contact Brain."""
        contact_tools = make_contact_tools(self.test_user_id)
        tools_dict = {t.name: t for t in contact_tools}

        self.assertIn("search_contacts", tools_dict)
        self.assertIn("record_contact_fact", tools_dict)
        self.assertIn("extract_contact_memory", tools_dict)

        search_tool = tools_dict["search_contacts"]
        create_tool = tools_dict["create_contact"]
        record_tool = tools_dict["record_contact_fact"]
        extract_tool = tools_dict["extract_contact_memory"]
        record_schema = record_tool.args_schema.model_json_schema()
        self.assertIn("contact_id", record_schema["required"])
        self.assertNotIn("contact_name", record_schema["properties"])

        # 5a. search_contacts tool execution
        with patch("app.services.contact_service.ContactService.get_contacts", new_callable=AsyncMock) as mock_get_contacts:
            mock_get_contacts.return_value = [
                {
                    "id": "cid-zhangming",
                    "name": "张明",
                    "email": "zhangming@huachuang.com",
                    "company": "华创资本",
                    "jobTitle": "合伙人",
                    "tags": ["医疗", "投资人"],
                    "profiles": [
                        {"fact_key": "tea_preference", "fact_value": "普洱茶"},
                        {"fact_key": "car", "fact_value": "问界M9"}
                    ]
                }
            ]

            output = await search_tool.ainvoke({"query": "张明"})
            self.assertIn("张明", output)
            self.assertIn("华创资本", output)
            self.assertIn("#医疗", output)
            self.assertIn("tea_preference", output)
            self.assertIn("普洱茶", output)
            self.assertIn("问界M9", output)

        # Same-name contacts are valid data, so creation must not silently
        # update whichever row happened to be returned first.
        with patch("app.services.contact_service.ContactService.get_contacts", new_callable=AsyncMock) as mock_get_c, \
             patch("app.services.contact_service.ContactService.update_contact", new_callable=AsyncMock) as mock_update_c, \
             patch("app.services.contact_service.ContactService.create_contact", new_callable=AsyncMock) as mock_create_c:
            mock_get_c.return_value = [
                {"id": "cid-1", "name": "曾佳丽", "email": "first@example.com", "company": ""},
                {"id": "cid-2", "name": "曾佳丽", "email": "", "company": "Example Co"},
            ]

            output = await create_tool.ainvoke({"name": "曾佳丽"})

            self.assertIn("Multiple contacts are named '曾佳丽'", output)
            self.assertIn("ask the user which contact", output)
            mock_update_c.assert_not_awaited()
            mock_create_c.assert_not_awaited()

        # 5b. record_contact_fact tool execution (casual single fact saving)
        with patch("app.services.contact_service.ContactService.get_contact_by_id", new_callable=AsyncMock) as mock_get_c, \
             patch("app.infrastructure.db.repositories.contacts.add_contact_profile", new_callable=AsyncMock) as mock_add_p, \
             patch("app.infrastructure.db.repositories.contacts.get_fact_vocabulary", new_callable=AsyncMock) as mock_vocab:

            mock_get_c.return_value = {"id": "cid-zhangming", "name": "张明"}
            mock_add_p.return_value = {
                "id": "fact-new-1",
                "dimension": "private",
                "category": "preference",
            }
            mock_vocab.return_value = {
                "dimensions": ["basic", "private"],
                "categories": ["preference"],
            }

            output = await record_tool.ainvoke({
                "contact_id": "cid-zhangming",
                "dimension": "private",
                "category": "preference",
                "fact_key": "tea_preference",
                "fact_value": "喜欢喝老班章普洱茶"
            })
            self.assertIn("Successfully recorded memory fact for 张明", output)
            self.assertIn("private", output)
            self.assertIn("tea_preference", output)

        # A missing/stale id never creates a contact implicitly. This keeps a
        # parallel create_contact + record_contact_fact response from inserting
        # two same-name rows.
        with patch("app.services.contact_service.ContactService.get_contact_by_id", new_callable=AsyncMock) as mock_get_c, \
             patch("app.services.contact_service.ContactService.create_contact", new_callable=AsyncMock) as mock_create_c, \
             patch("app.infrastructure.db.repositories.contacts.add_contact_profile", new_callable=AsyncMock) as mock_add_p:
            mock_get_c.return_value = None

            output = await record_tool.ainvoke({
                "contact_id": "missing-contact-id",
                "dimension": "private",
                "category": "pet",
                "fact_key": "guinea_pigs",
                "fact_value": "团团和妞妞",
            })

            self.assertIn("was not found", output)
            self.assertIn("Nothing was recorded", output)
            mock_create_c.assert_not_awaited()
            mock_add_p.assert_not_awaited()

        # 5c. extract_contact_memory tool execution (full chat log extraction)
        with patch("app.services.contact_brain_service.ContactBrainService.extract_and_save", new_callable=AsyncMock) as mock_extract_save:
            mock_extract_save.return_value = {
                "contact": {"name": "张明"},
                "extracted_profiles": [{"fact_key": "car", "fact_value": "M9"}, {"fact_key": "tea", "fact_value": "Pu'er"}]
            }

            output = await extract_tool.ainvoke({"text": "张总喜欢喝普洱茶，开问界M9"})
            self.assertIn("Successfully extracted memory for contact '张明'", output)
            self.assertIn("2 facts recorded", output)

        # 5d. extract_contact_memory empty text handling
        empty_output = await extract_tool.ainvoke({"text": ""})
        self.assertIn("Error: text argument cannot be empty", empty_output)


def import_json_str(data: dict) -> str:
    import json
    return json.dumps(data, ensure_ascii=False)


if __name__ == "__main__":
    runner = unittest.TextTestRunner(verbosity=2)
    suite = unittest.defaultTestLoader.loadTestsFromTestCase(TestContactFeatures)
    res = runner.run(suite)
    sys.exit(0 if res.wasSuccessful() else 1)
