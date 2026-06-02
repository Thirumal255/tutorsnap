"""patch_finance_columns2

Revision ID: u4v5w6x7y8z9
Revises: t3u4v5w6x7y8
Create Date: 2026-06-02 00:00:00.000000

The original finance migration (s2t3u4v5w6x7) created tables with a
completely different schema.  This adds all remaining columns our new
models expect but which the original tables don't have:

  payment_accounts   : updated_at
  fund_sources       : frequency, is_active
  fund_receipts      : received_date  (copy of original 'date' column)
  category_allocations: allocated_amount (copy of 'amount'), period, updated_at
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision: str = 'u4v5w6x7y8z9'
down_revision: Union[str, Sequence[str], None] = 't3u4v5w6x7y8'
branch_labels = None
depends_on = None


def _existing_cols(bind, table):
    return {c['name'] for c in sa.inspect(bind).get_columns(table)}


def upgrade() -> None:
    bind = op.get_bind()
    dialect = bind.dialect.name

    if dialect == 'sqlite':
        # payment_accounts.updated_at
        if 'updated_at' not in _existing_cols(bind, 'payment_accounts'):
            op.add_column('payment_accounts',
                sa.Column('updated_at', sa.DateTime(), server_default=sa.func.now()))

        # fund_sources.frequency, is_active
        src_cols = _existing_cols(bind, 'fund_sources')
        if 'frequency' not in src_cols:
            op.add_column('fund_sources',
                sa.Column('frequency', sa.String(20), nullable=False, server_default='monthly'))
        if 'is_active' not in src_cols:
            op.add_column('fund_sources',
                sa.Column('is_active', sa.Boolean(), nullable=False, server_default='1'))

        # fund_receipts.received_date
        rec_cols = _existing_cols(bind, 'fund_receipts')
        if 'received_date' not in rec_cols:
            op.add_column('fund_receipts',
                sa.Column('received_date', sa.Date(), nullable=True))
            # copy 'date' → 'received_date' where it exists
            if 'date' in rec_cols:
                op.execute('UPDATE fund_receipts SET received_date = "date"')

        # category_allocations.allocated_amount, period, updated_at
        alloc_cols = _existing_cols(bind, 'category_allocations')
        if 'allocated_amount' not in alloc_cols:
            op.add_column('category_allocations',
                sa.Column('allocated_amount', sa.Float(), nullable=False, server_default='0'))
            if 'amount' in alloc_cols:
                op.execute('UPDATE category_allocations SET allocated_amount = amount')
        if 'period' not in alloc_cols:
            op.add_column('category_allocations',
                sa.Column('period', sa.String(7), nullable=False, server_default='2026-06'))
        if 'updated_at' not in alloc_cols:
            op.add_column('category_allocations',
                sa.Column('updated_at', sa.DateTime(), server_default=sa.func.now()))

    else:
        # PostgreSQL
        op.execute("ALTER TABLE payment_accounts ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT NOW()")

        op.execute("ALTER TABLE fund_sources ADD COLUMN IF NOT EXISTS frequency VARCHAR(20) NOT NULL DEFAULT 'monthly'")
        op.execute("ALTER TABLE fund_sources ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE")

        op.execute("ALTER TABLE fund_receipts ADD COLUMN IF NOT EXISTS received_date DATE")
        # Populate from original 'date' column where present
        op.execute("""
            DO $$
            BEGIN
                IF EXISTS (SELECT 1 FROM information_schema.columns
                           WHERE table_name='fund_receipts' AND column_name='date') THEN
                    UPDATE fund_receipts SET received_date = "date" WHERE received_date IS NULL;
                END IF;
            END $$
        """)

        op.execute("ALTER TABLE category_allocations ADD COLUMN IF NOT EXISTS allocated_amount FLOAT NOT NULL DEFAULT 0")
        op.execute("""
            DO $$
            BEGIN
                IF EXISTS (SELECT 1 FROM information_schema.columns
                           WHERE table_name='category_allocations' AND column_name='amount') THEN
                    UPDATE category_allocations SET allocated_amount = amount WHERE allocated_amount = 0;
                END IF;
            END $$
        """)
        op.execute("ALTER TABLE category_allocations ADD COLUMN IF NOT EXISTS period VARCHAR(7) NOT NULL DEFAULT '2026-06'")
        op.execute("ALTER TABLE category_allocations ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT NOW()")


def downgrade() -> None:
    op.drop_column('category_allocations', 'updated_at')
    op.drop_column('category_allocations', 'period')
    op.drop_column('category_allocations', 'allocated_amount')
    op.drop_column('fund_receipts', 'received_date')
    op.drop_column('fund_sources', 'is_active')
    op.drop_column('fund_sources', 'frequency')
    op.drop_column('payment_accounts', 'updated_at')
