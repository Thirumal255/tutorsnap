"""polyhouse_tracker_fields

Revision ID: cc1d2e3f4g5h
Revises: bb2c3d4e5f6g
Create Date: 2026-08-13 00:00:00.000000
"""
from alembic import op
import sqlalchemy as sa

revision = 'cc1d2e3f4g5h'
down_revision = 'bb2c3d4e5f6g'
branch_labels = None
depends_on = None


def upgrade():
    # ── admin_tasks: owner + actual_start_date ────────────────────────────────
    op.add_column('admin_tasks', sa.Column('owner', sa.String(100), nullable=True))
    op.add_column('admin_tasks', sa.Column('actual_start_date', sa.Date(), nullable=True))

    # ── budget_line_items (new table) ─────────────────────────────────────────
    op.create_table(
        'budget_line_items',
        sa.Column('id',             sa.Integer(),     primary_key=True, autoincrement=True),
        sa.Column('name',           sa.String(300),   nullable=False),
        sa.Column('component',      sa.String(100),   nullable=True),
        sa.Column('category',       sa.String(100),   nullable=True),
        sa.Column('sub_category',   sa.String(100),   nullable=True),
        sa.Column('planned_date',   sa.Date(),        nullable=True),
        sa.Column('planned_amount', sa.Float(),       nullable=False, server_default='0'),
        sa.Column('actual_amount',  sa.Float(),       nullable=True),
        sa.Column('account_id',     sa.Integer(),     sa.ForeignKey('payment_accounts.id', ondelete='SET NULL'), nullable=True),
        sa.Column('notes',          sa.Text(),        nullable=True),
        sa.Column('created_at',     sa.DateTime(),    server_default=sa.func.now()),
        sa.Column('updated_at',     sa.DateTime(),    server_default=sa.func.now(), onupdate=sa.func.now()),
    )


def downgrade():
    op.drop_table('budget_line_items')
    op.drop_column('admin_tasks', 'actual_start_date')
    op.drop_column('admin_tasks', 'owner')
