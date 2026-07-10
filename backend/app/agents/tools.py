import logging
import os
from datetime import datetime, timedelta, timezone
from urllib.parse import quote

from fastapi import HTTPException
from langchain_core.tools import tool

from app.db import memos as memos_db
from app.tools import vector_store
from app.tools.github_client import github_get
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


def make_mail_tools(user_id: str) -> list:
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


_BEIJING_TZ = "China Standard Time"  # Graph's Windows tz id for UTC+8, no DST


def make_calendar_tools(user_id: str) -> list:
    @tool
    async def list_events(start: str, end: str) -> str:
        """List calendar events between two ISO 8601 datetimes in Beijing time
        (Asia/Shanghai, UTC+8), e.g. 2026-07-01T00:00:00."""
        path = f"/me/calendarView?startDateTime={start}&endDateTime={end}&$top=50&$orderby=start/dateTime"
        data, err = await _graph(
            graph_get(user_id, path, extra_headers={"Prefer": f'outlook.timezone="{_BEIJING_TZ}"'})
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
        """Create a calendar event. `start`/`end` are ISO 8601 datetimes in Beijing
        time (Asia/Shanghai, UTC+8), e.g. 2026-07-10T20:00:00 for 8pm Beijing time."""
        body = {
            "subject": subject,
            "start": {"dateTime": start, "timeZone": _BEIJING_TZ},
            "end": {"dateTime": end, "timeZone": _BEIJING_TZ},
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
    repo = os.environ.get("GITHUB_REPORT_REPO", "hunanjay/friday")

    @tool
    async def list_todays_commits() -> str:
        """List today's commits (Beijing time, UTC+8) on the user's project repo,
        with full commit messages. Use this to gather raw material for a work
        report - do not fabricate commits not returned here."""
        beijing = timezone(timedelta(hours=8))
        start_of_day = datetime.now(beijing).replace(hour=0, minute=0, second=0, microsecond=0)
        now = datetime.now(beijing)
        since = start_of_day.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        until = now.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        # ponytail: no author filter, single-contributor repo - add one if
        # `friday` ever gets a second contributor.
        data, err = await _github(
            github_get(user_id, f"/repos/{repo}/commits?since={since}&until={until}&per_page=100")
        )
        if err:
            return err
        if not data:
            return "No commits today."
        return "\n\n".join(
            f"- sha={c['sha'][:7]} author={c['commit']['author']['name']} date={c['commit']['author']['date']}\n"
            f"  {c['commit']['message']}"
            for c in data
        )

    return [list_todays_commits, _make_create_memo_tool(user_id)]
