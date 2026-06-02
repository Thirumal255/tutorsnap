"""multi_account_per_category

Revision ID: y8z9a0b1c2d3
Revises: x7y8z9a0b1c2
Create Date: 2026-06-02 00:00:00.000000

Allow the same category to be funded by multiple accounts.
- Drop UNIQUE(category, period)
- Add UNIQUE(category, period, account_id)
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision: str = 'y8z9a0b1c2d3'
down_revision: Union[str, Sequence[str], None] = 'x7y8z9a0b1c2'
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name == 'sqlite':
        # SQLite can't drop constraints — recreate table with new constraint
        op.execute("""
            CREATE TABLE category_allocations_new (
                id               INTEGER PRIMARY KEY AUTOINCREMENT,
                category         VARCHAR(100) NOT NULL,
                allocated_amount FLOAT NOT NULL DEFAULT 0,
                period           VARCHAR(7)   NOT NULL,
                account_id       INTEGER REFERENCES payment_accounts(id),
                created_at       DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at       DATETIME DEFAULT CURRENT_TIMESTAMP,
                UNIQUE (category, period, account_id)
            )
        """)
        op.execute("""
            INSERT INTO category_allocations_new
                (id, category, allocated_amount, period, account_id, created_at, updated_at)
            SELECT id, category,
                   COALESCE(allocated_amount, 0),
                   period, account_id, created_at, updated_at
            FROM category_allocations
        """)
        op.execute("DROP TABLE category_allocations")
        op.execute("ALTER TABLE category_allocations_new RENAME TO category_allocations")
    else:
        # PostgreSQL
        op.execute("""
            DO $$
            BEGIN
                IF EXISTS (
                    SELECT 1 FROM information_schema.table_constraints
                    WHERE table_name = 'category_allocations'
                    AND constraint_name = 'uq_category_period'
                ) THEN
                    ALTER TABLE category_allocations DROP CONSTRAINT uq_category_period;
                END IF;
            END $$
        """)
        op.execute("""
            ALTER TABLE category_allocations
            ADD CONSTRAINT uq_category_period_account
            UNIQUE (category, period, account_id)
        """)


def downgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name != 'sqlite':
        op.execute("ALTER TABLE category_allocations DROP CONSTRAINT IF EXISTS uq_category_period_account")
        op.execute("ALTER TABLE category_allocations ADD CONSTRAINT uq_category_period UNIQUE (category, period)")
