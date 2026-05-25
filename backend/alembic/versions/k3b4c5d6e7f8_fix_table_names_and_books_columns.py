"""fix table names (plural→singular) and add missing books columns

Revision ID: k3b4c5d6e7f8
Revises: j2a3b4c5d6e7
Create Date: 2026-05-25 00:00:00.000000

Migration j2a3b4c5d6e7 created ai_usage_logs / admin_audit_logs (plural) but
models.py and main.py use ai_usage_log / admin_audit_log (singular). On a fresh
DB the previous migration now creates the correct singular names, but on
production the plural tables already exist — this migration drops them.

Also adds three books columns that existed in models.py but had no migration:
  - books.toc_pages        (Varchar 20, nullable)
  - books.chapter_structure (Text, nullable)
  - books.chapter_limit    (Integer, nullable)
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa


revision: str = 'k3b4c5d6e7f8'
down_revision: Union[str, None] = 'j2a3b4c5d6e7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # ── Drop plural-named tables created by j2a3b4c5d6e7 on production ───────
    # On a fresh DB these tables won't exist (j2a3b4c5d6e7 now creates singular
    # names), so IF EXISTS makes this a no-op on fresh DBs.
    op.execute("DROP TABLE IF EXISTS ai_usage_logs")
    op.execute("DROP TABLE IF EXISTS admin_audit_logs")

    # ── books: ingestion-control columns ─────────────────────────────────────
    # Use IF NOT EXISTS — columns may already exist on production from startup code
    bind = op.get_bind()
    if bind.dialect.name == 'sqlite':
        # SQLite does not support IF NOT EXISTS on ADD COLUMN; check manually
        inspector = sa.inspect(bind)
        existing_cols = {c['name'] for c in inspector.get_columns('books')}
        if 'toc_pages' not in existing_cols:
            op.add_column('books', sa.Column('toc_pages', sa.String(20), nullable=True))
        if 'chapter_structure' not in existing_cols:
            op.add_column('books', sa.Column('chapter_structure', sa.Text(), nullable=True))
        if 'chapter_limit' not in existing_cols:
            op.add_column('books', sa.Column('chapter_limit', sa.Integer(), nullable=True))
    else:
        # PostgreSQL 9.6+ supports ADD COLUMN IF NOT EXISTS
        op.execute("ALTER TABLE books ADD COLUMN IF NOT EXISTS toc_pages VARCHAR(20)")
        op.execute("ALTER TABLE books ADD COLUMN IF NOT EXISTS chapter_structure TEXT")
        op.execute("ALTER TABLE books ADD COLUMN IF NOT EXISTS chapter_limit INTEGER")


def downgrade() -> None:
    op.drop_column('books', 'chapter_limit')
    op.drop_column('books', 'chapter_structure')
    op.drop_column('books', 'toc_pages')
