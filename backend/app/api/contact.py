from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

from app.core.security import get_user_id
from app.services.contact_service import ContactService

router = APIRouter(prefix="/api/graph/contacts", tags=["contacts"])


class CreateContactRequest(BaseModel):
    name: str
    email: str
    phone: str | None = None
    company: str | None = None
    job_title: str | None = None


@router.get("")
async def list_contacts(
    query: str | None = Query(default=None),
    top: int = Query(default=50, ge=1, le=100),
    user_id: str = Depends(get_user_id),
):
    return await ContactService.get_contacts(user_id=user_id, query=query, top=top)


@router.post("")
async def create_contact(
    payload: CreateContactRequest,
    user_id: str = Depends(get_user_id),
):
    if not payload.name:
        raise HTTPException(status_code=400, detail="Name is required")
    return await ContactService.create_contact(
        user_id=user_id,
        name=payload.name,
        email=payload.email,
        phone=payload.phone,
        company=payload.company,
        job_title=payload.job_title,
    )


@router.delete("/{contact_id}")
async def delete_contact(
    contact_id: str,
    user_id: str = Depends(get_user_id),
):
    return await ContactService.delete_contact(user_id=user_id, contact_id=contact_id)
