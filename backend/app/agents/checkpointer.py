import os

from langgraph.checkpoint.postgres.aio import AsyncPostgresSaver

_saver_cm = None
_checkpointer = None


async def init_checkpointer():
    """Opens the Postgres connection pool and runs the checkpoint table
    migrations. Call once from the FastAPI lifespan startup."""
    global _saver_cm, _checkpointer
    _saver_cm = AsyncPostgresSaver.from_conn_string(os.environ["CHECKPOINT_DB_URL"])
    _checkpointer = await _saver_cm.__aenter__()
    await _checkpointer.setup()


async def close_checkpointer():
    if _saver_cm is not None:
        await _saver_cm.__aexit__(None, None, None)


def get_checkpointer():
    """None until init_checkpointer() has run (e.g. under `langgraph dev`,
    which supplies its own checkpointer and never calls init_checkpointer)."""
    return _checkpointer
