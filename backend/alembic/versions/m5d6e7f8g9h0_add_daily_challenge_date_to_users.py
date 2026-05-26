"""add daily_challenge_date to users

Revision ID: m5d6e7f8g9h0
Revises: l4c5d6e7f8g9
Create Date: 2026-05-26 08:00:00.000000

Adds the daily_challenge_date DATE column used to track whether a student
has already completed today's daily 3-minute challenge.
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa


revision: str = 'm5d6e7f8g9h0'
down_revision: Union[str, None] = 'l4c5d6e7f8g9'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    existing_cols = [c['name'] for c in inspector.get_columns('users')]

    if 'daily_challenge_date' not in existing_cols:
        op.add_column(
            'users',
            sa.Column('daily_challenge_date', sa.Date(), nullable=True),
        )


def downgrade() -> None:
    op.drop_column('users', 'daily_challenge_date')
