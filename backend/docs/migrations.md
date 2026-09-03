# Database migrations

Two independent, version-tracked migration paths write to the same Postgres
database (`CHECKPOINT_DB_URL` / `DATABASE_URL`):

- **LangGraph checkpointer** (`app/agents/checkpointer.py`) — owns
  `checkpoints`, `checkpoint_blobs`, `checkpoint_writes`,
  `checkpoint_migrations`. Runs automatically inside `init_checkpointer()`
  during backend startup; a failed migration raises and aborts startup, and
  the failed step's version is never recorded.
- **Alembic** (`backend/alembic/`) — owns the business tables: chat sessions,
  HITL audit, contacts (+ profiles/tags/interactions), memos, todos, user
  memory, user settings. Does **not** run on startup — see below.

Tables owned directly by Supabase (`ms_tokens`, `github_tokens`,
`netease_tokens`, `mail_accounts`, auth) stay under `supabase/migrations/`
and are out of scope here.

## Running migrations

Migration is a pre-deploy step, run once, not per backend instance:

```bash
cd backend && source .venv/bin/activate && alembic upgrade head
```

Or, against the Docker Compose Postgres without a local venv:

```bash
docker compose run --rm backend alembic upgrade head
```

The CD workflow (`.github/workflows/cd.yml`) runs this after building the
backend image and before restarting the `backend` container; a failing
migration stops the deploy (`set -e`) and the old container keeps running.

## Baseline migration

`alembic/versions/36058cde5a0c_baseline_business_schema.py` executes each
repository's existing `_SCHEMA` constant (the source of truth stays in the
repository files, not duplicated into the migration). Every statement is
idempotent (`CREATE TABLE IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`), so
running it against:

- an **empty** database creates every table from scratch, or
- an **existing** database (the pre-Alembic state, where each repo's
  `init_schema()` had already run) is a no-op that alters nothing and drops
  nothing.

Either way `alembic upgrade head` finishes at the same schema and stamps
`alembic_version`. Both paths are covered by manually running the migration
twice against fresh vs. pre-seeded databases before merging any change here
(there's no CI Postgres service yet, so this isn't exercised automatically).

## Backup and rollback

- **Before running a migration against a real (non-disposable) database,
  take a Postgres backup**, e.g. `pg_dump -Fc $CHECKPOINT_DB_URL > backup.dump`
  (or your hosting provider's snapshot). Restore with
  `pg_restore -d $CHECKPOINT_DB_URL --clean backup.dump`.
- The baseline migration's `downgrade()` deliberately raises
  `NotImplementedError` instead of dropping tables — this migration is purely
  additive, and an automated `DROP TABLE` here would be a destructive command
  running against real user data for no corresponding benefit. If a future
  migration needs to ship a real rollback, give it an explicit, reviewed
  `downgrade()` instead of relying on this one.
- If a bad migration reaches head, the recovery path is: restore the
  pre-migration backup, fix the migration, redeploy. There is no automatic
  downgrade path.

## Writing a new migration

```bash
cd backend && source .venv/bin/activate && alembic revision -m "add foo column"
```

Fill in `upgrade()` with idempotent SQL via `op.execute(...)`, matching the
style already used in the repository `_SCHEMA` constants (`IF NOT EXISTS`
everywhere). If the change also needs code changes in the repository that
owns the table, update its `_SCHEMA` constant too so it stays the accurate
description of the table for anyone reading the repository file, even though
main.py no longer executes it.
