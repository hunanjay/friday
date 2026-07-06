from datetime import datetime, timedelta, timezone

from app.db.supabase_client import supabase_admin


def set_ms_token(user_id: str, token: str, refresh_token: str | None = None, expires_in: int | None = None) -> None:
    row = {"user_id": user_id, "token": token}
    if refresh_token is not None:
        row["refresh_token"] = refresh_token
    if expires_in is not None:
        row["expires_at"] = (datetime.now(timezone.utc) + timedelta(seconds=expires_in)).isoformat()
    supabase_admin.table("ms_tokens").upsert(row).execute()


def get_ms_token_row(user_id: str) -> dict | None:
    res = supabase_admin.table("ms_tokens").select("token, refresh_token, expires_at").eq("user_id", user_id).execute()
    return res.data[0] if res.data else None


def get_ms_token(user_id: str) -> str | None:
    row = get_ms_token_row(user_id)
    return row["token"] if row else None
