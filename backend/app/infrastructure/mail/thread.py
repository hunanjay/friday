"""邮件线程键合成（IMAP 无 conversationId，后端合成）。

优先级：
1. References 头第一个 Message-ID（链的根）
2. In-Reply-To 头（在本页已见集合内）
3. 邮件自己的 Message-ID
4. 兜底：规范化主题 hash

跨账号/跨提供商的线程不合并是预期行为。
"""

import hashlib
import re

_THREAD_PREFIX_RE = re.compile(r"^\s*(re|fw|fwd|回复|转发)[:\s]+", re.IGNORECASE)


def thread_key(
    msg_id: str | None,
    references: list[str],
    in_reply_to: list[str],
    subject: str | None,
    seen_ids: set[str],
) -> str:
    if references:
        return references[0]
    if in_reply_to and in_reply_to[0] in seen_ids:
        return in_reply_to[0]
    if msg_id:
        return msg_id
    norm = _THREAD_PREFIX_RE.sub("", subject or "").strip().lower()
    return f"subject:{hashlib.sha1(norm.encode()).hexdigest()[:16]}"
