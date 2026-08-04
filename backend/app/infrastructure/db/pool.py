import logging
import os
from typing import AsyncGenerator

from psycopg_pool import AsyncConnectionPool

logger = logging.getLogger(__name__)

_pool: AsyncConnectionPool | None = None


def get_db_url() -> str:
    return os.environ.get("CHECKPOINT_DB_URL") or os.environ.get("DATABASE_URL", "")


async def init_db_pool() -> AsyncConnectionPool:
    global _pool
    db_url = get_db_url()
    if not db_url:
        logger.warning("No database URL provided (CHECKPOINT_DB_URL or DATABASE_URL)")
        return None
    if _pool is None:
        logger.info("Initializing async database connection pool...")
        _pool = AsyncConnectionPool(db_url, open=False)
        await _pool.open()
    return _pool


async def close_db_pool() -> None:
    global _pool
    if _pool is not None:
        logger.info("Closing async database connection pool...")
        await _pool.close()
        _pool = None


def get_pool() -> AsyncConnectionPool | None:
    return _pool


async def get_connection() -> AsyncGenerator:
    if _pool is None:
        raise RuntimeError("Database connection pool is not initialized")
    async with _pool.connection() as conn:
        yield conn
