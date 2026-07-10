import logging

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
import json

from app.agents.draft import draft_reply
from app.agents.supervisor import build_supervisor
from app.db import chat_sessions
from app.db.supabase_client import get_user_id

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/agent", tags=["agent"])


@router.post("/draft-reply")
async def draft(body: dict, user_id: str = Depends(get_user_id)):
    email_id = body.get("email_id")
    intent = body.get("intent")
    my_name = body.get("my_name") or ""
    if not email_id or not intent:
        raise HTTPException(status_code=400, detail="email_id and intent are required")
    return {"draft": await draft_reply(user_id, email_id, intent, my_name)}


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
                # create_react_agent always names its LLM node "agent", so the
                # supervisor's own turn and every sub-agent's turn (mail_agent,
                # calendar_agent, memos_agent) all report node == "agent" -
                # checkpoint_ns additionally carries "<node_name>:<run_id>" for
                # whichever graph is actually running, so it's what tells the
                # supervisor's own turn apart from a sub-agent's turn (both of
                # which would otherwise stream and show up as one doubled reply).
                checkpoint_ns = metadata.get("langgraph_checkpoint_ns", "")
                is_supervisor_turn = checkpoint_ns.startswith("supervisor:")

                if event_type == "on_chat_model_stream" and node == "agent" and is_supervisor_turn:
                    chunk = event["data"].get("chunk")
                    if chunk and hasattr(chunk, "content") and chunk.content:
                        yield f"data: {json.dumps({'chunk': chunk.content})}\n\n"
                    elif chunk and isinstance(chunk, dict) and chunk.get("content"):
                        yield f"data: {json.dumps({'chunk': chunk['content']})}\n\n"
        except Exception as e:
            logger.exception("agent chat stream failed")
            yield f"data: {json.dumps({'error': str(e)})}\n\n"
        
        yield "data: [DONE]\n\n"

    return StreamingResponse(event_generator(), media_type="text/event-stream")

