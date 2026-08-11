#!/usr/bin/env python3
"""Unit tests for the generic IMAP/SMTP mail provider layer.

No pytest, no fixtures, no network (SSRF tests only use DNS resolution of
public hosts - everything else is pure). Run from the repo root:

    cd backend && PYTHONUTF8=1 .venv/Scripts/python.exe tests/test_mail_provider.py

Exit code 0 = all passed.
"""

import os
import sys
from email.message import EmailMessage

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

os.environ.setdefault(
    "MAIL_ENCRYPTION_KEY",
    "zeVBBAZx6uQFj05gxIuLlofUZ3lzpKp0zaktC_vG94c=",
)

_failures = []


def check(name: str, condition: bool, detail: str = ""):
    if condition:
        print(f"  PASS  {name}")
    else:
        print(f"  FAIL  {name}  {detail}")
        _failures.append(name)


# ---------------------------------------------------------------------------
# 1. Credential encryption (round-trip, no plaintext leak)
# ---------------------------------------------------------------------------
print("== 1. credential encryption ==")

from app.infrastructure.security.crypto import decrypt_credential, encrypt_credential  # noqa: E402

_secret = "my-app-password-123"
_cipher = encrypt_credential(_secret)
check("ciphertext differs from plaintext", _cipher != _secret)
check("ciphertext is not a substring of plaintext", _secret not in _cipher)
check("decrypt round-trips", decrypt_credential(_cipher) == _secret)
check("encryption is salted (two ciphertexts differ)", encrypt_credential(_secret) != _cipher)

# ---------------------------------------------------------------------------
# 2. SSRF guard (custom server addresses)
# ---------------------------------------------------------------------------
print("== 2. SSRF guard ==")

from app.infrastructure.mail.ssrf import assert_public_host  # noqa: E402

for bad in ["127.0.0.1", "localhost", "192.168.1.1", "10.0.0.5", "169.254.169.254", "0.0.0.0"]:
    try:
        assert_public_host(bad)
        check(f"reject {bad}", False, "should have raised")
    except ValueError:
        check(f"reject {bad}", True)

check("allow public host", assert_public_host("imap.163.com") is None)

# ---------------------------------------------------------------------------
# 3. Provider presets + override merge
# ---------------------------------------------------------------------------
print("== 3. provider presets ==")

from app.infrastructure.mail.providers import MAIL_PROVIDERS, resolve_provider_settings  # noqa: E402

check("netease preset", resolve_provider_settings("netease", {})["imap_host"] == "imap.163.com")
check("qq preset", resolve_provider_settings("qq", {})["smtp_host"] == "smtp.qq.com")
check("gmail preset", resolve_provider_settings("gmail", {})["imap_port"] == 993)
merged = resolve_provider_settings("qq", {"imap_host": "custom.example.com", "imap_port": 143})
check("override wins", merged["imap_host"] == "custom.example.com" and merged["imap_port"] == 143)
check("preset fills gaps", merged["smtp_host"] == "smtp.qq.com")

# ---------------------------------------------------------------------------
# 4. Mail ID namespace (multi-account)
# ---------------------------------------------------------------------------
print("== 4. mail id namespace ==")

from app.infrastructure.mail.ids import make_email_id, parse_email_id  # noqa: E402

eid = make_email_id("acct-123", "INBOX", 34217)
check("id format", eid == "imap:acct-123:INBOX:34217")
acc, mb, uid = parse_email_id(eid)
check("parse round-trip", (acc, mb, uid) == ("acct-123", "INBOX", 34217))
check("non-imap id returns None", parse_email_id("AQMkADAwAT...") is None)
try:
    parse_email_id("imap:acct:INBOX:not-a-number")
    check("malformed id raises", False, "should have raised ValueError")
except ValueError:
    check("malformed id raises", True)

# ---------------------------------------------------------------------------
# 5. Converter (RFC822 -> Graph-shaped contract)
# ---------------------------------------------------------------------------
print("== 5. converter ==")

from app.infrastructure.mail.converter import to_graph_message  # noqa: E402


def make_raw(**overrides):
    msg = EmailMessage()
    msg["Subject"] = overrides.get("subject", "会议安排")
    msg["From"] = "张三 <zhangsan@163.com>"
    msg["To"] = "lisi@qq.com, 王五 <wangwu@163.com>"
    msg["Date"] = "Tue, 11 Aug 2026 10:00:00 +0800"
    msg["Message-ID"] = "<m1@163.com>"
    if overrides.get("references"):
        msg["References"] = overrides["references"]
    if overrides.get("in_reply_to"):
        msg["In-Reply-To"] = overrides["in_reply_to"]
    msg.set_content("这是一封测试邮件\n第二行")
    return msg.as_bytes()


r = to_graph_message(make_raw(), "acct-1", "INBOX", 7, set(), full=True)
check("id uses account+mailbox+uid", r["id"] == "imap:acct-1:INBOX:7")
check("provider is imap", r["provider"] == "imap")
check("subject decoded", r["subject"] == "会议安排")
check("sender parsed", r["sender"]["emailAddress"]["address"] == "zhangsan@163.com")
check("two recipients", len(r["toRecipients"]) == 2)
check("recipient name decoded", r["toRecipients"][1]["emailAddress"]["name"] == "王五")
check("timestamp is UTC ISO", r["receivedDateTime"].endswith("+00:00"))
check("parentFolderId inbox", r["parentFolderId"] == "inbox")
check("bodyPreview present", len(r["bodyPreview"]) > 0)
check("body html/text present", r["body"]["contentType"] in ("html", "text"))

# Thread key: References[0] wins
r2 = to_graph_message(make_raw(references="<root@163.com> <mid@163.com>"), "acct-1", "INBOX", 8, set())
check("thread key = References root", r2["conversationId"] == "root@163.com")

# In-Reply-To resolved via seen_ids
seen = {"root@163.com"}
r3 = to_graph_message(make_raw(in_reply_to="<root@163.com>"), "acct-1", "INBOX", 9, seen)
check("thread key = In-Reply-To when seen", r3["conversationId"] == "root@163.com")

# 中文文件夹名映射
r4 = to_graph_message(make_raw(), "acct-1", "已发送", 10, set())
check("chinese sent folder maps to sent", r4["parentFolderId"] == "sent")

# Attachment metadata
msg_with_att = EmailMessage()
msg_with_att["Subject"] = "带附件"
msg_with_att["From"] = "a@163.com"
msg_with_att["To"] = "b@qq.com"
msg_with_att["Date"] = "Tue, 11 Aug 2026 10:00:00 +0800"
msg_with_att.set_content("body")
msg_with_att.add_attachment(b"hello world", maintype="text", subtype="plain", filename="note.txt")
r5 = to_graph_message(msg_with_att.as_bytes(), "acct-1", "INBOX", 11, set(), full=True)
check("attachments detected", r5["hasAttachments"] is True)
check("attachment metadata", r5["attachments"][0]["name"] == "note.txt" and r5["attachments"][0]["size"] == 11)

# ---------------------------------------------------------------------------
# 6. Failure/degradation behavior
# ---------------------------------------------------------------------------
print("== 6. failure/degradation ==")

# Empty/malformed raw message should not crash the converter
check("empty raw does not crash", to_graph_message(b"", "acct-1", "INBOX", 12, set())["id"].startswith("imap:acct-1"))

# provider list contains all expected presets
check("presets complete", {"netease", "qq", "gmail", "icloud", "outlook"} <= set(MAIL_PROVIDERS))

# ---------------------------------------------------------------------------
print()
if _failures:
    print(f"{len(_failures)} check(s) FAILED: {_failures}")
    sys.exit(1)
print("All mail provider checks passed.")
