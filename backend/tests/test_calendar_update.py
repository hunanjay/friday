#!/usr/bin/env python3
"""Partial-update semantics for calendar edits: omitted fields must survive.

Covers both entry points, since the body is built twice - once in the REST
route the UI calls, once in the agent tool the model calls.
"""

import asyncio
import os
import sys
from unittest.mock import patch

backend_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
sys.path.insert(0, backend_dir)

# app.core.security builds a Supabase client at import time; CI leaves these
# unset (same stubs as test_smoke.py).
for _var, _stub in (
    ("SUPABASE_URL", "https://test.supabase.co"),
    ("SUPABASE_ANON_KEY", "test-anon-key"),
    ("SUPABASE_SERVICE_ROLE_KEY", "test-service-key"),
):
    os.environ[_var] = os.environ.get(_var) or _stub

from app.agents.tools import make_calendar_tools  # noqa: E402
from app.api.calendar import EventUpdate, update_event as route_update_event  # noqa: E402

USER = "test-user-calendar-update"
EVENT_ID = "AAMkAD+needs=escaping"

failures: list[str] = []


def check(name: str, condition: bool, detail: str = "") -> None:
    print(f"{'PASS' if condition else 'FAIL'}  {name}{f' - {detail}' if detail else ''}")
    if not condition:
        failures.append(name)


def _tool(name: str):
    return next(t for t in make_calendar_tools(USER) if t.name == name)


async def main() -> None:
    calls: list[tuple] = []

    async def fake_patch(user_id, path, json):
        calls.append((user_id, path, json))
        return {"id": EVENT_ID}

    update = _tool("update_event")
    check("update_event is registered on the calendar agent", update is not None)

    # Only the moved fields travel; subject and location are left untouched.
    with patch("app.agents.tools.graph_patch", fake_patch):
        result = await update.ainvoke(
            {"event_id": EVENT_ID, "start": "2026-09-01T14:00:00", "end": "2026-09-01T15:00:00"}
        )
    _, path, body = calls[-1]
    check("tool omits fields the caller did not pass", set(body) == {"start", "end"}, str(body))
    check("tool sends a timezone with each datetime",
          body["start"]["timeZone"] and body["end"]["timeZone"] == body["start"]["timeZone"])
    # ponytail: quote() keeps its default safe="/", matching every other Graph
    # call site in app/ (18 of them), so an id containing "/" would still break
    # the path. Repo-wide fix, not a calendar one - see delete_event and the
    # mail tools.
    check("tool escapes the event id into the path", "AAMkAD%2Bneeds%3Descaping" in path, path)
    check("tool reports success to the model", "updated" in result.lower(), result)

    # A subject-only rename must not blank out start/end.
    calls.clear()
    with patch("app.agents.tools.graph_patch", fake_patch):
        await update.ainvoke({"event_id": EVENT_ID, "subject": "Renamed"})
    check("rename touches subject alone", set(calls[-1][2]) == {"subject"}, str(calls[-1][2]))

    # No fields at all must not fire a Graph write that blanks the event.
    calls.clear()
    with patch("app.agents.tools.graph_patch", fake_patch):
        empty = await update.ainvoke({"event_id": EVENT_ID})
    check("empty update makes no Graph call", not calls)
    check("empty update tells the model what is missing", "at least one" in empty, empty)

    # Same guarantees on the REST route the calendar UI calls.
    calls.clear()
    with patch("app.api.calendar.graph_patch", fake_patch):
        await route_update_event(EVENT_ID, EventUpdate(location="Room 2"), user_id=USER)
    check("route omits unset fields", set(calls[-1][2]) == {"location"}, str(calls[-1][2]))

    # An explicit empty string is a real edit (clear the location), unlike None.
    calls.clear()
    with patch("app.api.calendar.graph_patch", fake_patch):
        await route_update_event(EVENT_ID, EventUpdate(location=""), user_id=USER)
    check("route treats an explicit empty string as a clear",
          calls[-1][2] == {"location": {"displayName": ""}}, str(calls[-1][2]))

    gets: list = []

    async def fake_get(user_id, path, extra_headers=None):
        gets.append(path)
        return {"id": EVENT_ID}

    calls.clear()
    with patch("app.api.calendar.graph_patch", fake_patch), patch("app.api.calendar.graph_get", fake_get):
        await route_update_event(EVENT_ID, EventUpdate(), user_id=USER)
    check("empty route body reads instead of writing", not calls and len(gets) == 1)


asyncio.run(main())
print()
if failures:
    print(f"{len(failures)} check(s) failed: {', '.join(failures)}")
    sys.exit(1)
print("All calendar update checks passed.")
