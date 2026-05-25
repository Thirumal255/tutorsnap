"""add learning effectiveness: spaced-rep + exam sessions

Revision ID: g8b2c3d4e5f6
Revises: f7a1b2c3d4e5
Create Date: 2026-05-13 13:00:00.000000

Adds:
  - topic_mastery.next_review_at       (Timestamp, nullable)
  - topic_mastery.review_interval_days (Integer, default 1)
  - exam_sessions table
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision: str = 'g8b2c3d4e5f6'
down_revision: Union[str, None] = 'f7a1b2c3d4e5'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # ── TopicMastery spaced-rep columns ────────────────────────────────────
    op.add_column('topic_mastery', sa.Column('next_review_at', sa.DateTime(), nullable=True))
    op.add_column('topic_mastery', sa.Column('review_interval_days', sa.Integer(), server_default='1', nullable=True))

    # ── Exam sessions table ────────────────────────────────────────────────
    op.create_table(
        'exam_sessions',
        sa.Column('id', sa.Integer(), autoincrement=True, primary_key=True),
        sa.Column('user_id', sa.Integer(), sa.ForeignKey('users.id'), nullable=True),
        sa.Column('grade', sa.Integer(), nullable=False),
        sa.Column('subjects_json', sa.Text(), nullable=True),
        sa.Column('questions_json', sa.Text(), nullable=False),
        sa.Column('answers_json', sa.Text(), nullable=True),
        sa.Column('scores_json', sa.Text(), nullable=True),
        sa.Column('feedbacks_json', sa.Text(), nullable=True),
        sa.Column('time_limit_seconds', sa.Integer(), server_default='900', nullable=True),
        sa.Column('question_count', sa.Integer(), server_default='10', nullable=True),
        sa.Column('started_at', sa.DateTime(), nullable=True),
        sa.Column('ended_at', sa.DateTime(), nullable=True),
        sa.Column('status', sa.String(20), server_default='active', nullable=True),
        sa.Column('total_score', sa.Integer(), nullable=True),
        sa.Column('xp_earned', sa.Integer(), nullable=True),
    )


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS exam_sessions")
    op.drop_column('topic_mastery', 'review_interval_days')
    op.drop_column('topic_mastery', 'next_review_at')
