from fastapi import APIRouter, Depends

from app.db.supabase_client import get_user_id
from app.tools.graph_client import graph_get

router = APIRouter(prefix="/api/graph/mail", tags=["mail"])


@router.get("/inbox")
async def inbox(user_id: str = Depends(get_user_id)):
    return await graph_get(user_id, "/me/mailFolders/inbox/messages?$top=25")
