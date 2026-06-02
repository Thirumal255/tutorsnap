"""patch_finance_columns

Revision ID: t3u4v5w6x7y8
Revises: r1s2t3u4v5w6
Create Date: 2026-06-02 00:00:00.000000

Adds columns that were missing from the original finance tables created
by the reverted migration (s2t3u4v5w6x7):
  payment_accounts.current_balance
  fund_sources.expected_amount
  fund_receipts.description
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision: str = 't3u4v5w6x7y8'
down_revision: Union[str, Sequence[str], None] = 'r1s2t3u4v5w6'
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    dialect = bind.dialect.name

    if dialect == 'sqlite':
        import sqlalchemy as sa2
        inspector = sa2.inspect(bind)
        _add = lambda tbl, col, ddl: (
            op.add_column(tbl, ddl)
            if col not in {c['name'] for c in inspector.get_columns(tbl)}
            else None
        )
        _add('payment_accounts', 'current_balance',
             sa.Column('current_balance', sa.Float(), nullable=False, server_default='0'))
        _add('fund_sources', 'expected_amount',
             sa.Column('expected_amount', sa.Float(), nullable=True))
        _add('fund_receipts', 'description',
             sa.Column('description', sa.String(300), nullable=True))
    else:
        op.execute("ALTER TABLE payment_accounts ADD COLUMN IF NOT EXISTS current_balance FLOAT NOT NULL DEFAULT 0")
        op.execute("ALTER TABLE fund_sources ADD COLUMN IF NOT EXISTS expected_amount FLOAT")
        op.execute("ALTER TABLE fund_receipts ADD COLUMN IF NOT EXISTS description VARCHAR(300)")


def downgrade() -> None:
    op.drop_column('fund_receipts', 'description')
    op.drop_column('fund_sources', 'expected_amount')
    op.drop_column('payment_accounts', 'current_balance')
