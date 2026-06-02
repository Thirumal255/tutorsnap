"""expense_account_link

Revision ID: z9a0b1c2d3e4
Revises: y8z9a0b1c2d3
Create Date: 2026-06-02 00:00:00.000000

Adds account_id to admin_task_expenses so each paid expense can be
linked to the account it was paid from.
Also renames payment_accounts.current_balance → opening_balance since
the live balance is now computed dynamically.
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision: str = 'z9a0b1c2d3e4'
down_revision: Union[str, Sequence[str], None] = 'y8z9a0b1c2d3'
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name == 'sqlite':
        import sqlalchemy as sa2
        insp = sa2.inspect(bind)

        exp_cols = {c['name'] for c in insp.get_columns('admin_task_expenses')}
        if 'account_id' not in exp_cols:
            op.add_column('admin_task_expenses',
                sa.Column('account_id', sa.Integer(), nullable=True))

        acct_cols = {c['name'] for c in insp.get_columns('payment_accounts')}
        if 'opening_balance' not in acct_cols:
            op.add_column('payment_accounts',
                sa.Column('opening_balance', sa.Float(), server_default='0'))
            op.execute('UPDATE payment_accounts SET opening_balance = COALESCE(current_balance, 0)')
    else:
        op.execute("""
            ALTER TABLE admin_task_expenses
            ADD COLUMN IF NOT EXISTS account_id INTEGER
            REFERENCES payment_accounts(id) ON DELETE SET NULL
        """)
        op.execute("""
            ALTER TABLE payment_accounts
            ADD COLUMN IF NOT EXISTS opening_balance FLOAT NOT NULL DEFAULT 0
        """)
        op.execute("""
            UPDATE payment_accounts
            SET opening_balance = COALESCE(current_balance, 0)
            WHERE opening_balance = 0
        """)


def downgrade() -> None:
    op.drop_column('admin_task_expenses', 'account_id')
    op.drop_column('payment_accounts', 'opening_balance')
