import logging

from langgraph.checkpoint.postgres.aio import AsyncPostgresSaver
from langgraph.checkpoint.postgres.base import MIGRATIONS

from app.infrastructure.db.pool import get_pool

logger = logging.getLogger(__name__)

_checkpointer = None


async def init_checkpointer():
    """Opens the Postgres connection pool and runs the checkpoint table
    migrations. Call once from the FastAPI lifespan startup."""
    global _checkpointer
    pool = get_pool()
    if pool is None:
        raise RuntimeError("Database pool must be initialized before the checkpointer")

    # langgraph-checkpoint-postgres MIGRATIONS include CREATE INDEX CONCURRENTLY
    # statements that cannot run inside a transaction. The library's setup() uses
    # pool.connection() which wraps everything in a transaction, and version-tracks
    # migrations via the checkpoint_migrations table — if we let setup() run, it
    # sees version 0 and tries to re-run all migrations inside a tx, failing again.
    #
    # Workaround: run all migrations outside a transaction and insert version
    # records ourselves, then setup() sees version N and becomes a no-op.
    conn = await pool.getconn()
    try:
        await conn.set_autocommit(True)
        async with conn.cursor() as cur:
            for idx, migration in enumerate(MIGRATIONS, start=1):
                try:
                    await cur.execute(migration)
                except Exception:
                    # Migration already applied or cannot be re-run — skip
                    pass
                await cur.execute(
                    "INSERT INTO checkpoint_migrations (v) VALUES (%s) ON CONFLICT DO NOTHING",
                    (idx,),
                )
        await conn.set_autocommit(False)
    finally:
        await pool.putconn(conn)

    _checkpointer = AsyncPostgresSaver(pool)
    # setup() reads the checkpoint_migrations version, sees everything is
    # already applied, and skips — no CONCURRENTLY errors this time.
    await _checkpointer.setup()


async def close_checkpointer():
    global _checkpointer
    # The FastAPI lifespan owns and closes the shared application pool.
    _checkpointer = None


def get_checkpointer():
    """None until init_checkpointer() has run (e.g. under `langgraph dev`,
    which supplies its own checkpointer and never calls init_checkpointer)."""
    return _checkpointer
