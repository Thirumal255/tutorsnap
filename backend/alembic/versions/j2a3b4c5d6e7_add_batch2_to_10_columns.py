"""add all columns introduced in Batches 2-10

Revision ID: j2a3b4c5d6e7
Revises: i9c3d4e5f6g7
Create Date: 2026-05-23 00:00:00.000000

Missing columns discovered when production DB crashed on login (users.has_onboarded
column does not exist). Adds every column/table that exists in models.py but was
never captured in an Alembic migration.

Tables / columns added:
  users:
    - streak_days              (Integer, default 0)
    - streak_freeze_available  (Boolean, default false)
    - streak_freeze_used_at    (Timestamp, nullable)
    - has_onboarded            (Boolean, default false)
    - daily_goal_sessions      (Integer, default 1)
    - weekly_mastery_goal      (Integer, default 0)

  sessions:
    - diagnostic_phase  (Boolean, default false)
    - diagnostic_turn   (Integer, default 0)
    - is_practice       (Boolean, default false)
    - ab_variant        (Varchar 1, nullable)

  topic_mastery:
    - ease_factor        (Float, default 2.5)
    - studied            (Boolean, default false)
    - study_summary      (Text, nullable)
    - mastery_confirmed  (Boolean, default false)
    - session_memory     (Text, nullable)

  New tables:
    - ai_usage_logs
    - admin_audit_logs
    - question_bank
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision: str = 'j2a3b4c5d6e7'
down_revision: Union[str, None] = 'i9c3d4e5f6g7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # ── users: streak columns (Batch 7) ───────────────────────────────────────
    op.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS streak_days INTEGER DEFAULT 0")
    op.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS streak_freeze_available BOOLEAN DEFAULT FALSE")
    op.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS streak_freeze_used_at TIMESTAMP")

    # ── users: onboarding + daily goal (Batch 13/17/59) ──────────────────────
    op.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS has_onboarded BOOLEAN DEFAULT FALSE")
    op.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS daily_goal_sessions INTEGER DEFAULT 1")
    op.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS weekly_mastery_goal INTEGER DEFAULT 0")

    # ── sessions: diagnostic columns (Batch 9) ────────────────────────────────
    op.execute("ALTER TABLE sessions ADD COLUMN IF NOT EXISTS diagnostic_phase BOOLEAN DEFAULT FALSE")
    op.execute("ALTER TABLE sessions ADD COLUMN IF NOT EXISTS diagnostic_turn INTEGER DEFAULT 0")

    # ── sessions: practice mode + A/B variant (Batches 9/10) ─────────────────
    op.execute("ALTER TABLE sessions ADD COLUMN IF NOT EXISTS is_practice BOOLEAN DEFAULT FALSE")
    op.execute("ALTER TABLE sessions ADD COLUMN IF NOT EXISTS ab_variant VARCHAR(1)")

    # ── sessions: prompt_version + confidence_score (Batch 10) ───────────────
    op.execute("ALTER TABLE sessions ADD COLUMN IF NOT EXISTS prompt_version VARCHAR(20)")
    op.execute("ALTER TABLE sessions ADD COLUMN IF NOT EXISTS confidence_score FLOAT")

    # ── topic_mastery: SM-2 ease factor (Batch 24) ───────────────────────────
    op.execute("ALTER TABLE topic_mastery ADD COLUMN IF NOT EXISTS ease_factor FLOAT DEFAULT 2.5")

    # ── topic_mastery: study mode columns (Batches 5/40) ─────────────────────
    op.execute("ALTER TABLE topic_mastery ADD COLUMN IF NOT EXISTS studied BOOLEAN DEFAULT FALSE")
    op.execute("ALTER TABLE topic_mastery ADD COLUMN IF NOT EXISTS study_summary TEXT")

    # ── topic_mastery: mastery confirmed + session memory (Batches 38/40) ────
    op.execute("ALTER TABLE topic_mastery ADD COLUMN IF NOT EXISTS mastery_confirmed BOOLEAN DEFAULT FALSE")
    op.execute("ALTER TABLE topic_mastery ADD COLUMN IF NOT EXISTS session_memory TEXT")

    # ── ai_usage_logs table (Batch 26) ────────────────────────────────────────
    op.execute("""
        CREATE TABLE IF NOT EXISTS ai_usage_logs (
            id           SERIAL PRIMARY KEY,
            student_id   INTEGER REFERENCES users(id),
            endpoint     VARCHAR(80) NOT NULL,
            model        VARCHAR(80),
            input_tokens  INTEGER DEFAULT 0,
            output_tokens INTEGER DEFAULT 0,
            cost_usd     FLOAT DEFAULT 0.0,
            called_at    TIMESTAMP DEFAULT NOW()
        )
    """)

    # ── admin_audit_logs table (Batch 22) ─────────────────────────────────────
    op.execute("""
        CREATE TABLE IF NOT EXISTS admin_audit_logs (
            id           SERIAL PRIMARY KEY,
            admin_id     INTEGER REFERENCES users(id),
            admin_name   VARCHAR(200),
            action       VARCHAR(100) NOT NULL,
            target_type  VARCHAR(50),
            target_id    INTEGER,
            target_name  VARCHAR(200),
            details      TEXT,
            created_at   TIMESTAMP DEFAULT NOW()
        )
    """)

    # ── question_bank table (Batch 6) ─────────────────────────────────────────
    op.execute("""
        CREATE TABLE IF NOT EXISTS question_bank (
            id                   SERIAL PRIMARY KEY,
            topic_id             INTEGER REFERENCES topics(id),
            level                VARCHAR(5) NOT NULL,
            question_text        TEXT NOT NULL,
            expected_key_points  TEXT,
            answer_format        VARCHAR(30),
            created_at           TIMESTAMP DEFAULT NOW()
        )
    """)


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS question_bank")
    op.execute("DROP TABLE IF EXISTS admin_audit_logs")
    op.execute("DROP TABLE IF EXISTS ai_usage_logs")

    for col in ('session_memory', 'mastery_confirmed', 'study_summary', 'studied', 'ease_factor'):
        op.execute(f"ALTER TABLE topic_mastery DROP COLUMN IF EXISTS {col}")

    for col in ('confidence_score', 'prompt_version', 'ab_variant', 'is_practice',
                'diagnostic_turn', 'diagnostic_phase'):
        op.execute(f"ALTER TABLE sessions DROP COLUMN IF EXISTS {col}")

    for col in ('weekly_mastery_goal', 'daily_goal_sessions', 'has_onboarded',
                'streak_freeze_used_at', 'streak_freeze_available', 'streak_days'):
        op.execute(f"ALTER TABLE users DROP COLUMN IF EXISTS {col}")
