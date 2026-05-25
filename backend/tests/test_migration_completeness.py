"""
Migration completeness test — catches schema drift early.

Runs every Alembic migration on a fresh SQLite database, then compares the
resulting schema against models.py (Base.metadata).  The test fails if any
table or column defined in the models has no corresponding migration.

This prevents the production outage pattern where models.py is updated but
no migration file is created, causing 500 errors that bypass CORS headers
and appear as a generic "Login failed" in the frontend.
"""

import os
import sys
import pytest
from sqlalchemy import create_engine, inspect as sa_inspect
from unittest.mock import patch, MagicMock

# ---------------------------------------------------------------------------
# Skip if alembic is not importable (shouldn't happen, but guard anyway)
# ---------------------------------------------------------------------------
alembic = pytest.importorskip("alembic", reason="alembic not installed")


# ---------------------------------------------------------------------------
# The alembic.ini lives one directory above this file (backend/)
# ---------------------------------------------------------------------------
BACKEND_DIR = os.path.dirname(os.path.dirname(__file__))
ALEMBIC_INI = os.path.join(BACKEND_DIR, "alembic.ini")


def _run_migrations_on_engine(engine):
    """Apply all Alembic upgrade migrations to *engine* programmatically."""
    from alembic.config import Config
    from alembic import command

    cfg = Config(ALEMBIC_INI)
    cfg.set_main_option("sqlalchemy.url", str(engine.url))

    # Inject the connection so env.py reuses our in-memory SQLite engine
    # (must stay open for the duration — inspecting the same engine after works)
    with engine.connect() as conn:
        cfg.attributes["connection"] = conn
        command.upgrade(cfg, "head")
        conn.commit()          # flush WAL so the inspector can see the tables


def _get_migrated_schema(engine):
    """Return {table_name: set(column_names)} for every table in *engine*."""
    inspector = sa_inspect(engine)
    return {
        t: {c["name"] for c in inspector.get_columns(t)}
        for t in inspector.get_table_names()
        if t != "alembic_version"  # skip Alembic's bookkeeping table
    }


def _get_model_schema():
    """Return {table_name: set(column_names)} from Base.metadata."""
    # models.py is already imported by conftest, but import explicitly here
    # to be self-contained.
    import models  # noqa
    from database import Base

    return {
        table_name: {col.name for col in table.columns}
        for table_name, table in Base.metadata.tables.items()
    }


# ---------------------------------------------------------------------------
# Test
# ---------------------------------------------------------------------------

@pytest.mark.migration
def test_migrations_cover_all_model_columns():
    """
    Every column that exists in models.py must be reachable via
    'alembic upgrade head' on a fresh database.

    Failure means: a column was added to models.py without writing a
    migration file.  Fix: create a new migration in alembic/versions/.
    """
    # Fresh isolated SQLite database — does not touch the test suite's DB
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
    )

    # Patch heavy deps so importing models / database doesn't blow up
    # (they're already patched by conftest, but this test may run standalone)
    _run_migrations_on_engine(engine)

    migrated = _get_migrated_schema(engine)
    model_schema = _get_model_schema()

    missing_tables = []
    missing_columns = []

    for table_name, model_cols in model_schema.items():
        if table_name not in migrated:
            missing_tables.append(table_name)
            continue
        migrated_cols = migrated[table_name]
        for col in model_cols:
            if col not in migrated_cols:
                missing_columns.append(f"{table_name}.{col}")

    problems = (
        [f"Missing table: {t}" for t in sorted(missing_tables)]
        + [f"Missing column: {c}" for c in sorted(missing_columns)]
    )

    assert not problems, (
        f"\n\nSchema drift detected — {len(problems)} item(s) in models.py "
        f"have no Alembic migration:\n\n"
        + "\n".join(f"  ✗ {p}" for p in problems)
        + "\n\nFix: create a new file in backend/alembic/versions/ that adds "
        "the missing tables/columns.\n"
    )


@pytest.mark.migration
def test_migrations_are_linearly_ordered():
    """
    Every migration must have exactly one down_revision (or None for the
    first).  Branched history causes 'alembic upgrade head' to be ambiguous.
    """
    from alembic.config import Config
    from alembic.script import ScriptDirectory

    cfg = Config(ALEMBIC_INI)
    script = ScriptDirectory.from_config(cfg)

    heads = script.get_heads()
    assert len(heads) == 1, (
        f"Alembic migration history has {len(heads)} heads ({heads!r}). "
        "There should be exactly 1. Merge the branches with "
        "'alembic merge heads'."
    )
