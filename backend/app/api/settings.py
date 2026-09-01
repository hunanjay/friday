from fastapi import APIRouter, Depends, HTTPException

from app.core.security import get_user_id
from app.infrastructure.db.repositories import signature_templates, user_settings as user_settings_db
from app.services.avatar_gallery import list_avatar_presets

router = APIRouter(prefix="/api/settings", tags=["settings"])


@router.get("/assistant-name")
async def get_assistant_name(user_id: str = Depends(get_user_id)):
    return {"assistant_name": await user_settings_db.get_assistant_name(user_id)}


@router.put("/assistant-name")
async def set_assistant_name(body: dict, user_id: str = Depends(get_user_id)):
    name = body.get("assistant_name")
    if not isinstance(name, str) or not name.strip():
        raise HTTPException(status_code=422, detail="assistant_name is required")
    name = name.strip()
    if len(name) > 40:
        raise HTTPException(status_code=422, detail="assistant_name must be 40 characters or fewer")
    return {"assistant_name": await user_settings_db.set_assistant_name(user_id, name)}


@router.get("/avatar-presets")
async def get_avatar_presets(user_id: str = Depends(get_user_id)):
    return {"presets": list_avatar_presets()}


@router.get("/avatar")
async def get_avatar(user_id: str = Depends(get_user_id)):
    return {"avatar_url": await user_settings_db.get_avatar_url(user_id)}


@router.put("/avatar")
async def set_avatar(body: dict, user_id: str = Depends(get_user_id)):
    avatar_url = body.get("avatar_url")
    if not isinstance(avatar_url, str) or not avatar_url:
        raise HTTPException(status_code=422, detail="avatar_url is required")
    allowed = {preset["url"] for preset in list_avatar_presets()}
    if avatar_url not in allowed:
        raise HTTPException(status_code=422, detail="avatar_url must be one of the current presets")
    return {"avatar_url": await user_settings_db.set_avatar_url(user_id, avatar_url)}


MAX_SIGNATURE_LENGTH = 1000
MAX_SIGNATURE_NAME_LENGTH = 40


def _template_fields(body: dict) -> tuple[str, str]:
    name = body.get("name")
    if not isinstance(name, str) or not name.strip():
        raise HTTPException(status_code=422, detail="name is required")
    name = name.strip()
    if len(name) > MAX_SIGNATURE_NAME_LENGTH:
        raise HTTPException(
            status_code=422,
            detail=f"name must be {MAX_SIGNATURE_NAME_LENGTH} characters or fewer",
        )

    content = body.get("content")
    if not isinstance(content, str):
        raise HTTPException(status_code=422, detail="content must be a string")
    content = content.strip()
    if len(content) > MAX_SIGNATURE_LENGTH:
        raise HTTPException(
            status_code=422,
            detail=f"content must be {MAX_SIGNATURE_LENGTH} characters or fewer",
        )
    return name, content


@router.get("/signatures")
async def list_signatures(user_id: str = Depends(get_user_id)):
    """Every saved signature. The one flagged is_default is what gets appended."""
    return {"signatures": await signature_templates.list_templates(user_id)}


@router.post("/signatures", status_code=201)
async def create_signature(body: dict, user_id: str = Depends(get_user_id)):
    name, content = _template_fields(body)
    if await signature_templates.count_templates(user_id) >= signature_templates.MAX_TEMPLATES_PER_USER:
        raise HTTPException(
            status_code=422,
            detail=f"At most {signature_templates.MAX_TEMPLATES_PER_USER} signatures per account",
        )
    return {"signature": await signature_templates.create_template(user_id, name, content)}


@router.put("/signatures/{template_id}")
async def update_signature(template_id: str, body: dict, user_id: str = Depends(get_user_id)):
    name, content = _template_fields(body)
    updated = await signature_templates.update_template(user_id, template_id, name, content)
    if updated is None:
        raise HTTPException(status_code=404, detail="Signature not found")
    return {"signature": updated}


@router.put("/signatures/{template_id}/default")
async def set_default_signature(template_id: str, user_id: str = Depends(get_user_id)):
    """Switch which template outgoing mail is signed with."""
    if not await signature_templates.set_default(user_id, template_id):
        raise HTTPException(status_code=404, detail="Signature not found")
    return {"signatures": await signature_templates.list_templates(user_id)}


@router.delete("/signatures/{template_id}", status_code=204)
async def delete_signature(template_id: str, user_id: str = Depends(get_user_id)):
    if not await signature_templates.delete_template(user_id, template_id):
        raise HTTPException(status_code=404, detail="Signature not found")
