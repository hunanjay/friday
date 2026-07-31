import logging
from contextlib import asynccontextmanager

from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

load_dotenv()
logging.basicConfig(level=logging.INFO)

from app.core.config import settings
from app.infrastructure.db import pool as db_pool
from app.infrastructure.vector import qdrant as vector_store
from app.infrastructure.graph import client as graph_client
from app.infrastructure.github import client as github_client
from app.agents import checkpointer
from app.infrastructure.db.repositories import chat_sessions, pending_actions
from app.infrastructure.db.repositories import memos as memos_db

from app.api import agent, auth, calendar, contact, github, github_auth, mail, memos


@asynccontextmanager
async def lifespan(_app: FastAPI):
    # Initialize infrastructure & connections
    await db_pool.init_db_pool()
    await checkpointer.init_checkpointer()
    await chat_sessions.init_pool()
    await pending_actions.init_pool()
    await memos_db.init_pool()
    await vector_store.init_collection()

    yield

    # Teardown infrastructure & connections
    await memos_db.close_pool()
    await pending_actions.close_pool()
    await chat_sessions.close_pool()
    await checkpointer.close_checkpointer()
    await db_pool.close_db_pool()
    await graph_client.aclose_client()
    await github_client.aclose_client()


app = FastAPI(
    title="Friday Assistant Backend",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings.FRONTEND_URL, "http://localhost:3005"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Register Routers
app.include_router(auth.router)
app.include_router(mail.router)
app.include_router(calendar.router)
app.include_router(contact.router)
app.include_router(agent.router)
app.include_router(memos.router)
app.include_router(github_auth.router)
app.include_router(github.router)


@app.get("/health")
def health():
    return {"status": "ok", "environment": settings.ENV}
