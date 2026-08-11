"""IMAP 邮件 ID 命名空间（多账号）。

ID = "imap:{account_id}:{mailbox}:{uid}"
例：imap:3f2c1a9e:INBOX:34217、imap:3f2c1a9e:Sent:9912

account_id 区分不同绑定账号（一个用户可绑多个邮箱），
mailbox 用 IMAP 文件夹名，uid 是 IMAP UID（稳定，不用 message sequence）。
全项目只允许在这里解析/构造 IMAP 邮件 ID。
"""


def make_email_id(account_id: str, mailbox: str, uid: int) -> str:
    return f"imap:{account_id}:{mailbox}:{uid}"


def parse_email_id(email_id: str) -> tuple[str, str, int] | None:
    """解析 IMAP 邮件 ID。非 imap: 前缀返回 None；格式损坏抛 ValueError。

    返回 (account_id, mailbox, uid)。
    """
    if not email_id or not email_id.startswith("imap:"):
        return None
    parts = email_id.split(":", 3)
    if len(parts) != 4 or not parts[3].isdigit():
        raise ValueError(f"malformed imap email id: {email_id!r}")
    return parts[1], parts[2], int(parts[3])
