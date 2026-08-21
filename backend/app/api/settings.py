from fastapi import APIRouter, Depends, HTTPException

from app.core.security import get_user_id
from app.infrastructure.db.repositories import user_settings as user_settings_db
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


@router.get("/signature")
async def get_signature(user_id: str = Depends(get_user_id)):
    return {"signature": await user_settings_db.get_signature(user_id)}


@router.put("/signature")
async def set_signature(body: dict, user_id: str = Depends(get_user_id)):
    """Set the block appended to every outgoing email. Empty string clears it."""
    signature = body.get("signature")
    if not isinstance(signature, str):
        raise HTTPException(status_code=422, detail="signature must be a string")
    signature = signature.strip()
    if len(signature) > MAX_SIGNATURE_LENGTH:
        raise HTTPException(
            status_code=422,
            detail=f"signature must be {MAX_SIGNATURE_LENGTH} characters or fewer",
        )
    return {"signature": await user_settings_db.set_signature(user_id, signature)}
