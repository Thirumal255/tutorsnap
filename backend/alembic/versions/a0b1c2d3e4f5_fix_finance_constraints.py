"""fix_finance_constraints

Revision ID: a0b1c2d3e4f5
Revises: z9a0b1c2d3e4
Create Date: 2026-06-02 00:00:00.000000

1. Drop period from category_allocations unique constraint.
   Category-account mappings are permanent project allocations,
   not monthly budgets. New constraint: UNIQUE(category, account_id).

2. Make category_allocations.period nullable (kept for any legacy data).
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision: str = 'a0b1c2d3e4f5'
down_revision: Union[str, Sequence[str], None] = 'z9a0b1c2d3e4'
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name == 'sqlite':
        # Recreate table with new constraint
        op.execute("""
            CREATE TABLE category_allocations_new (
                id               INTEGER PRIMARY KEY AUTOINCREMENT,
                category         VARCHAR(100) NOT NULL,
                allocated_amount FLOAT NOT NULL DEFAULT 0,
                period           VARCHAR(7),
                account_id       INTEGER REFERENCES payment_accounts(id) ON DELETE SET NULL,
                created_at       DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at       DATETIME DEFAULT CURRENT_TIMESTAMP,
                UNIQUE (category, account_id)
            )
        """)
        op.execute("""
            INSERT INTO category_allocations_new
                (id, category, allocated_amount, period, account_id, created_at, updated_at)
            SELECT id, category, COALESCE(allocated_amount, 0),
                   period, account_id, created_at, updated_at
            FROM category_allocations
        """)
        op.execute("DROP TABLE category_allocations")
        op.execute("ALTER TABLE category_allocations_new RENAME TO category_allocations")
    else:
        # Drop old period-based constraints
        op.execute("""
            DO $$ BEGIN
                IF EXISTS (SELECT 1 FROM information_schema.table_constraints
                           WHERE table_name='category_allocations'
                           AND constraint_name='uq_category_period_account') THEN
                    ALTER TABLE category_allocations DROP CONSTRAINT uq_category_period_account;
                END IF;
                IF EXISTS (SELECT 1 FROM information_schema.table_constraints
                           WHERE table_name='category_allocations'
                           AND constraint_name='uq_category_period') THEN
                    ALTER TABLE category_allocations DROP CONSTRAINT uq_category_period;
                END IF;
            END $$
        """)
        # Make period nullable
        op.execute("ALTER TABLE category_allocations ALTER COLUMN period DROP NOT NULL")
        # Add permanent constraint: one allocation per (category, account)
        op.execute("""
            DO $$ BEGIN
                IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints
                               WHERE table_name='category_allocations'
                               AND constraint_name='uq_category_account') THEN
                    ALTER TABLE category_allocations
                    ADD CONSTRAINT uq_category_account UNIQUE (category, account_id);
                END IF;
            END $$
        """)


def downgrade() -> None:
    pass  # not worth reversing
