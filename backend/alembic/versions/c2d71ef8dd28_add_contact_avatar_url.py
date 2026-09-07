"""add contact avatar url

Adds `contacts.avatar_url` for uploaded contact photos (app/api/contact.py's
POST/DELETE .../avatar, storage via app/services/storage.py). Re-runs the
whole (idempotent) contacts schema rather than a bare ALTER, matching how
the baseline migration owns this table.

Revision ID: c2d71ef8dd28
Revises: d31386f22bbc
Create Date: 2026-09-04 16:01:10.278123

"""
import os
import sys
from typing import Sequence, Union

from alembic import op

revision: str = 'c2d71ef8dd28'
down_revision: Union[str, Sequence[str], None] = 'd31386f22bbc'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..")))

from app.infrastructure.db.repositories.contacts import _SCHEMA as CONTACTS_SCHEMA  # noqa: E402


def upgrade() -> None:
    op.execute(CONTACTS_SCHEMA)


def downgrade() -> None:
    op.execute("alter table contacts drop column if exists avatar_url")
