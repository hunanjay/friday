import logging
from contextlib import asynccontextmanager

from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

load_dotenv()
logging.basicConfig(level=logging.INFO)

from app.agents import checkpointer
from app.api import agent, auth, calendar, contact, github, github_auth, mail, memos, todos
from app.core.config import settings
from app.infrastructure.db import pool as db_pool
from app.infrastructure.db.repositories import (
    chat_sessions,
    contacts as contacts_db,
    hitl_audit,
    memos as memos_db,
    todos as todos_db,
)
from app.infrastructure.github import client as github_client
from app.infrastructure.graph import client as graph_client
from app.infrastructure.vector import qdrant as vector_store


@asynccontextmanager
async def lifespan(_app: FastAPI):
    # Initialize infrastructure & connections
    await db_pool.init_db_pool()
    await checkpointer.init_checkpointer()
    await chat_sessions.init_schema()
    await hitl_audit.init_schema()
    await contacts_db.init_schema()
    await memos_db.init_schema()
    await todos_db.init_schema()
    await vector_store.init_collection()

    yield

    # Teardown infrastructure & connections
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
    allow_origins=[
        settings.FRONTEND_URL,
        "https://friday.loganjian.top",
        "http://localhost:3005",
        "http://localhost:3000",
    ],
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
app.include_router(todos.router)
app.include_router(github_auth.router)
app.include_router(github.router)

import os

from fastapi.staticfiles import StaticFiles

uploads_dir = os.path.join(os.getcwd(), "uploads")
os.makedirs(uploads_dir, exist_ok=True)
app.mount("/uploads", StaticFiles(directory=uploads_dir), name="uploads")


@app.get("/health")
def health():
    return {"status": "ok", "environment": settings.ENV}
