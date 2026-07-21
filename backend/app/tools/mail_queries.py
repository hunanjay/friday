from urllib.parse import quote

# Shared by the agent's search_emails tool (app/agents/tools.py) and the
# frontend-facing /api/graph/mail routes (app/api/mail.py) so the Graph query
# logic only lives in one place.

MAIL_FOLDERS = {
    "inbox": "inbox",
    "drafts": "drafts",
    "sent": "sentItems",
    "deleted": "deletedItems",
    "junk": "junkemail",
    "archive": "archive",
}


def search_path(
    folder: str,
    query: str,
    unread_only: bool,
    has_attachments: bool,
    top: int,
    select: str | None = None,
) -> str:
    """Builds the Graph request path. `top` sets Graph's per-page size (capped
    at 50); callers wanting more than one page should follow `@odata.nextLink`
    (see graph_client.graph_get_paginated) rather than raising this further.
    Pass `select` to restrict which fields Graph returns (e.g. omit `body` for
    list views so the response stays within the browser's localStorage quota)."""
    graph_folder = MAIL_FOLDERS.get(folder, "inbox")
    page_size = min(top, 50)
    path = f"/me/mailFolders/{graph_folder}/messages?$top={page_size}"
    if select:
        path += f"&$select={select}"
    if query:
        path += f'&$search="{quote(query)}"'
    else:
        filters = []
        if unread_only:
            filters.append("isRead eq false")
        if has_attachments:
            filters.append("hasAttachments eq true")
        if filters:
            path += f"&$filter={quote(' and '.join(filters))}"
        path += "&$orderby=receivedDateTime desc"
    return path
