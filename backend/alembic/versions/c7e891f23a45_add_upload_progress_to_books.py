"""add upload progress to books

Revision ID: c7e891f23a45
Revises: f3a912c4e001
Create Date: 2026-05-07 09:00:00.000000

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision: str = 'c7e891f23a45'
down_revision: Union[str, None] = 'f3a912c4e001'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('books', sa.Column('upload_stage', sa.String(50), nullable=True))
    op.add_column('books', sa.Column('upload_progress', sa.Integer(), nullable=True, server_default='0'))


def downgrade() -> None:
    op.drop_column('books', 'upload_progress')
    op.drop_column('books', 'upload_stage')
