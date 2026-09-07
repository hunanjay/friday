"""add contact reminders

Adds `contact_reminders` (issue #17): explicit time-based reminders the
contact agent creates from a fact ("孩子9月要上小学"), plus the type/status
columns future reconnect and external_event reminders reuse.

Revision ID: d31386f22bbc
Revises: a8f34d2c91b7
Create Date: 2026-09-04 14:58:18.254587

"""
import os
import sys
from typing import Sequence, Union

from alembic import op

revision: str = 'd31386f22bbc'
down_revision: Union[str, Sequence[str], None] = 'a8f34d2c91b7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..")))

from app.infrastructure.db.repositories.contact_reminders import (  # noqa: E402
    _SCHEMA as CONTACT_REMINDERS_SCHEMA,
)


def upgrade() -> None:
    op.execute(CONTACT_REMINDERS_SCHEMA)


def downgrade() -> None:
    raise NotImplementedError("purely additive migration; restore from backup instead")
