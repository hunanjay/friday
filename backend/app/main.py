import logging
from contextlib import asynccontextmanager

from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

load_dotenv()
logging.basicConfig(level=logging.INFO)

from app.agents import checkpointer  # noqa: E402  (needs load_dotenv() first)
from app.api import agent, auth, calendar, github_auth, mail, memos  # noqa: E402  (needs load_dotenv() first)
from app.db import chat_sessions  # noqa: E402  (needs load_dotenv() first)
from app.db import memos as memos_db  # noqa: E402  (needs load_dotenv() first)
from app.tools import github_client, graph_client, vector_store  # noqa: E402  (needs load_dotenv() first)


@asynccontextmanager
async def lifespan(_app: FastAPI):
    await checkpointer.init_checkpointer()
    await chat_sessions.init_pool()
    await memos_db.init_pool()
    await vector_store.init_collection()
    yield
    await memos_db.close_pool()
    await chat_sessions.close_pool()
    await checkpointer.close_checkpointer()
    await graph_client.aclose_client()
    await github_client.aclose_client()


app = FastAPI(lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3005"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router)
app.include_router(mail.router)
app.include_router(calendar.router)
app.include_router(agent.router)
app.include_router(memos.router)
app.include_router(github_auth.router)


@app.get("/health")
def health():
    return {"status": "ok"}
