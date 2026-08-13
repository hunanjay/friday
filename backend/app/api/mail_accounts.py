"""通用邮箱账号 API。

绑定流程（与负责人确认的产品流程一致）：
  登录 → 绑定邮箱 → 验证 IMAP + SMTP → 加密保存凭据

安全要点：
- 凭据只经 JSON body 提交，绝不进 URL / 日志
- 自定义服务器地址先做 SSRF 校验（禁内网/云元数据）
- 响应永远脱敏，不返回凭据
- 解绑时删除整行（凭据随行删除）
"""


import aiosmtplib
from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from starlette.concurrency import run_in_threadpool

from app.core.security import get_user_id
from app.infrastructure.db.repositories import mail_accounts
from app.infrastructure.mail.imap_client import connect, select_mailbox
from app.infrastructure.mail.providers import CUSTOM_PROVIDER, MAIL_PROVIDERS, resolve_provider_settings
from app.infrastructure.mail.ssrf import assert_public_host
from app.services.mail_provider_service import MailProviderService

router = APIRouter(prefix="/api", tags=["mail-accounts"])


@router.get("/mail-providers")
async def list_providers():
    """预设提供商列表（前端下拉用）。custom 总是可用。"""
    providers = [
        {"provider": key, "name": value["name"]}
        for key, value in MAIL_PROVIDERS.items()
    ]
    providers.append({"provider": CUSTOM_PROVIDER, "name": "自定义服务器"})
    return {"providers": providers}


async def _verify_imap_smtp(provider: str, account: str, username: str, auth_code: str, overrides: dict) -> None:
    """验证 IMAP（必选）+ SMTP（可选）连接。任一失败抛 HTTPException。"""
    settings = resolve_provider_settings(provider, overrides)
    for host in (settings["imap_host"], settings["smtp_host"]):
        if host:
            assert_public_host(host)

    # IMAP 验证：login + select INBOX
    try:
        client = connect(
            settings["imap_host"], settings["imap_port"], settings["imap_security"],
            username or account, auth_code, timeout=15,
        )
        try:
            select_mailbox(client, "INBOX")
        finally:
            try:
                client.logout()
            except Exception:
                pass
    except Exception:
        raise HTTPException(
            status_code=400,
            detail="IMAP 连接验证失败：账号/授权码错误，或服务器配置不正确",
        )

    # SMTP 验证：仅认证（login），不发送任何邮件。
    # 注意：aiosmtplib 没有顶层 login() - 先 connect 再 client.login()。
    if settings["smtp_host"]:
        smtp_client = aiosmtplib.SMTP(
            hostname=settings["smtp_host"],
            port=settings["smtp_port"],
            use_tls=settings["smtp_security"] == "ssl",
            start_tls=settings["smtp_security"] == "starttls",
            timeout=15,
        )
        try:
            await smtp_client.connect()
            await smtp_client.login(username or account, auth_code)
        except Exception:
            raise HTTPException(
                status_code=400,
                detail="SMTP 连接验证失败：账号/授权码错误，或服务器配置不正确（发送功能将不可用）",
            )
        finally:
            try:
                smtp_client.close()
            except Exception:
                pass


@router.post("/mail-accounts")
async def bind_account(body: dict, user_id: str = Depends(get_user_id)):
    """绑定邮箱：验证 IMAP+SMTP → 加密存储凭据。"""
    provider = (body.get("provider") or "").strip()
    email_address = (body.get("email_address") or "").strip()
    auth_code = (body.get("auth_code") or "").strip()
    if provider not in MAIL_PROVIDERS and provider != CUSTOM_PROVIDER:
        raise HTTPException(status_code=400, detail="unsupported provider")
    if not email_address or not auth_code:
        raise HTTPException(status_code=400, detail="email_address and auth_code are required")
    if provider == CUSTOM_PROVIDER and not (body.get("imap_host") and body.get("smtp_host")):
        raise HTTPException(status_code=400, detail="custom provider requires imap_host and smtp_host")

    username = (body.get("username") or "").strip() or email_address
    overrides = {
        "imap_host": (body.get("imap_host") or "").strip() or None,
        "imap_port": body.get("imap_port"),
        "imap_security": body.get("imap_security"),
        "smtp_host": (body.get("smtp_host") or "").strip() or None,
        "smtp_port": body.get("smtp_port"),
        "smtp_security": body.get("smtp_security"),
    }
    # 只有自定义/覆盖时才存覆盖值；预设值不入库（preset 由后端配置提供）
    preset = resolve_provider_settings(provider, {})
    stored_overrides = {k: v for k, v in overrides.items() if v is not None and v != preset.get(k)}

    await _verify_imap_smtp(provider, email_address, username, auth_code, overrides)

    account = await run_in_threadpool(
        mail_accounts.create_account,
        user_id, provider, email_address, username, auth_code,
        "app_password", stored_overrides,
    )
    return {"account": account}


@router.get("/mail-accounts")
async def list_accounts(user_id: str = Depends(get_user_id)):
    """当前用户绑定的所有邮箱（脱敏，不含凭据）。"""
    accounts = await run_in_threadpool(mail_accounts.list_accounts, user_id)
    return {"accounts": accounts}


@router.delete("/mail-accounts/{account_id}")
async def unbind_account(account_id: str, user_id: str = Depends(get_user_id)):
    """解绑：删除整行（加密凭据随行删除，不留残余）。"""
    deleted = await run_in_threadpool(mail_accounts.delete_account, user_id, account_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="邮箱账号不存在")
    return {"status": "ok"}


@router.post("/mail-accounts/{account_id}/verify")
async def verify_account(account_id: str, user_id: str = Depends(get_user_id)):
    """重新验证连接（设置页"测试连接"用）。"""
    return await MailProviderService.verify_connection(user_id, account_id)


# ── 账号级邮件路由 ───────────────────────────────────────────────────


@router.get("/mail-accounts/{account_id}/mail/inbox")
async def inbox(account_id: str, top: int = 25, cursor: str | None = None, user_id: str = Depends(get_user_id)):
    return await MailProviderService.get_inbox(user_id, account_id, top=top, cursor=cursor)


@router.get("/mail-accounts/{account_id}/mail/sent")
async def sent(account_id: str, top: int = 25, cursor: str | None = None, user_id: str = Depends(get_user_id)):
    return await MailProviderService.get_sent(user_id, account_id, top=top, cursor=cursor)


@router.get("/mail-accounts/{account_id}/mail/search")
async def search(
    account_id: str,
    query: str = "",
    folder: str = "inbox",
    unread_only: bool = False,
    has_attachments: bool = False,
    top: int = 25,
    cursor: str | None = None,
    user_id: str = Depends(get_user_id),
):
    return await MailProviderService.search(
        user_id, account_id, query=query, folder=folder,
        unread_only=unread_only, has_attachments=has_attachments, top=top, cursor=cursor,
    )


@router.get("/mail-accounts/{account_id}/mail/folders/{folder}")
async def folder_counts(account_id: str, folder: str, user_id: str = Depends(get_user_id)):
    return await MailProviderService.get_folder_counts(user_id, account_id, folder)


@router.get("/mail-accounts/{account_id}/mail/conversation/{thread_key}")
async def conversation_thread(account_id: str, thread_key: str, user_id: str = Depends(get_user_id)):
    return await MailProviderService.get_conversation_thread(user_id, account_id, thread_key)


@router.post("/mail-accounts/{account_id}/mail/send")
async def send(
    account_id: str,
    to: str = Form(...),
    subject: str = Form(...),
    body: str = Form(...),
    attachments: list[UploadFile] = File(default=[]),
    user_id: str = Depends(get_user_id),
):
    att_list = []
    for f in attachments:
        if f.filename:
            content = await f.read()
            att_list.append({"name": f.filename, "contentType": f.content_type, "content": content})
    return await MailProviderService.send_message(
        user_id, account_id, to=to, subject=subject, content=body, attachments=att_list
    )


# ── 按邮件 ID 路由（ID 自带 account_id，如 imap:{account_id}:INBOX:123） ──


@router.get("/mail/{email_id}")
async def read(email_id: str, user_id: str = Depends(get_user_id)):
    return await MailProviderService.get_message(user_id, email_id)


@router.patch("/mail/{email_id}/read")
async def mark_read(email_id: str, body: dict, user_id: str = Depends(get_user_id)):
    is_read = body.get("is_read", True)
    return await MailProviderService.mark_read(user_id, email_id, is_read)


@router.delete("/mail/{email_id}")
async def delete(email_id: str, permanent: bool = False, user_id: str = Depends(get_user_id)):
    return await MailProviderService.delete_message(user_id, email_id, permanent)


@router.post("/mail/{email_id}/reply")
async def reply(
    email_id: str,
    body: str = Form(""),
    attachments: list[UploadFile] = File(default=[]),
    user_id: str = Depends(get_user_id),
):
    att_list = []
    for f in attachments:
        if f.filename:
            content = await f.read()
            att_list.append({"name": f.filename, "contentType": f.content_type, "content": content})
    return await MailProviderService.reply_message(user_id, email_id, content=body, attachments=att_list)


@router.get("/mail/{email_id}/attachments")
async def list_attachments(email_id: str, user_id: str = Depends(get_user_id)):
    return await MailProviderService.list_attachments(user_id, email_id)


@router.get("/mail/{email_id}/attachments/{attachment_id}/download")
async def download_attachment(email_id: str, attachment_id: str, user_id: str = Depends(get_user_id)):
    from fastapi.responses import Response
    att = await MailProviderService.download_attachment(user_id, email_id, attachment_id)
    headers = {}
    if att["content_disposition"]:
        headers["Content-Disposition"] = att["content_disposition"]
    return Response(content=att["content"], media_type=att["content_type"], headers=headers)
