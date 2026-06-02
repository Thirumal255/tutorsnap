"""add_status_to_expenses

Revision ID: q9r0s1t2u3v4
Revises: p8q9r0s1t2u3
Create Date: 2026-06-02 00:00:00.000000

Adds status column ('planned'|'paid') to admin_task_expenses.
Budget is now derived from expenses, not set manually.
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision: str = 'q9r0s1t2u3v4'
down_revision: Union[str, Sequence[str], None] = 'p8q9r0s1t2u3'
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name == 'sqlite':
        import sqlalchemy as sa2
        inspector = sa2.inspect(bind)
        cols = {c['name'] for c in inspector.get_columns('admin_task_expenses')}
        if 'status' not in cols:
            op.add_column('admin_task_expenses',
                sa.Column('status', sa.String(20), nullable=False, server_default='paid'))
    else:
        op.execute("""
            ALTER TABLE admin_task_expenses
            ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'paid'
        """)


def downgrade() -> None:
    op.drop_column('admin_task_expenses', 'status')
