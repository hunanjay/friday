import json
import logging
import re
import time
import uuid

from fastapi import APIRouter, Body, Depends, HTTPException
from fastapi.responses import StreamingResponse
from langchain_core.messages import AIMessage, ToolMessage
from langgraph.types import Command

from app.agents.checkpointer import get_checkpointer
from app.agents.draft import draft_reply
from app.agents.hitl import (
    approved_tool_error,
    interrupt_to_action,
    pending_actions_from_interrupts,
    resume_value_for,
)
from app.agents.message_visibility import (
    final_reply_text,
    is_supervisor_stream_namespace,
    visible_conversation_parts,
    visible_message_parts,
)
from app.agents.routing import AGENT_NAMES, decide_route
from app.agents.supervisor import build_supervisor, describe_team, format_memory_block, generate_session_title
from app.agents.turn_lock import session_turn_lock
from app.core.security import get_user_id
from app.core.tracing import trace_config
from app.infrastructure.db.repositories import (
    agent_runs,
    chat_sessions,
    hitl_audit,
    signature_templates,
    user_memory,
    user_settings,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/agent", tags=["agent"])

# Placeholder titles a session is created with (see chat.newSessionTitle in
# both locale files) - only auto-title over these, never a name the user
# (or a prior auto-title) already gave the session.
_DEFAULT_TITLES = {"New chat", "新对话"}


def _paused_reply(message: str) -> str:
    is_zh = bool(re.search(r"[\u4e00-\u9fff]", message or ""))
    return (
        "操作已暂停，请检查确认卡片；确认前不会执行。"
        if is_zh
        else "The action is paused. Review the confirmation card; it will not run before approval."
    )


def _explicit_agent_name(message) -> str | None:
    name = message.get("name") if isinstance(message, dict) else getattr(message, "name", None)
    return name if name in AGENT_NAMES else None


async def _prompt_settings(user_id: str) -> tuple[str, bool, str]:
    """Assistant name, whether a mail signature is configured, and the
    injectable user-memory block (profile + preference facts).

    All three shape the system prompts, so every graph build reads them
    together - the mail agent must stop writing its own sign-off once a
    signature exists, and every agent should see what's known about the user.
    """
    profile_rows, preference_rows = await user_memory.get_injectable_memory(user_id)
    return (
        await user_settings.get_assistant_name(user_id),
        bool(await signature_templates.get_default_content(user_id)),
        format_memory_block(profile_rows, preference_rows),
    )


async def _visible_actions_signature(user_id: str) -> str:
    """The signature an approval card must preview, since the send appends it."""
    return await signature_templates.get_default_content(user_id)


async def _visible_actions(user_id: str, session_id: str, interrupts: tuple) -> list[dict]:
    """Combine official interrupts with their durable execution state."""
    pending = await pending_actions_from_interrupts(
        interrupts, session_id, user_id, await _visible_actions_signature(user_id)
    )
    for action in pending:
        await hitl_audit.ensure_pending(user_id, session_id, action)
    persisted = await hitl_audit.list_actions(user_id, session_id)
    live_by_id = {action["id"]: action for action in pending}
    for action in persisted:
        live = live_by_id.get(action["id"])
        # The audit row was rendered when the interrupt was raised. While it is
        # still pending, what the card previews has to follow the live settings -
        # otherwise a signature saved after the draft appeared would be sent but
        # never shown.
        if live and action.get("status") == "pending":
            action["presentation"] = live["presentation"]
    persisted_ids = {action["id"] for action in persisted}
    return persisted + [action for action in pending if action["id"] not in persisted_ids]


@router.post("/draft-reply")
async def draft(body: dict, user_id: str = Depends(get_user_id)):
    email_id = body.get("email_id")
    intent = body.get("intent")
    my_name = body.get("my_name") or ""
    if not email_id or not intent:
        raise HTTPException(status_code=400, detail="email_id and intent are required")
    return {"draft": await draft_reply(user_id, email_id, intent, my_name)}


@router.get("/team_info")
async def team_info(user_id: str = Depends(get_user_id)):
    """Debug/introspection: the supervisor's prompt plus each domain agent's
    system prompt and tool name/description, exactly as they're sent to the
    model on the next real request from this user."""
    assistant_name, has_signature, memory_block = await _prompt_settings(user_id)
    return describe_team(user_id, assistant_name=assistant_name, has_signature=has_signature, memory_block=memory_block)


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
    the frontend only shows what the user typed and what the assistant actually
    replied.

    Shape: [{id, sender, text, timestamp}] - matches the message objects
    ChatPage already renders, so no frontend schema change is needed.
    """
    session = await chat_sessions.get_session(user_id, session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    assistant_name, has_signature, memory_block = await _prompt_settings(user_id)
    supervisor = build_supervisor(user_id, session_id, assistant_name, has_signature, memory_block)
    config = {"configurable": {"thread_id": session_id}}
    state = await supervisor.aget_state(config)
    raw_messages = (state.values or {}).get("messages", [])
    explicit_agents = {
        str(message.get("id") if isinstance(message, dict) else getattr(message, "id", "")): agent_name
        for message in raw_messages
        if (agent_name := _explicit_agent_name(message))
    }

    results = []
    for visible in visible_conversation_parts(raw_messages):
        msg_type, content, msg_id = visible

        if msg_type == "human":
            results.append({
                "id": str(msg_id) if msg_id else f"h_{len(results)}",
                "sender": "user",
                "senderName": "You",
                "text": content,
                "agent_name": explicit_agents.get(str(msg_id)),
                "timestamp": "",
            })
        elif msg_type == "ai":
            results.append({
                "id": str(msg_id) if msg_id else f"a_{len(results)}",
                "sender": "bot",
                "senderName": assistant_name,
                "text": content,
                "timestamp": "",
            })

    # An interrupted tool call has no persisted assistant text yet. Recreate
    # the safe pause reply with an id derived from the interrupt so its card has
    # a stable place in history across refreshes and thread switches.
    latest_user_text = next(
        (message["text"] for message in reversed(results) if message["sender"] == "user"),
        "",
    )
    for interrupt in state.interrupts:
        results.append({
            "id": f"hitl_{interrupt.id}",
            "sender": "bot",
            "senderName": assistant_name,
            "text": _paused_reply(latest_user_text),
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
    assistant_name, has_signature, memory_block = await _prompt_settings(user_id)
    graph = build_supervisor(user_id, session_id, assistant_name, has_signature, memory_block)
    state = await graph.aget_state({"configurable": {"thread_id": session_id}})
    return {"actions": await _visible_actions(user_id, session_id, state.interrupts)}


async def _decide_action(
    action_id: str,
    decision_id: str,
    session_id: str,
    user_id: str,
    edited_args: dict | None = None,
):
    session = await chat_sessions.get_session(user_id, session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    config = {"configurable": {"thread_id": session_id}, **trace_config(session_id, user_id)}
    assistant_name, has_signature, memory_block = await _prompt_settings(user_id)
    graph = build_supervisor(user_id, session_id, assistant_name, has_signature, memory_block)

    async with session_turn_lock(session_id):
        state = await graph.aget_state(config)
        pending = next((item for item in state.interrupts if item.id == action_id), None)
        if not pending:
            raise HTTPException(status_code=409, detail="This HITL interrupt is no longer pending")
        try:
            resume_value = resume_value_for(pending, decision_id, edited_args)
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc

        pending_action = await interrupt_to_action(
            pending,
            session_id,
            user_id,
            anchor_message_id=f"hitl_{pending.id}",
            signature=await _visible_actions_signature(user_id),
        )
        await hitl_audit.ensure_pending(user_id, session_id, pending_action)
        claim_status = await hitl_audit.claim_action(
            user_id,
            session_id,
            action_id,
            decision_id,
        )
        if claim_status == "expired":
            raise HTTPException(status_code=410, detail="This approval has expired")
        if claim_status != "claimed":
            raise HTTPException(
                status_code=409,
                detail=f"This HITL action is already {claim_status}",
            )

        before_messages = visible_conversation_parts((state.values or {}).get("messages", []))
        before_ai_ids = {
            message_id
            for kind, _content, message_id in before_messages
            if kind == "ai" and message_id
        }
        execution_error = None
        execution_results = []
        try:
            async for event in graph.astream_events(
                Command(resume={pending.id: resume_value}),
                config=config,
                version="v2",
            ):
                event_type = event.get("event")
                if event_type not in {"on_tool_end", "on_tool_error"}:
                    continue
                tool_name = event.get("name") or ""
                if event_type == "on_tool_error":
                    execution_results.append(
                        {
                            "name": tool_name,
                            "tool_call_id": f"event-error-{len(execution_results)}",
                            "status": "error",
                            "content": str(event.get("data", {}).get("error", "tool execution failed")),
                        }
                    )
                    continue
                output = event.get("data", {}).get("output")
                if isinstance(output, ToolMessage):
                    execution_results.append(output)
                else:
                    execution_results.append(
                        {
                            "name": tool_name,
                            "tool_call_id": f"event-result-{len(execution_results)}",
                            "status": "success",
                            "content": str(output or ""),
                        }
                    )
            resumed_state = await graph.aget_state(config)
        except Exception:
            # The external write may already have happened.  Fail closed and
            # retain the action for reconciliation instead of allowing a blind
            # retry that could duplicate the side effect.
            logger.exception("HITL action %s failed while resuming the graph", action_id)
            execution_error = "Execution was interrupted; the external outcome may require reconciliation."
            resumed_state = state
        messages = visible_conversation_parts((resumed_state.values or {}).get("messages", []))
        final_reply = next(
            (
                (content, message_id)
                for kind, content, message_id in reversed(messages)
                if kind == "ai" and (not message_id or message_id not in before_ai_ids)
            ),
            None,
        )
        final_text = final_reply[0] if final_reply else ""
        if decision_id == "reject" and execution_error is None:
            status = "cancelled"
        else:
            if execution_error is None:
                execution_error = approved_tool_error(
                    pending,
                    execution_results,
                )
            status = "failed" if execution_error else "succeeded"
        action = await interrupt_to_action(
            pending,
            session_id,
            user_id,
            status=status,
            anchor_message_id=final_reply[1] if final_reply else None,
            signature=await _visible_actions_signature(user_id),
        )
        # Show what was actually executed, not the model's original draft.
        edited_action = (resume_value["decisions"][0]).get("edited_action") or {}
        if edited_action.get("args"):
            action["payload"] = dict(edited_action["args"])
        action["resolved"] = True
        if execution_error:
            action["error"] = execution_error
        try:
            await hitl_audit.finish_action(
                user_id,
                session_id,
                action,
                status,
                error=execution_error,
            )
        except Exception:
            # If the graph already performed an external write, keep the API
            # response independent from presentation persistence. The row
            # remains executing and can be reconciled instead of retried.
            logger.exception("failed to finalize HITL execution state %s", action_id)
        preview = session.get("preview") or ""
        if final_text:
            preview = await chat_sessions.update_session_preview(user_id, session_id, final_text)
        return {
            "status": status,
            "message": final_text,
            "preview": preview,
            "action": action,
            "pending_actions": await _visible_actions(
                user_id, session_id, resumed_state.interrupts
            ),
        }


@router.post("/actions/{action_id}/decisions/{decision_id}")
async def decide_action(
    action_id: str,
    decision_id: str,
    session_id: str,
    body: dict | None = Body(None),
    user_id: str = Depends(get_user_id),
):
    """Resume an official LangChain HITL interrupt with a human decision.

    An optional ``{"payload": {...}}`` body carries the fields the user edited
    inline on the approval card; only keys the original tool call already had
    are accepted (see ``resume_value_for``).
    """
    edited_args = (body or {}).get("payload") or None
    if edited_args is not None and not isinstance(edited_args, dict):
        raise HTTPException(status_code=422, detail="payload must be an object")
    return await _decide_action(action_id, decision_id, session_id, user_id, edited_args)


@router.post("/actions/{action_id}/confirm")
async def confirm_action(action_id: str, session_id: str, user_id: str = Depends(get_user_id)):
    return await _decide_action(action_id, "approve", session_id, user_id)


@router.post("/actions/{action_id}/cancel")
async def cancel_action(action_id: str, session_id: str, user_id: str = Depends(get_user_id)):
    return await _decide_action(action_id, "reject", session_id, user_id)


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
    assistant_name, has_signature, memory_block = await _prompt_settings(user_id)

    async def locked_event_generator():
        started_at = time.perf_counter()
        tool_calls = 0
        # Which agent actually handled the turn: the slash command names it up
        # front, otherwise it is whoever the supervisor delegated to first.
        handled_by = routed_agent
        ok = True
        config = {"configurable": {"thread_id": session_id}, **trace_config(session_id, user_id)}
        graph = build_supervisor(user_id, session_id, assistant_name, has_signature, memory_block)
        user_message = {"role": "user", "content": routed_message}
        if route.source == "slash_command":
            # Persist the explicit route for UI rendering. The model adapter
            # strips message names before provider serialization, so this is
            # checkpoint metadata rather than prompt content.
            user_message["name"] = routed_agent
        input_messages = [user_message]
        if route.source == "slash_command":
            input_messages.append(
                AIMessage(
                    content="",
                    tool_calls=[
                        {
                            "name": f"delegate_to_{routed_agent}",
                            "args": {"task": routed_message},
                            "id": f"slash-{uuid.uuid4().hex}",
                            "type": "tool_call",
                        }
                    ],
                )
            )
        run_input = {"messages": input_messages}
        try:
            async for event in graph.astream_events(run_input, config=config, version="v2"):
                event_type = event.get("event")
                metadata = event.get("metadata", {})
                node = metadata.get("langgraph_node")
                checkpoint_ns = metadata.get("langgraph_checkpoint_ns", "")
                is_supervisor_turn = is_supervisor_stream_namespace(checkpoint_ns)

                if event_type == "on_chat_model_stream" and node == "model" and is_supervisor_turn:
                    chunk = event["data"].get("chunk")
                    chunk_content = getattr(chunk, "content", None)
                    if chunk_content is None and isinstance(chunk, dict):
                        chunk_content = chunk.get("content")
                    if isinstance(chunk_content, str) and chunk_content:
                        yield f"data: {json.dumps({'chunk': chunk_content})}\n\n"
                elif event_type == "on_tool_start":
                    tool_name = event.get("name") or metadata.get("langgraph_node") or "tool"
                    if tool_name.startswith("delegate_to_"):
                        if handled_by is None:
                            handled_by = tool_name.removeprefix("delegate_to_")
                        continue
                    tool_input = event.get("data", {}).get("input") or {}
                    yield f"data: {json.dumps({'tool_call': {'name': tool_name, 'input': tool_input, 'status': 'running'}})}\n\n"
                elif event_type == "on_tool_end":
                    tool_name = event.get("name") or metadata.get("langgraph_node") or "tool"
                    if tool_name.startswith("delegate_to_"):
                        continue
                    tool_calls += 1
                    tool_output = event.get("data", {}).get("output")
                    output_str = str(tool_output)[:500] if tool_output is not None else ""
                    yield f"data: {json.dumps({'tool_call': {'name': tool_name, 'output': output_str, 'status': 'completed'}})}\n\n"
        except Exception as e:
            logger.exception("agent chat stream failed")
            ok = False
            err_type = str(type(e).__name__)
            err_msg = str(e)
            if "Timeout" in err_type or "timeout" in err_msg.lower():
                user_err = "网络连接超时，请点击发送或稍后再试。"
            else:
                user_err = err_msg
            yield f"data: {json.dumps({'error': user_err})}\n\n"

        state = await graph.aget_state(config)
        public_actions = await _visible_actions(user_id, session_id, state.interrupts)

        # What the user ends up seeing never comes from the streamed chunks:
        # those are a typing effect that can lag, duplicate, or stream a leg of
        # the graph that never becomes the answer.  The rendered reply is always
        # this projection - the same one GET /sessions/{id}/messages replays -
        # so the live view and a later refresh cannot show different text.
        # A paused turn has no final answer yet, so it keeps the same placeholder
        # that endpoint reconstructs for each pending interrupt.
        final_text = (
            _paused_reply(routed_message)
            if state.interrupts
            else final_reply_text((state.values or {}).get("messages", []))
        )
        # Empty means "no authoritative answer to show", never "clear the
        # bubble": overwriting with "" would wipe text the user already watched
        # stream in and leave nothing behind.
        if final_text:
            yield f"data: {json.dumps({'final_message': final_text})}\n\n"

        if final_text:
            try:
                preview = await chat_sessions.update_session_preview(
                    user_id, session_id, final_text
                )
                yield f"data: {json.dumps({'preview': preview})}\n\n"
            except Exception:
                logger.exception("failed to update chat session preview")

        yield f"data: {json.dumps({'pending_actions': public_actions})}\n\n"

        if session["title"] in _DEFAULT_TITLES:
            try:
                title = await generate_session_title(routed_message)
                await chat_sessions.update_session_title(user_id, session_id, title)
                yield f"data: {json.dumps({'title': title})}\n\n"
            except Exception:
                logger.exception("session title generation failed")

        await agent_runs.record_run(
            user_id,
            session_id,
            route=route.source,
            agent=handled_by,
            tool_calls=tool_calls,
            paused=bool(state.interrupts),
            ok=ok,
            duration_ms=int((time.perf_counter() - started_at) * 1000),
        )

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
