#!/usr/bin/env python3
"""
Live LLM extraction test for ContactBrainService.
Tests real LLM call against configured Zhipu / GLM-4-flash endpoint.
"""

import asyncio
import os
import sys
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
from app.services.contact_brain_service import ContactBrainService


async def main():
    print("\n[Live LLM Extraction Test]")
    pool = await init_db_pool()
    await contacts_repo.init_schema()

    user_id = f"test-user-{uuid.uuid4()}"
    raw_text = """
    微信聊天记录 - 2026-08-08
    张明（华创资本主管合伙人）: 罗总好，我们华创资本最近在重点看医疗器械和具身智能AI方向，目前基金规模大概50亿。
    我: 张总好，下周您有空在北京见个面吗？
    张明: 可以的，我下周二下午从上海飞北京，在国贸附近出差。到时候一起喝茶，我平时只喝老班章普洱茶。
    我: 好的，那下周二国贸见！
    """

    try:
        print("  Calling ContactBrainService.extract_and_save with live LLM...")
        result = await ContactBrainService.extract_and_save(user_id=user_id, raw_text=raw_text)

        contact = result["contact"]
        profiles = result["extracted_profiles"]
        interaction = result["interaction"]

        print(f"  ✓ Extracted Contact Name: {contact.get('name')}")
        print(f"  ✓ Company: {contact.get('company')}, Job Title: {contact.get('jobTitle')}")
        print(f"  ✓ AI Summary: {contact.get('ai_summary')}")
        print(f"  ✓ Extracted Tags: {contact.get('tags')}")
        print(f"  ✓ Extracted Facts ({len(profiles)} items):")
        for p in profiles:
            print(f"     - [{p['dimension']} / {p['category']}] {p['fact_key']}: {p['fact_value']}")

        print(f"  ✓ Interaction Timeline: {interaction['summary']}")

        assert contact["name"] == "张明", f"Expected '张明', got {contact['name']}"
        assert len(profiles) >= 2, f"Expected at least 2 profile facts, got {len(profiles)}"
        print("\n  ALL LIVE LLM ASSERTIONS PASSED!")

    finally:
        async with pool.connection() as conn:
            await conn.execute("DELETE FROM contacts WHERE user_id = %s", (user_id,))
        await close_db_pool()


if __name__ == "__main__":
    asyncio.run(main())
