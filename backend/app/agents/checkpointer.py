from langgraph.checkpoint.postgres.aio import AsyncPostgresSaver

from app.infrastructure.db.pool import get_pool

_checkpointer = None


async def init_checkpointer():
    """Opens the Postgres connection pool and runs the checkpoint table
    migrations. Call once from the FastAPI lifespan startup."""
    global _checkpointer
    pool = get_pool()
    if pool is None:
        raise RuntimeError("Database pool must be initialized before the checkpointer")
    _checkpointer = AsyncPostgresSaver(pool)
    await _checkpointer.setup()


async def close_checkpointer():
    global _checkpointer
    # The FastAPI lifespan owns and closes the shared application pool.
    _checkpointer = None


def get_checkpointer():
    """None until init_checkpointer() has run (e.g. under `langgraph dev`,
    which supplies its own checkpointer and never calls init_checkpointer)."""
    return _checkpointer
