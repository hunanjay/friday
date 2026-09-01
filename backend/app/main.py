import logging
import os
from contextlib import asynccontextmanager

import psycopg
from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from alembic.config import Config as AlembicConfig
from alembic.script import ScriptDirectory

load_dotenv()
logging.basicConfig(level=logging.INFO)

from app.agents import checkpointer
from app.api import (
    agent,
    auth,
    calendar,
    contact,
    github,
    github_auth,
    mail,
    mail_accounts,
    memos,
    settings as settings_api,
    stats,
    todos,
)
from app.core.config import settings
from app.infrastructure.db import pool as db_pool
from app.infrastructure.github import client as github_client
from app.infrastructure.graph import client as graph_client
from app.infrastructure.vector import qdrant as vector_store

logger = logging.getLogger(__name__)

_BACKEND_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))


async def _log_business_schema_status():
    """Read-only: logs the Alembic history head vs. the revision actually
    applied to this database. Never runs a migration - that stays a separate
    `alembic upgrade head` step (see backend/docs/migrations.md)."""
    head = ScriptDirectory.from_config(AlembicConfig(os.path.join(_BACKEND_DIR, "alembic.ini"))).get_current_head()
    pool = db_pool.get_pool()
    current = None
    if pool is not None:
        try:
            async with pool.connection() as conn:
                cur = await conn.execute("select version_num from alembic_version")
                row = await cur.fetchone()
            current = row[0] if row else None
        except psycopg.errors.UndefinedTable:
            current = None
    if current == head:
        logger.info("Business schema migrations up to date (head %s)", head)
    else:
        logger.warning(
            "Business schema migration mismatch: db=%s head=%s - run `alembic upgrade head`", current, head
        )


@asynccontextmanager
async def lifespan(_app: FastAPI):
    # Initialize infrastructure & connections. Business-table schema (chat
    # sessions, HITL audit, contacts, memos, todos, user memory/settings) is
    # migrated via `alembic upgrade head` as an independent pre-deploy step
    # (see backend/docs/migrations.md), not on instance startup.
    await db_pool.init_db_pool()
    await _log_business_schema_status()
    await checkpointer.init_checkpointer()
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
app.include_router(settings_api.router)
app.include_router(github_auth.router)
app.include_router(github.router)
app.include_router(mail_accounts.router)
app.include_router(stats.router)

import os

from fastapi.staticfiles import StaticFiles

uploads_dir = os.path.join(os.getcwd(), "uploads")
os.makedirs(uploads_dir, exist_ok=True)
app.mount("/uploads", StaticFiles(directory=uploads_dir), name="uploads")


@app.get("/health")
def health():
    return {"status": "ok", "environment": settings.ENV}
