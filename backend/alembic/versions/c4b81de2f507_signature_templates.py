"""move the single signature column into named templates

`user_settings.signature` held one block per user. This creates
`signature_templates`, carries each existing signature over as that user's
default (so nobody's outgoing mail loses its sign-off), and drops the old
column so there is one place a signature can live.

Revision ID: c4b81de2f507
Revises: 9f2c41ab7d13
Create Date: 2026-08-31 00:00:00.000000

"""

import os
import sys
from typing import Sequence, Union

from alembic import op

revision: str = "c4b81de2f507"
down_revision: Union[str, Sequence[str], None] = "9f2c41ab7d13"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..")))

from app.infrastructure.db.repositories.signature_templates import (  # noqa: E402
    _SCHEMA as SIGNATURE_TEMPLATES_SCHEMA,
)


def upgrade() -> None:
    op.execute(SIGNATURE_TEMPLATES_SCHEMA)
    # Runs in the same transaction as the drop below: if the carry-over fails,
    # the column is still there.
    op.execute(
        """
        insert into signature_templates (user_id, name, content, is_default)
        select user_id, 'Default', signature, true
        from user_settings
        where signature is not null and btrim(signature) <> ''
        """
    )
    op.execute("alter table user_settings drop column if exists signature")


def downgrade() -> None:
    # Restores the pre-template state: the default template becomes the column
    # again. Non-default templates are dropped, because the old schema has
    # nowhere to put them.
    op.execute("alter table user_settings add column if not exists signature text")
    op.execute(
        """
        update user_settings as s
        set signature = t.content
        from signature_templates as t
        where t.user_id = s.user_id and t.is_default
        """
    )
    op.execute("drop table if exists signature_templates")
