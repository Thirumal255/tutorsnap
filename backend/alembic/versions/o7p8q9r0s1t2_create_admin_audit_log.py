"""create_admin_audit_log

Revision ID: o7p8q9r0s1t2
Revises: 8fdfaa172fd1
Create Date: 2026-06-01 08:30:00.000000

Creates admin_audit_log table which was missed on production during the
fix_table_names migration (k3b4c5d6e7f8 dropped the plural version but the
singular table was never created there).
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'o7p8q9r0s1t2'
down_revision: Union[str, Sequence[str], None] = '8fdfaa172fd1'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if 'admin_audit_log' not in inspector.get_table_names():
        op.create_table('admin_audit_log',
            sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
            sa.Column('admin_id', sa.Integer(), nullable=True),
            sa.Column('admin_name', sa.String(length=200), nullable=True),
            sa.Column('action', sa.String(length=100), nullable=False),
            sa.Column('target_type', sa.String(length=50), nullable=True),
            sa.Column('target_id', sa.Integer(), nullable=True),
            sa.Column('target_name', sa.String(length=200), nullable=True),
            sa.Column('details', sa.Text(), nullable=True),
            sa.Column('created_at', sa.DateTime(), nullable=True),
            sa.ForeignKeyConstraint(['admin_id'], ['users.id']),
            sa.PrimaryKeyConstraint('id'),
        )


def downgrade() -> None:
    op.execute('DROP TABLE IF EXISTS admin_audit_log')
