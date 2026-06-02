"""add_finance_tables

Revision ID: r1s2t3u4v5w6
Revises: q9r0s1t2u3v4
Create Date: 2026-06-02 00:00:00.000000

Adds 4 finance tables: payment_accounts, fund_sources, fund_receipts, category_allocations
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision: str = 'r1s2t3u4v5w6'
down_revision: Union[str, Sequence[str], None] = 'q9r0s1t2u3v4'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        'payment_accounts',
        sa.Column('id', sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column('name', sa.String(200), nullable=False),
        sa.Column('type', sa.String(20), nullable=False, server_default='bank'),  # bank|cash|credit
        sa.Column('current_balance', sa.Float(), nullable=False, server_default='0'),
        sa.Column('created_at', sa.DateTime(), server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(), server_default=sa.func.now()),
    )

    op.create_table(
        'fund_sources',
        sa.Column('id', sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column('name', sa.String(200), nullable=False),
        sa.Column('type', sa.String(30), nullable=False, server_default='other'),  # salary|rent|freelance|other
        sa.Column('expected_amount', sa.Float(), nullable=True),
        sa.Column('frequency', sa.String(20), nullable=False, server_default='monthly'),  # monthly|one-time
        sa.Column('is_active', sa.Boolean(), nullable=False, server_default='1'),
        sa.Column('created_at', sa.DateTime(), server_default=sa.func.now()),
    )

    op.create_table(
        'fund_receipts',
        sa.Column('id', sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column('source_id', sa.Integer(), sa.ForeignKey('fund_sources.id', ondelete='SET NULL'), nullable=True),
        sa.Column('account_id', sa.Integer(), sa.ForeignKey('payment_accounts.id', ondelete='SET NULL'), nullable=True),
        sa.Column('amount', sa.Float(), nullable=False),
        sa.Column('description', sa.String(300), nullable=True),
        sa.Column('received_date', sa.Date(), nullable=False),
        sa.Column('created_at', sa.DateTime(), server_default=sa.func.now()),
    )

    op.create_table(
        'category_allocations',
        sa.Column('id', sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column('category', sa.String(100), nullable=False),
        sa.Column('allocated_amount', sa.Float(), nullable=False, server_default='0'),
        sa.Column('period', sa.String(7), nullable=False),  # YYYY-MM
        sa.Column('created_at', sa.DateTime(), server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(), server_default=sa.func.now()),
        sa.UniqueConstraint('category', 'period', name='uq_category_period'),
    )


def downgrade() -> None:
    op.drop_table('category_allocations')
    op.drop_table('fund_receipts')
    op.drop_table('fund_sources')
    op.drop_table('payment_accounts')
