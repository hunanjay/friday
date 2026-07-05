import httpx
from fastapi import HTTPException

from app.db.token_store import get_ms_token

GRAPH_BASE = "https://graph.microsoft.com/v1.0"


async def graph_get(user_id: str, path: str) -> dict:
    ms_token = get_ms_token(user_id)
    if not ms_token:
        raise HTTPException(status_code=404, detail="No Microsoft account linked")
    async with httpx.AsyncClient() as client:
        resp = await client.get(
            f"{GRAPH_BASE}{path}",
            headers={"Authorization": f"Bearer {ms_token}"},
        )
    if resp.status_code == 401:
        raise HTTPException(status_code=401, detail="Microsoft token expired, please sign in again")
    if resp.status_code >= 400:
        raise HTTPException(status_code=resp.status_code, detail=f"Graph API error: {resp.text}")
    return resp.json()
