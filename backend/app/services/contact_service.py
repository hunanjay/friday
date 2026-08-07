import logging

from app.infrastructure.db.repositories import contacts as contacts_repo
from app.infrastructure.graph.client import graph_get

logger = logging.getLogger(__name__)


class ContactService:
    @classmethod
    async def get_contacts(cls, user_id: str, query: str | None = None, tag: str | None = None) -> list[dict]:
        """Fetch user's contacts from local Postgres DB with profiles, tags, and timeline."""
        return await contacts_repo.list_contacts(user_id=user_id, query=query, tag=tag)

    @classmethod
    async def get_contact_by_id(cls, user_id: str, contact_id: str) -> dict | None:
        """Fetch full single contact record with profiles, tags, and timeline."""
        return await contacts_repo.get_contact_by_id(user_id=user_id, contact_id=contact_id)

    @classmethod
    async def create_contact(
        cls,
        user_id: str,
        name: str,
        email: str = "",
        phone: str = "",
        company: str = "",
        job_title: str = "",
        location: str = "",
    ) -> dict:
        """Create a new contact directly in server Postgres DB."""
        return await contacts_repo.create_contact(
            user_id=user_id,
            name=name,
            email=email,
            phone=phone,
            company=company,
            job_title=job_title,
            location=location,
        )

    @classmethod
    async def update_contact(
        cls,
        user_id: str,
        contact_id: str,
        name: str | None = None,
        email: str | None = None,
        phone: str | None = None,
        company: str | None = None,
        job_title: str | None = None,
        location: str | None = None,
        ai_summary: str | None = None,
    ) -> dict | None:
        """Update an existing contact in server Postgres DB."""
        return await contacts_repo.update_contact(
            user_id=user_id,
            contact_id=contact_id,
            name=name,
            email=email,
            phone=phone,
            company=company,
            job_title=job_title,
            location=location,
            ai_summary=ai_summary,
        )

    @classmethod
    async def delete_contact(cls, user_id: str, contact_id: str) -> dict:
        """Delete a contact from server Postgres DB."""
        ok = await contacts_repo.delete_contact(user_id=user_id, contact_id=contact_id)
        return {"status": "ok" if ok else "error", "id": contact_id}

    @classmethod
    async def sync_from_microsoft(cls, user_id: str) -> dict:
        """
        Pull user's contacts from Microsoft Graph API (/me/contacts)
        and perform incremental upsert into server Postgres DB contacts table.
        Does NOT alter or delete existing contact_profiles, contact_tags, or contact_interactions.
        """
        path = "/me/contacts?$top=100&$select=id,displayName,givenName,surname,emailAddresses,jobTitle,companyName,mobilePhone,businessPhones"
        try:
            data = await graph_get(user_id, path)
            raw_items = data.get("value", []) if isinstance(data, dict) else []
        except Exception as exc:
            logger.warning("Failed to fetch MS contacts for user %s: %s", user_id, exc)
            return {"status": "error", "message": f"拉取微软通讯录失败: {str(exc)}", "created": 0, "updated": 0, "total": 0}

        created_count = 0
        updated_count = 0

        for item in raw_items:
            outlook_id = item.get("id")
            if not outlook_id:
                continue

            display_name = item.get("displayName") or f"{item.get('givenName', '')} {item.get('surname', '')}".strip() or "Unnamed Contact"
            emails = item.get("emailAddresses") or []
            email_addr = emails[0].get("address", "") if emails else ""

            phones = item.get("businessPhones") or []
            mobile = item.get("mobilePhone")
            phone = mobile or (phones[0] if phones else "")

            company = item.get("companyName") or ""
            job_title = item.get("jobTitle") or ""

            _, is_new = await contacts_repo.upsert_contact_from_microsoft(
                user_id=user_id,
                outlook_contact_id=outlook_id,
                name=display_name,
                email=email_addr,
                phone=phone,
                company=company,
                job_title=job_title,
            )

            if is_new:
                created_count += 1
            else:
                updated_count += 1

        return {
            "status": "ok",
            "total": len(raw_items),
            "created": created_count,
            "updated": updated_count,
        }
