"""fix_category_allocations_amount

Revision ID: x7y8z9a0b1c2
Revises: w6x7y8z9a0b1
Create Date: 2026-06-02 00:00:00.000000

The original reverted migration left an `amount` column on
category_allocations with a NOT NULL constraint.  New inserts from our
code only set `allocated_amount`, so PostgreSQL rejects them.

Fix: give `amount` a server default of 0 so it is never NULL on insert.
Also do the same for `date` (original NOT NULL date column).
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision: str = 'x7y8z9a0b1c2'
down_revision: Union[str, Sequence[str], None] = 'w6x7y8z9a0b1'
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name == 'sqlite':
        # SQLite doesn't enforce NOT NULL well and doesn't support
        # ALTER COLUMN — nothing needed here.
        pass
    else:
        # Drop NOT NULL from legacy columns so new inserts work
        op.execute("""
            ALTER TABLE category_allocations
            ALTER COLUMN amount SET DEFAULT 0
        """)
        op.execute("""
            ALTER TABLE category_allocations
            ALTER COLUMN amount DROP NOT NULL
        """)
        # `date` column may also be NOT NULL from original migration
        op.execute("""
            DO $$
            BEGIN
                IF EXISTS (
                    SELECT 1 FROM information_schema.columns
                    WHERE table_name = 'category_allocations'
                    AND column_name = 'date'
                    AND is_nullable = 'NO'
                ) THEN
                    ALTER TABLE category_allocations ALTER COLUMN date DROP NOT NULL;
                END IF;
            END $$
        """)
        # fund_receipts.date may also be NOT NULL
        op.execute("""
            DO $$
            BEGIN
                IF EXISTS (
                    SELECT 1 FROM information_schema.columns
                    WHERE table_name = 'fund_receipts'
                    AND column_name = 'date'
                    AND is_nullable = 'NO'
                ) THEN
                    ALTER TABLE fund_receipts ALTER COLUMN date DROP NOT NULL;
                END IF;
            END $$
        """)
        # fund_receipts.source_id was NOT NULL in original migration
        op.execute("""
            DO $$
            BEGIN
                IF EXISTS (
                    SELECT 1 FROM information_schema.columns
                    WHERE table_name = 'fund_receipts'
                    AND column_name = 'source_id'
                    AND is_nullable = 'NO'
                ) THEN
                    ALTER TABLE fund_receipts ALTER COLUMN source_id DROP NOT NULL;
                END IF;
            END $$
        """)


def downgrade() -> None:
    pass
