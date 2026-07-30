# Re-export from infrastructure/graph/client for backward compatibility
from app.infrastructure.graph.client import (
    GRAPH_BASE,
    MS_TOKEN_URL,
    aclose_client,
    cache_ms_token,
    graph_delete,
    graph_get,
    graph_get_paginated,
    graph_patch,
    graph_post,
    refresh_ms_token,
)

__all__ = [
    "GRAPH_BASE",
    "MS_TOKEN_URL",
    "aclose_client",
    "cache_ms_token",
    "graph_delete",
    "graph_get",
    "graph_get_paginated",
    "graph_patch",
    "graph_post",
    "refresh_ms_token",
]
