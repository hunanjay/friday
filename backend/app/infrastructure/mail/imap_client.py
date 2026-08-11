"""通用 IMAP 客户端（支持任意 IMAP 服务器）。

host/port/security 参数化：security ∈ {ssl, starttls, none}。
每次请求单独建连、用完登出（服务器对并发 IMAP 连接有限制），
连接对象不跨请求复用。同步库 imapclient，由调用方包 run_in_threadpool。
"""

import imapclient

_MAILBOX_ALIASES = {
    "INBOX": "INBOX",
    "Sent": ("Sent", "已发送", "Sent Items"),
    "Trash": ("Trash", "已删除", "Deleted Items", "Deleted"),
    "Drafts": ("Drafts", "草稿箱", "Draft"),
    "Junk": ("Junk", "垃圾邮件", "Spam"),
    "Archive": ("Archive", "归档", "All Mail"),
}

# 邮件 ID 编码用（与 ids.py 保持一致）
MAILBOX_SENT = "Sent"
MAILBOX_TRASH = "Trash"


def connect(host: str, port: int, security: str, username: str, password: str, timeout: int = 15) -> imapclient.IMAPClient:
    """建立并登录一个 IMAP 连接。失败抛 IMAPClientError / OSError。"""
    kwargs: dict = {"ssl": False}
    if security == "ssl":
        kwargs = {"ssl": True}
    elif security == "starttls":
        kwargs = {"ssl": False, "starttls": True}
    client = imapclient.IMAPClient(host, port=port, timeout=timeout, **kwargs)
    client.login(username, password)
    return client


def find_mailbox(client: imapclient.IMAPClient, mailbox: str) -> str:
    """按别名发现实际文件夹名（IMAP LIST），避免硬编码服务器名称。

    返回实际文件夹名；找不到抛 ValueError。INBOX 直接命中。
    """
    if mailbox == "INBOX":
        return "INBOX"
    candidates = _MAILBOX_ALIASES.get(mailbox, (mailbox,))
    folders = [info[2] for info in client.list_folders()]
    for candidate in candidates:
        if candidate in folders:
            return candidate
    lowered = {f.lower(): f for f in folders}
    for candidate in candidates:
        if candidate.lower() in lowered:
            return lowered[candidate.lower()]
    raise ValueError(f"mailbox {mailbox!r} not found (folders: {folders})")


def select_mailbox(client: imapclient.IMAPClient, mailbox: str) -> str:
    """选择文件夹并返回实际文件夹名（供 APPEND 归档使用）。"""
    actual = find_mailbox(client, mailbox)
    client.select_folder(actual)
    return actual
