"""link_allocations_to_accounts

Revision ID: w6x7y8z9a0b1
Revises: v5w6x7y8z9a0
Create Date: 2026-06-02 00:00:00.000000

Adds account_id FK to category_allocations so each category budget
can be funded by a specific payment account.
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision: str = 'w6x7y8z9a0b1'
down_revision: Union[str, Sequence[str], None] = 'v5w6x7y8z9a0'
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name == 'sqlite':
        import sqlalchemy as sa2
        cols = {c['name'] for c in sa2.inspect(bind).get_columns('category_allocations')}
        if 'account_id' not in cols:
            # SQLite doesn't support ADD COLUMN with FK constraints — add as plain Integer
            op.add_column('category_allocations',
                sa.Column('account_id', sa.Integer(), nullable=True))
    else:
        op.execute("""
            ALTER TABLE category_allocations
            ADD COLUMN IF NOT EXISTS account_id INTEGER
            REFERENCES payment_accounts(id) ON DELETE SET NULL
        """)


def downgrade() -> None:
    op.drop_column('category_allocations', 'account_id')
