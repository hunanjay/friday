import json
import logging

from langchain_core.messages import HumanMessage, SystemMessage

from app.core.config import settings
from app.core.llm import make_chat_model
from app.infrastructure.db.repositories import contacts as contacts_repo

logger = logging.getLogger(__name__)

EXTRACTION_SYSTEM_PROMPT = """你是一个高水平的 AI 关系大脑提取专家。
请分析用户输入的文本/微信聊天记录/随手记，提取出提及的联系人及其关联画像事实与标签。

请严格返回以下 JSON 格式结构 (不得返回 Markdown 代码块以外的多余文字，且纯 JSON 输出)：
{
  "name": "联系人姓名 (必须有)",
  "email": "邮箱 (若无写空字符串)",
  "phone": "电话 (若无写空字符串)",
  "company": "公司 (若无写空字符串)",
  "job_title": "职位 (若无写空字符串)",
  "location": "所在地 (若无写空字符串)",
  "ai_summary": "一句话整体画像描述",
  "tags": ["标签1", "标签2", "标签3"],
  "profiles": [
    {
      "dimension": "basic|business|private|dynamic",
      "category": "preference|pain_point|demand|family|anniversary|event|other",
      "fact_key": "事实键描述，如 diet_preference, business_scale",
      "fact_value": "事实具体内容，如 喜欢喝普洱茶，年营业额5000万"
    }
  ],
  "interaction_summary": "提取本次交互的关键事实/约定摘要"
}
"""


class ContactBrainService:
    @classmethod
    async def extract_and_save(cls, user_id: str, raw_text: str, target_contact_id: str | None = None) -> dict:
        """
        Calls LLM to extract structured profile facts & tags from raw text,
        then updates/inserts into PostgreSQL normalized tables (`contacts`, `contact_profiles`, `contact_tags`, `contact_interactions`).
        """
        llm = make_chat_model(model=settings.DRAFT_MODEL, temperature=0.1)

        try:
            res = await llm.ainvoke([
                SystemMessage(content=EXTRACTION_SYSTEM_PROMPT),
                HumanMessage(content=f"待提取的文本内容：\n{raw_text}"),
            ])
            cleaned = res.content.strip()
            if cleaned.startswith("```json"):
                cleaned = cleaned[7:]
            if cleaned.startswith("```"):
                cleaned = cleaned[3:]
            if cleaned.endswith("```"):
                cleaned = cleaned[:-3]

            data = json.loads(cleaned.strip())
        except Exception as exc:
            logger.error("LLM extraction failed: %s", exc)
            raise ValueError(f"AI 事实提炼失败: {str(exc)}")

        name = data.get("name") or "未命名联系人"
        email = data.get("email") or ""
        phone = data.get("phone") or ""
        company = data.get("company") or ""
        job_title = data.get("job_title") or ""
        location = data.get("location") or ""
        ai_summary = data.get("ai_summary") or ""
        tags = data.get("tags") or []
        profiles = data.get("profiles") or []
        interaction_summary = data.get("interaction_summary") or f"从文本资料中提取了 {len(profiles)} 条画像事实"

        # Find or create contact
        contact = None
        if target_contact_id:
            contact = await contacts_repo.get_contact_by_id(user_id, target_contact_id)

        if not contact:
            # Search by name or email
            existing = await contacts_repo.list_contacts(user_id, query=name)
            if existing:
                contact = existing[0]

        if contact:
            contact_id = contact["id"]
            # Update basic info if missing
            await contacts_repo.update_contact(
                user_id=user_id,
                contact_id=contact_id,
                email=email if (email and not contact.get("email")) else None,
                phone=phone if (phone and not contact.get("phone")) else None,
                company=company if (company and not contact.get("company")) else None,
                job_title=job_title if (job_title and not contact.get("jobTitle")) else None,
                location=location if (location and not contact.get("location")) else None,
                ai_summary=ai_summary or contact.get("ai_summary"),
            )
        else:
            contact = await contacts_repo.create_contact(
                user_id=user_id,
                name=name,
                email=email,
                phone=phone,
                company=company,
                job_title=job_title,
                location=location,
                ai_summary=ai_summary,
            )
            contact_id = contact["id"]

        # Insert the interaction row first: it holds the raw snippet, so it is the
        # provenance every fact extracted from this text points back to.
        interaction = await contacts_repo.add_contact_interaction(
            user_id=user_id,
            contact_id=contact_id,
            source_type="chat_paste",
            summary=interaction_summary,
            raw_snippet=raw_text[:500],
        )

        # Insert profiles (facts)
        added_profiles = []
        for p in profiles:
            dim = p.get("dimension") or "basic"
            cat = p.get("category") or "other"
            key = p.get("fact_key") or "note"
            val = p.get("fact_value") or ""
            if val:
                prof = await contacts_repo.add_contact_profile(
                    user_id=user_id,
                    contact_id=contact_id,
                    dimension=dim,
                    category=cat,
                    fact_key=key,
                    fact_value=val,
                    source_type="chat_paste",
                    source_id=interaction["id"],
                )
                added_profiles.append(prof)

        # Insert tags
        for t in tags:
            if isinstance(t, str) and t.strip():
                await contacts_repo.add_contact_tag(user_id, contact_id, t.strip())

        full_contact = await contacts_repo.get_contact_by_id(user_id, contact_id)
        return {
            "contact": full_contact,
            "extracted_profiles": added_profiles,
            "interaction": interaction,
        }
