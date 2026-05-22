# noqa: trigger redeploy 2026-05-16
from fastapi import FastAPI, Depends, HTTPException, BackgroundTasks, UploadFile, File, Query, Form
import asyncio
import json
from concurrent.futures import ThreadPoolExecutor
_executor = ThreadPoolExecutor(max_workers=4)
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session
from sqlalchemy import func
from pydantic import BaseModel
from typing import Optional, Dict
from datetime import datetime, timedelta
import os
import shutil
from dotenv import load_dotenv
from storage import save_upload, save_upload_bytes, USE_GCS, BUCKET_NAME
from progress import set_book_progress

load_dotenv(override=True)

from database import get_db, SessionLocal, engine
import random
from concurrent.futures import ThreadPoolExecutor as _TPool, as_completed as _as_completed
from models import (
    Book, Chapter, Topic, Session as SessionModel, SessionTurn, TopicMastery,
    AppSettings, User, ParentStudentLink, Notification,
    WeeklyChallenge, WeeklyChallengeCompletion, ExamSession, QuestionBank,
    AIUsageLog,
)
from ingestion import run_ingestion
from auth import get_current_user, require_admin, require_parent, verify_google_token, create_jwt
from session_engine import (
    generate_question, assess_answer, get_hint, get_concept_explanation,
    get_session_summary, determine_next_action, get_start_level,
    generate_sub_question,
    LEVEL_GUIDE, LEVEL_ORDER,
)

app = FastAPI(title="TutorSnap API")

_DEFAULT_SETTINGS = [
    {"key": "max_questions_per_session", "value": "20"},
    {"key": "max_hint_tiers", "value": "5"},
    {"key": "session_timeout_minutes", "value": "30"},
]


@app.on_event("startup")
def seed_settings():
    db = SessionLocal()
    try:
        for s in _DEFAULT_SETTINGS:
            if not db.query(AppSettings).filter(AppSettings.key == s["key"]).first():
                db.add(AppSettings(key=s["key"], value=s["value"]))
        db.commit()
    finally:
        db.close()


@app.on_event("startup")
def run_migrations():
    """Apply any pending schema migrations that aren't handled by Alembic."""
    from sqlalchemy import text
    try:
        with engine.connect() as conn:
            # Widen topic_number — idempotent
            conn.execute(text(
                "ALTER TABLE topics ALTER COLUMN topic_number TYPE VARCHAR(200)"
            ))
            # Add new book fields if they don't exist — idempotent via IF NOT EXISTS
            conn.execute(text(
                "ALTER TABLE books ADD COLUMN IF NOT EXISTS toc_pages VARCHAR(20)"
            ))
            conn.execute(text(
                "ALTER TABLE books ADD COLUMN IF NOT EXISTS chapter_structure TEXT"
            ))
            conn.execute(text(
                "ALTER TABLE books ADD COLUMN IF NOT EXISTS chapter_limit INTEGER"
            ))
            # Two-phase session engine: store reference answer alongside each question
            conn.execute(text(
                "ALTER TABLE session_turns ADD COLUMN IF NOT EXISTS expected_key_points TEXT"
            ))
            conn.execute(text(
                "ALTER TABLE session_turns ADD COLUMN IF NOT EXISTS answer_format VARCHAR(30)"
            ))
            conn.execute(text(
                "ALTER TABLE session_turns ADD COLUMN IF NOT EXISTS missed_key_points TEXT"
            ))
            conn.execute(text(
                "ALTER TABLE sessions ADD COLUMN IF NOT EXISTS level_question_count INTEGER DEFAULT 0"
            ))
            # Study Mode columns
            conn.execute(text(
                "ALTER TABLE topic_mastery ADD COLUMN IF NOT EXISTS studied BOOLEAN DEFAULT FALSE"
            ))
            conn.execute(text(
                "ALTER TABLE topic_mastery ADD COLUMN IF NOT EXISTS study_summary TEXT"
            ))
            # question_bank table — added in task #6
            conn.execute(text("""
                CREATE TABLE IF NOT EXISTS question_bank (
                    id SERIAL PRIMARY KEY,
                    topic_id INTEGER NOT NULL REFERENCES topics(id),
                    level VARCHAR(5) NOT NULL,
                    question_text TEXT NOT NULL,
                    expected_key_points TEXT,
                    answer_format VARCHAR(30),
                    created_at TIMESTAMP DEFAULT NOW()
                )
            """))
            conn.execute(text(
                "CREATE INDEX IF NOT EXISTS ix_qbank_topic_level ON question_bank(topic_id, level)"
            ))

            # student_id FK — added in migration i9c3d4e5f6g7
            conn.execute(text(
                "ALTER TABLE topic_mastery ADD COLUMN IF NOT EXISTS student_id INTEGER REFERENCES users(id)"
            ))
            # Backfill student_id where still NULL
            conn.execute(text("""
                UPDATE topic_mastery
                SET student_id = (
                    SELECT id FROM users
                    WHERE users.name = topic_mastery.student_name
                    LIMIT 1
                )
                WHERE student_id IS NULL
            """))
            # Diagnostic pre-assessment columns — added in task #9
            conn.execute(text(
                "ALTER TABLE sessions ADD COLUMN IF NOT EXISTS diagnostic_phase BOOLEAN DEFAULT FALSE"
            ))
            conn.execute(text(
                "ALTER TABLE sessions ADD COLUMN IF NOT EXISTS diagnostic_turn INTEGER DEFAULT 0"
            ))
            # Streak columns — added in task #7
            conn.execute(text(
                "ALTER TABLE users ADD COLUMN IF NOT EXISTS streak_days INTEGER DEFAULT 0"
            ))
            conn.execute(text(
                "ALTER TABLE users ADD COLUMN IF NOT EXISTS streak_freeze_available BOOLEAN DEFAULT FALSE"
            ))
            conn.execute(text(
                "ALTER TABLE users ADD COLUMN IF NOT EXISTS streak_freeze_used_at TIMESTAMP"
            ))
            # SM-2 ease factor — added in task #24
            conn.execute(text(
                "ALTER TABLE topic_mastery ADD COLUMN IF NOT EXISTS ease_factor REAL DEFAULT 2.5"
            ))
            # AI usage log table — added in task #26
            conn.execute(text("""
                CREATE TABLE IF NOT EXISTS ai_usage_log (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    student_id INTEGER REFERENCES users(id),
                    endpoint TEXT NOT NULL,
                    model TEXT,
                    input_tokens INTEGER DEFAULT 0,
                    output_tokens INTEGER DEFAULT 0,
                    cost_usd REAL DEFAULT 0.0,
                    called_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            """))
            conn.commit()
            print("Migration: schema up to date")
    except Exception as e:
        print(f"Migration run_migrations failed (non-fatal): {e}")


_ALLOWED_ORIGINS = [
    "http://localhost:5173",
    "http://localhost:5174",
    os.getenv("FRONTEND_URL", ""),
    "capacitor://localhost",
    "http://localhost",
    "https://localhost",
]
ALLOWED_ORIGINS = [o for o in _ALLOWED_ORIGINS if o]

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

UPLOAD_DIR = os.getenv("UPLOAD_DIR", "uploads")
os.makedirs(UPLOAD_DIR, exist_ok=True)


# ─── Helpers ───────────────────────────────────────────────────────────────

def level_label(level: str) -> str:
    return {
        "L1": "Getting started", "L2": "Building up", "L3": "Practising",
        "L4": "Going deeper",    "L5": "Challenge mode",
    }.get(level, level)


def _get_setting(key: str, default: str, db: Session) -> str:
    row = db.query(AppSettings).filter(AppSettings.key == key).first()
    return row.value if row else default


def _user_dict(u: User) -> dict:
    return {
        "id": u.id, "email": u.email, "name": u.name, "role": u.role,
        "grade": u.grade, "avatar_url": u.avatar_url, "is_active": u.is_active,
        "created_at": u.created_at.isoformat() if u.created_at else None,
        "last_login_at": u.last_login_at.isoformat() if u.last_login_at else None,
        # Gamification
        "total_xp": u.total_xp or 0,
        "weekly_xp": u.weekly_xp or 0,
        "show_on_leaderboard": u.show_on_leaderboard if u.show_on_leaderboard is not None else False,
        "buddy_name": u.buddy_name or "Buddy",
        "buddy_avatar": u.buddy_avatar or "robot",
        "avatar_preset": u.avatar_preset or None,
    }


def _get_week_start() -> datetime:
    """Return Monday 00:00 UTC of the current week."""
    today = datetime.utcnow().date()
    monday = today - timedelta(days=today.weekday())
    return datetime(monday.year, monday.month, monday.day)


def _update_user_xp(db: Session, user_id: int, xp_amount: int) -> None:
    """Atomically add XP to a user's total and weekly totals (resetting weekly on new week)."""
    if xp_amount <= 0:
        return
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        return
    week_start = _get_week_start()
    if not user.weekly_xp_reset_at or user.weekly_xp_reset_at < week_start:
        user.weekly_xp = 0
        user.weekly_xp_reset_at = week_start
    user.total_xp = (user.total_xp or 0) + xp_amount
    user.weekly_xp = (user.weekly_xp or 0) + xp_amount
    # No commit here — caller commits


def _compute_streak(db: Session, user: User, today: "date | None" = None) -> int:
    """
    Compute a student's current streak with compassionate rules:
    - Weekend grace: Sat/Sun don't break an ongoing streak (skipping a weekend day
      is treated the same as having a session that day).
    - Streak freeze: if the user has streak_freeze_available and we detect a
      gap on a non-weekend day, consume the freeze (one-time protection) and
      continue counting.
    - Returns the new streak count and mutates user.streak_days /
      user.streak_freeze_available in place (caller must commit).
    """
    from datetime import date as _date
    _today = today or datetime.utcnow().date()

    # Fetch all distinct session dates in the last 365 days (generous window)
    cutoff = datetime.utcnow() - timedelta(days=365)
    rows = (
        db.query(SessionModel.started_at)
        .filter(SessionModel.user_id == user.id, SessionModel.started_at >= cutoff)
        .all()
    )
    session_dates: set[str] = {r[0].date().isoformat() for r in rows if r[0]}

    streak = 0
    freeze_used = False

    for i in range(365):
        d = _today - timedelta(days=i)
        d_str = d.isoformat()
        is_weekend = d.weekday() >= 5  # Saturday=5, Sunday=6

        if d_str in session_dates:
            streak += 1
        elif is_weekend:
            # Weekend grace — count as if active (only while streak is building)
            if streak > 0 or i == 0:
                streak += 1
        elif not freeze_used and user.streak_freeze_available:
            # Consume the freeze token for this missed weekday
            freeze_used = True
            user.streak_freeze_available = False
            user.streak_freeze_used_at = datetime.utcnow()
            streak += 1
        else:
            break  # genuine gap, stop

    # Award a new freeze token at every 7-day streak milestone (if none available)
    if streak > 0 and streak % 7 == 0 and not user.streak_freeze_available and not freeze_used:
        user.streak_freeze_available = True

    user.streak_days = streak
    return streak


def _student_stats(db: Session, user_id: int) -> dict:
    total = db.query(func.count(SessionModel.id)).filter(
        SessionModel.user_id == user_id
    ).scalar() or 0
    mastered = db.query(func.count(TopicMastery.id)).filter(
        TopicMastery.student_id == user_id,
        TopicMastery.mastery_level.in_(["L3", "L4", "L5"]),
    ).scalar() or 0
    flagged = db.query(func.count(TopicMastery.id)).filter(
        TopicMastery.student_id == user_id,
        TopicMastery.flagged_for_review == True,
    ).scalar() or 0
    return {"total_sessions": total, "topics_mastered": mastered, "flagged_topics": flagged}


def _notify_parents(db: Session, session, topic, student_user: Optional[User]):
    if not student_user:
        return
    links = db.query(ParentStudentLink).filter(
        ParentStudentLink.student_id == student_user.id
    ).all()
    for link in links:
        db.add(Notification(
            user_id=link.parent_id,
            type="flagged_for_review",
            title=f"{student_user.name} needs help with {topic.title}",
            body=(
                f"{student_user.name} used all available hints on '{topic.title}' "
                f"and may need some extra support."
            ),
            related_topic_id=topic.id,
            related_session_id=session.id,
        ))


_REVIEW_INTERVALS = {"L1": 1, "L2": 3, "L3": 7, "L4": 14, "L5": 21}


# ── SM-2 spaced-repetition helper (task #24) ──────────────────────────────────

def _sm2_update(mastery, knew_it: bool) -> None:
    """Apply the SM-2 algorithm to *mastery* in-place.

    SM-2 quality mapping:
      knew_it=True  → q=5 (perfect recall)
      knew_it=False → q=1 (complete failure)

    EF' = max(1.3, EF + 0.1 - (5-q)*(0.08 + (5-q)*0.02))
    Interval: reset to 1 if q<3; else I(1)=1, I(2)=6, I(n)=round(I(n-1)*EF').
    """
    q = 5 if knew_it else 1
    ef = mastery.ease_factor if mastery.ease_factor is not None else 2.5
    new_ef = max(1.3, ef + 0.1 - (5 - q) * (0.08 + (5 - q) * 0.02))
    if q < 3:
        new_interval = 1
    else:
        old_interval = mastery.review_interval_days or 1
        if old_interval <= 1:
            new_interval = 1
        elif old_interval <= 6:
            new_interval = 6
        else:
            new_interval = round(old_interval * new_ef)
    mastery.ease_factor = round(new_ef, 4)
    mastery.review_interval_days = min(new_interval, 90)  # cap at 90 days
    mastery.next_review_at = datetime.utcnow() + timedelta(days=mastery.review_interval_days)


# ── AI rate limiting (task #25) ───────────────────────────────────────────────
# In-memory; resets each day. For multi-process deploy, replace with Redis.

_AI_DAILY_LIMIT = int(os.getenv("AI_DAILY_LIMIT", "200"))
_ai_call_counts: dict[int, dict[str, int]] = {}  # {user_id: {date_str: count}}


def _check_ai_rate_limit(user_id: int) -> None:
    """Raise 429 if the student has exceeded their daily AI call budget."""
    today = datetime.utcnow().date().isoformat()
    user_map = _ai_call_counts.setdefault(user_id, {})
    # prune stale dates to prevent unbounded growth
    for d in list(user_map):
        if d != today:
            del user_map[d]
    count = user_map.get(today, 0)
    if count >= _AI_DAILY_LIMIT:
        raise HTTPException(
            status_code=429,
            detail=f"Daily AI limit of {_AI_DAILY_LIMIT} calls reached. Try again tomorrow.",
        )
    user_map[today] = count + 1


# ── AI cost logging (task #26) ────────────────────────────────────────────────

def _log_ai_usage(db: Session, student_id: int | None, endpoint: str, usage_list: list) -> None:
    """Persist AI usage records collected via *_usage_out* parameter."""
    for u in usage_list:
        db.add(AIUsageLog(
            student_id=student_id,
            endpoint=endpoint,
            model=u.get("model"),
            input_tokens=u.get("input_tokens", 0),
            output_tokens=u.get("output_tokens", 0),
            cost_usd=u.get("cost_usd", 0.0),
        ))
    # caller must commit


def _next_question(db: Session, topic, level: str, prev_qs: list[str],
                   recent_fmts: list[str] = None, study_summary: str = "") -> dict:
    """Try the question bank first; fall back to live generation."""
    from question_bank import draw_from_bank
    bank_q = draw_from_bank(db, topic.id, level, prev_qs)
    if bank_q:
        return bank_q
    return generate_question(topic, level, prev_qs,
                              recent_formats=recent_fmts or [], study_summary=study_summary)


def _update_mastery(db: Session, session, topic, flagged: bool = False):
    """Update TopicMastery after a session ends, applying SM-2 scheduling."""
    # Determine whether the student improved (level went up) for SM-2 quality
    level_order = ["L1", "L2", "L3", "L4", "L5"]
    level_idx = level_order.index(session.current_level) if session.current_level in level_order else 0

    mastery = db.query(TopicMastery).filter(
        TopicMastery.student_id == session.user_id,
        TopicMastery.topic_id == session.topic_id,
    ).first()

    if mastery:
        prev_idx = level_order.index(mastery.mastery_level) if mastery.mastery_level in level_order else 0
        knew_it = level_idx >= prev_idx  # maintained or improved = "knew it"
        mastery.mastery_level = session.current_level
        mastery.last_practiced_at = datetime.utcnow()
        mastery.total_sessions += 1
        _sm2_update(mastery, knew_it)
        if flagged or session.flagged_for_review:
            mastery.flagged_for_review = True
    else:
        # First session: seed SM-2 with level-based initial interval
        init_interval = _REVIEW_INTERVALS.get(session.current_level, 3)
        new_mastery = TopicMastery(
            student_id=session.user_id,
            student_name=session.student_name,
            topic_id=session.topic_id,
            mastery_level=session.current_level,
            last_practiced_at=datetime.utcnow(),
            total_sessions=1,
            flagged_for_review=flagged or session.flagged_for_review,
            next_review_at=datetime.utcnow() + timedelta(days=init_interval),
            review_interval_days=init_interval,
            ease_factor=2.5,
        )
        db.add(new_mastery)
    db.commit()


# ─── Pydantic request models ───────────────────────────────────────────────

class GoogleLoginRequest(BaseModel):
    credential: str

class StartSessionRequest(BaseModel):
    student_name: str
    topic_id: int

class AnswerRequest(BaseModel):
    session_id: int
    answer: str
    image_data: Optional[str] = None   # base64 JPEG from handwriting canvas

class SubQuestionRequest(BaseModel):
    session_id: int
    confusion_type: Optional[str] = None  # "formula" | "apply" | "concept" | None

class HintRequest(BaseModel):
    session_id: int

class EndSessionRequest(BaseModel):
    session_id: int

class UpdateGradeRequest(BaseModel):
    grade: int

class CreateStudentRequest(BaseModel):
    email: str
    name: str
    grade: Optional[int] = None

class CreateParentRequest(BaseModel):
    email: str
    name: str

class LinkStudentRequest(BaseModel):
    student_id: int

class ConfirmRequest(BaseModel):
    confirm: bool

class InitUploadRequest(BaseModel):
    title: str
    subject: str
    grade: int
    filename: str
    content_type: str = "application/pdf"
    toc_pages: Optional[str] = None          # e.g. "3-5"
    chapter_structure: Optional[str] = None  # e.g. "Chapter → Topic → Example → Exercise"
    chapter_limit: Optional[int] = None      # limit chapters for test runs


# ─── Phase B: Auth Routes ──────────────────────────────────────────────────

class DevLoginRequest(BaseModel):
    email: str

@app.post("/api/auth/dev-login")
def dev_login(req: DevLoginRequest, db: Session = Depends(get_db)):
    """Dev-only endpoint — returns 404 in production so it appears not to exist."""
    if os.getenv("ENVIRONMENT", "development").lower() == "production":
        raise HTTPException(status_code=404, detail="Not found")
    # Legacy flag also supported
    if os.getenv("DISABLE_DEV_LOGIN", "false").lower() == "true":
        raise HTTPException(status_code=404, detail="Not found")

    admin_emails = [e.strip() for e in os.getenv("ADMIN_EMAILS", "").split(",") if e.strip()]
    user = db.query(User).filter(User.email == req.email).first()
    if not user:
        role = "admin" if req.email in admin_emails else "student"
        user = User(
            google_id=f"dev_{req.email}",
            email=req.email,
            name=req.email.split("@")[0].replace(".", " ").title(),
            role=role,
        )
        db.add(user)
    user.last_login_at = datetime.utcnow()
    db.commit()
    db.refresh(user)
    token = create_jwt(user.id, user.email, user.role)
    return {"access_token": token, "token_type": "bearer", "user": _user_dict(user)}


@app.post("/api/auth/google")
def google_login(req: GoogleLoginRequest, db: Session = Depends(get_db)):
    try:
        info = verify_google_token(req.credential)
    except ValueError as e:
        raise HTTPException(status_code=401, detail=str(e))

    admin_emails = [e.strip() for e in os.getenv("ADMIN_EMAILS", "").split(",") if e.strip()]

    # Look up by google_id first, then by email (handles stub parents)
    user = db.query(User).filter(User.google_id == info["google_id"]).first()
    if not user:
        user = db.query(User).filter(User.email == info["email"]).first()
        if user and user.google_id.startswith("stub_"):
            user.google_id = info["google_id"]

    if not user:
        # Admin emails are always allowed and auto-created
        if info["email"] in admin_emails:
            user = User(
                google_id=info["google_id"],
                email=info["email"],
                name=info["name"],
                avatar_url=info.get("avatar_url"),
                role="admin",
            )
            db.add(user)
        else:
            # All other users must be pre-registered by admin
            raise HTTPException(
                status_code=403,
                detail="Account not registered. Please ask your administrator to add you."
            )
    else:
        user.name = info["name"]
        # Only overwrite avatar_url with Google's photo if the user hasn't
        # set a custom profile picture (custom uploads are non-Google URLs).
        google_url = info.get("avatar_url") or ""
        existing_url = user.avatar_url or ""
        is_google_url = "googleusercontent.com" in existing_url or not existing_url
        if is_google_url:
            user.avatar_url = google_url or None

    user.last_login_at = datetime.utcnow()
    db.commit()
    db.refresh(user)

    if not user.is_active:
        raise HTTPException(status_code=403, detail="Account deactivated")

    token = create_jwt(user.id, user.email, user.role)
    requires_setup = user.role == "student" and user.grade is None

    return {
        "access_token": token,
        "token_type": "bearer",
        "user": _user_dict(user),
        "requires_setup": requires_setup,
    }


@app.get("/api/auth/me")
def get_me(current_user: User = Depends(get_current_user)):
    return _user_dict(current_user)


@app.post("/api/auth/logout")
def logout():
    return {"message": "Logged out"}


# ─── Phase C: Updated existing routes (with auth) ─────────────────────────

@app.post("/api/upload")
async def upload_pdf(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    title: str = Form(...),
    subject: str = Form(...),
    grade: int = Form(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    if not file.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Only PDF files are accepted")

    # Read file bytes eagerly so they're available in the thread
    file_content = await file.read()

    # Create book record first so we have an ID for progress tracking
    book = Book(
        title=title.strip(),
        subject=subject.strip(),
        grade=grade,
        filename=file.filename,
        filepath="pending",          # placeholder until GCS upload completes
        ingestion_status="pending",
        upload_stage="uploading",
        upload_progress=0,
    )
    db.add(book)
    db.commit()
    db.refresh(book)
    book_id = book.id

    # Upload to GCS in thread pool (non-blocking), with live progress tracking
    try:
        loop = asyncio.get_event_loop()
        filepath = await loop.run_in_executor(
            _executor,
            lambda: save_upload_bytes(file_content, file.filename, book_id=book_id)
        )
    except Exception as e:
        book.ingestion_status = "failed"
        book.upload_stage = "failed"
        book.ingestion_error = f"File upload failed: {e}"
        db.commit()
        raise HTTPException(status_code=500, detail=f"Failed to save file: {e}")

    # Update filepath and kick off ingestion
    book.filepath = filepath
    book.upload_stage = "reading"
    book.upload_progress = 30
    db.commit()

    background_tasks.add_task(run_ingestion, book_id, filepath)

    return {"book_id": book_id, "filename": book.filename, "title": book.title,
            "status": "processing", "message": "Upload successful. Ingestion started."}


@app.post("/api/upload/init")
def init_upload(
    req: InitUploadRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    """
    Step 1 of direct-to-GCS upload.
    Creates a Book record and returns a signed URL the browser can PUT the file to directly,
    bypassing Cloud Run's 32 MB request-body limit.
    """
    if not req.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Only PDF files are accepted")

    # Sanitise filename to avoid collisions
    import re, uuid
    safe_name = re.sub(r"[^a-zA-Z0-9._-]", "_", req.filename)
    unique_name = f"{uuid.uuid4().hex}_{safe_name}"

    book = Book(
        title=req.title.strip(),
        subject=req.subject.strip(),
        grade=req.grade,
        filename=unique_name,
        filepath="pending",
        ingestion_status="pending",
        upload_stage="uploading",
        upload_progress=0,
        toc_pages=req.toc_pages.strip() if req.toc_pages else None,
        chapter_structure=req.chapter_structure.strip() if req.chapter_structure else None,
        chapter_limit=req.chapter_limit if req.chapter_limit and req.chapter_limit > 0 else None,
    )
    db.add(book)
    db.commit()
    db.refresh(book)

    upload_url = None
    if USE_GCS:
        from storage import generate_upload_signed_url
        upload_url = generate_upload_signed_url(unique_name, content_type=req.content_type)

    return {
        "book_id": book.id,
        "upload_url": upload_url,
        "gcs_path": f"gs://{BUCKET_NAME}/uploads/{unique_name}",
        "use_signed_url": USE_GCS,
    }


@app.post("/api/upload/complete/{book_id}")
def complete_upload(
    book_id: int,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    """
    Step 2 of direct-to-GCS upload.
    Called by the browser after the signed-URL PUT succeeds.
    Updates the book filepath and kicks off background ingestion.
    """
    book = db.query(Book).filter(Book.id == book_id).first()
    if not book:
        raise HTTPException(status_code=404, detail="Book not found")
    if book.filepath != "pending":
        raise HTTPException(status_code=400, detail="Upload already completed")

    filepath = f"gs://{BUCKET_NAME}/uploads/{book.filename}"
    book.filepath = filepath
    book.upload_stage = "reading"
    book.upload_progress = 30
    db.commit()

    background_tasks.add_task(run_ingestion, book_id, filepath)
    return {"book_id": book_id, "status": "processing", "message": "Ingestion started."}


@app.post("/api/books/{book_id}/cancel")
def cancel_ingestion(
    book_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    """
    Marks a processing book as failed/cancelled.
    The background ingestion task checks this flag between chapter batches and stops gracefully.
    """
    book = db.query(Book).filter(Book.id == book_id).first()
    if not book:
        raise HTTPException(status_code=404, detail="Book not found")
    if book.ingestion_status not in ("processing", "pending"):
        raise HTTPException(status_code=400, detail="Book is not currently processing")
    book.ingestion_status = "failed"
    book.upload_stage = "failed"
    book.ingestion_error = "Cancelled by admin"
    db.commit()
    return {"ok": True, "message": "Cancellation requested. Processing will stop after the current chapter."}


@app.post("/api/books/{book_id}/retry")
def retry_ingestion(
    book_id: int,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    """
    Re-runs ingestion for a failed/cancelled book.
    Resumes from the last completed chapter (skips chapters already saved to DB),
    so no work is duplicated and the GCS file does not need to be re-uploaded.
    """
    book = db.query(Book).filter(Book.id == book_id).first()
    if not book:
        raise HTTPException(status_code=404, detail="Book not found")
    if book.ingestion_status == "processing":
        raise HTTPException(status_code=400, detail="Book is still processing — cancel it first")
    if not book.filepath or book.filepath == "pending":
        raise HTTPException(status_code=400, detail="No source file to retry from")

    book.ingestion_status = "processing"
    book.upload_stage = "reading"
    book.upload_progress = 30
    book.ingestion_error = None
    db.commit()

    background_tasks.add_task(run_ingestion, book_id, book.filepath)
    return {"ok": True, "book_id": book_id, "message": "Ingestion restarted from last checkpoint"}


@app.post("/api/books/{book_id}/generate-questions")
def trigger_question_bank(
    book_id: int,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    """
    Admin: pre-generate question bank (15 questions × level) for all topics in a book.
    Runs as a background task. Skips topic+level combos that already have ≥15 questions.
    """
    book = db.query(Book).filter(Book.id == book_id).first()
    if not book:
        raise HTTPException(status_code=404, detail="Book not found")
    if book.ingestion_status != "done":
        raise HTTPException(status_code=400, detail="Book must be fully ingested before generating questions")
    from question_bank import generate_for_book
    background_tasks.add_task(generate_for_book, book_id)
    return {"ok": True, "book_id": book_id, "message": "Question bank generation started in background"}


@app.get("/api/books/{book_id}/question-bank/status")
def question_bank_status(
    book_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    """Return question bank counts per topic and level for a book."""
    from sqlalchemy import func as sqlfunc
    book = db.query(Book).filter(Book.id == book_id).first()
    if not book:
        raise HTTPException(status_code=404, detail="Book not found")

    chapters = db.query(Chapter).filter(Chapter.book_id == book_id).all()
    topic_ids = [
        t.id for ch in chapters
        for t in db.query(Topic).filter(Topic.chapter_id == ch.id).all()
    ]
    if not topic_ids:
        return {"book_id": book_id, "total_questions": 0, "topics": []}

    rows = (
        db.query(QuestionBank.topic_id, QuestionBank.level, sqlfunc.count(QuestionBank.id))
        .filter(QuestionBank.topic_id.in_(topic_ids))
        .group_by(QuestionBank.topic_id, QuestionBank.level)
        .all()
    )
    total = sum(r[2] for r in rows)
    by_topic: dict[int, dict] = {}
    for topic_id, level, count in rows:
        by_topic.setdefault(topic_id, {})[level] = count

    return {
        "book_id": book_id,
        "total_questions": total,
        "topics": [{"topic_id": tid, "levels": lv} for tid, lv in by_topic.items()],
    }


@app.get("/api/ingestion/{book_id}")
def get_ingestion_status(
    book_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    book = db.query(Book).filter(Book.id == book_id).first()
    if not book:
        raise HTTPException(status_code=404, detail="Book not found")
    return {
        "book_id": book.id,
        "status": book.ingestion_status,
        "stage": book.upload_stage or ("done" if book.ingestion_status == "done" else "processing"),
        "progress": book.upload_progress or (100 if book.ingestion_status == "done" else 0),
        "chapter_count": book.chapter_count,
        "topic_count": book.topic_count,
        "error": book.ingestion_error,
    }


@app.get("/api/books")
def get_books(
    grade: Optional[int] = Query(None, description="Filter books by grade"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    q = db.query(Book).filter(Book.ingestion_status == "done")
    if grade is not None:
        q = q.filter(Book.grade == grade)
    # Admins see all books including non-done ones
    if current_user.role == "admin":
        q = db.query(Book)
        if grade is not None:
            q = q.filter(Book.grade == grade)
    books = q.order_by(Book.created_at.desc()).all()
    return [{"book_id": b.id, "title": b.title or b.filename,
             "subject": b.subject, "grade": b.grade,
             "filename": b.filename, "status": b.ingestion_status,
             "chapter_count": b.chapter_count, "topic_count": b.topic_count,
             "created_at": b.created_at.isoformat() if b.created_at else None}
            for b in books]


@app.delete("/api/books/{book_id}")
def delete_book(
    book_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    book = db.query(Book).filter(Book.id == book_id).first()
    if not book:
        raise HTTPException(status_code=404, detail="Book not found")

    # Collect all topic IDs and chapter IDs for this book
    chapters = db.query(Chapter).filter(Chapter.book_id == book_id).all()
    chapter_ids = [ch.id for ch in chapters]
    topic_ids = [t.id for ch_id in chapter_ids
                 for t in db.query(Topic).filter(Topic.chapter_id == ch_id).all()]

    if topic_ids:
        # Collect session IDs referencing these topics
        session_ids = [s.id for s in
                       db.query(SessionModel).filter(SessionModel.topic_id.in_(topic_ids)).all()]

        # 1. Clear notifications that point to these topics or sessions
        db.query(Notification).filter(Notification.related_topic_id.in_(topic_ids)).delete(synchronize_session=False)
        if session_ids:
            db.query(Notification).filter(Notification.related_session_id.in_(session_ids)).delete(synchronize_session=False)

        # 2. Delete session turns
        if session_ids:
            db.query(SessionTurn).filter(SessionTurn.session_id.in_(session_ids)).delete(synchronize_session=False)

        # 3. Delete sessions
        db.query(SessionModel).filter(SessionModel.topic_id.in_(topic_ids)).delete(synchronize_session=False)

        # 4. Delete topic mastery records
        db.query(TopicMastery).filter(TopicMastery.topic_id.in_(topic_ids)).delete(synchronize_session=False)

        # 4b. Delete weekly challenge completions + challenges referencing these topics
        challenge_ids = [wc.id for wc in
                         db.query(WeeklyChallenge).filter(WeeklyChallenge.topic_id.in_(topic_ids)).all()]
        if challenge_ids:
            db.query(WeeklyChallengeCompletion).filter(
                WeeklyChallengeCompletion.challenge_id.in_(challenge_ids)
            ).delete(synchronize_session=False)
            db.query(WeeklyChallenge).filter(WeeklyChallenge.id.in_(challenge_ids)).delete(synchronize_session=False)

        # 5. Delete topics
        db.query(Topic).filter(Topic.id.in_(topic_ids)).delete(synchronize_session=False)

    # 6. Delete chapters
    if chapter_ids:
        db.query(Chapter).filter(Chapter.id.in_(chapter_ids)).delete(synchronize_session=False)

    # 7. Delete the book
    db.delete(book)
    db.commit()
    return {"message": f"Book {book_id} deleted"}


@app.get("/api/topics/{book_id}")
def get_topics(
    book_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    book = db.query(Book).filter(Book.id == book_id).first()
    if not book:
        raise HTTPException(status_code=404, detail="Book not found")

    chapters = (db.query(Chapter).filter(Chapter.book_id == book_id)
                .order_by(Chapter.chapter_number).all())

    # Pre-fetch mastery records for this student so we don't N+1
    mastery_map: dict[int, TopicMastery] = {}
    if current_user.role == "student":
        all_topic_ids = [
            t.id for ch in chapters
            for t in db.query(Topic).filter(Topic.chapter_id == ch.id).all()
        ]
        if all_topic_ids:
            records = db.query(TopicMastery).filter(
                TopicMastery.student_id == current_user.id,
                TopicMastery.topic_id.in_(all_topic_ids),
            ).all()
            mastery_map = {r.topic_id: r for r in records}

    chapters_data = []
    for ch in chapters:
        topics = db.query(Topic).filter(Topic.chapter_id == ch.id).order_by(Topic.id).all()
        topic_list = []
        for t in topics:
            m = mastery_map.get(t.id)
            topic_list.append({
                "id": t.id, "topic_number": t.topic_number, "title": t.title,
                "difficulty_ceiling": t.difficulty_ceiling,
                "key_concepts": t.key_concepts or [],
                "vocabulary": t.vocabulary or [],
                "mastery_level": m.mastery_level if m else None,
                "mastery_sessions": m.total_sessions if m else 0,
                "flagged_for_review": m.flagged_for_review if m else False,
                "last_practiced_at": m.last_practiced_at.isoformat() if m and m.last_practiced_at else None,
                "studied": m.studied if m else False,
            })
        chapters_data.append({
            "id": ch.id, "chapter_number": ch.chapter_number, "title": ch.title,
            "topics": topic_list,
        })

    return {"book_id": book.id, "subject": book.subject, "grade": book.grade,
            "status": book.ingestion_status, "chapters": chapters_data}


# ── Study Mode endpoints ─────────────────────────────────────────────────────

class StudyChatRequest(BaseModel):
    student_name: str
    messages: list[dict]          # [{role: "user"|"assistant", content: str}]

class StudyCompleteRequest(BaseModel):
    student_name: str
    study_summary: str            # compact summary generated by the frontend after study


@app.post("/api/topics/{topic_id}/explain")
def explain_topic(
    topic_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Generate a structured, friendly explanation of the topic scoped strictly to
    the textbook content. Returns the explanation text.
    """
    if current_user.role != "student":
        raise HTTPException(status_code=403, detail="Students only")

    topic = db.query(Topic).filter(Topic.id == topic_id).first()
    if not topic:
        raise HTTPException(status_code=404, detail="Topic not found")
    topic.chapter = db.query(Chapter).filter(Chapter.id == topic.chapter_id).first()

    from session_engine import build_topic_context, TOPIC_BOUNDARY_RULE, call_claude, get_subject_label, _SONNET
    subject_label = get_subject_label(topic)

    system = (
        f"You are Buddy, a friendly AI tutor for a {subject_label} student.\n"
        f"{TOPIC_BOUNDARY_RULE}\n"
        f"{build_topic_context(topic)}"
    )

    user = (
        "A student is about to study this topic for the first time. "
        "Generate a warm, clear, structured explanation covering ONLY the content in this topic. "
        "Use this exact structure:\n\n"
        "🔍 **What is it?** — A simple 1-2 sentence definition.\n\n"
        "💡 **Key Ideas** — Explain each key concept in plain language (one short paragraph each).\n\n"
        "📋 **How it works** — Step-by-step explanation (if procedural) or deeper breakdown.\n\n"
        "✏️ **Example** — One fully worked example from the textbook content.\n\n"
        "🧠 **Remember** — 2-3 bullet-point takeaways the student must not forget.\n\n"
        "Keep the tone warm and encouraging, like a friendly teacher. "
        "Use simple language appropriate for the student's grade. "
        "Do NOT use any knowledge beyond what is in the topic context above. "
        "End with: 'Got any questions? Ask me anything about this topic! 💬'"
    )

    explanation = call_claude(system, user, max_tokens=1200, model=_SONNET)
    return {"topic_id": topic_id, "topic_title": topic.title, "explanation": explanation}


_PRACTICE_NUDGE = (
    "\n\n---\n"
    "🎯 **Feeling confident?** You've been studying for a while — that's great! "
    "When you're ready, tap **Complete Study** to take a quick 2-question check "
    "and unlock **Practice Mode** for this topic. 💪"
)

@app.post("/api/topics/{topic_id}/study-chat")
def study_chat(
    topic_id: int,
    req: StudyChatRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Handle follow-up Q&A during Study Mode. Maintains conversation history.
    Uses Haiku for fast, conversational responses.

    Topic-lock: strictly scoped to the current topic's content.
    12-message nudge: after ≥12 messages, appends a prompt to move to Practice.
    """
    if current_user.role != "student":
        raise HTTPException(status_code=403, detail="Students only")

    topic = db.query(Topic).filter(Topic.id == topic_id).first()
    if not topic:
        raise HTTPException(status_code=404, detail="Topic not found")
    topic.chapter = db.query(Chapter).filter(Chapter.id == topic.chapter_id).first()

    from session_engine import build_topic_context, TOPIC_BOUNDARY_RULE, get_subject_label, _HAIKU
    import anthropic as _anthropic
    subject_label = get_subject_label(topic)

    system = (
        f"You are Buddy, a friendly AI tutor for a {subject_label} student in Study Mode.\n"
        f"{TOPIC_BOUNDARY_RULE}\n"
        f"{build_topic_context(topic)}\n\n"
        "STRICT TOPIC LOCK: You may ONLY discuss the content defined above for this specific topic. "
        f"The topic is: '{topic.title}'. "
        "If the student asks ANYTHING not directly covered in this topic (other subjects, unrelated topics, "
        "general knowledge, personal questions, homework help on other topics, etc.), you MUST respond "
        f"ONLY with: 'That's a great question! That's covered in a different topic — let's stay focused "
        f"on {topic.title} for now. 🎯 Do you have any questions about this topic?' "
        "Do not elaborate, do not answer the off-topic question, do not apologise excessively. "
        "Just redirect clearly and invite them back on-topic.\n\n"
        "The student is studying — not being tested. For on-topic questions: answer clearly and warmly. "
        "Keep responses concise (2-4 sentences) unless a longer explanation is clearly needed."
    )

    client = _anthropic.Anthropic(api_key=os.environ.get("ANTHROPIC_API_KEY", ""))
    resp = client.messages.create(
        model=_HAIKU,
        max_tokens=600,
        system=system,
        messages=req.messages[-10:],   # keep last 10 turns for context
    )
    reply = resp.content[0].text.strip()

    # After ≥12 messages (≈6 Q&A turns), nudge the student to move to Practice
    nudge = len(req.messages) >= 12
    if nudge:
        reply += _PRACTICE_NUDGE

    return {"reply": reply, "show_nudge": nudge}


@app.post("/api/topics/{topic_id}/study-complete")
def complete_study(
    topic_id: int,
    req: StudyCompleteRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Mark topic as studied and generate 2 quick-check questions.
    The student must pass both to unlock Practice.
    """
    if current_user.role != "student":
        raise HTTPException(status_code=403, detail="Students only")

    topic = db.query(Topic).filter(Topic.id == topic_id).first()
    if not topic:
        raise HTTPException(status_code=404, detail="Topic not found")
    topic.chapter = db.query(Chapter).filter(Chapter.id == topic.chapter_id).first()

    # Upsert mastery record and save study_summary
    mastery = db.query(TopicMastery).filter(
        TopicMastery.student_id == current_user.id,
        TopicMastery.topic_id == topic_id,
    ).first()
    if not mastery:
        mastery = TopicMastery(student_id=current_user.id, student_name=current_user.name, topic_id=topic_id, mastery_level="L1")
        db.add(mastery)
        db.flush()

    mastery.study_summary = req.study_summary[:1500]   # cap at 1500 chars
    db.commit()

    # Generate 2 quick-check L1 recall questions from what was studied
    from session_engine import generate_question
    q1 = generate_question(topic, "L1", [], study_summary=req.study_summary)
    q2 = generate_question(topic, "L1", [q1["question"]], study_summary=req.study_summary)

    return {
        "topic_id": topic_id,
        "check_questions": [
            {"id": 1, **q1},
            {"id": 2, **q2},
        ],
    }


@app.post("/api/topics/{topic_id}/study-unlock")
def unlock_practice(
    topic_id: int,
    req: StudyCompleteRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Called after the student passes the 2 quick-check questions.
    Sets studied=True so Practice is unlocked.
    Awards +10 XP for completing Study Mode.
    """
    if current_user.role != "student":
        raise HTTPException(status_code=403, detail="Students only")

    mastery = db.query(TopicMastery).filter(
        TopicMastery.student_id == current_user.id,
        TopicMastery.topic_id == topic_id,
    ).first()
    if not mastery:
        raise HTTPException(status_code=404, detail="No study record found")

    mastery.studied = True
    db.commit()

    # Award XP for completing Study Mode
    user = db.query(User).filter(User.id == current_user.id).first()
    if user:
        user.total_xp = (user.total_xp or 0) + 10
        db.commit()

    return {"unlocked": True, "xp_awarded": 10}


@app.post("/api/session/start")
def start_session(
    req: StartSessionRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if current_user.role != "student":
        raise HTTPException(status_code=403, detail="Only students can start sessions")
    if not req.student_name.strip():
        raise HTTPException(status_code=400, detail="student_name is required")

    topic = db.query(Topic).filter(Topic.id == req.topic_id).first()
    if not topic:
        raise HTTPException(status_code=404, detail="Topic not found")

    chapter = db.query(Chapter).filter(Chapter.id == topic.chapter_id).first()
    topic.chapter = chapter

    mastery = db.query(TopicMastery).filter(
        TopicMastery.student_id == current_user.id,
        TopicMastery.topic_id == req.topic_id,
    ).first()
    just_created = False
    if not mastery:
        mastery = TopicMastery(student_id=current_user.id, student_name=req.student_name, topic_id=req.topic_id, mastery_level="L1")
        db.add(mastery)
        db.commit()
        db.refresh(mastery)
        just_created = True

    # Study Mode gate — student must study at least once before practising.
    # Exception: if they already have prior sessions (practiced before the study
    # gate was introduced), backfill studied=True and let them through.
    # total_sessions defaults to 1 when the record is first created at session
    # start; a completed session increments it to ≥2, so > 1 reliably identifies
    # students who genuinely practiced before the gate existed.
    if not mastery.studied:
        if not just_created and mastery.total_sessions > 1:
            mastery.studied = True
            db.commit()
        else:
            raise HTTPException(status_code=403, detail="study_required")

    # Trigger diagnostic pre-assessment on the very first practice session
    # (mastery.total_sessions == 1 means study was done but no practice yet)
    is_first_practice = (mastery.total_sessions == 1)
    start_level = "L1" if is_first_practice else get_start_level(mastery.mastery_level)

    session = SessionModel(
        student_name=req.student_name,
        user_id=current_user.id,
        topic_id=req.topic_id,
        current_level=start_level,
        status="active",
        diagnostic_phase=is_first_practice,
        diagnostic_turn=1 if is_first_practice else 0,
    )
    db.add(session)
    db.commit()
    db.refresh(session)

    prev_sessions = db.query(SessionModel).filter(
        SessionModel.user_id == current_user.id,
        SessionModel.topic_id == req.topic_id,
        SessionModel.id != session.id,
    ).all()
    previous_questions = []
    if prev_sessions:
        prev_turns = (db.query(SessionTurn)
                      .filter(SessionTurn.session_id.in_([s.id for s in prev_sessions]))
                      .order_by(SessionTurn.created_at.desc()).limit(10).all())
        previous_questions = [t.question_text for t in prev_turns]

    # Try question bank first; fall back to live generation
    q = _next_question(db, topic, start_level, previous_questions, [], mastery.study_summary or "")
    db.add(SessionTurn(
        session_id=session.id, turn_number=1,
        question_text=q["question"], level=start_level,
        expected_key_points=json.dumps(q["expected_key_points"]),
        answer_format=q["answer_format"],
    ))
    session.questions_asked = 1
    db.commit()

    if is_first_practice:
        intro = (
            f"Before we start, I'll ask you **3 quick questions** to find the best level for you. "
            f"Don't worry — there's no pressure! Just do your best. 😊\n\n"
            f"**Question 1 of 3:** {q['question']}"
        )
    else:
        intro = f"Hi {req.student_name}! Let's practise {topic.title}.\n\n{q['question']}"

    return {
        "session_id": session.id, "topic_title": topic.title,
        "chapter_title": chapter.title if chapter else "",
        "student_name": req.student_name, "current_level": start_level,
        "level_label": level_label(start_level),
        "message": intro,
        "answer_format": q["answer_format"],
        "show_hint_button": False, "turn_number": 1,
        "diagnostic": is_first_practice,
        "diagnostic_turn": 1 if is_first_practice else 0,
        "diagnostic_total": 3,
    }


@app.post("/api/session/answer")
def submit_answer(
    req: AnswerRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    # Rate limit: students only (admins/parents not restricted)
    if current_user.role == "student":
        _check_ai_rate_limit(current_user.id)

    session = db.query(SessionModel).filter(SessionModel.id == req.session_id).first()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    if session.status == "completed":
        raise HTTPException(status_code=400, detail="Session already completed")
    if session.user_id and session.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="Not your session")
    if not req.answer.strip():
        raise HTTPException(status_code=400, detail="Answer cannot be empty")

    topic = db.query(Topic).filter(Topic.id == session.topic_id).first()
    topic.chapter = db.query(Chapter).filter(Chapter.id == topic.chapter_id).first()

    _mastery = db.query(TopicMastery).filter(
        TopicMastery.student_id == session.user_id,
        TopicMastery.topic_id == session.topic_id,
    ).first()
    _study_summary = (_mastery.study_summary or "") if _mastery else ""

    current_turn = (db.query(SessionTurn).filter(SessionTurn.session_id == session.id)
                    .order_by(SessionTurn.turn_number.desc()).first())

    ekp = json.loads(current_turn.expected_key_points) if current_turn.expected_key_points else None
    _usage: list = []
    assessment = assess_answer(
        topic, current_turn.question_text, req.answer,
        session.current_level, session.hint_tier,
        expected_key_points=ekp,
        answer_format=current_turn.answer_format,
        image_data=req.image_data or None,
        _usage_out=_usage,
    )
    _log_ai_usage(db, current_user.id, "submit_answer", _usage)

    current_turn.student_answer = req.answer
    current_turn.assessment_score = assessment["score"]
    current_turn.confidence_tag = assessment["confidence_tag"]
    current_turn.hint_tier_used = session.hint_tier
    current_turn.missed_key_points = json.dumps(assessment.get("missed_key_points") or [])
    db.commit()

    # ── Diagnostic pre-assessment branch ─────────────────────────────────────
    if session.diagnostic_phase:
        _DIAG_LEVELS = ["L1", "L2", "L3"]
        scored_pass = assessment["score"] >= 60

        if session.diagnostic_turn < 3:
            # Move to next diagnostic level
            next_diag_turn = session.diagnostic_turn + 1
            next_diag_level = _DIAG_LEVELS[next_diag_turn - 1] if next_diag_turn <= 3 else "L3"
            # Cap at topic difficulty ceiling
            ceiling = getattr(topic, "difficulty_ceiling", None) or "L3"
            try:
                ceil_idx = LEVEL_ORDER.index(ceiling)
                diag_level_idx = LEVEL_ORDER.index(next_diag_level)
                next_diag_level = LEVEL_ORDER[min(diag_level_idx, ceil_idx)]
            except ValueError:
                pass

            session.diagnostic_turn = next_diag_turn
            session.current_level = next_diag_level

            prev_qs = [t.question_text for t in
                       db.query(SessionTurn).filter(SessionTurn.session_id == session.id).all()]
            nq = _next_question(db, topic, next_diag_level, prev_qs, [], _study_summary)
            new_turn_number = current_turn.turn_number + 1
            db.add(SessionTurn(
                session_id=session.id, turn_number=new_turn_number,
                question_text=nq["question"], level=next_diag_level,
                expected_key_points=json.dumps(nq["expected_key_points"]),
                answer_format=nq["answer_format"],
            ))
            session.questions_asked += 1
            db.commit()

            brief = "✅ Got it!" if scored_pass else "Thanks for trying!"
            next_q_msg = (
                f"{brief}\n\n"
                f"**Question {next_diag_turn} of 3:** {nq['question']}"
            )
            return {
                "session_id": session.id,
                "feedback": brief,
                "score": assessment["score"],
                "confidence_tag": assessment["confidence_tag"],
                "action": "diagnostic_next",
                "diagnostic": True,
                "diagnostic_turn": next_diag_turn,
                "diagnostic_total": 3,
                "current_level": next_diag_level,
                "level_label": level_label(next_diag_level),
                "next_question": next_q_msg,
                "answer_format": nq["answer_format"],
                "show_hint_button": False,
                "session_complete": False,
                "xp_earned": 0,
                "turn_number": new_turn_number,
            }
        else:
            # All 3 diagnostic questions answered — compute placement
            diag_turns = (db.query(SessionTurn)
                          .filter(SessionTurn.session_id == session.id)
                          .order_by(SessionTurn.turn_number)
                          .limit(3).all())
            scores = [t.assessment_score or 0 for t in diag_turns]
            passed = [s >= 60 for s in scores]  # [L1_ok, L2_ok, L3_ok]

            if passed[2]:   # all 3 or at least L3 passed
                placement = "L3"
            elif passed[1]: # L1 + L2 passed
                placement = "L2"
            else:           # only L1 (or none)
                placement = "L1"

            # Cap at topic ceiling
            ceiling = getattr(topic, "difficulty_ceiling", None) or "L3"
            try:
                ceil_idx = LEVEL_ORDER.index(ceiling)
                pl_idx = LEVEL_ORDER.index(placement)
                placement = LEVEL_ORDER[min(pl_idx, ceil_idx)]
            except ValueError:
                pass

            session.diagnostic_phase = False
            session.diagnostic_turn = 0
            session.current_level = placement
            session.questions_asked += 1  # count this last diagnostic turn

            # First real question at placement level
            prev_qs = [t.question_text for t in
                       db.query(SessionTurn).filter(SessionTurn.session_id == session.id).all()]
            nq = _next_question(db, topic, placement, prev_qs, [], _study_summary)
            new_turn_number = current_turn.turn_number + 1
            db.add(SessionTurn(
                session_id=session.id, turn_number=new_turn_number,
                question_text=nq["question"], level=placement,
                expected_key_points=json.dumps(nq["expected_key_points"]),
                answer_format=nq["answer_format"],
            ))
            db.commit()

            placement_msg = {
                "L1": "I'll start you at **Level 1** — let's build a solid foundation! 💪",
                "L2": "Great — I'll start you at **Level 2**! You've got a good base. 🚀",
                "L3": "Impressive! I'll start you at **Level 3** — you clearly know your stuff! ⭐",
            }.get(placement, f"Starting at **{level_label(placement)}**.")

            return {
                "session_id": session.id,
                "feedback": placement_msg,
                "score": assessment["score"],
                "confidence_tag": assessment["confidence_tag"],
                "action": "diagnostic_done",
                "diagnostic": False,
                "diagnostic_turn": 3,
                "diagnostic_total": 3,
                "placement_level": placement,
                "current_level": placement,
                "level_label": level_label(placement),
                "next_question": nq["question"],
                "answer_format": nq["answer_format"],
                "show_hint_button": False,
                "session_complete": False,
                "xp_earned": 0,
                "turn_number": new_turn_number,
            }
    # ── End diagnostic branch ─────────────────────────────────────────────────

    next_action = determine_next_action(
        session, assessment["confidence_tag"], topic,
        raw_score=assessment["score"],
    )
    db.commit()

    # ── XP awards ─────────────────────────────────────────────────────────────
    xp_earned = 0
    if session.user_id:
        action = next_action["action"]
        if action == "session_complete":
            xp_earned = 100
        elif action == "advance_level":
            xp_earned = 50
        elif action == "next_question" and assessment.get("score", 0) >= 80:
            xp_earned = 10
        if xp_earned > 0:
            _update_user_xp(db, session.user_id, xp_earned)

    if next_action["action"] == "session_complete":
        session.ended_at = datetime.utcnow()
        session.status = "completed"
        session.final_confidence = assessment["confidence_tag"]
        _update_mastery(db, session, topic)
        turns = db.query(SessionTurn).filter(SessionTurn.session_id == session.id).all()
        summary = get_session_summary(session, topic, turns)
        db.commit()
        return {"session_id": session.id, "feedback": assessment["feedback"],
                "score": assessment["score"], "confidence_tag": assessment["confidence_tag"],
                "action": "session_complete", "current_level": session.current_level,
                "level_label": level_label(session.current_level), "show_hint_button": False,
                "session_complete": True, "summary": summary,
                "turn_number": current_turn.turn_number, "xp_earned": xp_earned}

    next_question = None
    next_answer_format = None
    concept_explanation = None
    new_turn_number = current_turn.turn_number

    # Helper: last 3 answer formats in this session (for variety enforcement)
    def _recent_formats():
        recent = (db.query(SessionTurn.answer_format)
                  .filter(SessionTurn.session_id == session.id,
                          SessionTurn.answer_format != None)
                  .order_by(SessionTurn.turn_number.desc())
                  .limit(3).all())
        return [r[0] for r in recent]

    if next_action["action"] == "retry_question":
        next_question = current_turn.question_text
        next_answer_format = current_turn.answer_format

    elif next_action["action"] == "level_cap_reset":
        # Student stuck at this level — give concept explanation then a fresh question
        concept_explanation = get_concept_explanation(topic, current_turn.question_text)
        prev_qs = [t.question_text for t in
                   db.query(SessionTurn).filter(SessionTurn.session_id == session.id).all()]
        nq = _next_question(db, topic, session.current_level, prev_qs, _recent_formats(),
                            _study_summary)
        next_question = nq["question"]
        next_answer_format = nq["answer_format"]
        new_turn_number = current_turn.turn_number + 1
        db.add(SessionTurn(
            session_id=session.id, turn_number=new_turn_number,
            question_text=nq["question"], level=session.current_level,
            expected_key_points=json.dumps(nq["expected_key_points"]),
            answer_format=nq["answer_format"],
        ))
        session.questions_asked += 1
        db.commit()

    elif next_action["action"] in ("advance_level", "next_question"):
        prev_qs = [t.question_text for t in
                   db.query(SessionTurn).filter(SessionTurn.session_id == session.id).all()]
        nq = _next_question(db, topic, session.current_level, prev_qs, _recent_formats(),
                            _study_summary)
        next_question = nq["question"]
        next_answer_format = nq["answer_format"]
        new_turn_number = current_turn.turn_number + 1
        db.add(SessionTurn(
            session_id=session.id, turn_number=new_turn_number,
            question_text=nq["question"], level=session.current_level,
            expected_key_points=json.dumps(nq["expected_key_points"]),
            answer_format=nq["answer_format"],
        ))
        session.questions_asked += 1
        db.commit()

    db.commit()
    return {"session_id": session.id, "feedback": assessment["feedback"],
            "score": assessment["score"], "confidence_tag": assessment["confidence_tag"],
            "action": next_action["action"], "current_level": session.current_level,
            "level_label": level_label(session.current_level),
            "show_hint_button": next_action.get("show_hint_button", False),
            "session_complete": False, "next_question": next_question,
            "concept_explanation": concept_explanation, "xp_earned": xp_earned,
            "answer_format": next_answer_format,
            "turn_number": new_turn_number}


@app.post("/api/session/sub-question")
def request_sub_question(
    req: SubQuestionRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Generate a simpler stepping-stone question when a student is stuck."""
    session = db.query(SessionModel).filter(SessionModel.id == req.session_id).first()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    if session.user_id and session.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="Not your session")

    topic = db.query(Topic).filter(Topic.id == session.topic_id).first()
    topic.chapter = db.query(Chapter).filter(Chapter.id == topic.chapter_id).first()

    current_turn = (db.query(SessionTurn).filter(SessionTurn.session_id == session.id)
                    .order_by(SessionTurn.turn_number.desc()).first())

    original_question = current_turn.question_text if current_turn else "the current question"

    try:
        sub_q = generate_sub_question(topic, original_question, req.confusion_type)
    except Exception:
        sub_q = "Let's try a simpler step first — can you recall the key rule for this topic?"

    return {"sub_question": sub_q}


@app.post("/api/session/hint")
def request_hint(
    req: HintRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    session = db.query(SessionModel).filter(SessionModel.id == req.session_id).first()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    if session.status == "completed":
        raise HTTPException(status_code=400, detail="Session already completed")
    if session.user_id and session.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="Not your session")

    topic = db.query(Topic).filter(Topic.id == session.topic_id).first()
    topic.chapter = db.query(Chapter).filter(Chapter.id == topic.chapter_id).first()

    current_turn = (db.query(SessionTurn).filter(SessionTurn.session_id == session.id)
                    .order_by(SessionTurn.turn_number.desc()).first())

    session.hint_tier += 1
    max_hints = int(_get_setting("max_hint_tiers", os.getenv("MAX_HINT_TIERS", "5"), db))

    # Collect recent formats for variety enforcement when generating the fresh question
    recent_hint_formats = [r[0] for r in (
        db.query(SessionTurn.answer_format)
        .filter(SessionTurn.session_id == session.id, SessionTurn.answer_format != None)
        .order_by(SessionTurn.turn_number.desc()).limit(3).all()
    )]

    if session.hint_tier > max_hints and not session.concept_reset_done:
        session.concept_reset_done = True
        explanation = get_concept_explanation(topic, current_turn.question_text)
        prev_qs = [t.question_text for t in
                   db.query(SessionTurn).filter(SessionTurn.session_id == session.id).all()]
        fq = _next_question(db, topic, session.current_level, prev_qs, recent_hint_formats,
                            _study_summary)
        new_turn_number = current_turn.turn_number + 1
        db.add(SessionTurn(
            session_id=session.id, turn_number=new_turn_number,
            question_text=fq["question"], level=session.current_level,
            expected_key_points=json.dumps(fq["expected_key_points"]),
            answer_format=fq["answer_format"],
        ))
        session.hint_tier = 0
        session.questions_asked += 1
        db.commit()
        return {"session_id": session.id, "hint_message": explanation,
                "hint_tier": max_hints + 1, "is_final_hint": False,
                "is_concept_reset": True, "flagged": False,
                "fresh_question": fq["question"], "answer_format": fq["answer_format"]}

    if session.hint_tier > max_hints and session.concept_reset_done:
        session.flagged_for_review = True
        _update_mastery(db, session, topic, flagged=True)
        session.status = "completed"
        session.ended_at = datetime.utcnow()
        student_user = (db.query(User).filter(User.id == session.user_id).first()
                        if session.user_id else None)
        _notify_parents(db, session, topic, student_user)
        db.commit()
        return {"session_id": session.id,
                "hint_message": "You've done great trying today! Let's revisit this topic with your teacher.",
                "hint_tier": session.hint_tier, "is_final_hint": True,
                "is_concept_reset": False, "flagged": True, "fresh_question": None}

    # Pass missed_key_points so the hint can address the specific gap
    missed_kp = json.loads(current_turn.missed_key_points) if current_turn.missed_key_points else None
    hint_text = get_hint(
        topic, current_turn.question_text,
        current_turn.student_answer or "", session.hint_tier,
        missed_key_points=missed_kp,
    )
    db.commit()
    return {"session_id": session.id, "hint_message": hint_text,
            "hint_tier": session.hint_tier, "is_final_hint": session.hint_tier >= max_hints,
            "is_concept_reset": False, "flagged": False, "fresh_question": None}


@app.post("/api/session/end")
def end_session(
    req: EndSessionRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    session = db.query(SessionModel).filter(SessionModel.id == req.session_id).first()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    if session.user_id and session.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="Not your session")

    topic = db.query(Topic).filter(Topic.id == session.topic_id).first()
    topic.chapter = db.query(Chapter).filter(Chapter.id == topic.chapter_id).first()

    if session.status != "completed":
        last_turn = (db.query(SessionTurn).filter(SessionTurn.session_id == session.id)
                     .order_by(SessionTurn.turn_number.desc()).first())
        session.status = "completed"
        session.ended_at = datetime.utcnow()
        session.final_confidence = (last_turn.confidence_tag
                                    if last_turn and last_turn.confidence_tag else "shaky")
        _update_mastery(db, session, topic)
        db.commit()

    turns = db.query(SessionTurn).filter(SessionTurn.session_id == session.id).all()
    summary = get_session_summary(session, topic, turns)

    # ── XP breakdown (task #16) ────────────────────────────────────────────────
    answered_turns = [t for t in turns if t.student_answer and t.assessment_score is not None]

    # Per-answer XP: 10 pts for ≥80, 5 pts for 60–79, 0 for <60
    per_q_xp = sum(
        10 if (t.assessment_score or 0) >= 80 else
        5  if (t.assessment_score or 0) >= 60 else
        0
        for t in answered_turns
    )

    # Level-up bonus: compare previous mastery level vs reached level
    level_order = ["L1", "L2", "L3", "L4", "L5"]
    prev_mastery = db.query(TopicMastery).filter(
        TopicMastery.student_id == session.user_id,
        TopicMastery.topic_id == session.topic_id,
    ).first()
    prev_level = prev_mastery.mastery_level if prev_mastery else "L1"
    reached_level = session.current_level
    prev_idx = level_order.index(prev_level) if prev_level in level_order else 0
    reached_idx = level_order.index(reached_level) if reached_level in level_order else 0
    level_bonus = max(0, (reached_idx - prev_idx)) * 25  # 25 XP per level gained

    xp_display = per_q_xp + level_bonus
    xp_breakdown = []
    if per_q_xp > 0:
        xp_breakdown.append({"label": f"Answered {len(answered_turns)} question{'s' if len(answered_turns) != 1 else ''}", "xp": per_q_xp})
    if level_bonus > 0:
        levels_gained = reached_idx - prev_idx
        xp_breakdown.append({"label": f"Level{'s' if levels_gained > 1 else ''} up! ⬆", "xp": level_bonus})

    # Update persisted streak for the current user
    new_streak = _compute_streak(db, current_user)
    db.commit()

    return {"session_id": session.id, "student_name": session.student_name,
            "topic_title": topic.title, "level_reached": session.current_level,
            "level_label": level_label(session.current_level),
            "questions_asked": session.questions_asked, "summary": summary,
            "flagged_for_review": session.flagged_for_review,
            "xp_earned": xp_display,
            "xp_breakdown": xp_breakdown,
            "streak_days": new_streak,
            "streak_freeze_available": current_user.streak_freeze_available}


# ─── Phase C: Admin Routes ─────────────────────────────────────────────────

@app.post("/api/admin/students")
def admin_create_student(
    req: CreateStudentRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    existing = db.query(User).filter(User.email == req.email).first()
    if existing:
        existing.role = "student"
        if req.name:
            existing.name = req.name
        if req.grade:
            existing.grade = req.grade
        db.commit()
        db.refresh(existing)
        return _user_dict(existing)

    student = User(
        email=req.email,
        name=req.name,
        google_id=f"stub_{req.email}",
        role="student",
        grade=req.grade,
        is_active=True,
    )
    db.add(student)
    db.commit()
    db.refresh(student)
    return _user_dict(student)


@app.get("/api/admin/students")
def admin_get_students(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    students = db.query(User).filter(User.role == "student").order_by(User.name).all()
    result = []
    for s in students:
        stats = _student_stats(db, s.id)
        result.append({**_user_dict(s), **stats})
    return result


@app.get("/api/admin/students/{student_id}")
def admin_get_student(
    student_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    user = db.query(User).filter(User.id == student_id, User.role == "student").first()
    if not user:
        raise HTTPException(status_code=404, detail="Student not found")

    masteries = db.query(TopicMastery).filter(TopicMastery.student_id == user.id).all()
    topic_mastery_list = []
    for m in masteries:
        topic = db.query(Topic).filter(Topic.id == m.topic_id).first()
        chapter = db.query(Chapter).filter(Chapter.id == topic.chapter_id).first() if topic else None
        topic_mastery_list.append({
            "topic_title": topic.title if topic else "",
            "chapter_title": chapter.title if chapter else "",
            "mastery_level": m.mastery_level, "level_label": level_label(m.mastery_level),
            "last_practiced_at": m.last_practiced_at.isoformat() if m.last_practiced_at else None,
            "total_sessions": m.total_sessions, "flagged_for_review": m.flagged_for_review,
            "last_hint_tier_needed": m.last_hint_tier_needed,
        })

    recent = (db.query(SessionModel).filter(SessionModel.user_id == user.id)
              .order_by(SessionModel.started_at.desc()).limit(10).all())
    recent_sessions = []
    for s in recent:
        t = db.query(Topic).filter(Topic.id == s.topic_id).first()
        recent_sessions.append({
            "id": s.id, "topic_title": t.title if t else "",
            "started_at": s.started_at.isoformat() if s.started_at else None,
            "ended_at": s.ended_at.isoformat() if s.ended_at else None,
            "current_level": s.current_level, "questions_asked": s.questions_asked,
            "status": s.status,
        })

    parent_links = db.query(ParentStudentLink).filter(ParentStudentLink.student_id == user.id).all()
    parent_names = []
    for link in parent_links:
        p = db.query(User).filter(User.id == link.parent_id).first()
        if p:
            parent_names.append(p.name)

    return {**_user_dict(user), "topic_mastery": topic_mastery_list,
            "recent_sessions": recent_sessions, "parent_names": parent_names}


@app.post("/api/admin/students/{student_id}/grade")
def admin_update_grade(
    student_id: int,
    req: UpdateGradeRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    user = db.query(User).filter(User.id == student_id, User.role == "student").first()
    if not user:
        raise HTTPException(status_code=404, detail="Student not found")
    user.grade = req.grade
    db.commit()
    db.refresh(user)
    return _user_dict(user)


@app.post("/api/admin/students/{student_id}/deactivate")
def admin_deactivate(
    student_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    user = db.query(User).filter(User.id == student_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    user.is_active = False
    db.commit()
    return {"message": "Student deactivated"}


@app.post("/api/admin/students/{student_id}/activate")
def admin_activate(
    student_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    user = db.query(User).filter(User.id == student_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    user.is_active = True
    db.commit()
    return {"message": "Student activated"}


@app.post("/api/admin/students/{student_id}/reset-mastery")
def admin_reset_mastery(
    student_id: int,
    req: ConfirmRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    if not req.confirm:
        raise HTTPException(status_code=400, detail="Confirmation required")
    user = db.query(User).filter(User.id == student_id, User.role == "student").first()
    if not user:
        raise HTTPException(status_code=404, detail="Student not found")
    deleted = db.query(TopicMastery).filter(TopicMastery.student_id == user.id).delete()
    db.commit()
    return {"message": f"Mastery reset for {user.name}", "topics_cleared": deleted}


@app.get("/api/admin/parents")
def admin_get_parents(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    parents = db.query(User).filter(User.role == "parent").order_by(User.name).all()
    result = []
    for p in parents:
        links = db.query(ParentStudentLink).filter(ParentStudentLink.parent_id == p.id).all()
        children = []
        for link in links:
            child = db.query(User).filter(User.id == link.student_id).first()
            if child:
                children.append({"id": child.id, "name": child.name})
        result.append({**_user_dict(p), "children": children})
    return result


@app.post("/api/admin/parents")
def admin_create_parent(
    req: CreateParentRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    existing = db.query(User).filter(User.email == req.email).first()
    if existing:
        existing.role = "parent"
        if req.name:
            existing.name = req.name
        db.commit()
        db.refresh(existing)
        return _user_dict(existing)

    stub = User(
        email=req.email, name=req.name,
        google_id=f"stub_{req.email}",
        role="parent", is_active=True,
    )
    db.add(stub)
    db.commit()
    db.refresh(stub)
    return _user_dict(stub)


@app.post("/api/admin/parents/{parent_id}/link-student")
def admin_link_student(
    parent_id: int,
    req: LinkStudentRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    parent = db.query(User).filter(User.id == parent_id, User.role == "parent").first()
    if not parent:
        raise HTTPException(status_code=404, detail="Parent not found")
    student = db.query(User).filter(User.id == req.student_id, User.role == "student").first()
    if not student:
        raise HTTPException(status_code=404, detail="Student not found")
    existing = db.query(ParentStudentLink).filter(
        ParentStudentLink.parent_id == parent_id,
        ParentStudentLink.student_id == req.student_id,
    ).first()
    if existing:
        raise HTTPException(status_code=400, detail="Already linked")
    db.add(ParentStudentLink(parent_id=parent_id, student_id=req.student_id))
    db.commit()
    return {"message": "Linked successfully"}


@app.delete("/api/admin/parents/{parent_id}/unlink-student/{student_id}")
def admin_unlink_student(
    parent_id: int,
    student_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    link = db.query(ParentStudentLink).filter(
        ParentStudentLink.parent_id == parent_id,
        ParentStudentLink.student_id == student_id,
    ).first()
    if not link:
        raise HTTPException(status_code=404, detail="Link not found")
    db.delete(link)
    db.commit()
    return {"message": "Unlinked"}


@app.get("/api/admin/flagged")
def admin_get_flagged(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    flagged = db.query(TopicMastery).filter(TopicMastery.flagged_for_review == True).all()
    result = []
    for m in flagged:
        topic = db.query(Topic).filter(Topic.id == m.topic_id).first()
        chapter = db.query(Chapter).filter(Chapter.id == topic.chapter_id).first() if topic else None
        user = db.query(User).filter(User.name == m.student_name).first()
        result.append({
            "student_name": m.student_name,
            "student_id": user.id if user else None,
            "grade": user.grade if user else None,
            "topic_title": topic.title if topic else "",
            "chapter_title": chapter.title if chapter else "",
            "flagged_at": m.last_practiced_at.isoformat() if m.last_practiced_at else None,
            "total_sessions_on_topic": m.total_sessions,
            "last_hint_tier_needed": m.last_hint_tier_needed,
        })
    return result


@app.post("/api/admin/flagged/{student_id}/{topic_id}/resolve")
def admin_resolve_flag(
    student_id: int,
    topic_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    user = db.query(User).filter(User.id == student_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="Student not found")
    mastery = db.query(TopicMastery).filter(
        TopicMastery.student_id == user.id,
        TopicMastery.topic_id == topic_id,
    ).first()
    if not mastery:
        raise HTTPException(status_code=404, detail="Mastery record not found")
    mastery.flagged_for_review = False
    db.commit()
    return {"message": "Flag resolved"}


@app.get("/api/admin/settings")
def admin_get_settings(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    rows = db.query(AppSettings).all()
    return {r.key: r.value for r in rows}


@app.put("/api/admin/settings")
def admin_update_settings(
    payload: Dict[str, str],
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    for key, value in payload.items():
        row = db.query(AppSettings).filter(AppSettings.key == key).first()
        if row:
            row.value = value
            row.updated_by = current_user.id
            row.updated_at = datetime.utcnow()
        else:
            db.add(AppSettings(key=key, value=value, updated_by=current_user.id))
    db.commit()
    rows = db.query(AppSettings).all()
    return {r.key: r.value for r in rows}


@app.get("/api/admin/reports/overview")
def admin_overview(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    week_ago = datetime.utcnow() - timedelta(days=7)
    total_students = db.query(func.count(User.id)).filter(User.role == "student").scalar() or 0
    sessions_this_week = db.query(func.count(SessionModel.id)).filter(
        SessionModel.started_at >= week_ago
    ).scalar() or 0
    active_this_week = db.query(func.count(func.distinct(SessionModel.user_id))).filter(
        SessionModel.started_at >= week_ago,
        SessionModel.user_id.isnot(None),
    ).scalar() or 0
    flagged_students = db.query(func.count(func.distinct(TopicMastery.student_id))).filter(
        TopicMastery.flagged_for_review == True
    ).scalar() or 0
    books_uploaded = db.query(func.count(Book.id)).scalar() or 0
    topics_available = db.query(func.count(Topic.id)).scalar() or 0
    return {
        "total_students": total_students, "active_this_week": active_this_week,
        "total_sessions_this_week": sessions_this_week, "flagged_students": flagged_students,
        "books_uploaded": books_uploaded, "topics_available": topics_available,
    }


@app.get("/api/admin/analytics")
def admin_analytics(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    """Rich analytics for the Admin Analytics page."""
    now = datetime.utcnow()

    # ── 14-day session trend ────────────────────────────────────────────────
    trend = []
    for i in range(13, -1, -1):
        day_start = (now - timedelta(days=i)).replace(hour=0, minute=0, second=0, microsecond=0)
        day_end = day_start + timedelta(days=1)
        count = db.query(func.count(SessionModel.id)).filter(
            SessionModel.started_at >= day_start,
            SessionModel.started_at < day_end,
        ).scalar() or 0
        trend.append({"date": day_start.date().isoformat(), "sessions": count})

    # ── Grade breakdown ─────────────────────────────────────────────────────
    grade_rows = db.query(
        User.grade,
        func.count(User.id).label("students"),
    ).filter(User.role == "student", User.grade.isnot(None)).group_by(User.grade).all()

    grade_session_rows = db.query(
        User.grade,
        func.count(SessionModel.id).label("sessions"),
    ).join(SessionModel, SessionModel.user_id == User.id).filter(
        User.role == "student", User.grade.isnot(None)
    ).group_by(User.grade).all()

    grade_sess_map = {r.grade: r.sessions for r in grade_session_rows}
    grade_breakdown = [
        {"grade": r.grade, "students": r.students, "sessions": grade_sess_map.get(r.grade, 0)}
        for r in sorted(grade_rows, key=lambda x: x.grade)
    ]

    # ── Subject breakdown (sessions + flags) ────────────────────────────────
    subj_sess = db.query(
        Book.subject,
        func.count(SessionModel.id).label("sessions"),
    ).join(Chapter, Chapter.book_id == Book.id)\
     .join(Topic, Topic.chapter_id == Chapter.id)\
     .join(SessionModel, SessionModel.topic_id == Topic.id)\
     .group_by(Book.subject)\
     .order_by(func.count(SessionModel.id).desc())\
     .all()

    subj_flags = db.query(
        Book.subject,
        func.count(TopicMastery.id).label("flags"),
    ).join(Chapter, Chapter.book_id == Book.id)\
     .join(Topic, Topic.chapter_id == Chapter.id)\
     .join(TopicMastery, TopicMastery.topic_id == Topic.id)\
     .filter(TopicMastery.flagged_for_review == True)\
     .group_by(Book.subject)\
     .all()

    flags_map = {r.subject: r.flags for r in subj_flags}
    subject_breakdown = [
        {"subject": r.subject, "sessions": r.sessions, "flags": flags_map.get(r.subject, 0)}
        for r in subj_sess
    ]

    # ── Mastery level distribution ──────────────────────────────────────────
    mastery_rows = db.query(
        TopicMastery.mastery_level,
        func.count(TopicMastery.id).label("count"),
    ).filter(TopicMastery.mastery_level.isnot(None)).group_by(TopicMastery.mastery_level).all()
    mastery_dist = {r.mastery_level: r.count for r in mastery_rows}

    # ── Top 5 students by total XP ──────────────────────────────────────────
    top_users = db.query(User).filter(
        User.role == "student", User.is_active == True,
    ).order_by(User.total_xp.desc()).limit(5).all()

    top_students = []
    for u in top_users:
        mastered = db.query(func.count(TopicMastery.id)).filter(
            TopicMastery.student_id == u.id,
            TopicMastery.mastery_level.in_(["L3", "L4", "L5"]),
        ).scalar() or 0
        top_students.append({
            "id": u.id, "name": u.name, "grade": u.grade,
            "total_xp": u.total_xp or 0, "topics_mastered": mastered,
        })

    return {
        "sessions_trend": trend,
        "grade_breakdown": grade_breakdown,
        "subject_breakdown": subject_breakdown,
        "mastery_distribution": mastery_dist,
        "top_students": top_students,
    }


@app.get("/api/admin/ai-usage")
def admin_ai_usage(
    days: int = Query(7, ge=1, le=90),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    """AI cost monitoring — daily totals and per-student breakdown (task #26)."""
    from sqlalchemy import func as sqlfunc, cast, Date as SQLDate

    cutoff = datetime.utcnow() - timedelta(days=days)

    # Daily totals
    daily_rows = (
        db.query(
            sqlfunc.date(AIUsageLog.called_at).label("day"),
            sqlfunc.sum(AIUsageLog.input_tokens).label("input_tokens"),
            sqlfunc.sum(AIUsageLog.output_tokens).label("output_tokens"),
            sqlfunc.sum(AIUsageLog.cost_usd).label("cost_usd"),
            sqlfunc.count(AIUsageLog.id).label("calls"),
        )
        .filter(AIUsageLog.called_at >= cutoff)
        .group_by(sqlfunc.date(AIUsageLog.called_at))
        .order_by(sqlfunc.date(AIUsageLog.called_at))
        .all()
    )
    daily = [
        {
            "date": str(r.day),
            "calls": r.calls,
            "input_tokens": r.input_tokens or 0,
            "output_tokens": r.output_tokens or 0,
            "cost_usd": round(r.cost_usd or 0.0, 6),
        }
        for r in daily_rows
    ]

    # Per-student totals
    student_rows = (
        db.query(
            AIUsageLog.student_id,
            User.name,
            sqlfunc.sum(AIUsageLog.cost_usd).label("cost_usd"),
            sqlfunc.count(AIUsageLog.id).label("calls"),
        )
        .outerjoin(User, User.id == AIUsageLog.student_id)
        .filter(AIUsageLog.called_at >= cutoff, AIUsageLog.student_id.isnot(None))
        .group_by(AIUsageLog.student_id, User.name)
        .order_by(sqlfunc.sum(AIUsageLog.cost_usd).desc())
        .limit(20)
        .all()
    )
    per_student = [
        {
            "student_id": r.student_id,
            "name": r.name or "Unknown",
            "calls": r.calls,
            "cost_usd": round(r.cost_usd or 0.0, 6),
        }
        for r in student_rows
    ]

    total_cost = sum(d["cost_usd"] for d in daily)
    return {
        "period_days": days,
        "total_cost_usd": round(total_cost, 4),
        "daily": daily,
        "top_students": per_student,
        "daily_limit_per_student": _AI_DAILY_LIMIT,
    }


# ─── Phase C: Parent Routes ────────────────────────────────────────────────

@app.get("/api/parent/children")
def parent_get_children(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_parent),
):
    links = db.query(ParentStudentLink).filter(
        ParentStudentLink.parent_id == current_user.id
    ).all()
    result = []
    today = datetime.utcnow().date()
    week_start = datetime.utcnow() - timedelta(days=6)
    for link in links:
        child = db.query(User).filter(User.id == link.student_id).first()
        if not child:
            continue
        stats = _student_stats(db, child.id)
        last_session = (db.query(SessionModel).filter(SessionModel.user_id == child.id)
                        .order_by(SessionModel.started_at.desc()).first())
        # Streak — compassionate streak with weekend grace + freeze
        week_sessions = (db.query(SessionModel)
                         .filter(SessionModel.user_id == child.id,
                                 SessionModel.started_at >= week_start).all())
        day_counts: dict[str, int] = {}
        for s in week_sessions:
            d = s.started_at.date().isoformat()
            day_counts[d] = day_counts.get(d, 0) + 1
        streak = _compute_streak(db, child)
        sessions_this_week = sum(day_counts.values())
        result.append({
            "id": child.id, "name": child.name, "grade": child.grade,
            "avatar_url": child.avatar_url,
            "last_active": last_session.started_at.isoformat() if last_session and last_session.started_at else None,
            "total_sessions": stats["total_sessions"],
            "topics_mastered": stats["topics_mastered"],
            "flagged_topics": stats["flagged_topics"],
            "streak_days": streak,
            "sessions_this_week": sessions_this_week,
        })
    return result


@app.get("/api/parent/children/{student_id}")
def parent_get_child_detail(
    student_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_parent),
):
    link = db.query(ParentStudentLink).filter(
        ParentStudentLink.parent_id == current_user.id,
        ParentStudentLink.student_id == student_id,
    ).first()
    if not link:
        raise HTTPException(status_code=403, detail="Not linked to this student")

    child = db.query(User).filter(User.id == student_id).first()
    if not child:
        raise HTTPException(status_code=404, detail="Student not found")

    sessions = (db.query(SessionModel).filter(SessionModel.user_id == child.id)
                .order_by(SessionModel.started_at.desc()).all())

    total_sessions = len(sessions)
    total_minutes = 0
    for s in sessions:
        if s.started_at and s.ended_at:
            total_minutes += int((s.ended_at - s.started_at).total_seconds() / 60)

    masteries = db.query(TopicMastery).filter(TopicMastery.student_id == child.id).all()
    topics_practised = len(masteries)
    topics_at_l3 = sum(1 for m in masteries if m.mastery_level in ("L3", "L4", "L5"))
    flagged_count = sum(1 for m in masteries if m.flagged_for_review)

    topic_mastery_list = []
    subject_map: dict[str, dict] = {}  # subject → {mastered, attempted}
    for m in masteries:
        topic = db.query(Topic).filter(Topic.id == m.topic_id).first()
        chapter = db.query(Chapter).filter(Chapter.id == topic.chapter_id).first() if topic else None
        book = db.query(Book).filter(Book.id == chapter.book_id).first() if chapter else None
        subj = book.subject if book else "Other"
        if subj not in subject_map:
            subject_map[subj] = {"subject": subj, "attempted": 0, "mastered": 0}
        subject_map[subj]["attempted"] += 1
        if m.mastery_level in ("L3", "L4", "L5"):
            subject_map[subj]["mastered"] += 1
        topic_mastery_list.append({
            "topic_title": topic.title if topic else "", "chapter_title": chapter.title if chapter else "",
            "subject": subj,
            "mastery_level": m.mastery_level, "level_label": level_label(m.mastery_level),
            "last_practiced_at": m.last_practiced_at.isoformat() if m.last_practiced_at else None,
            "sessions_on_topic": m.total_sessions, "flagged_for_review": m.flagged_for_review,
            "last_hint_tier_needed": m.last_hint_tier_needed,
        })

    recent_sessions = []
    for s in sessions[:10]:
        t = db.query(Topic).filter(Topic.id == s.topic_id).first()
        dur = int((s.ended_at - s.started_at).total_seconds() / 60) if s.started_at and s.ended_at else 0
        recent_sessions.append({
            "topic_title": t.title if t else "", "started_at": s.started_at.isoformat() if s.started_at else None,
            "duration_minutes": dur, "level_reached": s.current_level,
            "questions_asked": s.questions_asked, "status": s.status,
        })

    flagged_topics = []
    for m in masteries:
        if m.flagged_for_review:
            topic = db.query(Topic).filter(Topic.id == m.topic_id).first()
            chapter = db.query(Chapter).filter(Chapter.id == topic.chapter_id).first() if topic else None
            flagged_topics.append({
                "topic_title": topic.title if topic else "",
                "chapter_title": chapter.title if chapter else "",
                "message": (f"{child.name} needed extra help with {topic.title if topic else 'this topic'}. "
                            "Consider reviewing it together."),
            })

    # Streak for this child — compassionate streak with weekend grace + freeze
    today_dt = datetime.utcnow().date()
    week_start_dt = datetime.utcnow() - timedelta(days=6)
    week_sess = [s for s in sessions if s.started_at and s.started_at >= week_start_dt]
    day_counts_detail: dict[str, int] = {}
    for s in week_sess:
        d = s.started_at.date().isoformat()
        day_counts_detail[d] = day_counts_detail.get(d, 0) + 1
    streak_detail = _compute_streak(db, child)

    # 7-day activity for this child
    weekly_activity = []
    for i in range(7):
        d = (today_dt - timedelta(days=6 - i)).isoformat()
        weekly_activity.append({"date": d, "sessions": day_counts_detail.get(d, 0)})

    return {
        "student": {"name": child.name, "grade": child.grade},
        "summary": {"total_sessions": total_sessions, "total_time_minutes": total_minutes,
                    "topics_practised": topics_practised, "topics_at_l3_or_above": topics_at_l3,
                    "flagged_topics": flagged_count, "streak_days": streak_detail,
                    "sessions_this_week": sum(day_counts_detail.values())},
        "subject_summary": list(subject_map.values()),
        "topic_mastery": topic_mastery_list,
        "recent_sessions": recent_sessions,
        "flagged_topics": flagged_topics,
        "weekly_activity": weekly_activity,
    }


@app.get("/api/parent/children/{student_id}/sessions")
def parent_get_child_sessions(
    student_id: int,
    limit: int = Query(20, ge=1, le=100),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_parent),
):
    link = db.query(ParentStudentLink).filter(
        ParentStudentLink.parent_id == current_user.id,
        ParentStudentLink.student_id == student_id,
    ).first()
    if not link:
        raise HTTPException(status_code=403, detail="Not linked to this student")

    child = db.query(User).filter(User.id == student_id).first()
    if not child:
        raise HTTPException(status_code=404, detail="Student not found")

    sessions = (db.query(SessionModel).filter(SessionModel.user_id == child.id)
                .order_by(SessionModel.started_at.desc()).offset(offset).limit(limit).all())
    result = []
    for s in sessions:
        t = db.query(Topic).filter(Topic.id == s.topic_id).first()
        dur = int((s.ended_at - s.started_at).total_seconds() / 60) if s.started_at and s.ended_at else 0
        result.append({
            "id": s.id, "topic_title": t.title if t else "",
            "started_at": s.started_at.isoformat() if s.started_at else None,
            "duration_minutes": dur, "level_reached": s.current_level,
            "questions_asked": s.questions_asked, "status": s.status,
        })
    return result


@app.get("/api/parent/children/{student_id}/weekly-report")
def child_weekly_report(
    student_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_parent),
):
    """Week-over-week snapshot for a parent's child."""
    # Verify parent owns this child (admins pass through)
    if current_user.role != "admin":
        link = db.query(ParentStudentLink).filter(
            ParentStudentLink.parent_id == current_user.id,
            ParentStudentLink.student_id == student_id,
        ).first()
        if not link:
            raise HTTPException(status_code=403, detail="Not your child")

    student = db.query(User).filter(User.id == student_id).first()
    if not student:
        raise HTTPException(status_code=404, detail="Student not found")

    now = datetime.utcnow()
    # This week: Monday 00:00 UTC
    days_since_monday = now.weekday()
    week_start = (now - timedelta(days=days_since_monday)).replace(hour=0, minute=0, second=0, microsecond=0)
    last_week_start = week_start - timedelta(days=7)

    def _sessions_in_range(start, end):
        return db.query(SessionModel).filter(
            SessionModel.user_id == student_id,
            SessionModel.started_at >= start,
            SessionModel.started_at < end,
        ).all()

    this_week_sessions = _sessions_in_range(week_start, now)
    last_week_sessions = _sessions_in_range(last_week_start, week_start)

    # Topics practiced this week
    topics_this_week = list({s.topic_id for s in this_week_sessions})

    # New masteries achieved this week (L3+ reached/improved)
    new_masteries = []
    masteries_this_week = db.query(TopicMastery).join(Topic).filter(
        TopicMastery.student_id == student.id,
        TopicMastery.last_practiced_at >= week_start,
        TopicMastery.mastery_level.in_(["L3", "L4", "L5"]),
    ).order_by(TopicMastery.last_practiced_at.desc()).limit(5).all()
    for m in masteries_this_week:
        new_masteries.append({"topic_title": m.topic.title if m.topic else "Unknown", "level": m.mastery_level})

    return {
        "this_week": {
            "sessions": len(this_week_sessions),
            "topics_count": len(topics_this_week),
            "xp_earned": student.weekly_xp or 0,
            "total_xp": student.total_xp or 0,
        },
        "last_week": {
            "sessions": len(last_week_sessions),
            "topics_count": len({s.topic_id for s in last_week_sessions}),
        },
        "delta_sessions": len(this_week_sessions) - len(last_week_sessions),
        "new_masteries": new_masteries,
        "streak_days": student.streak_days or 0,
    }


@app.get("/api/parent/family-activity")
def parent_family_activity(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_parent),
):
    """7-day session counts per child — for the family activity chart on Overview."""
    links = db.query(ParentStudentLink).filter(
        ParentStudentLink.parent_id == current_user.id
    ).all()
    today = datetime.utcnow().date()
    week_start = datetime.utcnow() - timedelta(days=6)
    dates = [(today - timedelta(days=6 - i)).isoformat() for i in range(7)]
    result = []
    for link in links:
        child = db.query(User).filter(User.id == link.student_id).first()
        if not child:
            continue
        week_sessions = (db.query(SessionModel)
                         .filter(SessionModel.user_id == child.id,
                                 SessionModel.started_at >= week_start).all())
        day_counts: dict[str, int] = {d: 0 for d in dates}
        for s in week_sessions:
            d = s.started_at.date().isoformat()
            if d in day_counts:
                day_counts[d] += 1
        result.append({
            "child_id": child.id,
            "child_name": child.name,
            "activity": [{"date": d, "sessions": day_counts[d]} for d in dates],
        })
    return result


@app.get("/api/parent/notifications")
def parent_get_notifications(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_parent),
):
    notifs = (db.query(Notification).filter(Notification.user_id == current_user.id)
              .order_by(Notification.created_at.desc()).all())
    return [{"id": n.id, "type": n.type, "title": n.title, "body": n.body,
             "is_read": n.is_read,
             "created_at": n.created_at.isoformat() if n.created_at else None}
            for n in notifs]


@app.post("/api/parent/notifications/mark-all-read")
def parent_mark_all_read(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_parent),
):
    db.query(Notification).filter(
        Notification.user_id == current_user.id,
        Notification.is_read == False,
    ).update({"is_read": True})
    db.commit()
    return {"message": "All marked as read"}


@app.post("/api/parent/notifications/{notification_id}/read")
def parent_mark_read(
    notification_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_parent),
):
    notif = db.query(Notification).filter(
        Notification.id == notification_id,
        Notification.user_id == current_user.id,
    ).first()
    if not notif:
        raise HTTPException(status_code=404, detail="Notification not found")
    notif.is_read = True
    db.commit()
    return {"message": "Marked as read"}


# ─── Student Self-Service Routes ───────────────────────────────────────────────

@app.get("/api/student/dashboard")
def student_dashboard(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Home page data: subject progress summary, last session, weekly activity."""
    if current_user.role != "student":
        raise HTTPException(status_code=403, detail="Students only")

    student_id = current_user.id
    student_name = current_user.name   # kept for display only
    grade = current_user.grade

    # ── All books for this grade ──────────────────────────────────────────
    books = db.query(Book).filter(Book.grade == grade, Book.ingestion_status == "done").all()

    # Fetch all mastery records for this student in one query
    all_masteries = db.query(TopicMastery).filter(
        TopicMastery.student_id == student_id
    ).all()
    mastery_by_topic: dict[int, TopicMastery] = {m.topic_id: m for m in all_masteries}

    # Build subject-wise breakdown
    subject_stats: dict[str, dict] = {}
    for book in books:
        subj = book.subject or "Other"
        if subj not in subject_stats:
            subject_stats[subj] = {
                "subject": subj,
                "total_topics": 0,
                "attempted": 0,      # has at least 1 session
                "mastered": 0,       # L3 or above
                "flagged": 0,
            }
        chapters = db.query(Chapter).filter(Chapter.book_id == book.id).all()
        for ch in chapters:
            topics = db.query(Topic).filter(Topic.chapter_id == ch.id).all()
            for t in topics:
                subject_stats[subj]["total_topics"] += 1
                m = mastery_by_topic.get(t.id)
                if m:
                    subject_stats[subj]["attempted"] += 1
                    if m.mastery_level in ("L3", "L4", "L5"):
                        subject_stats[subj]["mastered"] += 1
                    if m.flagged_for_review:
                        subject_stats[subj]["flagged"] += 1

    # ── Last practiced topic ──────────────────────────────────────────────
    last_session = (
        db.query(SessionModel)
        .filter(SessionModel.user_id == student_id)
        .order_by(SessionModel.started_at.desc())
        .first()
    )
    last_practiced = None
    if last_session:
        t = db.query(Topic).filter(Topic.id == last_session.topic_id).first()
        ch = db.query(Chapter).filter(Chapter.id == t.chapter_id).first() if t else None
        bk = db.query(Book).filter(Book.id == (ch.book_id if ch else None)).first() if ch else None
        if t:
            m = mastery_by_topic.get(t.id)
            last_practiced = {
                "topic_id": t.id,
                "topic_title": t.title,
                "chapter_title": ch.title if ch else "",
                "book_title": bk.title if bk else "",
                "subject": bk.subject if bk else "",
                "mastery_level": m.mastery_level if m else "L1",
                "session_id": last_session.id,
                "started_at": last_session.started_at.isoformat() if last_session.started_at else None,
            }

    # ── Weekly activity — sessions per day over last 7 days ──────────────
    today = datetime.utcnow().date()
    week_start = datetime.utcnow() - timedelta(days=6)
    week_sessions = (
        db.query(SessionModel)
        .filter(
            SessionModel.user_id == student_id,
            SessionModel.started_at >= week_start,
        )
        .all()
    )
    day_counts: dict[str, int] = {}
    for i in range(7):
        d = (today - timedelta(days=6 - i)).isoformat()
        day_counts[d] = 0
    for s in week_sessions:
        d = s.started_at.date().isoformat()
        if d in day_counts:
            day_counts[d] += 1

    weekly_activity = [{"date": d, "sessions": cnt} for d, cnt in sorted(day_counts.items())]

    # ── Streak: compassionate streak with weekend grace + freeze token ────────
    streak = _compute_streak(db, current_user)
    db.commit()

    # ── Weekly challenge status ──────────────────────────────────────────────
    weekly_challenge_done = False
    if grade:
        wc = db.query(WeeklyChallenge).filter(
            WeeklyChallenge.grade == grade,
            WeeklyChallenge.week_start == _get_week_start(),
        ).first()
        if wc:
            done = db.query(WeeklyChallengeCompletion).filter(
                WeeklyChallengeCompletion.user_id == current_user.id,
                WeeklyChallengeCompletion.challenge_id == wc.id,
            ).first()
            weekly_challenge_done = bool(done)

    return {
        "student_name": student_name,
        "grade": grade,
        "subject_stats": list(subject_stats.values()),
        "last_practiced": last_practiced,
        "weekly_activity": weekly_activity,
        "streak_days": streak,
        "total_sessions": db.query(SessionModel).filter(
            SessionModel.user_id == student_id
        ).count(),
        "total_xp": current_user.total_xp or 0,
        "weekly_xp": current_user.weekly_xp or 0,
        "weekly_challenge_done": weekly_challenge_done,
        "streak_freeze_available": current_user.streak_freeze_available or False,
    }


# ─── Gamification Endpoints ────────────────────────────────────────────────────

class BuddyUpdateRequest(BaseModel):
    buddy_name: Optional[str] = None
    buddy_avatar: Optional[str] = None
    show_on_leaderboard: Optional[bool] = None

class WeeklyChallengeSubmitRequest(BaseModel):
    challenge_id: int
    answer: str
    image_data: Optional[str] = None   # base64 JPEG for handwritten answers


@app.post("/api/student/use-streak-freeze")
def use_streak_freeze(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Manually apply a streak freeze token.
    The token is normally consumed automatically during streak computation,
    but this endpoint lets the frontend confirm that a freeze was applied
    and surface it to the student.
    """
    if current_user.role != "student":
        raise HTTPException(status_code=403, detail="Students only")

    streak = _compute_streak(db, current_user)
    db.commit()
    return {
        "streak_days": streak,
        "streak_freeze_available": current_user.streak_freeze_available or False,
        "freeze_used": current_user.streak_freeze_used_at is not None,
    }


@app.get("/api/student/buddy")
def get_buddy(current_user: User = Depends(get_current_user)):
    """Return the student's current buddy settings."""
    if current_user.role != "student":
        raise HTTPException(status_code=403, detail="Students only")
    return {
        "buddy_name": current_user.buddy_name or "Buddy",
        "buddy_avatar": current_user.buddy_avatar or "robot",
        "show_on_leaderboard": current_user.show_on_leaderboard if current_user.show_on_leaderboard is not None else False,
        "leaderboard_eligible": (current_user.grade or 0) >= _LEADERBOARD_MIN_GRADE,
    }


@app.put("/api/student/buddy")
def update_buddy(
    req: BuddyUpdateRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Update buddy name / avatar / leaderboard opt-in."""
    if current_user.role != "student":
        raise HTTPException(status_code=403, detail="Students only")

    VALID_AVATARS = {"robot", "fox", "panda", "lion", "dolphin", "owl", "dragon", "wizard"}
    user = db.query(User).filter(User.id == current_user.id).first()

    if req.buddy_name is not None:
        name = req.buddy_name.strip()[:20]
        user.buddy_name = name if name else "Buddy"
    if req.buddy_avatar is not None:
        if req.buddy_avatar not in VALID_AVATARS:
            raise HTTPException(status_code=400, detail=f"Invalid avatar. Choose from: {', '.join(VALID_AVATARS)}")
        user.buddy_avatar = req.buddy_avatar
    if req.show_on_leaderboard is not None:
        # Grades 1-5 cannot opt in — silently ignore the request
        if (user.grade or 0) >= _LEADERBOARD_MIN_GRADE:
            user.show_on_leaderboard = req.show_on_leaderboard
        else:
            user.show_on_leaderboard = False

    db.commit()
    return {
        "buddy_name": user.buddy_name or "Buddy",
        "buddy_avatar": user.buddy_avatar or "robot",
        "show_on_leaderboard": user.show_on_leaderboard if user.show_on_leaderboard is not None else False,
    }


# ── Profile endpoints (student + parent) ─────────────────────────────────────

VALID_AVATAR_PRESETS = {
    "cat", "dog", "fox", "panda", "lion", "dolphin", "owl", "frog",
    "tiger", "butterfly", "penguin", "unicorn",
    "dragon", "wizard", "eagle", "robot",
    "star", "rocket", "palette", "theatre",
}


class ProfileUpdateRequest(BaseModel):
    display_name: Optional[str] = None
    avatar_preset: Optional[str] = None  # empty string = clear preset


@app.get("/api/profile")
def get_profile(current_user: User = Depends(get_current_user)):
    """Return the current user's editable profile fields."""
    return {
        "name": current_user.name,
        "email": current_user.email,
        "role": current_user.role,
        "grade": current_user.grade,
        "avatar_url": current_user.avatar_url,
        "avatar_preset": current_user.avatar_preset,
    }


@app.put("/api/profile")
def update_profile(
    req: ProfileUpdateRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Update display name and/or avatar preset. Available to student and parent."""
    if current_user.role not in ("student", "parent"):
        raise HTTPException(status_code=403, detail="Not allowed")

    if req.display_name is not None:
        name = req.display_name.strip()[:200]
        if not name:
            raise HTTPException(status_code=400, detail="Name cannot be empty")
        current_user.name = name

    if req.avatar_preset is not None:
        if req.avatar_preset and req.avatar_preset not in VALID_AVATAR_PRESETS:
            raise HTTPException(status_code=400, detail="Invalid avatar preset")
        current_user.avatar_preset = req.avatar_preset or None

    db.commit()
    return {
        "name": current_user.name,
        "avatar_url": current_user.avatar_url,
        "avatar_preset": current_user.avatar_preset,
    }


@app.post("/api/profile/avatar")
async def upload_profile_avatar(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Upload a custom profile photo. Stores in GCS (prod) or local uploads/profiles/ (dev).
    Students may only use preset avatars or their Google photo — gallery upload is disabled."""
    if current_user.role == "student":
        raise HTTPException(
            status_code=403,
            detail="Students can use preset avatars or their Google profile photo only."
        )
    if current_user.role not in ("parent", "admin"):
        raise HTTPException(status_code=403, detail="Not allowed")

    if not file.content_type or not file.content_type.startswith("image/"):
        raise HTTPException(status_code=400, detail="Only image files are allowed")

    content = await file.read()
    if len(content) > 5 * 1024 * 1024:  # 5 MB limit
        raise HTTPException(status_code=400, detail="Image must be under 5 MB")

    ext = (file.filename or "").rsplit(".", 1)[-1].lower()
    if ext not in ("jpg", "jpeg", "png", "webp", "gif"):
        ext = "jpg"
    if ext == "jpeg":
        ext = "jpg"

    from storage import save_profile_image
    import asyncio as _asyncio
    url = await _asyncio.get_event_loop().run_in_executor(
        None, save_profile_image, content, current_user.id, ext
    )

    current_user.avatar_url = url
    current_user.avatar_preset = None  # custom photo takes precedence over preset
    db.commit()

    return {"avatar_url": url}


@app.get("/api/profile/avatar/file/{filename}")
def serve_local_profile_avatar(filename: str):
    """Serve locally-stored profile images in dev (not used in GCS/prod)."""
    import os as _os
    from fastapi.responses import FileResponse
    upload_dir = _os.getenv("UPLOAD_DIR", "uploads")
    filepath = _os.path.join(upload_dir, "profiles", filename)
    if not _os.path.exists(filepath):
        raise HTTPException(status_code=404, detail="Avatar not found")
    return FileResponse(filepath)


_LEADERBOARD_MIN_GRADE = 6  # Grades 1-5 are exempt from leaderboard (child safety)


@app.get("/api/student/leaderboard")
def get_leaderboard(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """XP leaderboard for students in the same grade. Disabled for Grades 1-5."""
    if current_user.role != "student":
        raise HTTPException(status_code=403, detail="Students only")

    grade = current_user.grade or 0

    # Leaderboard is not available for younger students
    if grade < _LEADERBOARD_MIN_GRADE:
        return {
            "disabled": True,
            "reason": "Leaderboard is available from Grade 6 onwards.",
            "leaderboard": [], "my_rank": None, "my_weekly_xp": 0, "my_total_xp": 0,
        }

    if not current_user.grade:
        return {"disabled": False, "leaderboard": [], "my_rank": None, "my_weekly_xp": 0, "my_total_xp": 0}

    students = (
        db.query(User)
        .filter(User.grade == current_user.grade, User.role == "student", User.is_active == True)
        .all()
    )

    # Sort by total XP descending
    sorted_students = sorted(students, key=lambda s: (s.total_xp or 0), reverse=True)

    # Build leaderboard — only show opted-in students, but always include self
    result = []
    my_rank = None
    rank_counter = 0
    for s in sorted_students:
        rank_counter += 1
        is_me = s.id == current_user.id
        # Opt-in default is False — only show if explicitly opted in, or it's self
        opted_in = s.show_on_leaderboard if s.show_on_leaderboard is not None else False
        if not opted_in and not is_me:
            continue
        entry = {
            "rank": rank_counter,
            "name": s.name.split()[0],  # first name only for privacy
            "avatar_url": s.avatar_url,
            "buddy_avatar": s.buddy_avatar or "robot",
            "total_xp": s.total_xp or 0,
            "weekly_xp": s.weekly_xp or 0,
            "is_me": is_me,
        }
        result.append(entry)
        if is_me:
            my_rank = rank_counter

    return {
        "disabled": False,
        "leaderboard": result,
        "my_rank": my_rank,
        "my_total_xp": current_user.total_xp or 0,
        "my_weekly_xp": current_user.weekly_xp or 0,
    }


@app.get("/api/student/weekly-challenge")
def get_weekly_challenge(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Get (or lazily create) this week's challenge for the student's grade."""
    if current_user.role != "student":
        raise HTTPException(status_code=403, detail="Students only")
    if not current_user.grade:
        return {"available": False, "reason": "no_grade"}

    week_start = _get_week_start()
    challenge = db.query(WeeklyChallenge).filter(
        WeeklyChallenge.grade == current_user.grade,
        WeeklyChallenge.week_start == week_start,
    ).first()

    if not challenge:
        # Lazily generate: pick a random ingested topic for this grade
        all_topics = (
            db.query(Topic)
            .join(Chapter, Chapter.id == Topic.chapter_id)
            .join(Book, Book.id == Chapter.book_id)
            .filter(Book.grade == current_user.grade, Book.ingestion_status == "done")
            .all()
        )
        if not all_topics:
            return {"available": False, "reason": "no_topics"}

        chosen_topic = random.choice(all_topics)
        chosen_topic.chapter = db.query(Chapter).filter(Chapter.id == chosen_topic.chapter_id).first()
        nq = generate_question(chosen_topic, "L4", [])
        challenge = WeeklyChallenge(
            grade=current_user.grade,
            week_start=week_start,
            topic_id=chosen_topic.id,
            question_text=nq["question"],
            expected_key_points=json.dumps(nq["expected_key_points"]),
            answer_format=nq["answer_format"],
        )
        db.add(challenge)
        try:
            db.commit()
            db.refresh(challenge)
        except Exception:
            db.rollback()
            # Another request may have created it concurrently — fetch again
            challenge = db.query(WeeklyChallenge).filter(
                WeeklyChallenge.grade == current_user.grade,
                WeeklyChallenge.week_start == week_start,
            ).first()
            if not challenge:
                return {"available": False, "reason": "generation_failed"}

    # Check if this user already completed it
    completion = db.query(WeeklyChallengeCompletion).filter(
        WeeklyChallengeCompletion.user_id == current_user.id,
        WeeklyChallengeCompletion.challenge_id == challenge.id,
    ).first()

    topic = db.query(Topic).filter(Topic.id == challenge.topic_id).first()
    chapter = db.query(Chapter).filter(Chapter.id == topic.chapter_id).first() if topic else None
    book = db.query(Book).filter(Book.id == chapter.book_id).first() if chapter else None

    return {
        "available": True,
        "challenge": {
            "id": challenge.id,
            "question": challenge.question_text,
            "answer_format": challenge.answer_format,
            "topic_title": topic.title if topic else "",
            "subject": book.subject if book else "",
            "week_start": challenge.week_start.isoformat(),
            "max_xp": 200,
        },
        "completed": bool(completion),
        "completion": {
            "score": completion.score,
            "xp_earned": completion.xp_earned,
            "feedback": completion.feedback,
        } if completion else None,
    }


@app.post("/api/student/weekly-challenge/submit")
def submit_weekly_challenge(
    req: WeeklyChallengeSubmitRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Submit an answer to the weekly challenge. One attempt per student per week."""
    if current_user.role != "student":
        raise HTTPException(status_code=403, detail="Students only")
    if not req.answer.strip():
        raise HTTPException(status_code=400, detail="Answer cannot be empty")

    challenge = db.query(WeeklyChallenge).filter(WeeklyChallenge.id == req.challenge_id).first()
    if not challenge:
        raise HTTPException(status_code=404, detail="Challenge not found")
    if challenge.grade != current_user.grade:
        raise HTTPException(status_code=403, detail="Not your grade's challenge")

    # Idempotency — already submitted
    existing = db.query(WeeklyChallengeCompletion).filter(
        WeeklyChallengeCompletion.user_id == current_user.id,
        WeeklyChallengeCompletion.challenge_id == challenge.id,
    ).first()
    if existing:
        return {"score": existing.score, "xp_earned": existing.xp_earned,
                "feedback": existing.feedback, "already_submitted": True}

    # Load topic context for assessment
    topic = db.query(Topic).filter(Topic.id == challenge.topic_id).first()
    topic.chapter = db.query(Chapter).filter(Chapter.id == topic.chapter_id).first()

    ekp = json.loads(challenge.expected_key_points) if challenge.expected_key_points else None
    assessment = assess_answer(
        topic, challenge.question_text, req.answer,
        level="L4", hint_tier=0,
        expected_key_points=ekp,
        answer_format=challenge.answer_format,
        image_data=req.image_data or None,
    )

    # XP = score * 2, capped at 200 (max for a perfect answer = 200)
    xp_earned = min(int(assessment["score"]) * 2, 200)

    completion = WeeklyChallengeCompletion(
        user_id=current_user.id,
        challenge_id=challenge.id,
        score=assessment["score"],
        xp_earned=xp_earned,
        feedback=assessment["feedback"],
    )
    db.add(completion)
    _update_user_xp(db, current_user.id, xp_earned)
    db.commit()

    return {
        "score": assessment["score"],
        "xp_earned": xp_earned,
        "feedback": assessment["feedback"],
        "already_submitted": False,
    }


# ─── Learning Effectiveness Endpoints ─────────────────────────────────────────

class ExamStartRequest(BaseModel):
    subjects: Optional[list] = None   # empty = all subjects
    question_count: int = 10
    time_limit_minutes: int = 15

class ExamSubmitRequest(BaseModel):
    exam_id: int
    answers: list   # list of strings, same length as questions

class FlashcardMarkRequest(BaseModel):
    topic_id: int
    known: bool


@app.get("/api/student/review-queue")
def get_review_queue(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Topics where next_review_at has passed — ordered soonest-overdue first.

    Also returns daily completion state (task #19):
    - reviewed_today: items that were due today and were practised today
    - completed_today: True when no items remain overdue
    """
    if current_user.role != "student":
        raise HTTPException(status_code=403, detail="Students only")

    now = datetime.utcnow()
    today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)

    due = (
        db.query(TopicMastery)
        .filter(
            TopicMastery.student_id == current_user.id,
            TopicMastery.next_review_at != None,
            TopicMastery.next_review_at <= now,
            TopicMastery.flagged_for_review == False,
        )
        .order_by(TopicMastery.next_review_at)
        .limit(10)
        .all()
    )

    # Count topics that were due today (next_review_at within today) but the student
    # already practised them today — this gives a "you're caught up" signal.
    reviewed_today = (
        db.query(func.count(TopicMastery.id))
        .filter(
            TopicMastery.student_id == current_user.id,
            TopicMastery.last_practiced_at >= today_start,
            TopicMastery.next_review_at != None,
            TopicMastery.next_review_at >= today_start,  # was due today
            TopicMastery.next_review_at <= now,
        )
        .scalar() or 0
    )

    result = []
    for m in due:
        t = db.query(Topic).filter(Topic.id == m.topic_id).first()
        if not t: continue
        ch = db.query(Chapter).filter(Chapter.id == t.chapter_id).first()
        bk = db.query(Book).filter(Book.id == ch.book_id).first() if ch else None
        overdue_days = max(0, (now - m.next_review_at).days)
        result.append({
            "topic_id": t.id,
            "title": t.title,
            "subject": bk.subject if bk else "",
            "chapter_title": ch.title if ch else "",
            "mastery_level": m.mastery_level,
            "overdue_days": overdue_days,
        })

    completed_today = len(result) == 0

    return {"due": result, "count": len(result),
            "reviewed_today": reviewed_today,
            "completed_today": completed_today}


@app.get("/api/student/mistakes")
def get_mistakes(
    limit: int = Query(30, ge=1, le=100),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Questions where the student struggled (score < 50), one per topic, most recent."""
    if current_user.role != "student":
        raise HTTPException(status_code=403, detail="Students only")

    # Get this student's completed session IDs
    session_ids = [
        row[0] for row in
        db.query(SessionModel.id).filter(
            SessionModel.user_id == current_user.id,
        ).all()
    ]
    if not session_ids:
        return {"mistakes": []}

    # Get struggling turns
    turns = (
        db.query(SessionTurn)
        .filter(
            SessionTurn.session_id.in_(session_ids),
            SessionTurn.confidence_tag == "struggling",
            SessionTurn.student_answer != None,
        )
        .order_by(SessionTurn.created_at.desc())
        .limit(300)
        .all()
    )

    # Build a session_id → topic_id lookup
    sess_map = {
        row[0]: row[1]
        for row in db.query(SessionModel.id, SessionModel.topic_id)
        .filter(SessionModel.id.in_([t.session_id for t in turns]))
        .all()
    }

    # Deduplicate: keep most recent struggling turn per topic
    seen: dict[int, SessionTurn] = {}
    for turn in turns:
        tid = sess_map.get(turn.session_id)
        if tid and tid not in seen:
            seen[tid] = turn

    # Build response
    result = []
    for topic_id, turn in list(seen.items())[:limit]:
        t = db.query(Topic).filter(Topic.id == topic_id).first()
        if not t: continue
        ch = db.query(Chapter).filter(Chapter.id == t.chapter_id).first()
        bk = db.query(Book).filter(Book.id == ch.book_id).first() if ch else None
        m = db.query(TopicMastery).filter(
            TopicMastery.student_id == current_user.id,
            TopicMastery.topic_id == topic_id,
        ).first()
        result.append({
            "topic_id": topic_id,
            "topic_title": t.title,
            "subject": bk.subject if bk else "",
            "chapter_title": ch.title if ch else "",
            "mastery_level": m.mastery_level if m else None,
            "question": turn.question_text,
            "my_answer": turn.student_answer,
            "score": turn.assessment_score or 0,
            "practiced_at": turn.created_at.isoformat() if turn.created_at else None,
        })

    return {"mistakes": result}


@app.post("/api/exam/start")
def start_exam(
    req: ExamStartRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Generate a timed mock exam. Questions are produced in parallel from Claude."""
    if current_user.role != "student":
        raise HTTPException(status_code=403, detail="Students only")
    if not current_user.grade:
        raise HTTPException(status_code=400, detail="Grade not set")

    count = max(3, min(req.question_count, 15))
    time_limit = max(5, min(req.time_limit_minutes, 30)) * 60  # convert to seconds

    # ── Find chapters where ALL topics have been practiced by this student ──────
    chapter_query = (
        db.query(Chapter)
        .join(Book, Book.id == Chapter.book_id)
        .filter(Book.grade == current_user.grade, Book.ingestion_status == "done")
    )
    if req.subjects:
        chapter_query = chapter_query.filter(Book.subject.in_(req.subjects))

    all_chapters = chapter_query.all()

    # Pre-fetch this student's mastery records (topic_id set)
    practiced_topic_ids = set(
        row[0] for row in
        db.query(TopicMastery.topic_id)
        .filter(
            TopicMastery.student_id == current_user.id,
            TopicMastery.mastery_level.isnot(None),
        ).all()
    )

    completed_chapter_ids = []
    for ch in all_chapters:
        ch_topic_ids = [
            row[0] for row in
            db.query(Topic.id).filter(Topic.chapter_id == ch.id).all()
        ]
        if ch_topic_ids and all(tid in practiced_topic_ids for tid in ch_topic_ids):
            completed_chapter_ids.append(ch.id)

    if not completed_chapter_ids:
        raise HTTPException(
            status_code=400,
            detail="chapter_not_complete"
        )

    # Build topic pool — only from completed chapters
    all_topics = (
        db.query(Topic)
        .filter(Topic.chapter_id.in_(completed_chapter_ids))
        .all()
    )
    if not all_topics:
        raise HTTPException(status_code=400, detail="No topics available for selected subjects")

    # Pre-load chapter → book for context (needed by generate_question)
    for t in all_topics:
        t.chapter = db.query(Chapter).filter(Chapter.id == t.chapter_id).first()

    # Pick diverse set of topics (try different chapters)
    chosen = _pick_diverse_topics(all_topics, count)

    # Generate questions in parallel
    def _gen(args):
        topic, level = args
        bk = db.query(Book).filter(Book.id == topic.chapter.book_id).first() if topic.chapter else None
        return generate_question(topic, level, []), topic, bk

    # Exam uses L2-L3 level for variety
    exam_level = "L3"
    questions = []
    with _TPool(max_workers=min(len(chosen), 6)) as pool:
        futures = {pool.submit(_gen, (t, exam_level)): t for t in chosen}
        for fut in _as_completed(futures, timeout=90):
            try:
                nq, topic, book = fut.result(timeout=30)
                questions.append({
                    "topic_id": topic.id,
                    "topic_title": topic.title,
                    "subject": book.subject if book else "",
                    "question": nq["question"],
                    "expected_key_points": nq["expected_key_points"],
                    "answer_format": nq["answer_format"],
                })
            except Exception:
                pass

    if not questions:
        raise HTTPException(status_code=500, detail="Failed to generate exam questions")

    exam = ExamSession(
        user_id=current_user.id,
        grade=current_user.grade,
        subjects_json=json.dumps(req.subjects or []),
        questions_json=json.dumps(questions),
        time_limit_seconds=time_limit,
        question_count=len(questions),
        status="active",
    )
    db.add(exam)
    db.commit()
    db.refresh(exam)

    return {
        "exam_id": exam.id,
        "questions": questions,
        "time_limit_seconds": time_limit,
        "question_count": len(questions),
    }


def _pick_diverse_topics(topics: list, count: int) -> list:
    """Pick up to `count` topics, preferring variety across chapters."""
    if len(topics) <= count:
        return topics
    # Group by chapter and pick round-robin
    by_chapter: dict = {}
    for t in topics:
        cid = t.chapter_id
        if cid not in by_chapter:
            by_chapter[cid] = []
        by_chapter[cid].append(t)
    chosen = []
    chapters = list(by_chapter.values())
    random.shuffle(chapters)
    idx = 0
    while len(chosen) < count:
        bucket = chapters[idx % len(chapters)]
        if bucket:
            chosen.append(bucket.pop(random.randint(0, len(bucket) - 1)))
        idx += 1
        if all(len(b) == 0 for b in chapters):
            break
    return chosen


@app.post("/api/exam/submit")
def submit_exam(
    req: ExamSubmitRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Batch-assess all answers; update XP; mark exam complete."""
    if current_user.role != "student":
        raise HTTPException(status_code=403, detail="Students only")

    exam = db.query(ExamSession).filter(
        ExamSession.id == req.exam_id,
        ExamSession.user_id == current_user.id,
    ).first()
    if not exam:
        raise HTTPException(status_code=404, detail="Exam not found")
    if exam.status == "completed":
        # Idempotent — return stored results
        return {
            "total_score": exam.total_score,
            "xp_earned": exam.xp_earned,
            "results": json.loads(exam.scores_json or "[]"),
        }

    questions = json.loads(exam.questions_json)
    answers = req.answers

    # Pad/trim to match question count
    while len(answers) < len(questions):
        answers.append("")
    answers = answers[:len(questions)]

    # Assess in parallel
    def _assess_one(args):
        q, ans = args
        if not ans.strip():
            return {"score": 0, "feedback": "No answer provided.", "confidence_tag": "struggling",
                    "off_topic": True, "missed_key_points": []}
        topic = db.query(Topic).filter(Topic.id == q["topic_id"]).first()
        if not topic:
            return {"score": 0, "feedback": "Topic not found.", "confidence_tag": "struggling",
                    "off_topic": False, "missed_key_points": []}
        topic.chapter = db.query(Chapter).filter(Chapter.id == topic.chapter_id).first()
        return assess_answer(
            topic, q["question"], ans, "L3", hint_tier=0,
            expected_key_points=q.get("expected_key_points"),
            answer_format=q.get("answer_format"),
        )

    results = []
    with _TPool(max_workers=min(len(questions), 6)) as pool:
        futures = {pool.submit(_assess_one, (q, answers[i])): i
                   for i, q in enumerate(questions)}
        result_map = {}
        for fut in _as_completed(futures, timeout=120):
            i = futures[fut]
            try:
                result_map[i] = fut.result(timeout=30)
            except Exception:
                result_map[i] = {"score": 0, "feedback": "Assessment failed.", "confidence_tag": "struggling",
                                  "off_topic": False, "missed_key_points": []}

    for i, q in enumerate(questions):
        r = result_map.get(i, {"score": 0, "feedback": "", "confidence_tag": "struggling",
                                "off_topic": False, "missed_key_points": []})
        results.append({
            "question_num": i + 1,
            "topic_title": q["topic_title"],
            "subject": q["subject"],
            "question": q["question"],
            "my_answer": answers[i],
            "score": r["score"],
            "feedback": r["feedback"],
            "answer_format": q.get("answer_format"),
        })

    total_score = int(sum(r["score"] for r in results) / len(results)) if results else 0
    xp_earned = max(0, total_score)  # 1 XP per score point, max 100

    exam.answers_json = json.dumps(answers)
    exam.scores_json = json.dumps(results)
    exam.ended_at = datetime.utcnow()
    exam.status = "completed"
    exam.total_score = total_score
    exam.xp_earned = xp_earned
    _update_user_xp(db, current_user.id, xp_earned)
    db.commit()

    return {"total_score": total_score, "xp_earned": xp_earned, "results": results}


@app.post("/api/flashcard/question")
def get_flashcard_question(
    req: dict,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Generate a fresh L1 flashcard question for a topic."""
    if current_user.role != "student":
        raise HTTPException(status_code=403, detail="Students only")

    topic_id = req.get("topic_id")
    if not topic_id:
        raise HTTPException(status_code=400, detail="topic_id required")

    topic = db.query(Topic).filter(Topic.id == topic_id).first()
    if not topic:
        raise HTTPException(status_code=404, detail="Topic not found")
    topic.chapter = db.query(Chapter).filter(Chapter.id == topic.chapter_id).first()

    nq = _next_question(db, topic, "L1", [])
    return {
        "topic_id": topic.id,
        "topic_title": topic.title,
        "question": nq["question"],
        "expected_key_points": nq["expected_key_points"],
        "answer_format": nq["answer_format"],
    }


@app.post("/api/flashcard/mark")
def mark_flashcard(
    req: FlashcardMarkRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Update spaced-repetition interval based on whether student knew the answer."""
    if current_user.role != "student":
        raise HTTPException(status_code=403, detail="Students only")

    mastery = db.query(TopicMastery).filter(
        TopicMastery.student_id == current_user.id,
        TopicMastery.topic_id == req.topic_id,
    ).first()

    if mastery:
        _sm2_update(mastery, knew_it=req.known)
        db.commit()

    return {"updated": bool(mastery), "next_review_days": mastery.review_interval_days if mastery else 1}


@app.get("/api/student/sessions")
def student_sessions(
    limit: int = Query(50, ge=1, le=200),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Session history for the Study Time page."""
    if current_user.role != "student":
        raise HTTPException(status_code=403, detail="Students only")

    sessions = (
        db.query(SessionModel)
        .filter(SessionModel.user_id == current_user.id)
        .order_by(SessionModel.started_at.desc())
        .limit(limit)
        .all()
    )
    result = []
    for s in sessions:
        t = db.query(Topic).filter(Topic.id == s.topic_id).first()
        ch = db.query(Chapter).filter(Chapter.id == t.chapter_id).first() if t else None
        bk = db.query(Book).filter(Book.id == ch.book_id).first() if ch else None
        dur = None
        if s.started_at and s.ended_at:
            dur = int((s.ended_at - s.started_at).total_seconds() / 60)
        result.append({
            "id": s.id,
            "topic_title": t.title if t else "",
            "chapter_title": ch.title if ch else "",
            "subject": bk.subject if bk else "",
            "started_at": s.started_at.isoformat() if s.started_at else None,
            "duration_minutes": dur,
            "level_reached": s.current_level,
            "level_label": level_label(s.current_level),
            "questions_asked": s.questions_asked,
            "status": s.status,
        })
    return result


@app.get("/api/student/progress")
def student_progress(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Detailed per-book/chapter/topic mastery for the My Progress page."""
    if current_user.role != "student":
        raise HTTPException(status_code=403, detail="Students only")

    grade = current_user.grade

    books = db.query(Book).filter(Book.grade == grade, Book.ingestion_status == "done").all()

    all_masteries = db.query(TopicMastery).filter(
        TopicMastery.student_id == current_user.id
    ).all()
    mastery_by_topic: dict[int, TopicMastery] = {m.topic_id: m for m in all_masteries}

    result = []
    for book in books:
        chapters = (db.query(Chapter).filter(Chapter.book_id == book.id)
                    .order_by(Chapter.chapter_number).all())
        ch_data = []
        for ch in chapters:
            topics = db.query(Topic).filter(Topic.chapter_id == ch.id).order_by(Topic.id).all()
            topic_list = []
            for t in topics:
                m = mastery_by_topic.get(t.id)
                topic_list.append({
                    "id": t.id,
                    "topic_number": t.topic_number,
                    "title": t.title,
                    "key_concepts": t.key_concepts or [],
                    "mastery_level": m.mastery_level if m else None,
                    "mastery_sessions": m.total_sessions if m else 0,
                    "flagged_for_review": m.flagged_for_review if m else False,
                    "studied": m.studied if m else False,
                    "last_practiced_at": m.last_practiced_at.isoformat() if m and m.last_practiced_at else None,
                    "next_review_at": m.next_review_at.isoformat() if m and m.next_review_at else None,
                })
            total = len(topic_list)
            attempted = sum(1 for tl in topic_list if tl["mastery_level"] is not None)
            mastered = sum(1 for tl in topic_list if tl["mastery_level"] in ("L3", "L4", "L5"))
            ch_data.append({
                "id": ch.id,
                "chapter_number": ch.chapter_number,
                "title": ch.title,
                "total_topics": total,
                "attempted": attempted,
                "mastered": mastered,
                "topics": topic_list,
            })
        result.append({
            "book_id": book.id,
            "title": book.title or book.filename,
            "subject": book.subject,
            "chapters": ch_data,
        })
    return result
