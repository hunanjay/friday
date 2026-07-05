from fastapi import APIRouter, Depends, HTTPException

from app.db.supabase_client import get_user_id
from app.db.token_store import set_ms_token

router = APIRouter(prefix="/api/graph", tags=["auth"])


@router.post("/token")
def store_graph_token(body: dict, user_id: str = Depends(get_user_id)):
    ms_token = body.get("ms_token")
    if not ms_token:
        raise HTTPException(status_code=400, detail="ms_token is required")
    set_ms_token(user_id, ms_token)
    return {"status": "ok"}
