from app.db.supabase_client import supabase_admin


def set_ms_token(user_id: str, token: str) -> None:
    supabase_admin.table("ms_tokens").upsert({"user_id": user_id, "token": token}).execute()


def get_ms_token(user_id: str) -> str | None:
    res = supabase_admin.table("ms_tokens").select("token").eq("user_id", user_id).execute()
    return res.data[0]["token"] if res.data else None
