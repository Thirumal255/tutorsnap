"""create student_goals table

Revision ID: n6e7f8g9h0i1
Revises: m5d6e7f8g9h0
Create Date: 2026-05-26 10:00:00.000000

Adds the student_goals table for the weekly Goal Journal feature.
Students set one goal per week; Buddy evaluates progress at end of week.
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa


revision: str = 'n6e7f8g9h0i1'
down_revision: Union[str, None] = 'm5d6e7f8g9h0'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    existing = inspector.get_table_names()

    if 'student_goals' not in existing:
        op.create_table(
            'student_goals',
            sa.Column('id', sa.Integer(), autoincrement=True, primary_key=True),
            sa.Column('user_id', sa.Integer(), sa.ForeignKey('users.id'), nullable=False),
            sa.Column('goal_text', sa.String(300), nullable=False),
            sa.Column('topic_id', sa.Integer(), sa.ForeignKey('topics.id'), nullable=True),
            sa.Column('week_start', sa.Date(), nullable=False),
            sa.Column('created_at', sa.DateTime(), nullable=True),
            sa.Column('status', sa.String(20), server_default='active', nullable=True),
            sa.Column('result_note', sa.Text(), nullable=True),
            sa.UniqueConstraint('user_id', 'week_start', name='uq_student_goals_user_week'),
        )


def downgrade() -> None:
    op.drop_table('student_goals')
