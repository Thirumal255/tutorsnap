"""add_admin_task_tracker

Revision ID: 8fdfaa172fd1
Revises: n6e7f8g9h0i1
Create Date: 2026-06-01 07:50:15.596685

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '8fdfaa172fd1'
down_revision: Union[str, Sequence[str], None] = 'n6e7f8g9h0i1'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table('admin_tasks',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('title', sa.String(length=200), nullable=False),
        sa.Column('notes', sa.Text(), nullable=True),
        sa.Column('status', sa.String(length=20), nullable=False),
        sa.Column('priority', sa.String(length=10), nullable=False),
        sa.Column('category', sa.String(length=100), nullable=False),
        sa.Column('start_date', sa.Date(), nullable=True),
        sa.Column('end_date', sa.Date(), nullable=True),
        sa.Column('parent_id', sa.Integer(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=True),
        sa.Column('updated_at', sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(['parent_id'], ['admin_tasks.id']),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_table('admin_task_expenses',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('task_id', sa.Integer(), nullable=False),
        sa.Column('amount', sa.Float(), nullable=False),
        sa.Column('description', sa.String(length=300), nullable=True),
        sa.Column('expense_date', sa.Date(), nullable=False),
        sa.Column('created_at', sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(['task_id'], ['admin_tasks.id']),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_table('admin_task_dependencies',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('task_id', sa.Integer(), nullable=False),
        sa.Column('depends_on_id', sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(['depends_on_id'], ['admin_tasks.id']),
        sa.ForeignKeyConstraint(['task_id'], ['admin_tasks.id']),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('task_id', 'depends_on_id'),
    )


def downgrade() -> None:
    op.drop_table('admin_task_dependencies')
    op.drop_table('admin_task_expenses')
    op.drop_table('admin_tasks')
