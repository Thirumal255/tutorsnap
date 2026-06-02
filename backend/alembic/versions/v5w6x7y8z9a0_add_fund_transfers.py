"""add_fund_transfers

Revision ID: v5w6x7y8z9a0
Revises: u4v5w6x7y8z9
Create Date: 2026-06-02 00:00:00.000000
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision: str = 'v5w6x7y8z9a0'
down_revision: Union[str, Sequence[str], None] = 'u4v5w6x7y8z9'
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name == 'sqlite':
        import sqlalchemy as sa2
        if 'fund_transfers' not in sa2.inspect(bind).get_table_names():
            op.create_table(
                'fund_transfers',
                sa.Column('id', sa.Integer(), primary_key=True, autoincrement=True),
                sa.Column('from_account_id', sa.Integer(), sa.ForeignKey('payment_accounts.id', ondelete='SET NULL'), nullable=True),
                sa.Column('to_account_id', sa.Integer(), sa.ForeignKey('payment_accounts.id', ondelete='SET NULL'), nullable=True),
                sa.Column('amount', sa.Float(), nullable=False),
                sa.Column('description', sa.String(300), nullable=True),
                sa.Column('transfer_date', sa.Date(), nullable=False),
                sa.Column('created_at', sa.DateTime(), server_default=sa.func.now()),
            )
    else:
        op.execute("""
            CREATE TABLE IF NOT EXISTS fund_transfers (
                id SERIAL PRIMARY KEY,
                from_account_id INTEGER REFERENCES payment_accounts(id) ON DELETE SET NULL,
                to_account_id   INTEGER REFERENCES payment_accounts(id) ON DELETE SET NULL,
                amount          FLOAT NOT NULL,
                description     VARCHAR(300),
                transfer_date   DATE NOT NULL,
                created_at      TIMESTAMP DEFAULT NOW()
            )
        """)


def downgrade() -> None:
    op.drop_table('fund_transfers')
