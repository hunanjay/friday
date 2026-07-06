from fastapi import APIRouter, Depends, HTTPException

from app.agents.supervisor import build_supervisor
from app.db.supabase_client import get_user_id

router = APIRouter(prefix="/api/agent", tags=["agent"])


@router.post("/chat")
async def chat(body: dict, user_id: str = Depends(get_user_id)):
    message = body.get("message")
    if not message:
        raise HTTPException(status_code=400, detail="message is required")

    graph = build_supervisor(user_id)
    result = await graph.ainvoke({"messages": [{"role": "user", "content": message}]})
    reply = result["messages"][-1].content
    return {"reply": reply}
