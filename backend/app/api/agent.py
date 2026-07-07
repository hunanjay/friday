from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
import json

from app.agents.supervisor import build_supervisor
from app.db import chat_sessions
from app.db.supabase_client import get_user_id

router = APIRouter(prefix="/api/agent", tags=["agent"])


@router.get("/sessions")
async def list_sessions(user_id: str = Depends(get_user_id)):
    return {"sessions": await chat_sessions.list_sessions(user_id)}


@router.post("/sessions")
async def create_session(body: dict, user_id: str = Depends(get_user_id)):
    title = body.get("title") or "New chat"
    return await chat_sessions.create_session(user_id, title)


@router.delete("/sessions/{session_id}")
async def delete_session(session_id: str, user_id: str = Depends(get_user_id)):
    deleted = await chat_sessions.delete_session(user_id, session_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Session not found")
    return {"status": "ok"}


@router.post("/chat")
async def chat(body: dict, user_id: str = Depends(get_user_id)):
    message = body.get("message")
    session_id = body.get("session_id")
    if not message:
        raise HTTPException(status_code=400, detail="message is required")
    if not session_id:
        raise HTTPException(status_code=400, detail="session_id is required")
    if not await chat_sessions.session_exists(user_id, session_id):
        raise HTTPException(status_code=404, detail="Session not found")

    async def event_generator():
        graph = build_supervisor(user_id)
        try:
            async for event in graph.astream_events(
                {"messages": [{"role": "user", "content": message}]},
                config={"configurable": {"thread_id": session_id}},
                version="v2",
            ):
                event_type = event.get("event")
                metadata = event.get("metadata", {})
                node = metadata.get("langgraph_node")
                
                # Check if it's the supervisor's chat model stream
                if event_type == "on_chat_model_stream" and node == "agent":
                    chunk = event["data"].get("chunk")
                    if chunk and hasattr(chunk, "content") and chunk.content:
                        yield f"data: {json.dumps({'chunk': chunk.content})}\n\n"
                    elif chunk and isinstance(chunk, dict) and chunk.get("content"):
                        yield f"data: {json.dumps({'chunk': chunk['content']})}\n\n"
        except Exception as e:
            yield f"data: {json.dumps({'error': str(e)})}\n\n"
        
        yield "data: [DONE]\n\n"

    return StreamingResponse(event_generator(), media_type="text/event-stream")

