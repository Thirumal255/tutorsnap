"""Add student_id FK to topic_mastery; migrate from student_name.

Revision ID: i9c3d4e5f6g7
Revises: h1a2b3c4d5e6
Create Date: 2026-05-21

Changes:
  - Add student_id INTEGER FK → users.id (nullable during backfill)
  - Backfill student_id from users table by matching student_name
  - Drop old unique constraint on (student_name, topic_id)
  - Add new unique constraint on (student_id, topic_id)
"""

from alembic import op
import sqlalchemy as sa


revision = 'i9c3d4e5f6g7'
down_revision = 'h1a2b3c4d5e6'
branch_labels = None
depends_on = None


def upgrade():
    # 1. Add nullable student_id column
    op.add_column(
        'topic_mastery',
        sa.Column('student_id', sa.Integer(), sa.ForeignKey('users.id'), nullable=True)
    )

    # 2. Backfill student_id by matching student_name to users.name
    op.execute("""
        UPDATE topic_mastery
        SET student_id = (
            SELECT id FROM users
            WHERE users.name = topic_mastery.student_name
            LIMIT 1
        )
        WHERE student_id IS NULL
    """)

    # 3. Drop old unique constraint on (student_name, topic_id)
    op.drop_constraint('topic_mastery_student_name_topic_id_key', 'topic_mastery', type_='unique')

    # 4. Add new unique constraint on (student_id, topic_id)
    op.create_unique_constraint(
        'topic_mastery_student_id_topic_id_key',
        'topic_mastery',
        ['student_id', 'topic_id']
    )


def downgrade():
    op.drop_constraint('topic_mastery_student_id_topic_id_key', 'topic_mastery', type_='unique')
    op.create_unique_constraint(
        'topic_mastery_student_name_topic_id_key',
        'topic_mastery',
        ['student_name', 'topic_id']
    )
    op.drop_column('topic_mastery', 'student_id')
