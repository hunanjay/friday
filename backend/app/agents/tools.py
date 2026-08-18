import logging
import os
from datetime import timedelta
from urllib.parse import quote

from fastapi import HTTPException
from langchain_core.tools import tool

from app.agents.calendar_dates import resolve_calendar_day
from app.infrastructure.db.repositories import memos as memos_db
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


async def _graph_mutation(coro):
    """Run a Graph write and preserve failures as error ToolMessages.

    LangGraph's ToolNode converts raised exceptions into ToolMessages with
    ``status='error'``.  Keeping writes on that path lets the approval API
    distinguish a successful execution from an approved call that failed.
    """
    return await coro


def _format_email_row(m: dict) -> str:
    unread = "" if m.get("isRead", True) else "[UNREAD] "
    sender = m.get("sender", {}).get("emailAddress", {}).get("address")
    return (
        f"- {unread}id={m['id']} from={sender} "
        f"subject={m.get('subject')!r} preview={m.get('bodyPreview', '')[:120]!r}"
    )


def _format_contact(c: dict, matches: list[dict] | None = None) -> str:
    parts = [f"=== Contact: {c['name']} ==="]
    meta = [
        f"Email: {c.get('email', '') or 'N/A'}",
        f"Phone: {c.get('phone', '') or 'N/A'}",
        f"Company: {c.get('company', '') or 'N/A'}",
        f"Job Title: {c.get('jobTitle', '') or 'N/A'}",
        f"Location: {c.get('location', '') or 'N/A'}",
    ]
    parts.append(" | ".join(meta))
    if c.get("ai_summary"):
        parts.append(f"AI Summary / Profile: {c['ai_summary']}")
    if c.get("tags"):
        parts.append(f"Tags: {', '.join('#' + t for t in c['tags'])}")

    # Memory Facts, each carrying the record it was learned from so the answer can cite it
    timeline_by_id = {t.get("id"): t for t in c.get("timeline", [])}
    facts = c.get("profiles", [])
    if facts:
        fact_lines = ["Memory Facts (4 Dimensions):"]
        for p in facts:
            origin = timeline_by_id.get(p.get("source_id"))
            if origin:
                date_str = str(origin.get("event_date", ""))[:10]
                source = f" (source: {p.get('source_type')} on {date_str} — {origin.get('summary', '')})"
            else:
                source = f" (source: {p.get('source_type') or 'unknown'})"
            fact_lines.append(
                f"  * [{p.get('dimension', 'fact')} / {p.get('category', '')}] {p.get('fact_key')}: {p.get('fact_value')}{source}"
            )
        parts.append("\n".join(fact_lines))

    # Timeline & Recent Activities
    timeline = c.get("timeline", [])
    if timeline:
        tl_lines = ["Recent Interactions & Timeline Activity:"]
        for item in timeline[:5]:
            date_str = str(item.get("event_date", ""))[:10]
            tl_lines.append(f"  * {date_str} [{item.get('source_type', 'activity')}]: {item.get('summary', '')}")
        parts.append("\n".join(tl_lines))

    if matches:
        hit_lines = ["Semantically matched on:"]
        for h in matches[:3]:
            src = h.get("source_type") or "unknown"
            hit_lines.append(f"  * [{h.get('doc_type', '')}] {h.get('snippet', '')} (source: {src})")
        parts.append("\n".join(hit_lines))

    return "\n".join(parts)


def _make_search_contacts_tool(user_id: str):
    @tool
    async def search_contacts(query: str = "") -> str:
        """Search and retrieve full profiles from the user's Personal Contact Relationship Brain.
        Matches by name, email, company, job title, location, tags, memory facts (diet, hobby, background, scale), or AI summary.
        Also handles vague descriptions ('the investor who likes pu-erh tea') via semantic search.
        Use this tool whenever asked about a person, contact, colleague, investor, their recent activities/plans ('他最近在干啥', '张明是谁'), or relationships."""
        from app.infrastructure.vector import qdrant
        from app.services.contact_service import ContactService

        contacts = await ContactService.get_contacts(user_id=user_id, query=query)
        matches_by_contact: dict[str, list[dict]] = {}

        # ponytail: SQL ILIKE already nails names, companies and literal fact text, so
        # the embedding call is only spent when literal matching found nothing. Revisit
        # blending both rankings once the offline eval set can measure the difference.
        if not contacts and query.strip():
            ordered_ids: list[str] = []
            for hit in await qdrant.search_contact_docs(user_id, query, limit=10):
                cid = hit.get("contact_id")
                if not cid:
                    continue
                if cid not in matches_by_contact:
                    ordered_ids.append(cid)
                matches_by_contact.setdefault(cid, []).append(hit)
            for cid in ordered_ids[:5]:
                found = await ContactService.get_contact_by_id(user_id=user_id, contact_id=cid)
                if found:
                    contacts.append(found)

        if not contacts:
            return "No contacts matched that search in your Relationship Brain."

        return "\n\n".join(_format_contact(c, matches_by_contact.get(c["id"])) for c in contacts[:10])
    return search_contacts


def make_mail_tools(user_id: str, session_id: str | None = None) -> list:
    search_contacts = _make_search_contacts_tool(user_id)

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
        """Send an email with final recipient, subject, and body. This tool is
        guarded by LangChain HITL middleware and only runs after approval."""
        html_body = body.replace("\r\n", "\n").replace("\n", "<br>")
        await _graph_mutation(
            graph_post(
                user_id,
                "/me/sendMail",
                {
                    "message": {
                        "subject": subject,
                        "body": {"contentType": "HTML", "content": html_body},
                        "toRecipients": [{"emailAddress": {"address": to}}],
                    },
                    "saveToSentItems": True,
                },
            )
        )
        return f"Email sent to {to}."

    @tool
    async def mark_email_read(email_id: str, is_read: bool = True) -> str:
        """Mark an email as read or unread by id."""
        _, err = await _graph(graph_patch(user_id, f"/me/messages/{quote(email_id)}", {"isRead": is_read}))
        if err:
            return err
        return f"Email {email_id} marked as {'read' if is_read else 'unread'}."

    @tool
    async def delete_email(email_id: str, subject: str = "", sender: str = "") -> str:
        """Move an email to Deleted Items. Include subject/sender when known so
        the HITL card is informative. Execution is blocked until approval."""
        await _graph_mutation(
            graph_post(
                user_id,
                f"/me/messages/{quote(email_id)}/move",
                {"destinationId": "deleteditems"},
            )
        )
        return f"Email moved to Deleted Items: {subject or email_id}."

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
        from app.infrastructure.db.repositories import contacts as contacts_repo
        from app.services.contact_service import ContactService

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
            source_type="chat",
            source_id=session_id,
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


def make_calendar_tools(user_id: str, session_id: str | None = None) -> list:
    async def list_event_range(start: str, end: str) -> tuple[list[dict] | None, str | None]:
        path = f"/me/calendarView?startDateTime={start}&endDateTime={end}&$top=50&$orderby=start/dateTime"
        data, err = await _graph(
            graph_get(user_id, path, extra_headers={"Prefer": f'outlook.timezone="{_graph_tz()}"'})
        )
        return (data.get("value", []), None) if not err else (None, err)

    def format_event_rows(events: list[dict]) -> str:
        return "\n".join(
            f"- id={event['id']} subject={event.get('subject')!r} "
            f"start={(event.get('start') or {}).get('dateTime')} "
            f"end={(event.get('end') or {}).get('dateTime')} "
            f"location={(event.get('location') or {}).get('displayName', '')!r}"
            for event in events
        )

    @tool
    async def list_events(start: str, end: str) -> str:
        """List calendar events between two ISO 8601 datetimes in the user's
        local timezone (configured via TIMEZONE env var, default Asia/Shanghai).
        Example: 2026-07-01T00:00:00."""
        events, err = await list_event_range(start, end)
        if err:
            return err
        if not events:
            return "No events in that range."
        return format_event_rows(events)

    @tool
    async def list_events_on_day(day: str) -> str:
        """List events on one natural-language or ISO calendar day. Pass the
        user's exact phrase, such as `本周三`, `下周五`, `tomorrow`, or
        `2026-08-12`; do not calculate start/end datetimes yourself."""
        resolved = resolve_calendar_day(day)
        if not resolved:
            return f"Could not resolve calendar day: {day!r}. Ask the user for an exact date."
        start = resolved.isoformat() + "T00:00:00"
        end = (resolved + timedelta(days=1)).isoformat() + "T00:00:00"
        events, err = await list_event_range(start, end)
        if err:
            return err
        if not events:
            return f"Resolved date: {resolved.isoformat()}. No events on that day."
        return f"Resolved date: {resolved.isoformat()}.\n{format_event_rows(events)}"

    @tool
    async def create_event(subject: str, start: str, end: str, location: str = "") -> str:
        """Create a calendar event after HITL approval. `start`/`end` are ISO 8601 datetimes in the
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
        await _graph_mutation(graph_post(user_id, "/me/events", body))
        return f"Event created: {subject}."

    @tool
    async def delete_event(
        event_id: str,
        subject: str,
        start: str,
        end: str,
        location: str = "",
    ) -> str:
        """Delete a calendar event by id after HITL approval. Include the
        display fields when known so the approval card can show them."""
        await _graph_mutation(graph_delete(user_id, f"/me/events/{quote(event_id)}"))
        return f"Event deleted: {subject or event_id}."

    @tool
    async def accept_event(event_id: str, comment: str = "") -> str:
        """Accept a calendar invitation after HITL approval."""
        await _graph_mutation(
            graph_post(
                user_id,
                f"/me/events/{quote(event_id)}/accept",
                {"comment": comment},
            )
        )
        return "Event invitation accepted."

    @tool
    async def decline_event(event_id: str, comment: str = "") -> str:
        """Decline a calendar invitation after HITL approval."""
        await _graph_mutation(
            graph_post(
                user_id,
                f"/me/events/{quote(event_id)}/decline",
                {"comment": comment},
            )
        )
        return "Event invitation declined."

    return [
        list_events,
        list_events_on_day,
        create_event,
        delete_event,
        accept_event,
        decline_event,
    ]


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

    return [list_memos, _make_create_memo_tool(user_id), search_memos, _make_search_contacts_tool(user_id)]


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
