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


def set_github_token(user_id: str, token: str) -> None:
    """A plain .upsert({"token": ...}) would null out `repos` on reconnect -
    PostgREST's upsert replaces the whole row using only the payload's
    columns, it doesn't merge. Update first (preserves `repos` on an
    existing row); only insert if there wasn't one yet."""
    updated = supabase_admin.table("github_tokens").update({"token": token}).eq("user_id", user_id).execute()
    if not updated.data:
        supabase_admin.table("github_tokens").insert({"user_id": user_id, "token": token}).execute()


def get_github_token(user_id: str) -> str | None:
    res = supabase_admin.table("github_tokens").select("token").eq("user_id", user_id).execute()
    return res.data[0]["token"] if res.data else None


def set_github_repos(user_id: str, repos: list[str]) -> None:
    """Only ever called for an already-connected user (repo picker is only
    shown once connected), so a github_tokens row already exists to update -
    a real UPDATE (not upsert) so it touches only this column."""
    supabase_admin.table("github_tokens").update({"repos": repos}).eq("user_id", user_id).execute()


def get_github_repos(user_id: str) -> list[str]:
    res = supabase_admin.table("github_tokens").select("repos").eq("user_id", user_id).execute()
    return res.data[0]["repos"] if res.data else []


def delete_github_token(user_id: str) -> None:
    supabase_admin.table("github_tokens").delete().eq("user_id", user_id).execute()
