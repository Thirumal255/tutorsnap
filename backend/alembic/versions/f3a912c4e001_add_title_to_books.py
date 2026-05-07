"""add title to books

Revision ID: f3a912c4e001
Revises: e06b85dfc23f
Create Date: 2026-05-07 08:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'f3a912c4e001'
down_revision: Union[str, None] = 'e06b85dfc23f'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('books', sa.Column('title', sa.String(length=300), nullable=True))
    # Backfill existing rows: use filename as title
    op.execute("UPDATE books SET title = filename WHERE title IS NULL")


def downgrade() -> None:
    op.drop_column('books', 'title')
