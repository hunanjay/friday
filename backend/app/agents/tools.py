from urllib.parse import quote

from fastapi import HTTPException
from langchain_core.tools import tool

from app.tools.graph_client import graph_delete, graph_get, graph_patch, graph_post
from app.tools.html_sanitizer import sanitize_html_to_text

_NOT_CONNECTED = (
    "The user's Microsoft account isn't connected, or the connection has "
    "expired. Tell them to sign in again to reconnect Outlook/Calendar access."
)

# ponytail: only the well-known folders Graph exposes by fixed name. A custom
# folder lookup (by display name -> id) would need an extra Graph call and
# isn't needed until someone actually asks for a folder outside this list.
_MAIL_FOLDERS = {
    "inbox": "inbox",
    "drafts": "drafts",
    "sent": "sentItems",
    "deleted": "deletedItems",
    "junk": "junkemail",
    "archive": "archive",
}

_EMAIL_DETAIL_FIELDS = (
    "id,subject,from,toRecipients,ccRecipients,receivedDateTime,"
    "bodyPreview,body,hasAttachments,importance,isRead"
)


async def _graph(coro):
    """Runs a graph_client call and turns auth-related HTTPExceptions into a
    plain string for the model, since LangGraph's ToolNode doesn't catch
    FastAPI's HTTPException and would otherwise crash the whole agent turn.
    Returns (result, error_message); error_message is None on success."""
    try:
        return await coro, None
    except HTTPException as e:
        if e.status_code in (401, 404):
            return None, _NOT_CONNECTED
        raise


def _format_email_row(m: dict) -> str:
    unread = "" if m.get("isRead", True) else "[UNREAD] "
    sender = m.get("sender", {}).get("emailAddress", {}).get("address")
    return (
        f"- {unread}id={m['id']} from={sender} "
        f"subject={m.get('subject')!r} preview={m.get('bodyPreview', '')[:120]!r}"
    )


def make_mail_tools(user_id: str) -> list:
    @tool
    async def list_inbox(top: int = 10, folder: str = "inbox") -> str:
        """List the most recent messages in a mail folder (subject, sender, preview).
        `folder` is one of: inbox, drafts, sent, deleted, junk, archive."""
        graph_folder = _MAIL_FOLDERS.get(folder, "inbox")
        data, err = await _graph(
            graph_get(user_id, f"/me/mailFolders/{graph_folder}/messages?$top={top}&$orderby=receivedDateTime desc")
        )
        if err:
            return err
        messages = data.get("value", [])
        if not messages:
            return f"No messages in {folder}."
        return "\n".join(_format_email_row(m) for m in messages)

    @tool
    async def search_emails(
        query: str = "",
        folder: str = "inbox",
        unread_only: bool = False,
        has_attachments: bool = False,
        top: int = 10,
    ) -> str:
        """Search emails by free-text `query` (matches subject/body/sender), optionally
        narrowed to unread-only and/or has-attachments. `folder` is one of: inbox,
        drafts, sent, deleted, junk, archive."""
        graph_folder = _MAIL_FOLDERS.get(folder, "inbox")
        path = f"/me/mailFolders/{graph_folder}/messages?$top={top}"
        if query:
            path += f"&$search=\"{quote(query)}\""
        else:
            filters = []
            if unread_only:
                filters.append("isRead eq false")
            if has_attachments:
                filters.append("hasAttachments eq true")
            if filters:
                path += f"&$filter={quote(' and '.join(filters))}"
            path += "&$orderby=receivedDateTime desc"
        data, err = await _graph(graph_get(user_id, path))
        if err:
            return err
        messages = data.get("value", [])
        if not messages:
            return "No emails matched that search."
        return "\n".join(_format_email_row(m) for m in messages)

    @tool
    async def read_email(email_id: str) -> str:
        """Read the full content of one email by id (get the id from list_inbox or
        search_emails first). HTML bodies are sanitized to visible text only."""
        data, err = await _graph(
            graph_get(user_id, f"/me/messages/{quote(email_id)}?$select={_EMAIL_DETAIL_FIELDS}")
        )
        if err:
            return err
        sender = data.get("from", {}).get("emailAddress", {})
        to = ", ".join(r["emailAddress"]["address"] for r in data.get("toRecipients", []))
        body = data.get("body") or {}
        content = body.get("content", data.get("bodyPreview", ""))
        text = sanitize_html_to_text(content) if body.get("contentType") == "html" else content
        return (
            f"From: {sender.get('name')} <{sender.get('address')}>\n"
            f"To: {to}\n"
            f"Subject: {data.get('subject')}\n"
            f"Date: {data.get('receivedDateTime')}\n"
            f"Has Attachments: {data.get('hasAttachments')}\n\n"
            f"{text}"
        )

    @tool
    async def send_email(to: str, subject: str, body: str) -> str:
        """Send an email on the user's behalf. `to` is a single recipient email address."""
        _, err = await _graph(
            graph_post(
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
        )
        if err:
            return err
        return f"Email sent to {to}."

    @tool
    async def mark_email_read(email_id: str, is_read: bool = True) -> str:
        """Mark an email as read or unread by id."""
        _, err = await _graph(graph_patch(user_id, f"/me/messages/{quote(email_id)}", {"isRead": is_read}))
        if err:
            return err
        return f"Email {email_id} marked as {'read' if is_read else 'unread'}."

    @tool
    async def delete_email(email_id: str, permanent: bool = False) -> str:
        """Delete an email by id. By default moves it to Deleted Items; pass
        permanent=True to bypass Deleted Items and remove it immediately."""
        if permanent:
            _, err = await _graph(graph_post(user_id, f"/me/messages/{quote(email_id)}/permanentDelete", {}))
        else:
            _, err = await _graph(
                graph_post(user_id, f"/me/messages/{quote(email_id)}/move", {"destinationId": "deleteditems"})
            )
        if err:
            return err
        return f"Email {email_id} deleted{' permanently' if permanent else ' (moved to Deleted Items)'}."

    return [list_inbox, search_emails, read_email, send_email, mark_email_read, delete_email]


def make_calendar_tools(user_id: str) -> list:
    @tool
    async def list_events(start: str, end: str) -> str:
        """List calendar events between two ISO 8601 datetimes, e.g. 2026-07-01T00:00:00Z."""
        path = f"/me/calendarView?startDateTime={start}&endDateTime={end}&$top=50&$orderby=start/dateTime"
        data, err = await _graph(graph_get(user_id, path))
        if err:
            return err
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
        created, err = await _graph(graph_post(user_id, "/me/events", body))
        if err:
            return err
        return f"Event created: id={created['id']} subject={subject}"

    @tool
    async def delete_event(event_id: str) -> str:
        """Delete a calendar event by its id (get the id from list_events first)."""
        _, err = await _graph(graph_delete(user_id, f"/me/events/{event_id}"))
        if err:
            return err
        return f"Event {event_id} deleted."

    @tool
    async def accept_event(event_id: str, comment: str = "") -> str:
        """Accept a calendar event invitation by its id."""
        _, err = await _graph(graph_post(user_id, f"/me/events/{event_id}/accept", {"comment": comment}))
        if err:
            return err
        return f"Event {event_id} accepted."

    @tool
    async def decline_event(event_id: str, comment: str = "") -> str:
        """Decline a calendar event invitation by its id."""
        _, err = await _graph(graph_post(user_id, f"/me/events/{event_id}/decline", {"comment": comment}))
        if err:
            return err
        return f"Event {event_id} declined."

    return [list_events, create_event, delete_event, accept_event, decline_event]


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
