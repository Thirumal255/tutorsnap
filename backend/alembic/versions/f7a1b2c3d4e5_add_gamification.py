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
    op.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS total_xp INTEGER DEFAULT 0")
    op.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS weekly_xp INTEGER DEFAULT 0")
    op.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS weekly_xp_reset_at TIMESTAMP")
    op.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS show_on_leaderboard BOOLEAN DEFAULT TRUE")
    op.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS buddy_name VARCHAR(50)")
    op.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS buddy_avatar VARCHAR(50)")

    # ── Weekly challenges table ────────────────────────────────────────────
    op.execute("""
        CREATE TABLE IF NOT EXISTS weekly_challenges (
            id          SERIAL PRIMARY KEY,
            grade       INTEGER NOT NULL,
            week_start  TIMESTAMP NOT NULL,
            topic_id    INTEGER REFERENCES topics(id),
            question_text        TEXT NOT NULL,
            expected_key_points  TEXT,
            answer_format        VARCHAR(30),
            created_at  TIMESTAMP DEFAULT NOW(),
            UNIQUE(grade, week_start)
        )
    """)

    # ── Weekly challenge completions table ─────────────────────────────────
    op.execute("""
        CREATE TABLE IF NOT EXISTS weekly_challenge_completions (
            id           SERIAL PRIMARY KEY,
            user_id      INTEGER REFERENCES users(id),
            challenge_id INTEGER REFERENCES weekly_challenges(id),
            score        INTEGER NOT NULL,
            xp_earned    INTEGER NOT NULL,
            feedback     TEXT,
            completed_at TIMESTAMP DEFAULT NOW(),
            UNIQUE(user_id, challenge_id)
        )
    """)


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS weekly_challenge_completions")
    op.execute("DROP TABLE IF EXISTS weekly_challenges")
    op.drop_column('users', 'buddy_avatar')
    op.drop_column('users', 'buddy_name')
    op.drop_column('users', 'show_on_leaderboard')
    op.drop_column('users', 'weekly_xp_reset_at')
    op.drop_column('users', 'weekly_xp')
    op.drop_column('users', 'total_xp')
