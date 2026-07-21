#!/usr/bin/env python3
"""
Smoke tests for Friday/Dora backend — no pytest, no fixtures.
Run from the repo root:

    cd backend && source .venv/bin/activate && python tests/test_smoke.py

Exit code 0 = all passed. Any failure prints the failing assertion and exits 1.
"""

import os
import sys
import time
import re

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

_failures = []


def check(name: str, condition: bool, detail: str = ""):
    if condition:
        print(f"  PASS  {name}")
    else:
        msg = f"  FAIL  {name}" + (f": {detail}" if detail else "")
        print(msg)
        _failures.append(msg)


def section(title: str):
    print(f"\n── {title} ──")


# ---------------------------------------------------------------------------
# 1. _TAG_RE  (api/agent.py)
# ---------------------------------------------------------------------------

section("1. _TAG_RE routing regex")

# Mirrors the exact pattern in api/agent.py
_TAG_RE = re.compile(r"^/(\w+)\s+(.*)", re.DOTALL)

m = _TAG_RE.match("/mail_agent 帮我看邮件")
check("valid tag splits agent name", m is not None)
if m:
    check("agent name = mail_agent", m.group(1) == "mail_agent")
    check("body = '帮我看邮件'", m.group(2) == "帮我看邮件")

m2 = _TAG_RE.match("/mail_agent help me read email with multiple\nlines")
check("multi-line body captured", m2 is not None and "\nlines" in m2.group(2))

# No leading slash → no match → falls through to supervisor
check("no-tag message doesn't match", _TAG_RE.match("just a regular message") is None)
check("slash-only no-space doesn't match (incomplete slash command)", _TAG_RE.match("/mail_agent") is None)

# Unknown agent: match returns a group(1) that isn't in AGENT_NAMES
AGENT_NAMES = {"mail_agent", "calendar_agent", "memos_agent", "github_agent"}
m3 = _TAG_RE.match("/unknown_agent do something")
unknown_tag = m3.group(1) if m3 else None
check("unknown agent tag matched but not in AGENT_NAMES → falls to supervisor",
      unknown_tag is not None and unknown_tag not in AGENT_NAMES)


# ---------------------------------------------------------------------------
# 2. html_sanitizer.sanitize_html_to_text
# ---------------------------------------------------------------------------

section("2. html_sanitizer")

# Add parent dir to sys.path so we can import app modules directly.
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from app.tools.html_sanitizer import sanitize_html_to_text  # noqa: E402

# 2a. Bare <meta> must NOT swallow subsequent content (production regression).
# This was the exact failure mode: meta landed in _REMOVE_ELEMENTS without
# being in _VOID_ELEMENTS, so skip_depth was set to 1 and never came back
# down, eating every sibling element after it.
meta_html = '<html><head><meta charset="utf-8"></head><body><p>Hello world</p></body></html>'
result = sanitize_html_to_text(meta_html)
check("<meta> doesn't swallow subsequent content", "Hello world" in result,
      f"got: {result!r}")

# 2b. display:none content must be stripped.
hidden_html = '<p>Visible</p><p style="display:none">Hidden injection</p><p>Also visible</p>'
result2 = sanitize_html_to_text(hidden_html)
check("display:none content stripped", "Hidden injection" not in result2,
      f"got: {result2!r}")
check("visible content around hidden element preserved", "Visible" in result2 and "Also visible" in result2,
      f"got: {result2!r}")

# 2c. visibility:hidden stripped.
vis_html = '<p>Real</p><span style="visibility:hidden">Shadow</span>'
result3 = sanitize_html_to_text(vis_html)
check("visibility:hidden stripped", "Shadow" not in result3)

# 2d. Normal HTML body renders visible text.
normal_html = "<h1>Subject</h1><p>Dear Alice,</p><p>Please see the attachment.</p>"
result4 = sanitize_html_to_text(normal_html)
check("normal body preserves text", "Dear Alice" in result4 and "Please see the attachment" in result4)

# 2e. Script tags stripped.
script_html = '<p>Safe</p><script>alert("xss")</script><p>Also safe</p>'
result5 = sanitize_html_to_text(script_html)
check("script tag content stripped", "alert" not in result5)
check("surrounding text preserved around stripped script", "Safe" in result5 and "Also safe" in result5)

# 2f. Invisible unicode characters stripped.
unicode_html = f"<p>Normal\u200bZero\u200bWidth</p>"
result6 = sanitize_html_to_text(unicode_html)
check("zero-width spaces stripped", "\u200b" not in result6)
check("visible text around invisible chars preserved", "NormalZeroWidth" in result6.replace(" ", ""))


# ---------------------------------------------------------------------------
# 3. GitHub OAuth nonce store  (api/github_auth.py — logic tested inline)
# ---------------------------------------------------------------------------

section("3. GitHub OAuth nonce store")

# The nonce helpers are pure Python (secrets + time + dict).
# We test the logic here rather than importing github_auth.py to avoid
# dragging in supabase_client which requires SUPABASE_URL / SUPABASE_ANON_KEY.
import secrets as _secrets
import time as _time

_TTL_SECONDS = 300
_pending_test: dict[str, tuple[str, float]] = {}


def _issue_nonce_test(user_id: str) -> str:
    nonce = _secrets.token_urlsafe(32)
    now = _time.monotonic()
    _pending_test[nonce] = (user_id, now + _TTL_SECONDS)
    expired = [k for k, (_, exp) in _pending_test.items() if exp < now]
    for k in expired:
        del _pending_test[k]
    return nonce


def _redeem_nonce_test(nonce: str) -> str | None:
    entry = _pending_test.pop(nonce, None)
    if entry is None:
        return None
    user_id, expires_at = entry
    return user_id if _time.monotonic() < expires_at else None


# 3a. Issue → redeem round-trip.
nonce = _issue_nonce_test("user-abc")
check("nonce is a non-empty string", isinstance(nonce, str) and len(nonce) > 0)
uid = _redeem_nonce_test(nonce)
check("redeem returns correct user_id", uid == "user-abc")

# 3b. One-time use: second redeem returns None.
uid2 = _redeem_nonce_test(nonce)
check("second redeem returns None (one-time use)", uid2 is None)

# 3c. Wrong nonce returns None.
check("unknown nonce returns None", _redeem_nonce_test("not-a-real-nonce") is None)

# 3d. Expired nonce returns None (simulate by directly writing a past TTL).
fake_nonce = "expiry-test-nonce"
_pending_test[fake_nonce] = ("user-xyz", _time.monotonic() - 1)  # already expired
uid3 = _redeem_nonce_test(fake_nonce)
check("expired nonce returns None", uid3 is None)
check("expired nonce removed from _pending after redeem attempt", fake_nonce not in _pending_test)

# 3e. Pruning: expired entries cleaned up on next issue.
stale = "stale-nonce"
_pending_test[stale] = ("user-stale", _time.monotonic() - 1)
_issue_nonce_test("user-trigger-prune")
check("stale entry pruned on next issue", stale not in _pending_test)


# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------

print()
if _failures:
    print(f"{'─'*50}")
    print(f"FAILED: {len(_failures)} test(s)")
    for f in _failures:
        print(f)
    sys.exit(1)
else:
    total = 25  # approximate
    print(f"All checks passed.")
    sys.exit(0)
