import uuid
from datetime import datetime

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from pydantic import BaseModel

from app.core.security import get_user_id
from app.infrastructure.db.repositories import (
    contact_reminders as reminders_repo,
    contacts as contacts_repo,
    user_memory as user_memory_repo,
)
from app.services.contact_brain_service import ContactBrainService
from app.services.contact_service import ContactService
from app.services.storage import save_attachment_file

_AVATAR_MAX_BYTES = 5 * 1024 * 1024

router = APIRouter(prefix="/api/contacts", tags=["contacts"])


class CreateContactRequest(BaseModel):
    name: str
    email: str | None = ""
    phone: str | None = ""
    company: str | None = ""
    job_title: str | None = ""
    location: str | None = ""


class UpdateContactRequest(BaseModel):
    name: str | None = None
    email: str | None = None
    phone: str | None = None
    company: str | None = None
    job_title: str | None = None
    location: str | None = None
    ai_summary: str | None = None


class ExtractTextRequest(BaseModel):
    text: str
    contact_id: str | None = None


class AddFactRequest(BaseModel):
    dimension: str
    category: str
    fact_key: str
    fact_value: str


class UpdateReminderRequest(BaseModel):
    status: str  # 'done' | 'dismissed' | 'snoozed'
    snooze_until: datetime | None = None


@router.get("")
async def list_contacts(
    query: str | None = Query(default=None),
    tag: str | None = Query(default=None),
    user_id: str = Depends(get_user_id),
):
    """List contacts from server Postgres DB with full normalized profiles, tags, and timeline."""
    return await ContactService.get_contacts(user_id=user_id, query=query, tag=tag)


@router.get("/tags")
async def list_tags(user_id: str = Depends(get_user_id)):
    """List all unique tags created for contacts."""
    return await contacts_repo.get_all_user_tags(user_id)


@router.get("/me")
async def get_self_memory(user_id: str = Depends(get_user_id)):
    """The user's own long-term memory (profile/preference/topic facts saved
    via remember_user_fact), shaped like a contact so it reuses the same
    facts UI as a real contact's Memory Profiles panel."""
    facts = await user_memory_repo.list_all_facts(user_id)
    return {
        "id": "me",
        "name": None,
        "email": None,
        "phone": None,
        "company": None,
        "jobTitle": None,
        "location": None,
        "ai_summary": None,
        "profiles": [{**f, "dimension": f["category"]} for f in facts],
        "tags": [],
        "timeline": [],
    }


@router.delete("/me/facts/{fact_id}")
async def delete_self_fact(fact_id: str, user_id: str = Depends(get_user_id)):
    """Delete one of the user's own memory facts (not a contact fact)."""
    ok = await user_memory_repo.delete_fact_by_id(user_id, fact_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Fact not found")
    return {"status": "ok", "fact_id": fact_id}


@router.get("/reminders")
async def list_reminders(
    status: str | None = Query(default=None),
    user_id: str = Depends(get_user_id),
):
    """Relationship-maintenance reminders (issue #17), soonest due_at first.
    The dashboard Radar panel passes status=pending."""
    return await reminders_repo.list_reminders(user_id, status=status)


@router.patch("/reminders/{reminder_id}")
async def update_reminder(
    reminder_id: str,
    payload: UpdateReminderRequest,
    user_id: str = Depends(get_user_id),
):
    if payload.status not in ("done", "dismissed", "snoozed"):
        raise HTTPException(status_code=422, detail="status must be done, dismissed, or snoozed")
    if payload.status == "snoozed" and not payload.snooze_until:
        raise HTTPException(status_code=422, detail="snooze_until is required when snoozing")
    updated = await reminders_repo.update_status(
        user_id, reminder_id, payload.status, snooze_until=payload.snooze_until
    )
    if not updated:
        raise HTTPException(status_code=404, detail="Reminder not found")
    return updated


@router.get("/{contact_id}")
async def get_contact(
    contact_id: str,
    user_id: str = Depends(get_user_id),
):
    contact = await ContactService.get_contact_by_id(user_id=user_id, contact_id=contact_id)
    if not contact:
        raise HTTPException(status_code=404, detail="Contact not found")
    return contact


@router.post("")
async def create_contact(
    payload: CreateContactRequest,
    user_id: str = Depends(get_user_id),
):
    if not payload.name or not payload.name.strip():
        raise HTTPException(status_code=400, detail="Name is required")
    return await ContactService.create_contact(
        user_id=user_id,
        name=payload.name.strip(),
        email=payload.email or "",
        phone=payload.phone or "",
        company=payload.company or "",
        job_title=payload.job_title or "",
        location=payload.location or "",
    )


@router.post("/sync/microsoft")
async def sync_microsoft_contacts(
    user_id: str = Depends(get_user_id),
):
    """Sync contacts from Microsoft Outlook into server Postgres DB."""
    return await ContactService.sync_from_microsoft(user_id=user_id)


@router.post("/extract")
async def extract_contact_facts(
    payload: ExtractTextRequest,
    user_id: str = Depends(get_user_id),
):
    """Extract profile facts & tags from raw text using LLM and persist across normalized tables."""
    if not payload.text or not payload.text.strip():
        raise HTTPException(status_code=400, detail="Text is required for extraction")
    return await ContactBrainService.extract_and_save(
        user_id=user_id,
        raw_text=payload.text,
        target_contact_id=payload.contact_id,
    )


@router.patch("/{contact_id}")
async def update_contact(
    contact_id: str,
    payload: UpdateContactRequest,
    user_id: str = Depends(get_user_id),
):
    updated = await ContactService.update_contact(
        user_id=user_id,
        contact_id=contact_id,
        name=payload.name,
        email=payload.email,
        phone=payload.phone,
        company=payload.company,
        job_title=payload.job_title,
        location=payload.location,
        ai_summary=payload.ai_summary,
    )
    if not updated:
        raise HTTPException(status_code=404, detail="Contact not found")
    return updated


@router.delete("/{contact_id}")
async def delete_contact(
    contact_id: str,
    user_id: str = Depends(get_user_id),
):
    return await ContactService.delete_contact(user_id=user_id, contact_id=contact_id)


@router.post("/{contact_id}/avatar")
async def upload_avatar(
    contact_id: str,
    file: UploadFile = File(...),
    user_id: str = Depends(get_user_id),
):
    """Upload/replace a contact's avatar photo. Stored via the same Aliyun
    OSS-or-local path memo attachments use (app/services/storage.py)."""
    if not await ContactService.get_contact_by_id(user_id=user_id, contact_id=contact_id):
        raise HTTPException(status_code=404, detail="Contact not found")
    if not (file.content_type or "").startswith("image/"):
        raise HTTPException(status_code=422, detail="Avatar must be an image file")

    content_bytes = await file.read()
    if len(content_bytes) > _AVATAR_MAX_BYTES:
        raise HTTPException(status_code=422, detail="Avatar image must be 5MB or smaller")

    safe_filename = f"{contact_id}_{uuid.uuid4().hex}_{file.filename}"
    avatar_url, _ = save_attachment_file(content_bytes, safe_filename, file.content_type, subfolder="contacts")
    return await contacts_repo.update_contact(user_id=user_id, contact_id=contact_id, avatar_url=avatar_url)


@router.delete("/{contact_id}/avatar")
async def delete_avatar(
    contact_id: str,
    user_id: str = Depends(get_user_id),
):
    updated = await contacts_repo.update_contact(user_id=user_id, contact_id=contact_id, avatar_url="")
    if not updated:
        raise HTTPException(status_code=404, detail="Contact not found")
    return updated


@router.post("/reindex")
async def reindex_contacts(
    full: bool = Query(default=False),
    limit: int = Query(default=500, le=2000),
    user_id: str = Depends(get_user_id),
):
    """Compensation task for contact vector indexing.

    Default: index only rows whose write to Qdrant previously failed.
    `full=true`: rebuild the caller's whole index from Postgres.
    A non-zero `pending` in the response means rows remain — call again.
    """
    if full:
        await contacts_repo.reset_index_state(user_id)
    return await contacts_repo.reindex_pending(user_id=user_id, limit=limit)


@router.post("/{contact_id}/facts")
async def add_fact(
    contact_id: str,
    payload: AddFactRequest,
    user_id: str = Depends(get_user_id),
):
    """Add a discrete fact row to contact_profiles."""
    return await contacts_repo.add_contact_profile(
        user_id=user_id,
        contact_id=contact_id,
        dimension=payload.dimension,
        category=payload.category,
        fact_key=payload.fact_key,
        fact_value=payload.fact_value,
        source_type="manual",
    )


@router.delete("/{contact_id}/facts/{fact_id}")
async def delete_fact(
    contact_id: str,
    fact_id: str,
    user_id: str = Depends(get_user_id),
):
    """Delete a discrete fact row from contact_profiles."""
    ok = await contacts_repo.delete_contact_profile(user_id, contact_id, fact_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Fact not found")
    return {"status": "ok", "fact_id": fact_id}
