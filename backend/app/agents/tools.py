from langchain_core.tools import tool

from app.tools.graph_client import graph_delete, graph_get, graph_post


def make_mail_tools(user_id: str) -> list:
    @tool
    async def list_inbox(top: int = 10) -> str:
        """List the most recent messages in the user's inbox (subject, sender, preview)."""
        data = await graph_get(user_id, f"/me/mailFolders/inbox/messages?$top={top}")
        messages = data.get("value", [])
        if not messages:
            return "Inbox is empty."
        return "\n".join(
            f"- id={m['id']} from={m.get('sender', {}).get('emailAddress', {}).get('address')} "
            f"subject={m.get('subject')!r} preview={m.get('bodyPreview', '')[:120]!r}"
            for m in messages
        )

    @tool
    async def send_email(to: str, subject: str, body: str) -> str:
        """Send an email on the user's behalf. `to` is a single recipient email address."""
        await graph_post(
            user_id,
            "/me/sendMail",
            {
                "message": {
                    "subject": subject,
                    "body": {"contentType": "Text", "content": body},
                    "toRecipients": [{"emailAddress": {"address": to}}],
                },
                "saveToSentItems": True,
            },
        )
        return f"Email sent to {to}."

    return [list_inbox, send_email]


def make_calendar_tools(user_id: str) -> list:
    @tool
    async def list_events(start: str, end: str) -> str:
        """List calendar events between two ISO 8601 datetimes, e.g. 2026-07-01T00:00:00Z."""
        path = f"/me/calendarView?startDateTime={start}&endDateTime={end}&$top=50&$orderby=start/dateTime"
        data = await graph_get(user_id, path)
        events = data.get("value", [])
        if not events:
            return "No events in that range."
        return "\n".join(
            f"- id={e['id']} subject={e.get('subject')!r} start={e['start']['dateTime']} end={e['end']['dateTime']}"
            for e in events
        )

    @tool
    async def create_event(subject: str, start: str, end: str, location: str = "") -> str:
        """Create a calendar event. `start`/`end` are ISO 8601 datetimes in UTC, e.g. 2026-07-10T15:00:00."""
        body = {
            "subject": subject,
            "start": {"dateTime": start, "timeZone": "UTC"},
            "end": {"dateTime": end, "timeZone": "UTC"},
        }
        if location:
            body["location"] = {"displayName": location}
        created = await graph_post(user_id, "/me/events", body)
        return f"Event created: id={created['id']} subject={subject}"

    @tool
    async def delete_event(event_id: str) -> str:
        """Delete a calendar event by its id (get the id from list_events first)."""
        await graph_delete(user_id, f"/me/events/{event_id}")
        return f"Event {event_id} deleted."

    return [list_events, create_event, delete_event]


def make_memos_tools(user_id: str) -> list:
    # ponytail: memos have no backend store yet (frontend keeps them in
    # localStorage only) - this is a registered entry point so the supervisor
    # can route memo requests somewhere, not a real read/write path yet.
    # Upgrade: back this with a Supabase `memos` table (mirroring ms_tokens)
    # once the frontend is ready to sync memos server-side.
    @tool
    async def create_memo(text: str) -> str:
        """Save a memo/note for the user. Not yet persisted server-side."""
        return (
            "Memos aren't backed by server storage yet - ask the user to jot "
            f"this down in the Memos tab: {text!r}"
        )

    return [create_memo]
