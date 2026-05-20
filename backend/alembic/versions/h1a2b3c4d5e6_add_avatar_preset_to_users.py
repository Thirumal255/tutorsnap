"""add avatar_preset to users

Revision ID: h1a2b3c4d5e6
Revises: g8b2c3d4e5f6
Create Date: 2026-05-16 12:00:00.000000

Adds:
  - users.avatar_preset  (VARCHAR 50, nullable) — preset avatar key e.g. "fox"
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision: str = 'h1a2b3c4d5e6'
down_revision: Union[str, None] = 'g8b2c3d4e5f6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('users', sa.Column('avatar_preset', sa.String(50), nullable=True))


def downgrade() -> None:
    op.drop_column('users', 'avatar_preset')
