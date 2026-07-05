from fastapi import APIRouter, Depends

from app.db.supabase_client import get_user_id
from app.tools.graph_client import graph_get

router = APIRouter(prefix="/api/graph/calendar", tags=["calendar"])


@router.get("/events")
async def events(user_id: str = Depends(get_user_id)):
    return await graph_get(user_id, "/me/events?$top=50&$orderby=start/dateTime")
