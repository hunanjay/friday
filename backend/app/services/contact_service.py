import logging

from app.infrastructure.graph.client import graph_get

logger = logging.getLogger(__name__)


class ContactService:
    @classmethod
    async def get_contacts(cls, user_id: str, query: str | None = None, top: int = 50) -> list[dict]:
        """Fetch user's Outlook contacts and format them for the API & frontend."""
        path = f"/me/contacts?$top={min(top, 100)}&$select=id,displayName,givenName,surname,emailAddresses,jobTitle,companyName,mobilePhone,businessPhones"
        try:
            data = await graph_get(user_id, path)
            raw_items = data.get("value", []) if isinstance(data, dict) else []
        except Exception as exc:
            logger.warning("Failed to fetch contacts for user %s: %s", user_id, exc)
            return []

        contacts = []
        for item in raw_items:
            display_name = item.get("displayName") or f"{item.get('givenName', '')} {item.get('surname', '')}".strip() or "Unnamed Contact"
            emails = item.get("emailAddresses") or []
            email_addr = emails[0].get("address", "") if emails else ""

            # Extract phone
            phones = item.get("businessPhones") or []
            mobile = item.get("mobilePhone")
            phone = mobile or (phones[0] if phones else "")

            contact_obj = {
                "id": item.get("id"),
                "name": display_name,
                "email": email_addr,
                "jobTitle": item.get("jobTitle") or "",
                "company": item.get("companyName") or "",
                "phone": phone,
            }

            # Filter if query is provided
            if query:
                q = query.lower()
                matches_name = q in contact_obj["name"].lower()
                matches_email = q in contact_obj["email"].lower()
                matches_company = q in contact_obj["company"].lower()
                if not (matches_name or matches_email or matches_company):
                    continue

            contacts.append(contact_obj)

        return contacts

    @classmethod
    async def create_contact(
        cls,
        user_id: str,
        name: str,
        email: str,
        phone: str | None = None,
        company: str | None = None,
        job_title: str | None = None,
    ) -> dict:
        """Create a new contact in Outlook using MS Graph SDK."""
        from msgraph.generated.models.contact import Contact
        from msgraph.generated.models.email_address import EmailAddress

        from app.infrastructure.graph.sdk_client import get_graph_sdk_client

        client = get_graph_sdk_client(user_id)

        # Split name into givenName and surname if possible
        name_parts = name.strip().split(maxsplit=1)
        given_name = name_parts[0] if name_parts else name
        surname = name_parts[1] if len(name_parts) > 1 else ""

        contact_model = Contact(
            display_name=name,
            given_name=given_name,
            surname=surname,
            email_addresses=[
                EmailAddress(address=email, name=name)
            ] if email else [],
            mobile_phone=phone,
            company_name=company,
            job_title=job_title,
        )

        created = await client.me.contacts.post(contact_model)
        return {
            "id": created.id,
            "name": created.display_name or name,
            "email": email,
            "jobTitle": created.job_title or job_title or "",
            "company": created.company_name or company or "",
            "phone": created.mobile_phone or phone or "",
        }

    @classmethod
    async def delete_contact(cls, user_id: str, contact_id: str) -> dict:
        """Delete a contact using MS Graph SDK."""
        from app.infrastructure.graph.sdk_client import get_graph_sdk_client

        client = get_graph_sdk_client(user_id)
        await client.me.contacts.by_contact_id(contact_id).delete()
        return {"status": "ok", "id": contact_id}

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
    ) -> dict:
        """Update an existing contact using MS Graph SDK."""
        from msgraph.generated.models.contact import Contact
        from msgraph.generated.models.email_address import EmailAddress

        from app.infrastructure.graph.sdk_client import get_graph_sdk_client

        client = get_graph_sdk_client(user_id)

        update_kwargs = {}
        if name is not None:
            name_parts = name.strip().split(maxsplit=1)
            update_kwargs["display_name"] = name
            update_kwargs["given_name"] = name_parts[0] if name_parts else name
            update_kwargs["surname"] = name_parts[1] if len(name_parts) > 1 else ""
        if email is not None:
            update_kwargs["email_addresses"] = [EmailAddress(address=email, name=name or "")] if email else []
        if phone is not None:
            update_kwargs["mobile_phone"] = phone
        if company is not None:
            update_kwargs["company_name"] = company
        if job_title is not None:
            update_kwargs["job_title"] = job_title

        contact_model = Contact(**update_kwargs)
        updated = await client.me.contacts.by_contact_id(contact_id).patch(contact_model)

        return {
            "id": contact_id,
            "name": getattr(updated, "display_name", None) or name or "",
            "email": email or "",
            "jobTitle": getattr(updated, "job_title", None) or job_title or "",
            "company": getattr(updated, "company_name", None) or company or "",
            "phone": getattr(updated, "mobile_phone", None) or phone or "",
        }
