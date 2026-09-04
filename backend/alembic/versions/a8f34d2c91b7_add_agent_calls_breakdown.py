"""add per-turn agent call breakdown

Stores every delegated agent invocation in a chat turn so usage totals can
count multi-agent turns without discarding calls after the first agent.

Revision ID: a8f34d2c91b7
Revises: 60d700163997
Create Date: 2026-09-04 09:35:00.000000

"""

from typing import Sequence, Union

from alembic import op

revision: str = "a8f34d2c91b7"
down_revision: Union[str, Sequence[str], None] = "60d700163997"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(
        "alter table agent_runs "
        "add column if not exists agent_calls jsonb not null default '{}'::jsonb"
    )


def downgrade() -> None:
    op.execute("alter table agent_runs drop column if exists agent_calls")
