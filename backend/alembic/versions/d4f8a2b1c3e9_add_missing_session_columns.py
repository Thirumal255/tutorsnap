"""add missing session and session_turn columns

Revision ID: d4f8a2b1c3e9
Revises: c7e891f23a45
Create Date: 2026-05-11 12:00:00.000000

Adds columns that exist in models.py but were never captured in a migration:
  - session_turns.expected_key_points  (Text, nullable)
  - session_turns.answer_format        (String 30, nullable)
  - session_turns.missed_key_points    (Text, nullable)
  - sessions.level_question_count      (Integer, default 0)
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'd4f8a2b1c3e9'
down_revision: Union[str, None] = 'c7e891f23a45'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Use IF NOT EXISTS so this is safe to run even if columns were added outside Alembic
    op.execute("ALTER TABLE session_turns ADD COLUMN IF NOT EXISTS expected_key_points TEXT")
    op.execute("ALTER TABLE session_turns ADD COLUMN IF NOT EXISTS answer_format VARCHAR(30)")
    op.execute("ALTER TABLE session_turns ADD COLUMN IF NOT EXISTS missed_key_points TEXT")
    op.execute("ALTER TABLE sessions ADD COLUMN IF NOT EXISTS level_question_count INTEGER DEFAULT 0")


def downgrade() -> None:
    op.drop_column('sessions', 'level_question_count')
    op.drop_column('session_turns', 'missed_key_points')
    op.drop_column('session_turns', 'answer_format')
    op.drop_column('session_turns', 'expected_key_points')
