"""create ai_usage_log table (was never created on production)

Revision ID: l4c5d6e7f8g9
Revises: k3b4c5d6e7f8
Create Date: 2026-05-25 07:00:00.000000

The startup code in main.py used AUTOINCREMENT (SQLite-only) so ai_usage_log
was never actually created on PostgreSQL in production.  Migration
k3b4c5d6e7f8 then dropped ai_usage_logs (the plural mis-named table created
by j2a3b4c5d6e7) leaving no ai_usage_log table at all.

This migration creates it with correct portable syntax.
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa


revision: str = 'l4c5d6e7f8g9'
down_revision: Union[str, None] = 'k3b4c5d6e7f8'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Use get_bind to check if table already exists (safe for re-entrant runs)
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    existing = inspector.get_table_names()

    if 'ai_usage_log' not in existing:
        op.create_table(
            'ai_usage_log',
            sa.Column('id', sa.Integer(), autoincrement=True, primary_key=True),
            sa.Column('student_id', sa.Integer(), sa.ForeignKey('users.id'), nullable=True),
            sa.Column('endpoint', sa.String(80), nullable=False),
            sa.Column('model', sa.String(80), nullable=True),
            sa.Column('input_tokens', sa.Integer(), server_default='0', nullable=True),
            sa.Column('output_tokens', sa.Integer(), server_default='0', nullable=True),
            sa.Column('cost_usd', sa.Float(), server_default='0.0', nullable=True),
            sa.Column('called_at', sa.DateTime(), nullable=True),
        )


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS ai_usage_log")
