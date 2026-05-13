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
    op.execute("ALTER TABLE topic_mastery ADD COLUMN IF NOT EXISTS next_review_at TIMESTAMP")
    op.execute("ALTER TABLE topic_mastery ADD COLUMN IF NOT EXISTS review_interval_days INTEGER DEFAULT 1")

    # ── Exam sessions table ────────────────────────────────────────────────
    op.execute("""
        CREATE TABLE IF NOT EXISTS exam_sessions (
            id                  SERIAL PRIMARY KEY,
            user_id             INTEGER REFERENCES users(id),
            grade               INTEGER NOT NULL,
            subjects_json       TEXT,
            questions_json      TEXT NOT NULL,
            answers_json        TEXT,
            scores_json         TEXT,
            feedbacks_json      TEXT,
            time_limit_seconds  INTEGER DEFAULT 900,
            question_count      INTEGER DEFAULT 10,
            started_at          TIMESTAMP DEFAULT NOW(),
            ended_at            TIMESTAMP,
            status              VARCHAR(20) DEFAULT 'active',
            total_score         INTEGER,
            xp_earned           INTEGER
        )
    """)


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS exam_sessions")
    op.drop_column('topic_mastery', 'review_interval_days')
    op.drop_column('topic_mastery', 'next_review_at')
