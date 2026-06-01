"""add_budget_to_admin_tasks

Revision ID: p8q9r0s1t2u3
Revises: o7p8q9r0s1t2
Create Date: 2026-06-01 10:00:00.000000

Adds an optional budget column to admin_tasks so admins can track
allocated budget vs actual spend per task.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'p8q9r0s1t2u3'
down_revision: Union[str, Sequence[str], None] = 'o7p8q9r0s1t2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name == 'sqlite':
        import sqlalchemy as sa2
        inspector = sa2.inspect(bind)
        cols = {c['name'] for c in inspector.get_columns('admin_tasks')}
        if 'budget' not in cols:
            op.add_column('admin_tasks', sa.Column('budget', sa.Float(), nullable=True))
    else:
        op.execute("ALTER TABLE admin_tasks ADD COLUMN IF NOT EXISTS budget FLOAT")


def downgrade() -> None:
    op.drop_column('admin_tasks', 'budget')
