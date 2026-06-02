"""add_finance_tables

Revision ID: r1s2t3u4v5w6
Revises: s2t3u4v5w6x7
Create Date: 2026-06-02 00:00:00.000000

Ensures 4 finance tables exist: payment_accounts, fund_sources,
fund_receipts, category_allocations. Uses IF NOT EXISTS so it is
idempotent whether the original stub created them or not.
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision: str = 'r1s2t3u4v5w6'
down_revision: Union[str, Sequence[str], None] = 's2t3u4v5w6x7'
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    dialect = bind.dialect.name

    if dialect == 'sqlite':
        inspector = sa.inspect(bind)
        existing = set(inspector.get_table_names())

        if 'payment_accounts' not in existing:
            op.create_table(
                'payment_accounts',
                sa.Column('id', sa.Integer(), primary_key=True, autoincrement=True),
                sa.Column('name', sa.String(200), nullable=False),
                sa.Column('type', sa.String(20), nullable=False, server_default='bank'),
                sa.Column('current_balance', sa.Float(), nullable=False, server_default='0'),
                sa.Column('created_at', sa.DateTime(), server_default=sa.func.now()),
                sa.Column('updated_at', sa.DateTime(), server_default=sa.func.now()),
            )
        if 'fund_sources' not in existing:
            op.create_table(
                'fund_sources',
                sa.Column('id', sa.Integer(), primary_key=True, autoincrement=True),
                sa.Column('name', sa.String(200), nullable=False),
                sa.Column('type', sa.String(30), nullable=False, server_default='other'),
                sa.Column('expected_amount', sa.Float(), nullable=True),
                sa.Column('frequency', sa.String(20), nullable=False, server_default='monthly'),
                sa.Column('is_active', sa.Boolean(), nullable=False, server_default='1'),
                sa.Column('created_at', sa.DateTime(), server_default=sa.func.now()),
            )
        if 'fund_receipts' not in existing:
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
        if 'category_allocations' not in existing:
            op.create_table(
                'category_allocations',
                sa.Column('id', sa.Integer(), primary_key=True, autoincrement=True),
                sa.Column('category', sa.String(100), nullable=False),
                sa.Column('allocated_amount', sa.Float(), nullable=False, server_default='0'),
                sa.Column('period', sa.String(7), nullable=False),
                sa.Column('created_at', sa.DateTime(), server_default=sa.func.now()),
                sa.Column('updated_at', sa.DateTime(), server_default=sa.func.now()),
                sa.UniqueConstraint('category', 'period', name='uq_category_period'),
            )
    else:
        # PostgreSQL — use IF NOT EXISTS
        op.execute("""
            CREATE TABLE IF NOT EXISTS payment_accounts (
                id SERIAL PRIMARY KEY,
                name VARCHAR(200) NOT NULL,
                type VARCHAR(20) NOT NULL DEFAULT 'bank',
                current_balance FLOAT NOT NULL DEFAULT 0,
                created_at TIMESTAMP DEFAULT NOW(),
                updated_at TIMESTAMP DEFAULT NOW()
            )
        """)
        op.execute("""
            CREATE TABLE IF NOT EXISTS fund_sources (
                id SERIAL PRIMARY KEY,
                name VARCHAR(200) NOT NULL,
                type VARCHAR(30) NOT NULL DEFAULT 'other',
                expected_amount FLOAT,
                frequency VARCHAR(20) NOT NULL DEFAULT 'monthly',
                is_active BOOLEAN NOT NULL DEFAULT TRUE,
                created_at TIMESTAMP DEFAULT NOW()
            )
        """)
        op.execute("""
            CREATE TABLE IF NOT EXISTS fund_receipts (
                id SERIAL PRIMARY KEY,
                source_id INTEGER REFERENCES fund_sources(id) ON DELETE SET NULL,
                account_id INTEGER REFERENCES payment_accounts(id) ON DELETE SET NULL,
                amount FLOAT NOT NULL,
                description VARCHAR(300),
                received_date DATE NOT NULL,
                created_at TIMESTAMP DEFAULT NOW()
            )
        """)
        op.execute("""
            CREATE TABLE IF NOT EXISTS category_allocations (
                id SERIAL PRIMARY KEY,
                category VARCHAR(100) NOT NULL,
                allocated_amount FLOAT NOT NULL DEFAULT 0,
                period VARCHAR(7) NOT NULL,
                created_at TIMESTAMP DEFAULT NOW(),
                updated_at TIMESTAMP DEFAULT NOW(),
                CONSTRAINT uq_category_period UNIQUE (category, period)
            )
        """)


def downgrade() -> None:
    op.drop_table('category_allocations')
    op.drop_table('fund_receipts')
    op.drop_table('fund_sources')
    op.drop_table('payment_accounts')
