from fastapi import APIRouter, Depends, Query

from app.db.supabase_client import get_user_id
from app.tools.graph_client import graph_get

router = APIRouter(prefix="/api/graph/calendar", tags=["calendar"])


@router.get("/events")
async def events(
    # ponytail: fixed 2-year window instead of syncing to the visible month;
    # add start/end passthrough from the frontend if the app needs to page
    # further out.
    start: str = Query("2025-01-01T00:00:00Z"),
    end: str = Query("2027-01-01T00:00:00Z"),
    user_id: str = Depends(get_user_id),
):
    # calendarView expands recurring events into their concrete occurrences
    # within [start, end); /me/events returns only the series master with its
    # original (often past) start time, which never matches the visible month.
    path = f"/me/calendarView?startDateTime={start}&endDateTime={end}&$top=100&$orderby=start/dateTime"
    # Frontend displays event.start/end.dateTime digits as-is (no timezone
    # math), so ask Graph to return them already in Beijing time - matching
    # what create_event now writes (see agents/tools.py's _BEIJING_TZ).
    return await graph_get(user_id, path, extra_headers={"Prefer": 'outlook.timezone="China Standard Time"'})
