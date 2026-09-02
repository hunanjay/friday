"""add memos sync status

Lets a memo carry where it's been routed to (issue #44's memo-routing
workflow): 'pending' until the model classifies it, 'synced' once it's been
written to a contact fact / user_memory / a todo, 'no_action' for memos that
are neither about a person, about the user, nor actionable.

Revision ID: 60d700163997
Revises: c4b81de2f507
Create Date: 2026-09-02 16:10:43.891323

"""

from typing import Sequence, Union

from alembic import op

revision: str = "60d700163997"
down_revision: Union[str, Sequence[str], None] = "c4b81de2f507"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(
        "alter table memos add column if not exists sync_status text not null default 'pending'"
    )
    # Drop-then-add, not ADD CONSTRAINT IF NOT EXISTS - Postgres doesn't
    # support the latter, and this keeps upgrade() safely replayable.
    op.execute("alter table memos drop constraint if exists memos_sync_status_check")
    op.execute(
        "alter table memos add constraint memos_sync_status_check "
        "check (sync_status in ('pending', 'synced', 'no_action'))"
    )


def downgrade() -> None:
    op.execute("alter table memos drop constraint if exists memos_sync_status_check")
    op.execute("alter table memos drop column if exists sync_status")
