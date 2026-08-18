from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

from app.core.security import get_user_id
from app.infrastructure.db.repositories import contacts as contacts_repo
from app.services.contact_brain_service import ContactBrainService
from app.services.contact_service import ContactService

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
