"""add agent_runs usage log

Backs GET /api/stats. The DDL is owned by the repository that reads and
writes the table, same as the baseline migration, so there is one definition
of the schema rather than two that can drift.

Revision ID: 9f2c41ab7d13
Revises: 36058cde5a0c
Create Date: 2026-08-31 00:00:00.000000

"""

import os
import sys
from typing import Sequence, Union

from alembic import op

revision: str = "9f2c41ab7d13"
down_revision: Union[str, Sequence[str], None] = "36058cde5a0c"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..")))

from app.infrastructure.db.repositories.agent_runs import _SCHEMA as AGENT_RUNS_SCHEMA  # noqa: E402


def upgrade() -> None:
    op.execute(AGENT_RUNS_SCHEMA)


def downgrade() -> None:
    # Unlike the baseline, this one is safe to reverse: agent_runs holds
    # derived telemetry, not user data. Losing it costs history in /api/stats
    # and nothing else.
    op.execute("drop table if exists agent_runs")
