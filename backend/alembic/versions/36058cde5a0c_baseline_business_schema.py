"""baseline business schema

Consolidates the ad hoc `_SCHEMA` DDL that each repository used to run via
its own `init_schema()` (called from the FastAPI lifespan) into one
version-tracked migration. Every statement below is copied verbatim from the
repository that owns the table - so this is a baseline, not a rewrite - and
every statement is idempotent (`IF NOT EXISTS` / `ADD COLUMN IF NOT EXISTS`),
so running it against a database that already has these tables (the
pre-Alembic norm) is a no-op upgrade: no data is dropped or altered
destructively. See backend/docs/migrations.md for the upgrade/rollback
runbook.

Revision ID: 36058cde5a0c
Revises:
Create Date: 2026-08-25 10:20:20.815282

"""

import os
import sys
from typing import Sequence, Union

from alembic import op

revision: str = "36058cde5a0c"
down_revision: Union[str, Sequence[str], None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..")))

from app.infrastructure.db.repositories.chat_sessions import _SCHEMA as CHAT_SESSIONS_SCHEMA  # noqa: E402
from app.infrastructure.db.repositories.contacts import _SCHEMA as CONTACTS_SCHEMA  # noqa: E402
from app.infrastructure.db.repositories.hitl_audit import _SCHEMA as HITL_AUDIT_SCHEMA  # noqa: E402
from app.infrastructure.db.repositories.memos import _SCHEMA as MEMOS_SCHEMA  # noqa: E402
from app.infrastructure.db.repositories.todos import _SCHEMA as TODOS_SCHEMA  # noqa: E402
from app.infrastructure.db.repositories.user_memory import _SCHEMA as USER_MEMORY_SCHEMA  # noqa: E402
from app.infrastructure.db.repositories.user_settings import _SCHEMA as USER_SETTINGS_SCHEMA  # noqa: E402

# chat_sessions first - hitl_action_audit has a foreign key to it.
_SCHEMAS_IN_ORDER = (
    CHAT_SESSIONS_SCHEMA,
    HITL_AUDIT_SCHEMA,
    CONTACTS_SCHEMA,
    MEMOS_SCHEMA,
    TODOS_SCHEMA,
    USER_MEMORY_SCHEMA,
    USER_SETTINGS_SCHEMA,
)


def upgrade() -> None:
    for schema in _SCHEMAS_IN_ORDER:
        op.execute(schema)


def downgrade() -> None:
    # This baseline is purely additive against both an empty database and the
    # pre-Alembic schema it was generated from - there is nothing destructive
    # to undo. Dropping these tables would destroy real user data, so this is
    # intentionally not implemented: recover a bad deploy by restoring the
    # pre-migration backup (see backend/docs/migrations.md), not by downgrading.
    raise NotImplementedError(
        "No downgrade for the baseline migration - restore from backup instead (see backend/docs/migrations.md)"
    )
