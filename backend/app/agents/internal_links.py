"""Links from agent output back into Friday's own UI.

Agent tools should not embed provider URLs (for example, Microsoft Graph's
``webLink``) in user-visible Markdown.  Keeping the route and query-key
mapping here makes links consistent as more resources become clickable.
"""

from urllib.parse import urlencode

_RESOURCE_ROUTES = {
    "calendar": ("/calendar", "eventId"),
    "email": ("/email", "emailId"),
}


def build_internal_link(resource: str, resource_id: str, **params: str) -> str:
    """Build a relative link to a resource in the Friday frontend."""
    try:
        route, id_key = _RESOURCE_ROUTES[resource]
    except KeyError as exc:
        raise ValueError(f"Unsupported internal link resource: {resource}") from exc

    query = {id_key: str(resource_id)}
    query.update({key: str(value) for key, value in params.items() if value is not None and value != ""})
    return f"{route}?{urlencode(query)}"


def markdown_internal_link(label: str, resource: str, resource_id: str, **params: str) -> str:
    """Render a safe Markdown link whose destination stays inside Friday."""
    escaped_label = (
        str(label or "(no subject)")
        .replace("\\", "\\\\")
        .replace("[", r"\[")
        .replace("]", r"\]")
    )
    return f"[{escaped_label}]({build_internal_link(resource, resource_id, **params)})"
