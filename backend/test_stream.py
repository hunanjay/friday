import asyncio
import os
from dotenv import load_dotenv

# Load env variables
load_dotenv()

from app.agents.supervisor import build_supervisor
from app.agents.checkpointer import init_checkpointer, close_checkpointer

async def main():
    await init_checkpointer()
    user_id = "test-user"
    session_id = "test-session-123"
    
    graph = build_supervisor(user_id)
    
    print("--- ASTREAM EVENTS ---")
    async for event in graph.astream_events(
        {"messages": [{"role": "user", "content": "hello. What can you do?"}]},
        config={"configurable": {"thread_id": session_id}},
        version="v2"
    ):
        event_type = event.get("event")
        name = event.get("name")
        tags = event.get("tags")
        metadata = event.get("metadata", {})
        node = metadata.get("langgraph_node")
        
        if event_type == "on_chat_model_stream":
            chunk = event["data"].get("chunk")
            content = chunk.content if chunk else ""
            print(f"[STREAM] Node: {node}, Content: {repr(content)}")
        elif event_type == "on_chat_model_end":
            print(f"[MODEL END] Node: {node}")
        elif event_type == "on_chain_end" and name == "LangGraph":
            print("[GRAPH END]")
            
    await close_checkpointer()

if __name__ == "__main__":
    asyncio.run(main())
