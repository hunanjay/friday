"""Langfuse tracing, active only when LANGFUSE_* keys are set.

`trace_config` returns the RunnableConfig extras for one graph run: the callback
handler plus the session/user tags Langfuse groups a conversation by. Telemetry
must never break a chat turn, so any failure here degrades to "no tracing"
rather than raising.
"""

import logging
import os

_handler = None
_loaded = False


def _load() -> None:
    global _handler, _loaded
    if _loaded:
        return
    _loaded = True
    if not (os.environ.get("LANGFUSE_PUBLIC_KEY") and os.environ.get("LANGFUSE_SECRET_KEY")):
        return
    try:
        from langfuse.langchain import CallbackHandler

        _handler = CallbackHandler()
        logging.info("Langfuse tracing enabled (%s)", os.environ.get("LANGFUSE_BASE_URL", "cloud"))
    except Exception:
        logging.exception("Langfuse keys are set but tracing failed to start")


def trace_config(session_id: str, user_id: str) -> dict:
    """RunnableConfig extras for this run; empty dict when tracing is off."""
    _load()
    if _handler is None:
        return {}
    return {
        "callbacks": [_handler],
        # the handler lifts these two out of run metadata (langfuse/langchain/CallbackHandler.py)
        "metadata": {"langfuse_session_id": session_id, "langfuse_user_id": user_id},
    }
