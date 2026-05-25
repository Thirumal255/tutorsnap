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
    op.add_column('users', sa.Column('streak_days', sa.Integer(), server_default='0', nullable=True))
    op.add_column('users', sa.Column('streak_freeze_available', sa.Boolean(), server_default='0', nullable=True))
    op.add_column('users', sa.Column('streak_freeze_used_at', sa.DateTime(), nullable=True))

    # ── users: onboarding + daily goal (Batch 13/17/59) ──────────────────────
    op.add_column('users', sa.Column('has_onboarded', sa.Boolean(), server_default='0', nullable=True))
    op.add_column('users', sa.Column('daily_goal_sessions', sa.Integer(), server_default='1', nullable=True))
    op.add_column('users', sa.Column('weekly_mastery_goal', sa.Integer(), server_default='0', nullable=True))

    # ── sessions: diagnostic columns (Batch 9) ────────────────────────────────
    op.add_column('sessions', sa.Column('diagnostic_phase', sa.Boolean(), server_default='0', nullable=True))
    op.add_column('sessions', sa.Column('diagnostic_turn', sa.Integer(), server_default='0', nullable=True))

    # ── sessions: practice mode + A/B variant (Batches 9/10) ─────────────────
    op.add_column('sessions', sa.Column('is_practice', sa.Boolean(), server_default='0', nullable=True))
    op.add_column('sessions', sa.Column('ab_variant', sa.String(1), nullable=True))

    # ── sessions: prompt_version + confidence_score (Batch 10) ───────────────
    op.add_column('sessions', sa.Column('prompt_version', sa.String(20), nullable=True))
    op.add_column('sessions', sa.Column('confidence_score', sa.Float(), nullable=True))

    # ── topic_mastery: SM-2 ease factor (Batch 24) ───────────────────────────
    op.add_column('topic_mastery', sa.Column('ease_factor', sa.Float(), server_default='2.5', nullable=True))

    # ── topic_mastery: study mode columns (Batches 5/40) ─────────────────────
    op.add_column('topic_mastery', sa.Column('studied', sa.Boolean(), server_default='0', nullable=True))
    op.add_column('topic_mastery', sa.Column('study_summary', sa.Text(), nullable=True))

    # ── topic_mastery: mastery confirmed + session memory (Batches 38/40) ────
    op.add_column('topic_mastery', sa.Column('mastery_confirmed', sa.Boolean(), server_default='0', nullable=True))
    op.add_column('topic_mastery', sa.Column('session_memory', sa.Text(), nullable=True))

    # ── ai_usage_log table (Batch 26) ─────────────────────────────────────────
    op.create_table(
        'ai_usage_log',
        sa.Column('id', sa.Integer(), autoincrement=True, primary_key=True),
        sa.Column('student_id', sa.Integer(), sa.ForeignKey('users.id'), nullable=True),
        sa.Column('endpoint', sa.String(80), nullable=False),
        sa.Column('model', sa.String(80), nullable=True),
        sa.Column('input_tokens', sa.Integer(), server_default='0', nullable=True),
        sa.Column('output_tokens', sa.Integer(), server_default='0', nullable=True),
        sa.Column('cost_usd', sa.Float(), server_default='0.0', nullable=True),
        sa.Column('called_at', sa.DateTime(), nullable=True),
    )

    # ── admin_audit_log table (Batch 22) ──────────────────────────────────────
    op.create_table(
        'admin_audit_log',
        sa.Column('id', sa.Integer(), autoincrement=True, primary_key=True),
        sa.Column('admin_id', sa.Integer(), sa.ForeignKey('users.id'), nullable=True),
        sa.Column('admin_name', sa.String(200), nullable=True),
        sa.Column('action', sa.String(100), nullable=False),
        sa.Column('target_type', sa.String(50), nullable=True),
        sa.Column('target_id', sa.Integer(), nullable=True),
        sa.Column('target_name', sa.String(200), nullable=True),
        sa.Column('details', sa.Text(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=True),
    )

    # ── question_bank table (Batch 6) ─────────────────────────────────────────
    op.create_table(
        'question_bank',
        sa.Column('id', sa.Integer(), autoincrement=True, primary_key=True),
        sa.Column('topic_id', sa.Integer(), sa.ForeignKey('topics.id'), nullable=True),
        sa.Column('level', sa.String(5), nullable=False),
        sa.Column('question_text', sa.Text(), nullable=False),
        sa.Column('expected_key_points', sa.Text(), nullable=True),
        sa.Column('answer_format', sa.String(30), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=True),
    )


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS question_bank")
    op.execute("DROP TABLE IF EXISTS admin_audit_log")
    op.execute("DROP TABLE IF EXISTS ai_usage_log")

    for col in ('session_memory', 'mastery_confirmed', 'study_summary', 'studied', 'ease_factor'):
        op.execute(f"ALTER TABLE topic_mastery DROP COLUMN IF EXISTS {col}")

    for col in ('confidence_score', 'prompt_version', 'ab_variant', 'is_practice',
                'diagnostic_turn', 'diagnostic_phase'):
        op.execute(f"ALTER TABLE sessions DROP COLUMN IF EXISTS {col}")

    for col in ('weekly_mastery_goal', 'daily_goal_sessions', 'has_onboarded',
                'streak_freeze_used_at', 'streak_freeze_available', 'streak_days'):
        op.execute(f"ALTER TABLE users DROP COLUMN IF EXISTS {col}")
