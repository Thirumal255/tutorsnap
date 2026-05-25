"""add gamification: XP, buddy, leaderboard, weekly challenges

Revision ID: f7a1b2c3d4e5
Revises: d4f8a2b1c3e9
Create Date: 2026-05-13 12:00:00.000000

Adds:
  - users.total_xp              (Integer, default 0)
  - users.weekly_xp             (Integer, default 0)
  - users.weekly_xp_reset_at    (Timestamp, nullable)
  - users.show_on_leaderboard   (Boolean, default true)
  - users.buddy_name            (Varchar 50, nullable)
  - users.buddy_avatar          (Varchar 50, nullable)
  - weekly_challenges table
  - weekly_challenge_completions table
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa


revision: str = 'f7a1b2c3d4e5'
down_revision: Union[str, None] = 'd4f8a2b1c3e9'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # ── Users gamification columns ─────────────────────────────────────────
    op.add_column('users', sa.Column('total_xp', sa.Integer(), server_default='0', nullable=True))
    op.add_column('users', sa.Column('weekly_xp', sa.Integer(), server_default='0', nullable=True))
    op.add_column('users', sa.Column('weekly_xp_reset_at', sa.DateTime(), nullable=True))
    op.add_column('users', sa.Column('show_on_leaderboard', sa.Boolean(), server_default='1', nullable=True))
    op.add_column('users', sa.Column('buddy_name', sa.String(50), nullable=True))
    op.add_column('users', sa.Column('buddy_avatar', sa.String(50), nullable=True))

    # ── Weekly challenges table ────────────────────────────────────────────
    op.create_table(
        'weekly_challenges',
        sa.Column('id', sa.Integer(), autoincrement=True, primary_key=True),
        sa.Column('grade', sa.Integer(), nullable=False),
        sa.Column('week_start', sa.DateTime(), nullable=False),
        sa.Column('topic_id', sa.Integer(), sa.ForeignKey('topics.id'), nullable=True),
        sa.Column('question_text', sa.Text(), nullable=False),
        sa.Column('expected_key_points', sa.Text(), nullable=True),
        sa.Column('answer_format', sa.String(30), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=True),
        sa.UniqueConstraint('grade', 'week_start'),
    )

    # ── Weekly challenge completions table ─────────────────────────────────
    op.create_table(
        'weekly_challenge_completions',
        sa.Column('id', sa.Integer(), autoincrement=True, primary_key=True),
        sa.Column('user_id', sa.Integer(), sa.ForeignKey('users.id'), nullable=True),
        sa.Column('challenge_id', sa.Integer(), sa.ForeignKey('weekly_challenges.id'), nullable=True),
        sa.Column('score', sa.Integer(), nullable=False),
        sa.Column('xp_earned', sa.Integer(), nullable=False),
        sa.Column('feedback', sa.Text(), nullable=True),
        sa.Column('completed_at', sa.DateTime(), nullable=True),
        sa.UniqueConstraint('user_id', 'challenge_id'),
    )


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS weekly_challenge_completions")
    op.execute("DROP TABLE IF EXISTS weekly_challenges")
    op.drop_column('users', 'buddy_avatar')
    op.drop_column('users', 'buddy_name')
    op.drop_column('users', 'show_on_leaderboard')
    op.drop_column('users', 'weekly_xp_reset_at')
    op.drop_column('users', 'weekly_xp')
    op.drop_column('users', 'total_xp')
