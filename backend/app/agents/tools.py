import logging
import os
from urllib.parse import quote

from fastapi import HTTPException
from langchain_core.tools import tool

from app.infrastructure.db.repositories import memos as memos_db
from app.infrastructure.db.repositories import pending_actions
from app.tools import vector_store
from app.tools.github_client import format_commits, list_commits
from app.tools.graph_client import graph_delete, graph_get, graph_get_paginated, graph_patch, graph_post
from app.tools.html_sanitizer import sanitize_html_to_text
from app.tools.mail_queries import MAIL_FOLDERS, search_path

_NOT_CONNECTED = (
    "The user's Microsoft account isn't connected, or the connection has "
    "expired. Tell them to sign in again to reconnect Outlook/Calendar access."
)

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


def make_mail_tools(user_id: str, session_id: str | None = None) -> list:
    @tool
    async def list_inbox(top: int = 10, folder: str = "inbox") -> str:
        """List the most recent messages in a mail folder (subject, sender, preview).
        `folder` is one of: inbox, drafts, sent, deleted, junk, archive."""
        graph_folder = MAIL_FOLDERS.get(folder, "inbox")
        path = f"/me/mailFolders/{graph_folder}/messages?$top={min(top, 50)}&$orderby=receivedDateTime desc"
        data, err = await _graph(graph_get_paginated(user_id, path, top))
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
        path = search_path(folder, query, unread_only, has_attachments, top)
        data, err = await _graph(graph_get_paginated(user_id, path, top))
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
        """Request approval to send an email. This tool cannot send anything itself:
        it creates a short-lived server-side request that only the user's confirmation
        button can execute. Call it once with the final recipient, subject, and body."""
        if not session_id:
            return "Email approval is unavailable outside an authenticated chat session."
        action = await pending_actions.create_action(
            user_id,
            session_id,
            "send_email",
            {"to": to, "subject": subject, "body": body},
        )
        return (
            f"Approval required (action {action['id']}). Nothing has been sent. "
            "The user must review the email and press Confirm and send in the chat UI."
        )

    @tool
    async def mark_email_read(email_id: str, is_read: bool = True) -> str:
        """Mark an email as read or unread by id."""
        _, err = await _graph(graph_patch(user_id, f"/me/messages/{quote(email_id)}", {"isRead": is_read}))
        if err:
            return err
        return f"Email {email_id} marked as {'read' if is_read else 'unread'}."

    @tool
    async def delete_email(email_id: str) -> str:
        """Request approval to move an email to Deleted Items. This tool cannot
        delete anything itself; only the user's confirmation button can execute
        the short-lived server-side request."""
        if not session_id:
            return "Email approval is unavailable outside an authenticated chat session."
        message, err = await _graph(
            graph_get(user_id, f"/me/messages/{quote(email_id)}?$select=id,subject,from")
        )
        if err:
            return err
        sender = (message.get("from") or {}).get("emailAddress") or {}
        action = await pending_actions.create_action(
            user_id,
            session_id,
            "delete_email",
            {
                "email_id": email_id,
                "subject": message.get("subject") or "(no subject)",
                "sender": sender.get("address") or sender.get("name") or "",
            },
        )
        return (
            f"Approval required (action {action['id']}). Nothing has been deleted. "
            "The user must review the message and press Confirm delete in the chat UI."
        )

    return [list_inbox, search_emails, read_email, send_email, mark_email_read, delete_email]


# Maps IANA timezone names to Microsoft Graph's Windows tz IDs.
# Graph's calendarView requires the Windows format; add entries here as needed.
_IANA_TO_GRAPH_TZ = {
    "Asia/Shanghai": "China Standard Time",
    "Asia/Hong_Kong": "China Standard Time",
    "Asia/Taipei": "Taipei Standard Time",
    "Asia/Tokyo": "Tokyo Standard Time",
    "America/New_York": "Eastern Standard Time",
    "America/Los_Angeles": "Pacific Standard Time",
    "Europe/London": "GMT Standard Time",
    "Europe/Berlin": "W. Europe Standard Time",
    "UTC": "UTC",
}


def _graph_tz() -> str:
    """Returns the Graph Windows tz ID for the configured TIMEZONE, falling
    back to China Standard Time (UTC+8) if the env var is unset or unrecognised."""
    iana = os.environ.get("TIMEZONE", "Asia/Shanghai")
    graph_tz = _IANA_TO_GRAPH_TZ.get(iana)
    if not graph_tz:
        import logging
        logging.warning("TIMEZONE %r has no Graph mapping, falling back to China Standard Time", iana)
        return "China Standard Time"
    return graph_tz


def make_calendar_tools(user_id: str) -> list:
    @tool
    async def list_events(start: str, end: str) -> str:
        """List calendar events between two ISO 8601 datetimes in the user's
        local timezone (configured via TIMEZONE env var, default Asia/Shanghai).
        Example: 2026-07-01T00:00:00."""
        path = f"/me/calendarView?startDateTime={start}&endDateTime={end}&$top=50&$orderby=start/dateTime"
        data, err = await _graph(
            graph_get(user_id, path, extra_headers={"Prefer": f'outlook.timezone="{_graph_tz()}"'})
        )
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
        """Create a calendar event. `start`/`end` are ISO 8601 datetimes in the
        user's local timezone (configured via TIMEZONE env var, default Asia/Shanghai).
        Example: 2026-07-10T20:00:00 for 8pm local time."""
        tz = _graph_tz()
        body = {
            "subject": subject,
            "start": {"dateTime": start, "timeZone": tz},
            "end": {"dateTime": end, "timeZone": tz},
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


def _format_memo_row(m: dict) -> str:
    return f"- id={m['id']} category={m['category']} title={m['title']!r}: {m['content'][:200]!r}"


def _make_create_memo_tool(user_id: str):
    @tool
    async def create_memo(title: str, content: str, category: str = "ideas") -> str:
        """Save a memo/note for the user. `category` is one of: work, ideas, notes, snippets."""
        memo = await memos_db.create_memo(user_id, title, content, category, "beige")
        try:
            await vector_store.upsert_memo(user_id, memo["id"], title, content, category)
        except Exception:
            logging.exception("failed to index memo %s in Qdrant", memo["id"])
        return f"Memo saved: id={memo['id']} title={title!r}"

    return create_memo


def make_memos_tools(user_id: str) -> list:
    @tool
    async def list_memos(top: int = 20) -> str:
        """List the user's most recently updated/pinned memos (not a search -
        no relevance ranking). Use this for open-ended requests like "show me
        my memos" where there's no specific question to search for yet."""
        memos = (await memos_db.list_memos(user_id))[:max(1, min(top, 50))]
        if not memos:
            return "The user has no memos yet."
        return "\n".join(_format_memo_row(m) for m in memos)

    @tool
    async def search_memos(query: str, limit: int = 5) -> str:
        """Hybrid (semantic + keyword) search over the user's memos/notes. Use
        this before answering anything that might be covered by something the
        user previously jotted down."""
        results = await vector_store.search_memos(user_id, query, limit)
        if not results:
            return "No memos matched that search."
        return "\n".join(_format_memo_row(r) for r in results)

    return [list_memos, _make_create_memo_tool(user_id), search_memos]


_GITHUB_NOT_CONNECTED = (
    "The user's GitHub account isn't connected, or the connection was revoked. "
    "Tell them to connect GitHub (see the sidebar) to generate a report."
)


async def _github(coro):
    try:
        return await coro, None
    except HTTPException as e:
        if e.status_code in (401, 404):
            return None, _GITHUB_NOT_CONNECTED
        raise


def make_github_tools(user_id: str) -> list:
    @tool
    async def list_todays_commits() -> str:
        """List today's commits (Beijing time, UTC+8) across all of the user's
        selected GitHub repos, with full commit messages. Use this to gather
        raw material for a work report - do not fabricate commits not
        returned here."""
        data, err = await _github(list_commits(user_id))
        if err:
            return err
        return format_commits(data)

    return [list_todays_commits, _make_create_memo_tool(user_id)]
