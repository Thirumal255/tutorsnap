"""add_account_id_to_expenses

Revision ID: s2t3u4v5w6x7
Revises: r1s2t3u4v5w6
Create Date: 2026-06-02 00:00:00.000000

Adds account_id FK to admin_task_expenses so each paid expense can be linked
to the bank/cash account it was paid from.
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision: str = 's2t3u4v5w6x7'
down_revision: Union[str, Sequence[str], None] = 'r1s2t3u4v5w6'
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    dialect = bind.dialect.name

    if dialect == 'sqlite':
        import sqlalchemy as sa2
        inspector = sa2.inspect(bind)
        cols = [c['name'] for c in inspector.get_columns('admin_task_expenses')]
        if 'account_id' not in cols:
            op.add_column('admin_task_expenses',
                sa.Column('account_id', sa.Integer,
                          sa.ForeignKey('payment_accounts.id'), nullable=True))
    else:
        op.execute("""
            ALTER TABLE admin_task_expenses
            ADD COLUMN IF NOT EXISTS account_id INTEGER REFERENCES payment_accounts(id) ON DELETE SET NULL
        """)


def downgrade() -> None:
    op.drop_column('admin_task_expenses', 'account_id')
