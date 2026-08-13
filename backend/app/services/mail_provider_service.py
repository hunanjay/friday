"""通用 IMAP/SMTP 邮箱服务层。

按 mail_accounts 表中的账号（account_id）路由：取解密凭据 →
resolve_provider_settings 合并预设/覆盖 → 建连 → 操作 → logout。
方法签名与 services/mail_service.py 对齐（{value, next_cursor} 契约），
前端复用同一套数据格式。

IMAP 是同步库，全部包 run_in_threadpool；SMTP 用 aiosmtplib 异步。
"""

from fastapi import HTTPException
from starlette.concurrency import run_in_threadpool

from app.infrastructure.db.repositories import mail_accounts
from app.infrastructure.mail.converter import to_graph_message
from app.infrastructure.mail.ids import parse_email_id
from app.infrastructure.mail.imap_client import connect, select_mailbox
from app.infrastructure.mail.providers import resolve_provider_settings
from app.infrastructure.mail.ssrf import assert_public_host

_IMAP_FOLDER_BY_ALIAS = {
    "inbox": "INBOX",
    "sent": "Sent",
    "trash": "Trash",
    "drafts": "Drafts",
    "junk": "Junk",
    "archive": "Archive",
}

# cursor 里用别名（前端文件夹名），解析到 IMAP 文件夹
_CURSOR_FOLDER_BY_ALIAS = _IMAP_FOLDER_BY_ALIAS


def _account_settings(user_id: str, account_id: str) -> dict:
    """取账号行 + 解密凭据 + 合并预设，未找到抛 404。"""
    account = mail_accounts.get_account(user_id, account_id)
    if not account:
        raise HTTPException(status_code=404, detail="邮箱账号不存在")
    creds = mail_accounts.get_credentials(user_id, account_id)
    settings = resolve_provider_settings(account["provider"], account)
    return {**account, **creds, **settings}


def _verify_hosts(settings: dict) -> None:
    """SSRF 校验（自定义 host 场景）。"""
    for host in (settings.get("imap_host"), settings.get("smtp_host")):
        if host:
            assert_public_host(host)


# ── 同步实现（run_in_threadpool 中运行） ─────────────────────────────

def _verify_connection_sync(settings: dict) -> dict:
    client = connect(
        settings["imap_host"], settings["imap_port"], settings["imap_security"],
        settings["username"], settings["credential"], timeout=15,
    )
    try:
        select_mailbox(client, "INBOX")
    finally:
        try:
            client.logout()
        except Exception:
            pass
    return {"imap": True}


def _fetch_messages_sync(settings: dict, mailbox_alias: str, top: int, cursor: str | None, full: bool):
    """拉取一页：SEARCH ALL → 最新 top 个 → BODY.PEEK[]（防置已读）。"""
    client = connect(
        settings["imap_host"], settings["imap_port"], settings["imap_security"],
        settings["username"], settings["credential"], timeout=30,
    )
    try:
        actual = select_mailbox(client, _IMAP_FOLDER_BY_ALIAS[mailbox_alias])
        uids = client.search("ALL")
        if not uids:
            return [], None
        if cursor:
            parts = cursor.split(":")
            last_uid = int(parts[-1]) if parts else 0
            uids = [u for u in uids if u < last_uid]
        page = sorted(uids)[-top:]
        if not page:
            return [], None
        raw_map = client.fetch(page, ["BODY.PEEK[]", "FLAGS"])
        account_id = settings["account_id"]
        seen_ids: set[str] = set()
        messages = []
        for uid in sorted(page, reverse=True):
            data = raw_map.get(uid, {})
            raw = data.get(b"BODY[]") or data.get("BODY[]")
            if not raw:
                continue
            flags = data.get(b"FLAGS") or data.get("FLAGS") or ()
            message = to_graph_message(raw, account_id, actual, uid, seen_ids, full=full)
            message["isRead"] = b"\\Seen" in flags
            messages.append(message)
        next_cursor = f"{mailbox_alias}:{page[0]}" if len(page) == top else None
        return messages, next_cursor
    finally:
        try:
            client.logout()
        except Exception:
            pass


def _search_sync(settings: dict, mailbox_alias: str, query: str, unread_only: bool, has_attachments: bool, top: int, cursor: str | None):
    """搜索：IMAP SEARCH 优先，中文兼容差时降级全量拉头 + Python 过滤。"""
    client = connect(
        settings["imap_host"], settings["imap_port"], settings["imap_security"],
        settings["username"], settings["credential"], timeout=30,
    )
    try:
        actual = select_mailbox(client, _IMAP_FOLDER_BY_ALIAS[mailbox_alias])
        try:
            criteria = ["OR", "OR", f"SUBJECT {query}", f"FROM {query}", f"TEXT {query}"]
            if unread_only:
                criteria = ["UNSEEN"] + criteria
            uids = client.search("UTF-8", *criteria)
        except Exception:
            uids = client.search("ALL")
        if not uids:
            return [], None
        if cursor:
            parts = cursor.split(":")
            last_uid = int(parts[-1]) if parts else 0
            uids = [u for u in uids if u < last_uid]
        page = sorted(uids)[-top:]
        if not page:
            return [], None
        raw_map = client.fetch(page, ["BODY.PEEK[]", "FLAGS"])
        account_id = settings["account_id"]
        seen_ids: set[str] = set()
        messages = []
        for uid in sorted(page, reverse=True):
            data = raw_map.get(uid, {})
            raw = data.get(b"BODY[]") or data.get("BODY[]")
            if not raw:
                continue
            flags = data.get(b"FLAGS") or data.get("FLAGS") or ()
            message = to_graph_message(raw, account_id, actual, uid, seen_ids, full=False)
            message["isRead"] = b"\\Seen" in flags
            haystack = " ".join([
                message.get("subject", ""),
                message.get("bodyPreview", ""),
                message.get("sender", {}).get("emailAddress", {}).get("address", ""),
            ]).lower()
            if query and query.lower() not in haystack:
                continue
            if has_attachments and not message["hasAttachments"]:
                continue
            messages.append(message)
        next_cursor = f"{mailbox_alias}:{page[0]}" if len(page) == top else None
        return messages, next_cursor
    finally:
        try:
            client.logout()
        except Exception:
            pass


def _thread_sync(settings: dict, thread_key: str):
    """扫描 INBOX + Sent，收集属于该线程键的邮件（时间升序）。

    两遍拉取：先 BODY.PEEK[HEADER] 匹配线程键（便宜），再对匹配的
    UID 拉完整 BODY.PEEK[]——否则正文永远为空。
    """
    client = connect(
        settings["imap_host"], settings["imap_port"], settings["imap_security"],
        settings["username"], settings["credential"], timeout=30,
    )
    results = []
    account_id = settings["account_id"]
    try:
        for mailbox_alias in ("INBOX", "Sent"):
            try:
                actual = select_mailbox(client, mailbox_alias)
            except Exception:
                continue
            uids = client.search("ALL")
            if not uids:
                continue
            headers = client.fetch(uids, ["BODY.PEEK[HEADER]", "FLAGS"])
            matched = []
            flags_by_uid = {}
            for uid in uids:
                data = headers.get(uid, {})
                raw = data.get(b"BODY[HEADER]") or data.get("BODY[HEADER]")
                if not raw:
                    continue
                flags_by_uid[uid] = data.get(b"FLAGS") or data.get("FLAGS") or ()
                # header-only 转换：body 为空不影响 conversationId 匹配
                message = to_graph_message(raw, account_id, actual, uid, set(), full=False)
                if message["conversationId"] == thread_key:
                    matched.append(uid)
            if not matched:
                continue
            # 第二遍：对匹配的 UID 拉完整正文
            full_map = client.fetch(matched, ["BODY.PEEK[]", "FLAGS"])
            for uid in matched:
                data = full_map.get(uid, {})
                raw = data.get(b"BODY[]") or data.get("BODY[]")
                if not raw:
                    continue
                flags = data.get(b"FLAGS") or flags_by_uid.get(uid) or ()
                message = to_graph_message(raw, account_id, actual, uid, set(), full=True)
                message["isRead"] = b"\\Seen" in flags
                results.append(message)
    finally:
        try:
            client.logout()
        except Exception:
            pass
    results.sort(key=lambda m: m.get("receivedDateTime", ""))
    return results


def _get_message_sync(settings: dict, mailbox: str, uid: int):
    client = connect(
        settings["imap_host"], settings["imap_port"], settings["imap_security"],
        settings["username"], settings["credential"], timeout=30,
    )
    try:
        actual = select_mailbox(client, mailbox)
        raw_map = client.fetch([uid], ["BODY.PEEK[]", "FLAGS"])
        data = raw_map.get(uid, {})
        raw = data.get(b"BODY[]") or data.get("BODY[]")
        if not raw:
            raise HTTPException(status_code=404, detail="邮件不存在或已被删除")
        flags = data.get(b"FLAGS") or data.get("FLAGS") or ()
        message = to_graph_message(raw, settings["account_id"], actual, uid, set(), full=True)
        message["isRead"] = b"\\Seen" in flags
        return message
    finally:
        try:
            client.logout()
        except Exception:
            pass


def _mark_read_sync(settings: dict, mailbox: str, uid: int, is_read: bool):
    client = connect(
        settings["imap_host"], settings["imap_port"], settings["imap_security"],
        settings["username"], settings["credential"], timeout=30,
    )
    try:
        select_mailbox(client, mailbox)
        if is_read:
            client.add_flags([uid], [r'\Seen'])
        else:
            client.remove_flags([uid], [r'\Seen'])
        return {"status": "ok"}
    finally:
        try:
            client.logout()
        except Exception:
            pass


def _delete_sync(settings: dict, mailbox: str, uid: int):
    r"""IMAP 无统一回收站：\Deleted + EXPUNGE（物理删除，不可恢复）。"""
    client = connect(
        settings["imap_host"], settings["imap_port"], settings["imap_security"],
        settings["username"], settings["credential"], timeout=30,
    )
    try:
        select_mailbox(client, mailbox)
        client.delete_messages([uid])
        client.expunge()
        return {"status": "ok"}
    finally:
        try:
            client.logout()
        except Exception:
            pass


def _attachments_sync(settings: dict, mailbox: str, uid: int):
    message = _get_message_sync(settings, mailbox, uid)
    return message.get("attachments", [])


def _download_sync(settings: dict, mailbox: str, uid: int, attachment_id: str):
    client = connect(
        settings["imap_host"], settings["imap_port"], settings["imap_security"],
        settings["username"], settings["credential"], timeout=30,
    )
    try:
        select_mailbox(client, mailbox)
        raw_map = client.fetch([uid], ["BODY.PEEK[]"])
        data = raw_map.get(uid, {})
        raw = data.get(b"BODY[]") or data.get("BODY[]")
        if not raw:
            raise HTTPException(status_code=404, detail="邮件不存在或已被删除")
        import email
        msg = email.message_from_bytes(raw)
        # 附件 id 是 converter 里 msg.walk() 的全局序号（含正文 part），
        # 这里必须用同一个序号定位，不能对过滤后的列表取索引。
        part = None
        for idx, candidate in enumerate(msg.walk()):
            if candidate.get_content_maintype() == "multipart":
                continue
            if not candidate.get_filename():
                continue
            if str(idx) == attachment_id:
                part = candidate
                break
        if part is None:
            raise HTTPException(status_code=404, detail="附件不存在")
        payload = part.get_payload(decode=True) or b""
        return {
            "content": payload,
            "content_type": part.get_content_type() or "application/octet-stream",
            "content_disposition": part.get_filename() and f'attachment; filename="{part.get_filename()}"',
        }
    finally:
        try:
            client.logout()
        except Exception:
            pass


def _counts_sync(settings: dict, mailbox_alias: str):
    client = connect(
        settings["imap_host"], settings["imap_port"], settings["imap_security"],
        settings["username"], settings["credential"], timeout=30,
    )
    try:
        select_mailbox(client, _IMAP_FOLDER_BY_ALIAS[mailbox_alias])
        total = len(client.search("ALL"))
        unread = len(client.search("UNSEEN"))
        return {"unread": unread, "total": total}
    finally:
        try:
            client.logout()
        except Exception:
            pass


def _append_sent_sync(settings: dict, raw_message: bytes):
    """发件后 APPEND 到 Sent（很多服务器不会自动归档已发送）。"""
    client = connect(
        settings["imap_host"], settings["imap_port"], settings["imap_security"],
        settings["username"], settings["credential"], timeout=30,
    )
    try:
        sent_folder = select_mailbox(client, "Sent")
        client.append(sent_folder, raw_message, flags=[r'\Seen'])
    finally:
        try:
            client.logout()
        except Exception:
            pass


def _get_raw_sync(settings: dict, mailbox: str, uid: int) -> bytes:
    client = connect(
        settings["imap_host"], settings["imap_port"], settings["imap_security"],
        settings["username"], settings["credential"], timeout=30,
    )
    try:
        select_mailbox(client, mailbox)
        raw_map = client.fetch([uid], ["BODY.PEEK[]"])
        data = raw_map.get(uid, {})
        raw = data.get(b"BODY[]") or data.get("BODY[]")
        if not raw:
            raise HTTPException(status_code=404, detail="邮件不存在或已被删除")
        return raw
    finally:
        try:
            client.logout()
        except Exception:
            pass


# ── 异步服务层 ──────────────────────────────────────────────────────

class MailProviderService:
    @staticmethod
    async def _settings(user_id: str, account_id: str) -> dict:
        settings = await run_in_threadpool(_account_settings, user_id, account_id)
        settings["account_id"] = account_id
        return settings

    @classmethod
    async def verify_connection(cls, user_id: str, account_id: str) -> dict:
        """验证账号的 IMAP 连接（绑定后/状态检查用）。成功更新 last_verified_at。"""
        settings = await cls._settings(user_id, account_id)
        await run_in_threadpool(_verify_connection_sync, settings)
        await run_in_threadpool(mail_accounts.touch_verified, user_id, account_id)
        return {"status": "verified"}

    @classmethod
    async def get_inbox(cls, user_id: str, account_id: str, top: int = 25, cursor: str | None = None) -> dict:
        settings = await cls._settings(user_id, account_id)
        values, next_cursor = await run_in_threadpool(
            _fetch_messages_sync, settings, "inbox", min(top, 50), cursor, False
        )
        return {"value": values, "next_cursor": next_cursor}

    @classmethod
    async def get_sent(cls, user_id: str, account_id: str, top: int = 25, cursor: str | None = None) -> dict:
        settings = await cls._settings(user_id, account_id)
        values, next_cursor = await run_in_threadpool(
            _fetch_messages_sync, settings, "sent", min(top, 50), cursor, False
        )
        return {"value": values, "next_cursor": next_cursor}

    @classmethod
    async def search(
        cls, user_id: str, account_id: str, query: str = "", folder: str = "inbox",
        unread_only: bool = False, has_attachments: bool = False, top: int = 25, cursor: str | None = None,
    ) -> dict:
        settings = await cls._settings(user_id, account_id)
        values, next_cursor = await run_in_threadpool(
            _search_sync, settings, folder, query, unread_only, has_attachments, min(top, 50), cursor
        )
        return {"value": values, "next_cursor": next_cursor}

    @classmethod
    async def get_folder_counts(cls, user_id: str, account_id: str, folder: str) -> dict:
        settings = await cls._settings(user_id, account_id)
        return await run_in_threadpool(_counts_sync, settings, folder)

    @classmethod
    async def get_conversation_thread(cls, user_id: str, account_id: str, thread_key: str) -> dict:
        settings = await cls._settings(user_id, account_id)
        values = await run_in_threadpool(_thread_sync, settings, thread_key)
        return {"value": values}

    @classmethod
    async def get_message(cls, user_id: str, email_id: str) -> dict:
        parsed = parse_email_id(email_id)
        if not parsed:
            raise HTTPException(status_code=400, detail="invalid imap email id")
        account_id, mailbox, uid = parsed
        settings = await cls._settings(user_id, account_id)
        return await run_in_threadpool(_get_message_sync, settings, mailbox, uid)

    @classmethod
    async def mark_read(cls, user_id: str, email_id: str, is_read: bool = True) -> dict:
        parsed = parse_email_id(email_id)
        if not parsed:
            raise HTTPException(status_code=400, detail="invalid imap email id")
        account_id, mailbox, uid = parsed
        settings = await cls._settings(user_id, account_id)
        return await run_in_threadpool(_mark_read_sync, settings, mailbox, uid, is_read)

    @classmethod
    async def delete_message(cls, user_id: str, email_id: str, permanent: bool = False) -> dict:
        parsed = parse_email_id(email_id)
        if not parsed:
            raise HTTPException(status_code=400, detail="invalid imap email id")
        account_id, mailbox, uid = parsed
        settings = await cls._settings(user_id, account_id)
        return await run_in_threadpool(_delete_sync, settings, mailbox, uid)

    @classmethod
    async def list_attachments(cls, user_id: str, email_id: str) -> dict:
        parsed = parse_email_id(email_id)
        if not parsed:
            raise HTTPException(status_code=400, detail="invalid imap email id")
        account_id, mailbox, uid = parsed
        settings = await cls._settings(user_id, account_id)
        values = await run_in_threadpool(_attachments_sync, settings, mailbox, uid)
        return {"value": values}

    @classmethod
    async def download_attachment(cls, user_id: str, email_id: str, attachment_id: str) -> dict:
        parsed = parse_email_id(email_id)
        if not parsed:
            raise HTTPException(status_code=400, detail="invalid imap email id")
        account_id, mailbox, uid = parsed
        settings = await cls._settings(user_id, account_id)
        return await run_in_threadpool(_download_sync, settings, mailbox, uid, attachment_id)

    @classmethod
    async def send_message(cls, user_id: str, account_id: str, to: str, subject: str, content: str, attachments: list = None) -> dict:
        """SMTP 发送 + IMAP APPEND 归档到 Sent。"""
        from app.infrastructure.mail.smtp_client import build_message, send_mail

        settings = await cls._settings(user_id, account_id)
        html_content = content.replace("\r\n", "\n").replace("\n", "<br>")
        raw = build_message(
            from_addr=settings["email_address"],
            to=to,
            subject=subject,
            html_body=html_content,
            attachments=attachments,
        )
        try:
            await send_mail(
                settings["smtp_host"], settings["smtp_port"], settings["smtp_security"],
                settings["username"], settings["credential"], raw,
                sender=settings["email_address"], recipients=[to],
            )
        except Exception as exc:
            raise HTTPException(
                status_code=500,
                detail=f"邮件发送失败：{type(exc).__name__}（请检查授权码/服务器配置）",
            )
        await run_in_threadpool(_append_sent_sync, settings, raw)
        return {"status": "ok"}

    @classmethod
    async def reply_message(cls, user_id: str, email_id: str, content: str, attachments: list = None) -> dict:
        from app.infrastructure.mail.smtp_client import build_message, send_mail

        parsed = parse_email_id(email_id)
        if not parsed:
            raise HTTPException(status_code=400, detail="invalid imap email id")
        account_id, mailbox, uid = parsed
        settings = await cls._settings(user_id, account_id)

        raw = await run_in_threadpool(_get_raw_sync, settings, mailbox, uid)
        import email as email_mod
        original = email_mod.message_from_bytes(raw)
        original_msg_id = (original.get("Message-ID") or "").strip("<>") or None
        original_refs = [
            ref.strip("<>")
            for ref in (original.get("References") or "").replace(",", " ").split()
            if ref.strip("<>")
        ]
        references = original_refs + ([original_msg_id] if original_msg_id else [])
        original_subject = original.get("Subject") or ""
        subject = f"Re: {original_subject}" if not original_subject.lower().startswith("re:") else original_subject

        html_content = content.replace("\r\n", "\n").replace("\n", "<br>")
        raw_reply = build_message(
            from_addr=settings["email_address"],
            to=(original.get("Reply-To") or original.get("From") or ""),
            subject=subject,
            html_body=html_content,
            attachments=attachments,
            references=references or None,
            in_reply_to=original_msg_id,
        )
        try:
            reply_to = (original.get("Reply-To") or original.get("From") or "").strip()
            await send_mail(
                settings["smtp_host"], settings["smtp_port"], settings["smtp_security"],
                settings["username"], settings["credential"], raw_reply,
                sender=settings["email_address"], recipients=[reply_to],
            )
        except Exception as exc:
            raise HTTPException(
                status_code=500,
                detail=f"邮件回复失败：{type(exc).__name__}（请检查授权码/服务器配置）",
            )
        await run_in_threadpool(_append_sent_sync, settings, raw_reply)
        return {"status": "ok"}
