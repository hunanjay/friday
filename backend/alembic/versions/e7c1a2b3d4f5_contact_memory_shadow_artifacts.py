"""add Contact Memory representation, audit, Judge, and Cue Anchor artifacts

Revision ID: e7c1a2b3d4f5
Revises: c2d71ef8dd28
Create Date: 2026-09-17 11:30:00

"""

import os
import sys
from typing import Sequence, Union

from alembic import op

revision: str = "e7c1a2b3d4f5"
down_revision: Union[str, Sequence[str], None] = "c2d71ef8dd28"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..")))

from app.infrastructure.db.repositories.contact_memory import (  # noqa: E402
    _SCHEMA as CONTACT_MEMORY_SCHEMA,
)


def upgrade() -> None:
    op.execute(CONTACT_MEMORY_SCHEMA)


def downgrade() -> None:
    # Evidence and revision rows are user data and may be the only audit trail
    # for an automatic update. Keep this migration additive rather than
    # silently deleting that history during a downgrade.
    raise NotImplementedError("additive memory migration cannot discard audit history")
