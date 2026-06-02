"""finance_tables_original (stub)

Revision ID: s2t3u4v5w6x7
Revises: q9r0s1t2u3v4
Create Date: 2026-06-02 00:00:00.000000

Stub for the original finance migration that was applied to production
but whose code was reverted. Tables already exist in DB.
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision: str = 's2t3u4v5w6x7'
down_revision: Union[str, Sequence[str], None] = 'q9r0s1t2u3v4'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Tables were already created by the original migration that was later reverted.
    # This stub ensures the revision chain is complete. No-op here.
    pass


def downgrade() -> None:
    pass
