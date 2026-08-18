"""Per-session serialization for stateful LangGraph turns.

LangGraph checkpoints preserve state, but they do not make two application
requests for the same thread a single logical turn.  Keep one turn active per
session so a second browser tab or retry cannot read stale history and write
over the first response.

This registry is intentionally process-local.  It is sufficient for the
current single-backend deployment; cross-replica approval races are guarded by
the durable atomic claim in ``hitl_audit``.  General chat-turn serialization
still requires a database or Redis lease before a multi-replica deployment.
"""

import asyncio
from contextlib import asynccontextmanager
from dataclasses import dataclass, field


@dataclass
class _LockEntry:
    lock: asyncio.Lock = field(default_factory=asyncio.Lock)
    users: int = 0


_entries: dict[str, _LockEntry] = {}
_entries_guard = asyncio.Lock()


@asynccontextmanager
async def session_turn_lock(session_id: str):
    """Acquire the session's turn lock and remove it once no caller uses it."""
    async with _entries_guard:
        entry = _entries.setdefault(session_id, _LockEntry())
        # Count waiters as well as the current owner so the entry cannot be
        # removed in the gap between one turn releasing and the next acquiring.
        entry.users += 1

    acquired = False
    try:
        await entry.lock.acquire()
        acquired = True
        yield
    finally:
        if acquired:
            entry.lock.release()
        async with _entries_guard:
            entry.users -= 1
            if entry.users == 0 and _entries.get(session_id) is entry:
                _entries.pop(session_id, None)
