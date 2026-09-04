from urllib.parse import quote

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel

from app.core.security import get_user_id
from app.tools.graph_client import graph_delete, graph_get, graph_patch, graph_post

router = APIRouter(prefix="/api/graph/calendar", tags=["calendar"])

# Matches the Prefer header below and agents/tools.py's create_event, so
# manually-created and agent-created events land in the same timezone.
_BEIJING_TZ = "China Standard Time"


class EventCreate(BaseModel):
    subject: str
    start: str  # ISO 8601, no offset - interpreted in _BEIJING_TZ
    end: str
    location: str = ""
    categories: list[str] = []


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
    return await graph_get(user_id, path, extra_headers={"Prefer": f'outlook.timezone="{_BEIJING_TZ}"'})


@router.post("/events")
async def create_event(body: EventCreate, user_id: str = Depends(get_user_id)):
    graph_body = {
        "subject": body.subject,
        "start": {"dateTime": body.start, "timeZone": _BEIJING_TZ},
        "end": {"dateTime": body.end, "timeZone": _BEIJING_TZ},
    }
    if body.location:
        graph_body["location"] = {"displayName": body.location}
    if body.categories:
        graph_body["categories"] = body.categories
    return await graph_post(user_id, "/me/events", graph_body)


class EventUpdate(BaseModel):
    # All optional: Graph PATCH is a partial update, so omitting a field must
    # leave it alone rather than blank it. start/end still travel as a pair -
    # Graph rejects a lone dateTime without its timeZone.
    subject: str | None = None
    start: str | None = None
    end: str | None = None
    location: str | None = None
    categories: list[str] | None = None


@router.patch("/events/{event_id}")
async def update_event(event_id: str, body: EventUpdate, user_id: str = Depends(get_user_id)):
    graph_body: dict = {}
    if body.subject is not None:
        graph_body["subject"] = body.subject
    if body.start is not None:
        graph_body["start"] = {"dateTime": body.start, "timeZone": _BEIJING_TZ}
    if body.end is not None:
        graph_body["end"] = {"dateTime": body.end, "timeZone": _BEIJING_TZ}
    if body.location is not None:
        graph_body["location"] = {"displayName": body.location}
    if body.categories is not None:
        graph_body["categories"] = body.categories
    if not graph_body:
        return await graph_get(user_id, f"/me/events/{quote(event_id)}")
    return await graph_patch(user_id, f"/me/events/{quote(event_id)}", graph_body)


@router.delete("/events/{event_id}")
async def delete_event(event_id: str, user_id: str = Depends(get_user_id)):
    await graph_delete(user_id, f"/me/events/{quote(event_id)}")
    return {"ok": True}
