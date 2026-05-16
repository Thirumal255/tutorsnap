"""
Shared pytest fixtures for TutorSnap backend tests.

Strategy
--------
* Use an in-memory SQLite database (no real Postgres / Cloud SQL required).
* Patch `database.engine` / `database.SessionLocal` / `database.get_db` so
  every module that imports them gets the test DB.
* Patch external services (Claude, GCS, Google OAuth) with lightweight mocks.
* Create a TestClient wrapping the FastAPI `app`.

Each test function receives a fresh DB session to avoid state leakage.
"""

import os
import sys
import json
import pytest
from datetime import datetime, timedelta
from unittest.mock import MagicMock, patch

# ── 1. Minimal env vars so the app can be imported ───────────────────────────
os.environ.setdefault("DATABASE_URL", "sqlite:///:memory:")
os.environ.setdefault("JWT_SECRET", "test-secret-key-at-least-32-chars-long")
os.environ.setdefault("JWT_EXPIRY_HOURS", "24")
os.environ.setdefault("GOOGLE_CLIENT_ID", "test-google-client-id")
os.environ.setdefault("ANTHROPIC_API_KEY", "test-anthropic-key")
os.environ.setdefault("ADMIN_EMAILS", "admin@test.com")
os.environ.setdefault("USE_GCS", "false")
os.environ.setdefault("UPLOAD_DIR", "uploads_test")

# ── 2. Add backend/ to sys.path so bare imports work (e.g. `import models`) ──
BACKEND_DIR = os.path.dirname(os.path.dirname(__file__))
if BACKEND_DIR not in sys.path:
    sys.path.insert(0, BACKEND_DIR)

# ── 3. Patch heavy optional dependencies BEFORE app is imported ───────────────
#       This prevents ImportError when google-cloud-storage / PyMuPDF etc.
#       are not installed in the CI environment.

# Patch anthropic client so no real API calls are made
_mock_anthropic = MagicMock()
_mock_message = MagicMock()
_mock_message.content = [MagicMock(text='{"score":85,"feedback":"Good answer","confidence":"confident","missed_key_points":[]}')]
_mock_anthropic.Anthropic.return_value.messages.create.return_value = _mock_message
sys.modules.setdefault("anthropic", _mock_anthropic)

# Patch fitz (PyMuPDF) – not needed for API tests
_mock_fitz = MagicMock()
sys.modules.setdefault("fitz", _mock_fitz)

# Patch GCS
_mock_gcs = MagicMock()
sys.modules.setdefault("google.cloud.storage", _mock_gcs)
sys.modules.setdefault("google.cloud", MagicMock())

# ── 4. Create test SQLite engine ───────────────────────────────────────────────
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

TEST_DB_URL = "sqlite:///:memory:"
test_engine = create_engine(
    TEST_DB_URL,
    connect_args={"check_same_thread": False},
)
TestSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=test_engine)

# ── 5. Patch database module so the app uses our test engine ──────────────────
import database as _db_module

_db_module.engine = test_engine
_db_module.SessionLocal = TestSessionLocal


# ── 6. Import models and create all tables ────────────────────────────────────
import models  # noqa — registers all ORM classes with Base.metadata

# Patch the ingestion module's _client to avoid Anthropic calls
with patch.dict(sys.modules, {"anthropic": _mock_anthropic}):
    pass  # Already patched above

# Create tables on the test engine
_db_module.Base.metadata.create_all(bind=test_engine)

# ── 7. Import and configure the FastAPI app ───────────────────────────────────
# Suppress startup events that touch the real DB / real services
with patch("main.seed_settings"), patch("main.run_migrations"):
    import main as _main_module

app = _main_module.app


# ── 8. Fixtures ───────────────────────────────────────────────────────────────

@pytest.fixture(scope="function")
def db():
    """Return a fresh SQLAlchemy session; roll back after each test."""
    connection = test_engine.connect()
    transaction = connection.begin()
    session = TestSessionLocal(bind=connection)

    yield session

    session.close()
    transaction.rollback()
    connection.close()


@pytest.fixture(scope="function")
def client(db):
    """Return a FastAPI TestClient with the DB overridden."""
    from fastapi.testclient import TestClient

    def override_get_db():
        yield db

    app.dependency_overrides[_main_module.get_db] = override_get_db
    yield TestClient(app, raise_server_exceptions=False)
    app.dependency_overrides.clear()


# ── Helper: create a User row directly in DB ──────────────────────────────────

def make_user(
    db,
    email="student@test.com",
    name="Test Student",
    google_id="google-sub-001",
    role="student",
    grade=6,
    is_active=True,
    total_xp=0,
):
    from models import User

    user = User(
        email=email,
        name=name,
        google_id=google_id,
        role=role,
        grade=grade,
        is_active=is_active,
        total_xp=total_xp,
        weekly_xp=0,
        show_on_leaderboard=True,
        buddy_name="Buddy",
        buddy_avatar="robot",
        created_at=datetime.utcnow(),
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def make_jwt(user_id: int, email: str, role: str) -> str:
    """Create a JWT for the given user using the test JWT_SECRET."""
    import jwt as _jwt

    expiry_hours = int(os.getenv("JWT_EXPIRY_HOURS", 24))
    payload = {
        "user_id": user_id,
        "email": email,
        "role": role,
        "exp": datetime.utcnow() + timedelta(hours=expiry_hours),
        "iat": datetime.utcnow(),
    }
    return _jwt.encode(payload, os.getenv("JWT_SECRET"), algorithm="HS256")


def auth_headers(user) -> dict:
    """Return Authorization headers for the given user."""
    token = make_jwt(user.id, user.email, user.role)
    return {"Authorization": f"Bearer {token}"}


def make_book(db, subject="Mathematics", grade=6, title="Test Book"):
    from models import Book

    book = Book(
        title=title,
        subject=subject,
        grade=grade,
        filename="test.pdf",
        filepath="uploads_test/test.pdf",
        ingestion_status="done",
        chapter_count=1,
        topic_count=2,
    )
    db.add(book)
    db.commit()
    db.refresh(book)
    return book


def make_chapter(db, book_id, number=1, title="Chapter 1"):
    from models import Chapter

    ch = Chapter(
        book_id=book_id,
        chapter_number=number,
        title=title,
        page_start=1,
        page_end=20,
    )
    db.add(ch)
    db.commit()
    db.refresh(ch)
    return ch


def make_topic(db, chapter_id, number="1.1", title="Topic 1"):
    from models import Topic

    t = Topic(
        chapter_id=chapter_id,
        topic_number=number,
        title=title,
        key_concepts=["concept A", "concept B"],
        vocabulary=["word1", "word2"],
        difficulty_ceiling="L3",
        raw_content="This is the topic content about mathematics.",
    )
    db.add(t)
    db.commit()
    db.refresh(t)
    return t


def make_studied(db, student_name: str, topic_id: int):
    """Create a TopicMastery row with studied=True so /api/session/start is allowed."""
    from models import TopicMastery

    existing = db.query(TopicMastery).filter(
        TopicMastery.student_name == student_name,
        TopicMastery.topic_id == topic_id,
    ).first()
    if existing:
        existing.studied = True
        db.commit()
        return existing

    m = TopicMastery(
        student_name=student_name,
        topic_id=topic_id,
        studied=True,
        study_summary="Test study summary.",
    )
    db.add(m)
    db.commit()
    db.refresh(m)
    return m


def make_mastery(db, student_name: str, topic_id: int, mastery_level: str = "L2", studied: bool = True):
    """Create a TopicMastery row with mastery_level and studied set (chapter-completion gate)."""
    from models import TopicMastery

    existing = db.query(TopicMastery).filter(
        TopicMastery.student_name == student_name,
        TopicMastery.topic_id == topic_id,
    ).first()
    if existing:
        existing.mastery_level = mastery_level
        existing.studied = studied
        db.commit()
        return existing

    m = TopicMastery(
        student_name=student_name,
        topic_id=topic_id,
        mastery_level=mastery_level,
        studied=studied,
        total_sessions=2,  # > 1 so backfill gate treats this as a real prior session
    )
    db.add(m)
    db.commit()
    db.refresh(m)
    return m


def make_session(db, student_name, topic_id, user_id=None, status="active", level="L1"):
    from models import Session as SessionModel

    s = SessionModel(
        student_name=student_name,
        user_id=user_id,
        topic_id=topic_id,
        status=status,
        current_level=level,
        questions_asked=3,
        consecutive_confident=0,
        hint_tier=0,
        flagged_for_review=False,
    )
    db.add(s)
    db.commit()
    db.refresh(s)
    return s
