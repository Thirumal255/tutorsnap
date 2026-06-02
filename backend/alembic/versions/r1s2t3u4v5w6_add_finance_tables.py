"""add_finance_tables

Revision ID: r1s2t3u4v5w6
Revises: q9r0s1t2u3v4
Create Date: 2026-06-02 00:00:00.000000

Adds payment_accounts, fund_sources, fund_receipts, category_allocations
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision: str = 'r1s2t3u4v5w6'
down_revision: Union[str, Sequence[str], None] = 'q9r0s1t2u3v4'
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    dialect = bind.dialect.name

    if dialect == 'sqlite':
        import sqlalchemy as sa2
        inspector = sa2.inspect(bind)
        existing = inspector.get_table_names()

        if 'payment_accounts' not in existing:
            op.create_table('payment_accounts',
                sa.Column('id', sa.Integer, primary_key=True, autoincrement=True),
                sa.Column('name', sa.String(100), nullable=False),
                sa.Column('type', sa.String(20), nullable=False, server_default='bank'),
                sa.Column('opening_balance', sa.Float, nullable=False, server_default='0'),
                sa.Column('color', sa.String(20), nullable=True),
                sa.Column('notes', sa.String(300), nullable=True),
                sa.Column('created_at', sa.DateTime, server_default=sa.func.now()),
            )
        if 'fund_sources' not in existing:
            op.create_table('fund_sources',
                sa.Column('id', sa.Integer, primary_key=True, autoincrement=True),
                sa.Column('name', sa.String(100), nullable=False),
                sa.Column('type', sa.String(30), nullable=False, server_default='loan'),
                sa.Column('total_sanctioned', sa.Float, nullable=True),
                sa.Column('notes', sa.String(300), nullable=True),
                sa.Column('created_at', sa.DateTime, server_default=sa.func.now()),
            )
        if 'fund_receipts' not in existing:
            op.create_table('fund_receipts',
                sa.Column('id', sa.Integer, primary_key=True, autoincrement=True),
                sa.Column('source_id', sa.Integer, sa.ForeignKey('fund_sources.id'), nullable=False),
                sa.Column('account_id', sa.Integer, sa.ForeignKey('payment_accounts.id'), nullable=True),
                sa.Column('amount', sa.Float, nullable=False),
                sa.Column('date', sa.Date, nullable=False),
                sa.Column('notes', sa.String(300), nullable=True),
                sa.Column('ref_number', sa.String(100), nullable=True),
                sa.Column('created_at', sa.DateTime, server_default=sa.func.now()),
            )
        if 'category_allocations' not in existing:
            op.create_table('category_allocations',
                sa.Column('id', sa.Integer, primary_key=True, autoincrement=True),
                sa.Column('category', sa.String(100), nullable=False),
                sa.Column('amount', sa.Float, nullable=False),
                sa.Column('date', sa.Date, nullable=False),
                sa.Column('notes', sa.String(300), nullable=True),
                sa.Column('source_id', sa.Integer, sa.ForeignKey('fund_sources.id'), nullable=True),
                sa.Column('created_at', sa.DateTime, server_default=sa.func.now()),
            )
    else:
        op.execute("""
            CREATE TABLE IF NOT EXISTS payment_accounts (
                id SERIAL PRIMARY KEY,
                name VARCHAR(100) NOT NULL,
                type VARCHAR(20) NOT NULL DEFAULT 'bank',
                opening_balance FLOAT NOT NULL DEFAULT 0,
                color VARCHAR(20),
                notes VARCHAR(300),
                created_at TIMESTAMP DEFAULT NOW()
            )
        """)
        op.execute("""
            CREATE TABLE IF NOT EXISTS fund_sources (
                id SERIAL PRIMARY KEY,
                name VARCHAR(100) NOT NULL,
                type VARCHAR(30) NOT NULL DEFAULT 'loan',
                total_sanctioned FLOAT,
                notes VARCHAR(300),
                created_at TIMESTAMP DEFAULT NOW()
            )
        """)
        op.execute("""
            CREATE TABLE IF NOT EXISTS fund_receipts (
                id SERIAL PRIMARY KEY,
                source_id INTEGER NOT NULL REFERENCES fund_sources(id) ON DELETE CASCADE,
                account_id INTEGER REFERENCES payment_accounts(id) ON DELETE SET NULL,
                amount FLOAT NOT NULL,
                date DATE NOT NULL,
                notes VARCHAR(300),
                ref_number VARCHAR(100),
                created_at TIMESTAMP DEFAULT NOW()
            )
        """)
        op.execute("""
            CREATE TABLE IF NOT EXISTS category_allocations (
                id SERIAL PRIMARY KEY,
                category VARCHAR(100) NOT NULL,
                amount FLOAT NOT NULL,
                date DATE NOT NULL,
                notes VARCHAR(300),
                source_id INTEGER REFERENCES fund_sources(id) ON DELETE SET NULL,
                created_at TIMESTAMP DEFAULT NOW()
            )
        """)


def downgrade() -> None:
    op.drop_table('category_allocations')
    op.drop_table('fund_receipts')
    op.drop_table('fund_sources')
    op.drop_table('payment_accounts')
