"""add_assignment_papers

Revision ID: aa1b2c3d4e5f
Revises: z9a0b1c2d3e4, a963847deb5a
Create Date: 2026-07-28 00:00:00.000000
"""
from alembic import op
import sqlalchemy as sa

revision = 'aa1b2c3d4e5f'
down_revision = ('z9a0b1c2d3e4', 'a963847deb5a')
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        'assignment_papers',
        sa.Column('id',              sa.Integer(),     primary_key=True, autoincrement=True),
        sa.Column('book_id',         sa.Integer(),     sa.ForeignKey('books.id', ondelete='CASCADE'), nullable=False),
        sa.Column('created_by',      sa.Integer(),     sa.ForeignKey('users.id', ondelete='SET NULL'), nullable=True),
        sa.Column('title',           sa.String(300),   nullable=False),
        sa.Column('chapter_ids',     sa.JSON(),        nullable=False),
        sa.Column('questions',       sa.JSON(),        nullable=False),
        sa.Column('include_answers', sa.Boolean(),     nullable=False, server_default='false'),
        sa.Column('created_at',      sa.DateTime(),    server_default=sa.func.now()),
    )


def downgrade():
    op.drop_table('assignment_papers')
