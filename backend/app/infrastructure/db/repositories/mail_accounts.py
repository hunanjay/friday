"""mail_accounts 存取。

凭据永远加密后入库（credential_ciphertext），本模块负责加解密边界：
- 对外（API/前端）只暴露脱敏数据，绝不返回凭据
- 对内（Provider 层）用 get_credentials() 取解密后的凭据
"""

from datetime import datetime, timezone

from app.core.security import supabase_admin
from app.infrastructure.security.crypto import decrypt_credential, encrypt_credential

_ACCOUNT_FIELDS = (
    "id,user_id,provider,email_address,auth_type,username,"
    "imap_host,imap_port,imap_security,smtp_host,smtp_port,smtp_security,"
    "status,last_verified_at,created_at,updated_at"
)


def _public_account(row: dict) -> dict:
    """脱敏视图：不含 credential_ciphertext，端口/安全模式原样返回。"""
    return {k: row.get(k) for k in _ACCOUNT_FIELDS.split(",")}


def create_account(
    user_id: str,
    provider: str,
    email_address: str,
    username: str,
    credential: str,
    auth_type: str = "app_password",
    overrides: dict | None = None,
) -> dict:
    overrides = overrides or {}
    row = {
        "user_id": user_id,
        "provider": provider,
        "email_address": email_address,
        "auth_type": auth_type,
        "username": username,
        "credential_ciphertext": encrypt_credential(credential),
        "imap_host": overrides.get("imap_host"),
        "imap_port": overrides.get("imap_port"),
        "imap_security": overrides.get("imap_security"),
        "smtp_host": overrides.get("smtp_host"),
        "smtp_port": overrides.get("smtp_port"),
        "smtp_security": overrides.get("smtp_security"),
        "status": "verified",
        "last_verified_at": datetime.now(timezone.utc).isoformat(),
    }
    res = supabase_admin.table("mail_accounts").insert(row).execute()
    return _public_account(res.data[0])


def list_accounts(user_id: str) -> list[dict]:
    res = (
        supabase_admin.table("mail_accounts")
        .select(_ACCOUNT_FIELDS)
        .eq("user_id", user_id)
        .order("created_at")
        .execute()
    )
    return [_public_account(row) for row in res.data]


def get_account(user_id: str, account_id: str) -> dict | None:
    res = (
        supabase_admin.table("mail_accounts")
        .select(_ACCOUNT_FIELDS)
        .eq("id", account_id)
        .eq("user_id", user_id)
        .execute()
    )
    return _public_account(res.data[0]) if res.data else None


def get_credentials(user_id: str, account_id: str) -> dict | None:
    """解密后的凭据，仅后端内部使用（Provider 层）。"""
    res = (
        supabase_admin.table("mail_accounts")
        .select("provider,email_address,username,credential_ciphertext")
        .eq("id", account_id)
        .eq("user_id", user_id)
        .execute()
    )
    if not res.data:
        return None
    row = res.data[0]
    return {
        "provider": row["provider"],
        "email_address": row["email_address"],
        "username": row["username"] or row["email_address"],
        "credential": decrypt_credential(row["credential_ciphertext"]),
    }


def update_status(user_id: str, account_id: str, status: str) -> None:
    supabase_admin.table("mail_accounts").update({"status": status}).eq(
        "id", account_id
    ).eq("user_id", user_id).execute()


def touch_verified(user_id: str, account_id: str) -> None:
    supabase_admin.table("mail_accounts").update(
        {"status": "verified", "last_verified_at": datetime.now(timezone.utc).isoformat()}
    ).eq("id", account_id).eq("user_id", user_id).execute()


def delete_account(user_id: str, account_id: str) -> bool:
    res = (
        supabase_admin.table("mail_accounts")
        .delete()
        .eq("id", account_id)
        .eq("user_id", user_id)
        .execute()
    )
    return bool(res.data)
