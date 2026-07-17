import logging
import re

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
import json

from app.agents.draft import draft_reply
from app.agents.supervisor import AGENT_NAMES, build_agent, build_supervisor, generate_session_title
from app.db import chat_sessions
from app.db.supabase_client import get_user_id

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/agent", tags=["agent"])

# Placeholder titles a session is created with (see chat.newSessionTitle in
# both locale files) - only auto-title over these, never a name the user
# (or a prior auto-title) already gave the session.
_DEFAULT_TITLES = {"New chat", "新对话"}

# Matches an explicit "/agent_name rest of message" prefix, e.g. from the
# chat page's slash-command agent picker (ChatPage.jsx's selectAgent).
_TAG_RE = re.compile(r"^/(\w+)\s+(.*)", re.DOTALL)


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
    session = await chat_sessions.get_session(user_id, session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    tag_match = _TAG_RE.match(message.strip())
    routed_agent = tag_match.group(1) if tag_match and tag_match.group(1) in AGENT_NAMES else None
    routed_message = tag_match.group(2).strip() if routed_agent else message

    async def event_generator():
        config = {"configurable": {"thread_id": session_id}}
        try:
            if routed_agent:
                # Deterministic routing for an explicit "/agent_name ..."
                # tag: the supervisor's own routing is just prompt-following
                # (an LLM tool call it can choose to skip) and silently did
                # skip it in practice, so bypass the supervisor entirely and
                # call the target sub-agent directly. Reads the shared
                # conversation straight off the supervisor's own checkpoint
                # so the sub-agent still has full context, then writes the
                # new turn back into that same checkpoint (as_node=routed_agent)
                # so a later untagged message still sees it.
                supervisor_graph = build_supervisor(user_id)
                state = await supervisor_graph.aget_state(config)
                history = (state.values or {}).get("messages", [])
                agent = build_agent(user_id, routed_agent)
                new_user_msg = {"role": "user", "content": routed_message}

                final_output = None
                async for event in agent.astream_events(
                    {"messages": history + [new_user_msg]},
                    version="v2",
                ):
                    if event.get("event") == "on_chat_model_stream" and event.get("metadata", {}).get("langgraph_node") == "agent":
                        chunk = event["data"].get("chunk")
                        if chunk and getattr(chunk, "content", None):
                            yield f"data: {json.dumps({'chunk': chunk.content})}\n\n"
                    elif event.get("event") == "on_chain_end" and not event.get("parent_ids"):
                        final_output = event["data"]["output"]

                if final_output:
                    new_messages = final_output["messages"][len(history):]
                    await supervisor_graph.aupdate_state(config, {"messages": new_messages}, as_node=routed_agent)
            else:
                graph = build_supervisor(user_id)
                async for event in graph.astream_events(
                    {"messages": [{"role": "user", "content": message}]},
                    config=config,
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

        if session["title"] in _DEFAULT_TITLES:
            try:
                title = await generate_session_title(routed_message)
                await chat_sessions.update_session_title(user_id, session_id, title)
                yield f"data: {json.dumps({'title': title})}\n\n"
            except Exception:
                logger.exception("session title generation failed")

        yield "data: [DONE]\n\n"

    return StreamingResponse(event_generator(), media_type="text/event-stream")

