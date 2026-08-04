import json
import logging
import re
from urllib.parse import quote
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse

from app.agents.checkpointer import get_checkpointer
from app.agents.draft import draft_reply
from app.agents.message_visibility import visible_message_parts
from app.agents.routing import EMAIL_ADDRESS_RE, decide_route, is_email_send_request
from app.agents.supervisor import build_agent, build_supervisor, generate_session_title
from app.agents.turn_lock import session_turn_lock
from app.core.security import get_user_id
from app.infrastructure.db.repositories import chat_sessions, pending_actions
from app.tools.graph_client import graph_post

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/agent", tags=["agent"])

# Placeholder titles a session is created with (see chat.newSessionTitle in
# both locale files) - only auto-title over these, never a name the user
# (or a prior auto-title) already gave the session.
_DEFAULT_TITLES = {"New chat", "新对话"}

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
    sessions = await chat_sessions.list_sessions(user_id)
    saver = get_checkpointer()
    if saver:
        for session in sessions:
            if session.get("preview"):
                continue
            try:
                checkpoint = await saver.aget({"configurable": {"thread_id": session["id"]}})
                raw_messages = ((checkpoint or {}).get("channel_values") or {}).get("messages", [])
                for raw_message in reversed(raw_messages):
                    visible = visible_message_parts(raw_message)
                    if not visible:
                        continue
                    session["preview"] = await chat_sessions.update_session_preview(
                        user_id,
                        session["id"],
                        visible[1],
                        touch_updated_at=False,
                    )
                    break
            except Exception:
                logger.exception("failed to backfill preview for chat session %s", session["id"])
    return {"sessions": sessions}


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


@router.get("/sessions/{session_id}/messages")
async def get_session_messages(session_id: str, user_id: str = Depends(get_user_id)):
    """Returns the conversation history for a session, read from the LangGraph
    checkpoint stored in Postgres.  Only HumanMessages and final AI text
    responses are returned - tool calls and tool results are filtered out so
    the frontend only shows what the user typed and what Dora actually replied.

    Shape: [{id, sender, text, timestamp}] - matches the message objects
    ChatPage already renders, so no frontend schema change is needed.
    """
    session = await chat_sessions.get_session(user_id, session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    supervisor = build_supervisor(user_id, session_id)
    config = {"configurable": {"thread_id": session_id}}
    state = await supervisor.aget_state(config)
    raw_messages = (state.values or {}).get("messages", [])

    results = []
    for msg in raw_messages:
        visible = visible_message_parts(msg)
        if not visible:
            continue
        msg_type, content, msg_id = visible

        if msg_type == "human":
            results.append({
                "id": str(msg_id) if msg_id else f"h_{len(results)}",
                "sender": "user",
                "senderName": "You",
                "text": content,
                "timestamp": "",
            })
        elif msg_type == "ai":
            results.append({
                "id": str(msg_id) if msg_id else f"a_{len(results)}",
                "sender": "bot",
                "senderName": "Dora",
                "text": content,
                "timestamp": "",
            })

    preview = session.get("preview") or ""
    if not preview and results:
        preview = await chat_sessions.update_session_preview(
            user_id, session_id, results[-1]["text"], touch_updated_at=False
        )
    return {"messages": results, "preview": preview}


@router.get("/actions")
async def list_actions(session_id: str, user_id: str = Depends(get_user_id)):
    session = await chat_sessions.get_session(user_id, session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    actions = await pending_actions.list_session_actions(user_id, session_id)
    return {"actions": [pending_actions.public_action(action) for action in actions]}


@router.post("/actions/{action_id}/confirm")
async def confirm_action(action_id: UUID, user_id: str = Depends(get_user_id)):
    """Execute an approved action exactly once.

    Agent tools cannot call this endpoint and never receive the user's bearer
    token. Only the authenticated UI exposes it after a deliberate click.
    """
    action_id_str = str(action_id)
    action = await pending_actions.claim_action(user_id, action_id_str)
    if not action:
        existing = await pending_actions.get_action(user_id, action_id_str)
        if not existing:
            raise HTTPException(status_code=404, detail="Action not found")
        raise HTTPException(status_code=409, detail=f"Action is already {existing['status']}")

    payload = action["payload"]
    try:
        if action["action_type"] == "send_email":
            html_body = payload["body"].replace("\r\n", "\n").replace("\n", "<br>")
            await graph_post(
                user_id,
                "/me/sendMail",
                {
                    "message": {
                        "subject": payload["subject"],
                        "body": {"contentType": "HTML", "content": html_body},
                        "toRecipients": [{"emailAddress": {"address": payload["to"]}}],
                    },
                    "saveToSentItems": True,
                },
            )
            message = f"Email sent to {payload['to']}."
        elif action["action_type"] == "delete_email":
            await graph_post(
                user_id,
                f"/me/messages/{quote(payload['email_id'])}/move",
                {"destinationId": "deleteditems"},
            )
            message = "Email moved to Deleted Items."
        else:
            raise RuntimeError("Unsupported pending action type")
    except Exception as exc:
        await pending_actions.fail_action(user_id, action_id_str, str(exc))
        raise

    completed = await pending_actions.complete_action(user_id, action_id_str)
    preview = await chat_sessions.update_session_preview(user_id, action["session_id"], message)
    return {
        "status": "completed",
        "message": message,
        "preview": preview,
        "action": pending_actions.public_action(completed),
    }


@router.post("/actions/{action_id}/cancel")
async def cancel_action(action_id: UUID, user_id: str = Depends(get_user_id)):
    action_id_str = str(action_id)
    action = await pending_actions.cancel_action(user_id, action_id_str)
    if not action:
        existing = await pending_actions.get_action(user_id, action_id_str)
        if not existing:
            raise HTTPException(status_code=404, detail="Action not found")
        raise HTTPException(status_code=409, detail=f"Action is already {existing['status']}")
    return {"status": "cancelled", "action": pending_actions.public_action(action)}


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

    route = decide_route(message)
    routed_agent = route.agent_name
    routed_message = route.message
    async def locked_event_generator():
        config = {"configurable": {"thread_id": session_id}}
        assistant_chunks: list[str] = []
        requires_email_approval = routed_agent == "mail_agent" and is_email_send_request(routed_message)
        existing_action_ids: set[str] = set()
        if requires_email_approval:
            try:
                existing_action_ids = {
                    action["id"]
                    for action in await pending_actions.list_session_actions(user_id, session_id)
                }
            except Exception:
                logger.exception("failed to snapshot email actions before agent run")
        try:
            if routed_agent:
                # Deterministic routing for an explicit "/agent_name ..." tag
                # or a recognized send-email request. The supervisor's routing
                # is prompt-following and can be skipped by the model, so call
                # the target sub-agent directly. Reads the shared
                # conversation straight off the supervisor's own checkpoint
                # so the sub-agent still has full context, then writes the
                # new turn back into that same checkpoint (as_node=routed_agent)
                # so a later untagged message still sees it.
                supervisor_graph = build_supervisor(user_id, session_id)
                state = await supervisor_graph.aget_state(config)
                history = (state.values or {}).get("messages", [])
                agent = build_agent(user_id, routed_agent, session_id)
                new_user_msg = {"role": "user", "content": routed_message}

                final_output = None
                async for event in agent.astream_events(
                    {"messages": history + [new_user_msg]},
                    version="v2",
                ):
                    if event.get("event") == "on_chat_model_stream" and event.get("metadata", {}).get("langgraph_node") == "agent":
                        chunk = event["data"].get("chunk")
                        if chunk and getattr(chunk, "content", None):
                            if isinstance(chunk.content, str) and not requires_email_approval:
                                assistant_chunks.append(chunk.content)
                                yield f"data: {json.dumps({'chunk': chunk.content})}\n\n"
                    elif event.get("event") == "on_chain_end" and not event.get("parent_ids"):
                        final_output = event["data"]["output"]

                if final_output:
                    new_messages = final_output["messages"][len(history):]
                    if requires_email_approval:
                        current_actions = await pending_actions.list_session_actions(user_id, session_id)
                        created_action = next(
                            (action for action in current_actions if action["id"] not in existing_action_ids),
                            None,
                        )
                        if not created_action:
                            recipient_match = EMAIL_ADDRESS_RE.search(routed_message)
                            recipient = recipient_match.group(0).lower() if recipient_match else ""
                            created_action = next(
                                (
                                    action
                                    for action in current_actions
                                    if action["status"] == "pending"
                                    and str(action.get("payload", {}).get("to", "")).lower() == recipient
                                ),
                                None,
                            )
                        is_zh = bool(re.search(r"[\u4e00-\u9fff]", routed_message))
                        safe_reply = (
                            "邮件已准备好，请检查下方确认卡片并确认发送。"
                            if created_action and is_zh
                            else "The email is ready. Review the confirmation card below before sending."
                            if created_action
                            else "未能创建邮件确认卡，邮件没有发送。请重试。"
                            if is_zh
                            else "The confirmation card could not be created. The email was not sent. Please try again."
                        )
                        assistant_chunks = [safe_reply]
                        yield f"data: {json.dumps({'chunk': safe_reply})}\n\n"
                        anchor_message_id = None
                        for index in range(len(new_messages) - 1, -1, -1):
                            if getattr(new_messages[index], "type", None) == "ai":
                                new_messages[index] = new_messages[index].model_copy(
                                    update={"content": safe_reply}
                                )
                                anchor_message_id = getattr(new_messages[index], "id", None)
                                break
                        if created_action and anchor_message_id:
                            await pending_actions.set_action_anchor(
                                user_id,
                                created_action["id"],
                                str(anchor_message_id),
                            )
                    await supervisor_graph.aupdate_state(config, {"messages": new_messages}, as_node=routed_agent)
            else:
                graph = build_supervisor(user_id, session_id)
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
                            if isinstance(chunk.content, str):
                                assistant_chunks.append(chunk.content)
                            yield f"data: {json.dumps({'chunk': chunk.content})}\n\n"
                        elif chunk and isinstance(chunk, dict) and chunk.get("content"):
                            chunk_content = chunk["content"]
                            if isinstance(chunk_content, str):
                                assistant_chunks.append(chunk_content)
                            yield f"data: {json.dumps({'chunk': chunk_content})}\n\n"
        except Exception as e:
            logger.exception("agent chat stream failed")
            err_type = str(type(e).__name__)
            err_msg = str(e)
            if "Timeout" in err_type or "timeout" in err_msg.lower():
                user_err = "网络连接超时，请点击发送或稍后再试。"
            else:
                user_err = err_msg
            yield f"data: {json.dumps({'error': user_err})}\n\n"

        if assistant_chunks:
            try:
                preview = await chat_sessions.update_session_preview(
                    user_id, session_id, "".join(assistant_chunks)
                )
                yield f"data: {json.dumps({'preview': preview})}\n\n"
            except Exception:
                logger.exception("failed to update chat session preview")

        try:
            actions = await pending_actions.list_session_actions(user_id, session_id)
            public_actions = [pending_actions.public_action(action) for action in actions]
            yield f"data: {json.dumps({'pending_actions': public_actions})}\n\n"
        except Exception:
            logger.exception("failed to load pending actions for chat stream")

        if session["title"] in _DEFAULT_TITLES:
            try:
                title = await generate_session_title(routed_message)
                await chat_sessions.update_session_title(user_id, session_id, title)
                yield f"data: {json.dumps({'title': title})}\n\n"
            except Exception:
                logger.exception("session title generation failed")

        yield "data: [DONE]\n\n"

    async def event_generator():
        # Hold the lock for the complete graph run and checkpoint update.  The
        # response remains streaming; a concurrent request for this session
        # simply waits until the previous turn reaches its terminal event.
        async with session_turn_lock(session_id):
            await chat_sessions.update_session_preview(user_id, session_id, routed_message)
            async for event in locked_event_generator():
                yield event

    return StreamingResponse(event_generator(), media_type="text/event-stream")
