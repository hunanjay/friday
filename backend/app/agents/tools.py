import logging
import os
from urllib.parse import quote

from fastapi import HTTPException
from langchain_core.tools import tool

from app.infrastructure.db.repositories import memos as memos_db, pending_actions
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
    async def search_contacts(query: str = "") -> str:
        """Search the user's Personal Contact Relationship Brain by name, email, company, job title, tags, or memory facts."""
        from app.services.contact_service import ContactService
        contacts = await ContactService.get_contacts(user_id=user_id, query=query)
        if not contacts:
            return "No contacts matched that search."
        lines = []
        for c in contacts[:15]:
            tags_str = f" [Tags: {', '.join(c.get('tags', []))}]" if c.get("tags") else ""
            facts_list = []
            for p in c.get("profiles", []):
                facts_list.append(f"{p.get('fact_key', '')}: {p.get('fact_value', '')}")
            facts_str = f" | Memory Facts: {'; '.join(facts_list)}" if facts_list else ""
            lines.append(f"- {c['name']} <{c.get('email', '')}> | Company: {c.get('company', '')} | Job: {c.get('jobTitle', '')}{tags_str}{facts_str}")
        return "\n".join(lines)

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

    @tool
    async def record_contact_fact(
        contact_name: str,
        dimension: str,
        category: str,
        fact_key: str,
        fact_value: str,
    ) -> str:
        """Record a single explicit memory fact for a contact into the Personal Relationship Brain.
        
        WHEN TO USE:
        Use ONLY when the user gives a single, explicit fact update about a contact in casual conversation 
        (e.g., "Note down that Zhang Ming likes Pu'er tea", "Zhang Ming just bought an AITO M9 car").
        Do NOT use for long chat logs or raw multi-sentence text — use `extract_contact_memory` instead.
        
        PARAMETERS:
        - `contact_name` (str, REQUIRED): Contact's full name or name used in conversation. If not found in DB, a new contact will be auto-created.
        - `dimension` (str, REQUIRED): MUST be strictly one of:
            * 'basic': Static personal info (hometown, school, birthday)
            * 'business': Professional context (company size, investment focus, tech stack, budget)
            * 'private': Personal habits/lifestyle (diet, coffee/tea preference, vehicle, family, health)
            * 'dynamic': Recent events/activities (travel plans, recent purchases, upcoming meetings)
        - `category` (str, REQUIRED): MUST be one of: 'preference', 'pain_point', 'demand', 'family', 'anniversary', 'event', 'other'.
        - `fact_key` (str, REQUIRED): Short snake_case identifier (e.g., 'tea_preference', 'car_model', 'travel_destination').
        - `fact_value` (str, REQUIRED): The actual fact content (e.g., 'Likes hot Pu'er tea', 'AITO M9', 'San Francisco next Tuesday').
        """
        from app.services.contact_service import ContactService
        from app.infrastructure.db.repositories import contacts as contacts_repo

        contacts = await ContactService.get_contacts(user_id=user_id, query=contact_name)
        if contacts:
            contact_id = contacts[0]["id"]
            cname = contacts[0]["name"]
        else:
            new_c = await ContactService.create_contact(user_id=user_id, name=contact_name)
            contact_id = new_c["id"]
            cname = new_c["name"]

        # Normalize and validate dimension against strict whitelist
        dim_clean = dimension.strip().lower()
        if dim_clean not in ("basic", "business", "private", "dynamic"):
            dim_clean = "private"

        cat_clean = category.strip().lower()
        if cat_clean not in ("preference", "pain_point", "demand", "family", "anniversary", "event", "other"):
            cat_clean = "other"

        fact = await contacts_repo.add_contact_profile(
            user_id=user_id,
            contact_id=contact_id,
            dimension=dim_clean,
            category=cat_clean,
            fact_key=fact_key.strip(),
            fact_value=fact_value.strip(),
        )
        return f"Successfully recorded memory fact for {cname}: [{dim_clean} / {cat_clean}] {fact_key} = {fact_value} (fact_id: {fact['id']})."

    @tool
    async def extract_contact_memory(text: str) -> str:
        """Deeply analyze and extract structured profiles, 4-dimension facts, tags, and timeline events from raw text into the Relationship Brain.
        
        WHEN TO USE:
        Use when the user pastes a raw chat log, a long dialogue snippet, or multi-topic unstructured meeting notes 
        and requests archiving, extracting, or summarizing contact memory.
        
        PARAMETERS:
        - `text` (str, REQUIRED): The full raw text / conversation transcript to analyze. Must be non-empty.
        """
        if not text or not text.strip():
            return "Error: text argument cannot be empty for memory extraction."

        from app.services.contact_brain_service import ContactBrainService
        try:
            res = await ContactBrainService.extract_and_save(user_id=user_id, raw_text=text)
            c = res.get("contact", {})
            profs = res.get("extracted_profiles", [])
            return f"Successfully extracted memory for contact '{c.get('name')}' with {len(profs)} facts recorded and archived to Relationship Brain."
        except Exception as exc:
            return f"Failed to extract contact memory: {str(exc)}"

    return [
        list_inbox,
        search_contacts,
        record_contact_fact,
        extract_contact_memory,
        search_emails,
        read_email,
        send_email,
        mark_email_read,
        delete_email,
    ]


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
    row = f"- id={m['id']} category={m['category']} title={m['title']!r}: {m.get('content', '')[:200]!r}"
    atts = m.get("attachments") or []
    if atts:
        att_parts = []
        for a in atts:
            if isinstance(a, dict):
                name = a.get("name") or "attachment"
                ext_text = a.get("extracted_text") or ""
                if ext_text:
                    att_parts.append(f"{name}: {ext_text[:300]}")
                else:
                    att_parts.append(name)
        if att_parts:
            row += f" [Attachments: {'; '.join(att_parts)}]"
    return row


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


import re as _re

# Pronouns and question words that typically signal an ambiguous/follow-up query
_AMBIGUOUS_PATTERNS = _re.compile(
    r"(它|他|她|这个|那个|这些|那些|其中|上面|前面|刚才|是什么|有哪些|怎么|如何|什么时候|为什么|how|what|which|it |they |this |that )",
    _re.IGNORECASE,
)


def _needs_rewrite(query: str) -> bool:
    """Fast heuristic: return True only when the query is likely ambiguous or
    too short to stand alone as a retrieval query."""
    q = query.strip()
    # Very short queries almost always lack context
    if len(q) <= 6:
        return True
    # Contains ambiguous pronouns or question words without specifics
    if _AMBIGUOUS_PATTERNS.search(q):
        return True
    return False


async def _rewrite_search_query(user_query: str) -> str:
    """Explicitly rewrite short or ambiguous user queries into standalone,
    semantically rich queries to boost vector RAG recall.

    Fast-path: clear queries (e.g. 'ACP考试大纲 技能要求') skip the LLM entirely.
    Slow-path: ambiguous queries (e.g. '技能要求是什么？') get an LLM rewrite.
    """
    if not user_query:
        return user_query

    # ⚡ Fast-path: query is already specific enough — skip LLM call entirely
    if not _needs_rewrite(user_query):
        logging.debug("Query rewrite skipped (fast-path): %r", user_query)
        return user_query

    # 🐢 Slow-path: invoke LLM to produce a standalone contextual search query
    try:
        from app.agents.supervisor import _get_model
        llm = _get_model()
        resp = await llm.ainvoke([
            {
                "role": "system",
                "content": (
                    "You are a search query rewriting specialist for RAG vector retrieval. "
                    "The user's query is short, ambiguous, or uses pronouns like 'it/they/this'. "
                    "Rewrite it into a clear, standalone, semantically rich search query "
                    "that contains all the key topics and entities needed for retrieval. "
                    "Do NOT answer the question. Reply with ONLY the rewritten query in the same language."
                ),
            },
            {"role": "user", "content": user_query},
        ])
        rewritten = resp.content.strip().strip('"')
        if rewritten:
            logging.info("RAG Query Rewrite (slow-path): %r -> %r", user_query, rewritten)
            return rewritten
    except Exception as e:
        logging.warning("Query rewriting failed, using original query: %s", e)
    return user_query


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
        # 1. Explicit Query Rewriting for RAG Recall
        target_query = await _rewrite_search_query(query)

        # 2. Perform Qdrant Vector Search
        try:
            results = await vector_store.search_memos(user_id, target_query, limit)
            if results:
                return "\n".join(_format_memo_row(r) for r in results)
        except Exception:
            logging.exception("search_memos failed on Qdrant, falling back to Postgres DB")

        # 3. Fallback to Postgres DB keyword search if Qdrant is offline/timing out or returned empty
        try:
            memos = await memos_db.list_memos(user_id)
            q_terms = [t.strip().lower() for t in target_query.split() if t.strip()]
            matched = []
            for m in memos:
                t_lower = m["title"].lower()
                c_lower = m["content"].lower()
                att_texts = " ".join(
                    a.get("extracted_text", "").lower()
                    for a in (m.get("attachments") or [])
                    if isinstance(a, dict)
                )
                full_text = f"{t_lower} {c_lower} {att_texts}"
                if any(term in full_text for term in q_terms):
                    matched.append(m)
            if not matched:
                return f"No memos matched query {query!r}."
            return "\n".join(_format_memo_row(r) for r in matched[:limit])
        except Exception:
            logging.exception("Postgres DB fallback failed in search_memos")
            return "No memos matched that search."

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
