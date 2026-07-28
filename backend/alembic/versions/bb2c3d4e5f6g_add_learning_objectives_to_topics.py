"""add_learning_objectives_to_topics

Revision ID: bb2c3d4e5f6g
Revises: aa1b2c3d4e5f
Create Date: 2026-07-28 00:00:00.000000
"""
from alembic import op
import sqlalchemy as sa

revision = 'bb2c3d4e5f6g'
down_revision = 'aa1b2c3d4e5f'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('topics', sa.Column('learning_objectives', sa.JSON(), nullable=True))


def downgrade():
    op.drop_column('topics', 'learning_objectives')
