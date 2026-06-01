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
from datetime import datetime, timedelta, date as _date
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
    AIUsageLog, AdminAuditLog, StudentGoal,
    AdminTask, AdminTaskExpense, AdminTaskDependency,
)
from ingestion import run_ingestion
from auth import get_current_user, require_admin, require_parent, verify_google_token, create_jwt
from session_engine import (
    generate_question, assess_answer, get_hint, get_concept_explanation,
    get_session_summary, determine_next_action, get_start_level,
    generate_sub_question, generate_worked_example, generate_parent_tip,
    generate_transfer_question,
    LEVEL_GUIDE, LEVEL_ORDER, PROMPT_VERSION,
)

app = FastAPI(title="TutorSnap API")

_DEFAULT_SETTINGS = [
    {"key": "max_questions_per_session", "value": "20"},
    {"key": "max_hint_tiers", "value": "5"},
    {"key": "session_timeout_minutes", "value": "30"},
    {"key": "break_reminder_at_questions", "value": "10"},   # suggest a break after N questions
]

# ── A/B summary helper (#64) ──────────────────────────────────────────────────
def _compute_ab_summary(db):
    """
    Compare outcomes between hint-throttle variants A (standard) and B (+1 hint).
    Returns per-variant session counts, avg final level score, avg questions answered.
    Only counts completed non-practice sessions that have ab_variant set.
    """
    _LEVEL_SCORE = {"L1": 20, "L2": 40, "L3": 60, "L4": 80, "L5": 100}
    rows = (
        db.query(SessionModel.ab_variant, SessionModel.current_level, SessionModel.questions_asked)
        .filter(
            SessionModel.status == "completed",
            SessionModel.is_practice == False,
            SessionModel.ab_variant.isnot(None),
        )
        .all()
    )
    buckets: dict[str, dict] = {}
    for variant, level, qs in rows:
        v = variant or "A"
        if v not in buckets:
            buckets[v] = {"sessions": 0, "score_sum": 0, "qs_sum": 0}
        buckets[v]["sessions"] += 1
        buckets[v]["score_sum"] += _LEVEL_SCORE.get(level or "L1", 20)
        buckets[v]["qs_sum"] += qs or 0
    result = {}
    for v, b in buckets.items():
        n = b["sessions"]
        result[v] = {
            "sessions": n,
            "avg_score": round(b["score_sum"] / n) if n else 0,
            "avg_questions": round(b["qs_sum"] / n, 1) if n else 0,
        }
    return result


# ── AI confidence helper (#66) ─────────────────────────────────────────────────
def _compute_ai_confidence(questions_asked: int, current_level: str) -> int:
    """
    Return 0-100 score reflecting how confident the AI is in the session assessment.
    Higher question count = more data = more confident.
    Higher mastery level reached = AI had clear evidence of understanding.
    """
    _LEVEL_WEIGHT = {"L1": 0.60, "L2": 0.72, "L3": 0.85, "L4": 0.93, "L5": 0.97}
    question_factor = min(questions_asked / 6.0, 1.0)  # full weight at ≥6 answered
    level_factor = _LEVEL_WEIGHT.get(current_level or "L1", 0.60)
    return int(level_factor * question_factor * 100)


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
            # Onboarding & daily goal — added in task #13/#17
            conn.execute(text(
                "ALTER TABLE users ADD COLUMN IF NOT EXISTS has_onboarded BOOLEAN DEFAULT FALSE"
            ))
            conn.execute(text(
                "ALTER TABLE users ADD COLUMN IF NOT EXISTS daily_goal_sessions INTEGER DEFAULT 1"
            ))
            conn.execute(text(
                "ALTER TABLE users ADD COLUMN IF NOT EXISTS weekly_mastery_goal INTEGER DEFAULT 0"
            ))
            conn.execute(text(
                "ALTER TABLE users ADD COLUMN IF NOT EXISTS daily_challenge_date DATE"
            ))
            # Student Goal Journal
            conn.execute(text("""
                CREATE TABLE IF NOT EXISTS student_goals (
                    id SERIAL PRIMARY KEY,
                    user_id INTEGER NOT NULL REFERENCES users(id),
                    goal_text VARCHAR(300) NOT NULL,
                    topic_id INTEGER REFERENCES topics(id),
                    week_start DATE NOT NULL,
                    created_at TIMESTAMP DEFAULT NOW(),
                    status VARCHAR(20) DEFAULT 'active',
                    result_note TEXT,
                    UNIQUE(user_id, week_start)
                )
            """))
            # Practice mode (#58) — low-stakes sessions with no mastery/XP updates
            conn.execute(text(
                "ALTER TABLE sessions ADD COLUMN IF NOT EXISTS is_practice BOOLEAN DEFAULT FALSE"
            ))
            # A/B testing (#64) — variant assigned at session start
            conn.execute(text(
                "ALTER TABLE sessions ADD COLUMN IF NOT EXISTS ab_variant VARCHAR(1)"
            ))
            # admin_audit_log and ai_usage_log are now created by Alembic migrations
            # (j2a3b4c5d6e7 / l4c5d6e7f8g9).  The old inline CREATE TABLE blocks
            # are removed because the ai_usage_log one used AUTOINCREMENT (SQLite-
            # only) which silently failed on PostgreSQL every time the app started.
            # Mastery quality gate (task #38)
            conn.execute(text(
                "ALTER TABLE topic_mastery ADD COLUMN IF NOT EXISTS mastery_confirmed BOOLEAN DEFAULT FALSE"
            ))
            # Session-to-session AI memory (task #40)
            conn.execute(text(
                "ALTER TABLE topic_mastery ADD COLUMN IF NOT EXISTS session_memory TEXT"
            ))
            # FK integrity (task #3): deduplicate then enforce unique (student_id, topic_id)
            conn.execute(text("""
                DELETE FROM topic_mastery
                WHERE student_id IS NOT NULL
                  AND id NOT IN (
                    SELECT MIN(id)
                    FROM topic_mastery
                    WHERE student_id IS NOT NULL
                    GROUP BY student_id, topic_id
                  )
            """))
            conn.execute(text("""
                CREATE UNIQUE INDEX IF NOT EXISTS ix_mastery_student_topic
                ON topic_mastery(student_id, topic_id)
                WHERE student_id IS NOT NULL
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
        # Onboarding & goal
        "has_onboarded": bool(u.has_onboarded),
        "daily_goal_sessions": u.daily_goal_sessions or 1,
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
    # task #38: only count topics that passed the quality gate (L3+ AND ≥2 sessions)
    mastered = db.query(func.count(TopicMastery.id)).filter(
        TopicMastery.student_id == user_id,
        TopicMastery.mastery_confirmed == True,
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


def _audit_log(
    db: Session,
    admin: Optional[User],
    action: str,
    target_type: Optional[str] = None,
    target_id: Optional[int] = None,
    target_name: Optional[str] = None,
    details: Optional[str] = None,
) -> None:
    """Append a row to admin_audit_log. Caller must commit."""
    db.add(AdminAuditLog(
        admin_id=admin.id if admin else None,
        admin_name=admin.name if admin else None,
        action=action,
        target_type=target_type,
        target_id=target_id,
        target_name=target_name,
        details=details,
    ))


def _next_question(db: Session, topic, level: str, prev_qs: list[str],
                   recent_fmts: list[str] = None, study_summary: str = "",
                   session_memory: str = "") -> dict:
    """Try the question bank first; fall back to live AI generation; final static fallback.

    task #6  — graceful failure: never crash the session if AI is unavailable.
    task #40 — session_memory passed to generate_question for continuity.
    """
    from question_bank import draw_from_bank
    bank_q = draw_from_bank(db, topic.id, level, prev_qs)
    if bank_q:
        return bank_q
    try:
        return generate_question(
            topic, level, prev_qs,
            recent_formats=recent_fmts or [],
            study_summary=study_summary,
            session_memory=session_memory,
        )
    except Exception as exc:
        print(f"[_next_question] AI generation failed ({exc}); using static fallback.")
        # Static fallback — always safe, never crashes the session
        key_concepts = topic.key_concepts or []
        hint = (f" Focus on: {', '.join(key_concepts[:2])}." if key_concepts else "")
        return {
            "question": (
                f"📘 {topic.title} — Can you explain one key concept from this topic "
                f"in your own words?{hint}"
            ),
            "expected_key_points": list(key_concepts[:2]) or ["any concept from the topic"],
            "answer_format": "explanation",
        }


def _update_mastery(db: Session, session, topic, flagged: bool = False, session_summary: str = ""):
    """Update TopicMastery after a session ends, applying SM-2 scheduling.

    session_summary (task #40): compact text summary of this session; appended
    to the rolling session_memory JSON array (last 3 entries kept).
    mastery_confirmed (task #38): set True only when level >= L3 AND total_sessions >= 2.
    """
    level_order = ["L1", "L2", "L3", "L4", "L5"]
    level_idx = level_order.index(session.current_level) if session.current_level in level_order else 0

    mastery = db.query(TopicMastery).filter(
        TopicMastery.student_id == session.user_id,
        TopicMastery.topic_id == session.topic_id,
    ).first()

    now = datetime.utcnow()

    def _build_memory_entry() -> dict:
        return {
            "summary": session_summary[:500],
            "level": session.current_level,
            "date": now.strftime("%Y-%m-%d"),
        }

    if mastery:
        prev_idx = level_order.index(mastery.mastery_level) if mastery.mastery_level in level_order else 0
        knew_it = level_idx >= prev_idx  # maintained or improved = "knew it"
        mastery.mastery_level = session.current_level
        mastery.last_practiced_at = now
        mastery.total_sessions += 1
        _sm2_update(mastery, knew_it)
        if flagged or session.flagged_for_review:
            mastery.flagged_for_review = True

        # ── Task #38: mastery quality gate ────────────────────────────────────
        final_idx = level_order.index(mastery.mastery_level) if mastery.mastery_level in level_order else 0
        mastery.mastery_confirmed = (final_idx >= 2 and mastery.total_sessions >= 2)

        # ── Task #40: session memory (rolling last-3) ─────────────────────────
        if session_summary:
            existing: list = []
            try:
                existing = json.loads(mastery.session_memory or "[]")
                if not isinstance(existing, list):
                    existing = []
            except Exception:
                existing = []
            existing.append(_build_memory_entry())
            mastery.session_memory = json.dumps(existing[-3:])
    else:
        # First practice session: seed SM-2 with level-based initial interval.
        # mastery_confirmed stays False (total_sessions = 1, below the 2-session threshold).
        init_interval = _REVIEW_INTERVALS.get(session.current_level, 3)
        new_mastery = TopicMastery(
            student_id=session.user_id,
            student_name=session.student_name,
            topic_id=session.topic_id,
            mastery_level=session.current_level,
            last_practiced_at=now,
            total_sessions=1,
            mastery_confirmed=False,
            flagged_for_review=flagged or session.flagged_for_review,
            next_review_at=now + timedelta(days=init_interval),
            review_interval_days=init_interval,
            ease_factor=2.5,
            session_memory=(
                json.dumps([_build_memory_entry()]) if session_summary else None
            ),
        )
        db.add(new_mastery)
    db.commit()


# ─── Pydantic request models ───────────────────────────────────────────────

class GoogleLoginRequest(BaseModel):
    credential: str

class StartSessionRequest(BaseModel):
    student_name: str
    topic_id: int
    practice_mode: Optional[bool] = False  # #58: low-stakes mode — skips mastery & XP


class EncourageRequest(BaseModel):                          # #50
    message: str

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

class CompleteOnboardingRequest(BaseModel):
    buddy_avatar: Optional[str] = None
    buddy_name: Optional[str] = None
    daily_goal_sessions: Optional[int] = 1

class StudentImportRow(BaseModel):
    email: str
    name: str
    grade: Optional[int] = None

class StudentImportRequest(BaseModel):
    students: list[StudentImportRow]

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


@app.get("/api/admin/books/{book_id}/preview")
def admin_preview_book(
    book_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    """Rich preview of a book's extracted content for admin review — works on any ingestion status."""
    book = db.query(Book).filter(Book.id == book_id).first()
    if not book:
        raise HTTPException(status_code=404, detail="Book not found")

    chapters = (db.query(Chapter).filter(Chapter.book_id == book_id)
                .order_by(Chapter.chapter_number).all())

    chapters_data = []
    all_vocab: list = []
    all_concepts: list = []
    topic_count = 0

    for ch in chapters:
        topics = db.query(Topic).filter(Topic.chapter_id == ch.id).order_by(Topic.id).all()
        topic_list = []
        for t in topics:
            topic_count += 1
            kc = t.key_concepts or []
            vc = t.vocabulary or []
            all_concepts.extend(kc[:3])
            all_vocab.extend(vc[:3])
            topic_list.append({
                "id": t.id,
                "topic_number": t.topic_number,
                "title": t.title,
                "difficulty_ceiling": t.difficulty_ceiling,
                "key_concepts": kc,
                "vocabulary": vc,
            })
        chapters_data.append({
            "id": ch.id,
            "chapter_number": ch.chapter_number,
            "title": ch.title,
            "topic_count": len(topic_list),
            "topics": topic_list,
        })

    return {
        "book_id": book.id,
        "title": book.title or book.filename,
        "subject": book.subject,
        "grade": book.grade,
        "ingestion_status": book.ingestion_status,
        "upload_stage": book.upload_stage,
        "chapter_count": len(chapters_data),
        "topic_count": topic_count,
        "sample_concepts": list(dict.fromkeys(all_concepts))[:12],
        "sample_vocab": list(dict.fromkeys(all_vocab))[:12],
        "chapters": chapters_data,
    }


@app.post("/api/admin/books/{book_id}/publish")
def publish_book(
    book_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    """Approve and publish a book that has finished ingestion (status 'review').
    After this call the book is visible to students."""
    book = db.query(Book).filter(Book.id == book_id).first()
    if not book:
        raise HTTPException(status_code=404, detail="Book not found")
    if book.ingestion_status not in ("review", "done"):
        raise HTTPException(
            status_code=400,
            detail=f"Book is not ready for review (status: {book.ingestion_status})"
        )
    book.ingestion_status = "done"
    _audit_log(
        db, current_user,
        action="publish_book",
        target_type="book",
        target_id=book.id,
        target_name=book.title or book.filename,
        details=f"Approved and published book: {book.chapter_count} chapters, {book.topic_count} topics",
    )
    db.commit()
    return {"ok": True, "book_id": book.id, "title": book.title or book.filename}


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


@app.get("/api/parent/topics/{topic_id}/explain")
def explain_topic_for_parent(
    topic_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Parent-facing topic explainer: plain-English overview of what the topic covers
    and concrete at-home support tips — no jargon, no student-level detail.
    """
    if current_user.role not in ("parent", "admin"):
        raise HTTPException(status_code=403, detail="Parents only")

    topic = db.query(Topic).filter(Topic.id == topic_id).first()
    if not topic:
        raise HTTPException(status_code=404, detail="Topic not found")
    topic.chapter = db.query(Chapter).filter(Chapter.id == topic.chapter_id).first()

    from session_engine import build_topic_context, call_claude, get_subject_label, _SONNET
    subject_label = get_subject_label(topic)
    book = getattr(topic.chapter, "book", None) if topic.chapter else None
    grade = getattr(book, "grade", None) or 7

    system = (
        f"You are a helpful education assistant writing for a parent, not a student. "
        f"Your job is to explain what their child is learning in {subject_label} (Grade {grade}) "
        f"in plain everyday language — no jargon, no formulas unless unavoidable. "
        f"You must stay strictly within the topic content provided below.\n\n"
        f"{build_topic_context(topic)}"
    )

    user_prompt = (
        "A parent wants to understand what their child is studying. "
        "Write a parent guide with this exact structure:\n\n"
        "📘 **What is this topic about?** — 2-3 sentences in everyday language. "
        "Imagine explaining to someone with no subject background.\n\n"
        "🎯 **What will my child be able to do?** — 3 bullet points describing the skills "
        "or knowledge their child should gain (start each with an action verb).\n\n"
        "🏠 **How can I help at home?** — 3 specific, practical suggestions a parent can do "
        "today or this week to support their child. Be concrete and activity-based.\n\n"
        "❓ **Good questions to ask your child** — 3 conversation-starter questions "
        "that naturally check understanding without feeling like a test.\n\n"
        "Keep the tone warm, supportive, and brief. "
        "Do not use technical terms without a simple explanation in brackets. "
        "Do not include anything outside the topic content above."
    )

    explanation = call_claude(system, user_prompt, max_tokens=800, model=_SONNET)
    return {
        "topic_id": topic_id,
        "topic_title": topic.title,
        "subject": subject_label,
        "grade": grade,
        "explanation": explanation,
    }


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


class TeachChatRequest(BaseModel):
    messages: list   # [{role: "user"|"assistant", content: str}]
    turn_number: int = 1   # how many student turns so far (1-indexed)


@app.post("/api/topics/{topic_id}/teach-chat")
def teach_chat(
    topic_id: int,
    req: TeachChatRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Teach-it-back (Feynman) mode.
    Buddy plays a curious student who knows nothing — the real student must explain
    the topic. After 3 student turns Buddy switches to assessment mode and returns
    a score, gap list, and XP reward.
    """
    if current_user.role != "student":
        raise HTTPException(status_code=403, detail="Students only")

    topic = db.query(Topic).filter(Topic.id == topic_id).first()
    if not topic:
        raise HTTPException(status_code=404, detail="Topic not found")
    topic.chapter = db.query(Chapter).filter(Chapter.id == topic.chapter_id).first()

    from session_engine import build_topic_context, call_claude, get_subject_label, _SONNET
    import anthropic as _anthropic
    subject_label = get_subject_label(topic)
    book = getattr(topic.chapter, "book", None) if topic.chapter else None
    grade = getattr(book, "grade", None) or 7

    MAX_STUDENT_TURNS = 3
    is_assessment_turn = req.turn_number > MAX_STUDENT_TURNS

    if not is_assessment_turn:
        # ── Probing phase: Buddy is a curious student ──────────────────────
        questions_left = MAX_STUDENT_TURNS - req.turn_number + 1
        system = (
            f"You are playing the role of a curious {subject_label} student in Grade {grade} "
            f"who knows NOTHING about '{topic.title}'. "
            f"A fellow student is teaching you this topic. Your job:\n"
            f"1. Listen to their explanation carefully.\n"
            f"2. Ask ONE short, genuine follow-up question about something they said OR "
            f"   something important about the topic they haven't explained yet.\n"
            f"3. Keep your reply SHORT — one sentence of acknowledgement + one question only.\n"
            f"4. Do NOT reveal that you already know the answer. Stay in character.\n"
            f"5. Do NOT explain the topic yourself — only ask questions.\n\n"
            f"You have {questions_left} question(s) left before the session ends.\n\n"
            f"Topic reference (for you to know what to probe, NOT to share with the student):\n"
            f"{build_topic_context(topic)}"
        )
        client = _anthropic.Anthropic(api_key=os.environ.get("ANTHROPIC_API_KEY", ""))
        resp = client.messages.create(
            model=_SONNET,
            max_tokens=200,
            system=system,
            messages=req.messages[-8:],
        )
        reply = resp.content[0].text.strip()
        return {"reply": reply, "is_done": False}

    else:
        # ── Assessment phase: Buddy evaluates the full explanation ──────────
        # Build a transcript of only the student's turns for assessment
        student_turns = [m["content"] for m in req.messages if m.get("role") == "user"]
        student_explanation = "\n\n".join(
            f"[Turn {i+1}] {t}" for i, t in enumerate(student_turns)
        )

        assessment_prompt = (
            f"A student has just finished teaching the topic '{topic.title}' "
            f"({subject_label}, Grade {grade}). Below is everything they said:\n\n"
            f"--- STUDENT EXPLANATION ---\n{student_explanation}\n---\n\n"
            f"Topic reference (ground truth):\n{build_topic_context(topic)}\n\n"
            f"Evaluate their explanation. Respond ONLY with valid JSON — no markdown, no commentary:\n"
            f'{{"score": 75, "summary": "One warm sentence praising what they got right.", '
            f'"gaps": ["gap 1 (max 8 words)", "gap 2"], "xp_earned": 20}}\n\n'
            f"Rules:\n"
            f"- score: 0-100 integer. 80+ = excellent, 60-79 = good, 40-59 = partial, <40 = needs work.\n"
            f"- summary: 1-2 warm encouraging sentences highlighting what they did well.\n"
            f"- gaps: list of 0-3 KEY concepts they missed or got wrong (short phrases, max 8 words each). "
            f"  Empty list [] if score >= 85.\n"
            f"- xp_earned: 20 base if score >= 40; 30 if score >= 70; 40 if score >= 90. else 10."
        )

        assessment_json = call_claude(
            "You are a strict but fair examiner. Return ONLY valid JSON, nothing else.",
            assessment_prompt,
            max_tokens=400,
            model=_SONNET,
        )

        import json as _json
        try:
            data = _json.loads(assessment_json)
        except Exception:
            # Fallback
            data = {"score": 60, "summary": "Good effort explaining the topic!", "gaps": [], "xp_earned": 20}

        score = int(data.get("score", 60))
        xp = int(data.get("xp_earned", 20))

        # Award XP to the student
        current_user.total_xp = (current_user.total_xp or 0) + xp
        current_user.weekly_xp = (current_user.weekly_xp or 0) + xp
        db.commit()

        return {
            "is_done": True,
            "score": score,
            "summary": data.get("summary", ""),
            "gaps": data.get("gaps", []),
            "xp_earned": xp,
        }


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
    # Practice mode (#58) bypasses the gate — no mastery/XP changes anyway.
    if not mastery.studied and not req.practice_mode:
        if not just_created and mastery.total_sessions > 1:
            mastery.studied = True
            db.commit()
        else:
            raise HTTPException(status_code=403, detail="study_required")

    # Trigger diagnostic pre-assessment on the very first practice session
    # (mastery.total_sessions == 1 means study was done but no practice yet)
    is_first_practice = (mastery.total_sessions == 1)
    start_level = "L1" if is_first_practice else get_start_level(mastery.mastery_level)

    # Practice mode: skip diagnostic and start at mastery level (or L1 if first)
    if req.practice_mode:
        is_first_practice = False  # no diagnostic in practice mode
    session = SessionModel(
        student_name=req.student_name,
        user_id=current_user.id,
        topic_id=req.topic_id,
        current_level=start_level,
        status="active",
        diagnostic_phase=is_first_practice,
        diagnostic_turn=1 if is_first_practice else 0,
        is_practice=bool(req.practice_mode),  # #58
        ab_variant="A" if random.randint(0, 1) == 0 else "B",  # #64: random 50/50 split
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
    q = _next_question(db, topic, start_level, previous_questions, [],
                       mastery.study_summary or "", mastery.session_memory or "")
    db.add(SessionTurn(
        session_id=session.id, turn_number=1,
        question_text=q["question"], level=start_level,
        expected_key_points=json.dumps(q["expected_key_points"]),
        answer_format=q["answer_format"],
    ))
    session.questions_asked = 1
    db.commit()

    # ── Worked example (task #30): show before first real practice question ───
    # Only for non-diagnostic sessions where the student has study notes.
    worked_example = None
    if not is_first_practice and mastery.study_summary:
        worked_example = generate_worked_example(topic, start_level, mastery.study_summary)
        if not worked_example:
            worked_example = None  # keep None if generation fails

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
        "worked_example": worked_example,
        "is_practice": bool(req.practice_mode),  # #58
        "prompt_version": PROMPT_VERSION,         # #65
    }


@app.post("/api/session/answer")
def submit_answer(
    req: AnswerRequest,
    background_tasks: BackgroundTasks,
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
    _session_memory = (_mastery.session_memory or "") if _mastery else ""  # task #40

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
            nq = _next_question(db, topic, next_diag_level, prev_qs, [], _study_summary, _session_memory)
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
            nq = _next_question(db, topic, placement, prev_qs, [], _study_summary, _session_memory)
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

    # ── XP awards (task #42 — integrity: scaled by level, min 3 turns) ───────
    # Per-turn XP scales with difficulty so grinding easy topics gives less XP.
    # session_complete bonus scales by level reached.
    # Minimum 3 answered turns before any session/advance bonus is paid.
    # Practice mode (#58) skips all XP and mastery updates.
    _XP_PER_TURN = {"L1": 5, "L2": 8, "L3": 10, "L4": 15, "L5": 20}
    _XP_SESSION_COMPLETE = {"L1": 50, "L2": 70, "L3": 100, "L4": 130, "L5": 160}
    _XP_ADVANCE_LEVEL    = {"L1": 15, "L2": 20, "L3": 30, "L4": 40, "L5": 50}

    xp_earned = 0
    if session.user_id and not session.is_practice:
        action = next_action["action"]
        lvl = session.current_level or "L1"
        turns_answered = session.questions_asked or 0

        if action == "session_complete":
            # Full bonus only after meaningful engagement (≥3 turns)
            xp_earned = _XP_SESSION_COMPLETE.get(lvl, 100) if turns_answered >= 3 else 20
        elif action == "advance_level":
            xp_earned = _XP_ADVANCE_LEVEL.get(lvl, 30) if turns_answered >= 3 else 0
        elif action in ("next_question", "retry_question") and assessment.get("score", 0) >= 80:
            # Per-turn reward for a correct answer (hint penalty already applied to score)
            xp_earned = _XP_PER_TURN.get(lvl, 10)

        if xp_earned > 0:
            _update_user_xp(db, session.user_id, xp_earned)

    # ── Variable reward: surprise double-XP (~15% chance) — task #53 ─────────
    # Triggers only on a confident, hint-free, high-score answer in next_question turns.
    bonus_xp = 0
    if (session.user_id and not session.is_practice and xp_earned > 0
            and next_action["action"] in ("next_question",)
            and assessment.get("confidence_tag") in ("confident", "very_confident")
            and (session.hint_tier or 0) == 0
            and assessment.get("score", 0) >= 90
            and random.random() < 0.15):
        bonus_xp = xp_earned
        _update_user_xp(db, session.user_id, bonus_xp)

    if next_action["action"] == "session_complete":
        session.ended_at = datetime.utcnow()
        session.status = "completed"
        session.final_confidence = assessment["confidence_tag"]
        # Generate summary before _update_mastery so it can be stored in session_memory (#40)
        turns = db.query(SessionTurn).filter(SessionTurn.session_id == session.id).all()
        summary = get_session_summary(session, topic, turns)
        # Practice mode: generate summary for feedback but skip mastery update (#58)
        if not session.is_practice:
            _update_mastery(db, session, topic, session_summary=summary)
        db.commit()

        # ── Parent tip notification (task #49, background so it doesn't delay response) ──
        # Skip for practice sessions (no meaningful mastery change to report)
        if session.user_id and not session.is_practice:
            _parent_links = db.query(ParentStudentLink).filter(
                ParentStudentLink.student_id == session.user_id
            ).all()
            if _parent_links:
                _student = db.query(User).filter(User.id == session.user_id).first()
                _mastery_lvl = _mastery.mastery_level if _mastery else "L1"
                background_tasks.add_task(
                    _send_parent_tip_bg,
                    student_name=_student.name if _student else "Your child",
                    topic_title=topic.title,
                    key_concepts=topic.key_concepts or [],
                    mastery_level=_mastery_lvl,
                    session_summary=summary,
                    parent_ids=[lnk.parent_id for lnk in _parent_links],
                )

        return {"session_id": session.id, "feedback": assessment["feedback"],
                "score": assessment["score"], "confidence_tag": assessment["confidence_tag"],
                "action": "session_complete", "current_level": session.current_level,
                "level_label": level_label(session.current_level), "show_hint_button": False,
                "session_complete": True, "summary": summary,
                "turn_number": current_turn.turn_number, "xp_earned": xp_earned,
                "is_practice": bool(session.is_practice),
                "ai_confidence": _compute_ai_confidence(session.questions_asked, session.current_level)}  # #66

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
                            _study_summary, _session_memory)
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
                            _study_summary, _session_memory)
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

    # ── Session length controls (task #12) ────────────────────────────────────
    _max_qs_setting = db.query(AppSettings).filter(
        AppSettings.key == "max_questions_per_session"
    ).first()
    _max_qs = int(_max_qs_setting.value) if _max_qs_setting else 20
    _break_at_setting = db.query(AppSettings).filter(
        AppSettings.key == "break_reminder_at_questions"
    ).first()
    _break_at = int(_break_at_setting.value) if _break_at_setting else 10

    # Hard limit: force session_complete when max questions reached
    if session.questions_asked >= _max_qs:
        session.status = "completed"
        session.ended_at = datetime.utcnow()
        session.final_confidence = assessment["confidence_tag"]
        turns = db.query(SessionTurn).filter(SessionTurn.session_id == session.id).all()
        summary = get_session_summary(session, topic, turns)
        if not session.is_practice:  # #58: skip mastery in practice mode
            _update_mastery(db, session, topic, session_summary=summary)
        db.commit()
        return {"session_id": session.id, "feedback": assessment["feedback"],
                "score": assessment["score"], "confidence_tag": assessment["confidence_tag"],
                "action": "session_complete", "current_level": session.current_level,
                "level_label": level_label(session.current_level), "show_hint_button": False,
                "session_complete": True, "summary": summary,
                "turn_number": current_turn.turn_number, "xp_earned": xp_earned,
                "at_question_limit": True,
                "ai_confidence": _compute_ai_confidence(session.questions_asked, session.current_level)}  # #66

    # Soft limit: suggest break
    suggest_break = (session.questions_asked > 0 and
                     session.questions_asked % _break_at == 0 and
                     next_action.get("action") == "next_question")

    db.commit()
    return {"session_id": session.id, "feedback": assessment["feedback"],
            "score": assessment["score"], "confidence_tag": assessment["confidence_tag"],
            "action": next_action["action"], "current_level": session.current_level,
            "level_label": level_label(session.current_level),
            "show_hint_button": next_action.get("show_hint_button", False),
            "session_complete": False, "next_question": next_question,
            "concept_explanation": concept_explanation, "xp_earned": xp_earned,
            "bonus_xp": bonus_xp,  # task #53: variable reward bonus
            "answer_format": next_answer_format,
            "turn_number": new_turn_number,
            "suggest_break": suggest_break,
            "transcription": assessment.get("transcription"),
            "misconception": assessment.get("misconception")}


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

    # ── Task #45: throttle hints by mastery level ──────────────────────────────
    # Higher mastery = fewer free hints (students should work harder before asking).
    # L1 → 5 hints (full support), L2 → 4, L3 → 3, L4/L5 → 2.
    _hint_mastery = db.query(TopicMastery).filter(
        TopicMastery.student_id == session.user_id,
        TopicMastery.topic_id == session.topic_id,
    ).first() if session.user_id else None
    if _hint_mastery and _hint_mastery.mastery_level:
        _lvl_order = ["L1", "L2", "L3", "L4", "L5"]
        _lvl_i = _lvl_order.index(_hint_mastery.mastery_level) if _hint_mastery.mastery_level in _lvl_order else 0
        max_hints = max(2, max_hints - _lvl_i)  # L1=5,L2=4,L3=3,L4=2,L5=2
    # #64 A/B: Variant B gets one extra hint — tests whether more scaffolding improves outcomes
    if getattr(session, "ab_variant", None) == "B":
        max_hints = min(max_hints + 1, 6)

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
                            _study_summary, _session_memory)
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
        session.status = "completed"
        session.ended_at = datetime.utcnow()
        if not session.is_practice:  # #58: no flagging in practice mode
            session.flagged_for_review = True
            _update_mastery(db, session, topic, flagged=True)
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
        turns = db.query(SessionTurn).filter(SessionTurn.session_id == session.id).all()
        summary = get_session_summary(session, topic, turns)
        if not session.is_practice:  # #58: skip mastery in practice mode
            _update_mastery(db, session, topic, session_summary=summary)
        db.commit()
    else:
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

    # ── Stats snapshot for achievement detection (task #29) ──────────────────
    total_sessions_now = db.query(func.count(SessionModel.id)).filter(
        SessionModel.user_id == current_user.id
    ).scalar() or 0
    topics_mastered_now = db.query(func.count(TopicMastery.id)).filter(
        TopicMastery.student_id == current_user.id,
        TopicMastery.mastery_level.in_(["L3", "L4", "L5"]),
    ).scalar() or 0

    return {"session_id": session.id, "student_name": session.student_name,
            "topic_title": topic.title, "level_reached": session.current_level,
            "level_label": level_label(session.current_level),
            "questions_asked": session.questions_asked, "summary": summary,
            "flagged_for_review": session.flagged_for_review,
            "xp_earned": xp_display,
            "xp_breakdown": xp_breakdown,
            "streak_days": new_streak,
            "streak_freeze_available": current_user.streak_freeze_available,
            # For badge detection
            "total_sessions": total_sessions_now,
            "total_xp": current_user.total_xp or 0,
            "topics_mastered": topics_mastered_now,
            "total_questions_answered": db.query(func.sum(SessionModel.questions_asked)).filter(
                SessionModel.user_id == current_user.id,
                SessionModel.status == "completed",
            ).scalar() or 0,  # #47 effort badge track
            # #65 prompt versioning / #66 confidence
            "prompt_version": PROMPT_VERSION,
            "ai_confidence": _compute_ai_confidence(session.questions_asked, session.current_level)}


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
    db.flush()  # get the id before commit
    _audit_log(db, current_user, "create_student", "student", student.id, student.name,
               f"Grade: {req.grade}")
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
    old_grade = user.grade
    user.grade = req.grade
    _audit_log(db, current_user, "update_grade", "student", user.id, user.name,
               f"Grade {old_grade} → {req.grade}")
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
    _audit_log(db, current_user, "deactivate_student", "student", user.id, user.name)
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
    _audit_log(db, current_user, "activate_student", "student", user.id, user.name)
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
    _audit_log(db, current_user, "reset_mastery", "student", user.id, user.name,
               f"{deleted} topic records cleared")
    db.commit()
    return {"message": f"Mastery reset for {user.name}", "topics_cleared": deleted}


# ── Bulk CSV import (task #21) ────────────────────────────────────────────────

@app.post("/api/admin/students/import")
def admin_import_students(
    req: StudentImportRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    """Import up to 200 students from a parsed CSV payload."""
    if len(req.students) > 200:
        raise HTTPException(status_code=400, detail="Maximum 200 students per import")

    results = []
    created = updated = errors = 0

    for row in req.students:
        email = (row.email or "").strip().lower()
        name  = (row.name  or "").strip()
        if not email or not name:
            results.append({"email": email, "name": name, "status": "error",
                             "error": "Email and name are required"})
            errors += 1
            continue
        try:
            existing = db.query(User).filter(User.email == email).first()
            if existing:
                existing.role = "student"
                existing.name = name
                if row.grade:
                    existing.grade = row.grade
                db.commit()
                results.append({"email": email, "name": name, "status": "updated", "error": None})
                updated += 1
            else:
                student = User(email=email, name=name,
                               google_id=f"stub_{email}",
                               role="student", grade=row.grade, is_active=True)
                db.add(student)
                db.commit()
                results.append({"email": email, "name": name, "status": "created", "error": None})
                created += 1
        except Exception as exc:
            db.rollback()
            results.append({"email": email, "name": name, "status": "error", "error": str(exc)})
            errors += 1

    _audit_log(db, current_user, "import_students", "students", None, None,
               f"{created} created, {updated} updated, {errors} errors")
    db.commit()

    return {"results": results, "created": created, "updated": updated, "errors": errors}


# ── Audit log read endpoint (task #22) ───────────────────────────────────────

@app.get("/api/admin/audit-log")
def admin_audit_log(
    limit: int = Query(100, ge=1, le=500),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    rows = (
        db.query(AdminAuditLog)
        .order_by(AdminAuditLog.created_at.desc())
        .limit(limit)
        .all()
    )
    return [
        {
            "id": r.id,
            "admin_name": r.admin_name or "System",
            "action": r.action,
            "target_type": r.target_type,
            "target_id": r.target_id,
            "target_name": r.target_name,
            "details": r.details,
            "created_at": r.created_at.isoformat() if r.created_at else None,
        }
        for r in rows
    ]


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
    topic = db.query(Topic).filter(Topic.id == topic_id).first()
    _audit_log(db, current_user, "resolve_flag", "student", user.id, user.name,
               f"Topic: {topic.title if topic else topic_id}")
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

    # ── Hardest topics (#61): most flags relative to sessions ──────────────
    topic_flag_rows = (
        db.query(
            Topic.id,
            Topic.title,
            Book.subject,
            func.count(TopicMastery.id).label("flags"),
        )
        .join(TopicMastery, TopicMastery.topic_id == Topic.id)
        .join(Chapter, Chapter.id == Topic.chapter_id)
        .join(Book, Book.id == Chapter.book_id)
        .filter(TopicMastery.flagged_for_review == True)
        .group_by(Topic.id, Topic.title, Book.subject)
        .order_by(func.count(TopicMastery.id).desc())
        .limit(8)
        .all()
    )
    hardest_topics = [
        {"topic_id": r.id, "title": r.title, "subject": r.subject, "flags": r.flags}
        for r in topic_flag_rows
    ]

    # ── AI usage summary (last 7 days) ──────────────────────────────────────
    cutoff_7d = now - timedelta(days=7)
    ai_cost_7d = db.query(func.sum(AIUsageLog.cost_usd)).filter(
        AIUsageLog.called_at >= cutoff_7d
    ).scalar() or 0.0

    return {
        "sessions_trend": trend,
        "grade_breakdown": grade_breakdown,
        "subject_breakdown": subject_breakdown,
        "mastery_distribution": mastery_dist,
        "top_students": top_students,
        "hardest_topics": hardest_topics,    # #61
        "ai_cost_7d": round(ai_cost_7d, 4), # bonus: quick cost visibility on analytics page
        "prompt_version": PROMPT_VERSION,    # #65: which prompt version is live
        "ab_summary": _compute_ab_summary(db),  # #64: A/B variant outcome comparison
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
        # Today's session count for goal ring
        today_start_child = datetime.utcnow().replace(hour=0, minute=0, second=0, microsecond=0)
        sessions_today_child = db.query(func.count(SessionModel.id)).filter(
            SessionModel.user_id == child.id,
            SessionModel.started_at >= today_start_child,
        ).scalar() or 0
        result.append({
            "id": child.id, "name": child.name, "grade": child.grade,
            "avatar_url": child.avatar_url,
            "last_active": last_session.started_at.isoformat() if last_session and last_session.started_at else None,
            "total_sessions": stats["total_sessions"],
            "topics_mastered": stats["topics_mastered"],
            "flagged_topics": stats["flagged_topics"],
            "streak_days": streak,
            "sessions_this_week": sessions_this_week,
            "daily_goal_sessions": child.daily_goal_sessions or 1,
            "sessions_today": sessions_today_child,
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
            "topic_id": m.topic_id,
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
            book = db.query(Book).filter(Book.id == chapter.book_id).first() if chapter else None
            flagged_topics.append({
                "topic_id": m.topic_id,
                "topic_title": topic.title if topic else "",
                "chapter_title": chapter.title if chapter else "",
                "subject": book.subject if book else "Other",
                "mastery_level": m.mastery_level,
                "message": (f"{child.name} needed extra help with {topic.title if topic else 'this topic'}. "
                            "Consider reviewing it together."),
            })

    # Today's session count & daily goal (task #15/#17)
    today_start_dt = datetime.utcnow().replace(hour=0, minute=0, second=0, microsecond=0)
    sessions_today_count = sum(1 for s in sessions if s.started_at and s.started_at >= today_start_dt)
    daily_goal = child.daily_goal_sessions or 1

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

    # ── Score trend (14 days) — derived from session mastery level (#51) ─────────
    _LEVEL_SCORE = {"L1": 20, "L2": 40, "L3": 60, "L4": 80, "L5": 100}
    trend_cutoff = datetime.utcnow() - timedelta(days=14)
    trend_sessions = [s for s in sessions if s.started_at and s.started_at >= trend_cutoff and s.status == "completed"]
    score_by_day: dict[str, list] = {}
    for s in trend_sessions:
        d = s.started_at.date().isoformat()
        score_by_day.setdefault(d, []).append(_LEVEL_SCORE.get(s.current_level or "L1", 20))
    score_trend = []
    for i in range(14):
        d = (today_dt - timedelta(days=13 - i)).isoformat()
        scores = score_by_day.get(d, [])
        score_trend.append({
            "date": d,
            "avg_score": round(sum(scores) / len(scores)) if scores else None,
            "sessions": len(scores),
        })

    return {
        "student": {"name": child.name, "grade": child.grade,
                    "daily_goal_sessions": daily_goal,
                    "sessions_today": sessions_today_count},
        "summary": {"total_sessions": total_sessions, "total_time_minutes": total_minutes,
                    "topics_practised": topics_practised, "topics_at_l3_or_above": topics_at_l3,
                    "flagged_topics": flagged_count, "streak_days": streak_detail,
                    "sessions_this_week": sum(day_counts_detail.values())},
        "subject_summary": list(subject_map.values()),
        "topic_mastery": topic_mastery_list,
        "recent_sessions": recent_sessions,
        "flagged_topics": flagged_topics,
        "weekly_activity": weekly_activity,
        "score_trend": score_trend,              # #51: 14-day performance trend
    }


class SetChildGoalRequest(BaseModel):
    daily_goal_sessions: int  # 1–10


@app.post("/api/parent/children/{student_id}/set-goal")
def parent_set_child_goal(
    student_id: int,
    req: SetChildGoalRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_parent),
):
    """Allow a parent to set their child's daily session goal (task #15)."""
    link = db.query(ParentStudentLink).filter(
        ParentStudentLink.parent_id == current_user.id,
        ParentStudentLink.student_id == student_id,
    ).first()
    if not link:
        raise HTTPException(status_code=403, detail="Not linked to this student")
    child = db.query(User).filter(User.id == student_id).first()
    if not child:
        raise HTTPException(status_code=404, detail="Student not found")

    child.daily_goal_sessions = max(1, min(10, req.daily_goal_sessions))
    db.commit()
    return {"daily_goal_sessions": child.daily_goal_sessions, "name": child.name}


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


@app.get("/api/parent/children/{student_id}/digest")
def child_weekly_digest(
    student_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_parent),
):
    """#48: Weekly digest payload — structured snapshot a parent reads in-app (or receives by email)."""
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
    days_since_monday = now.weekday()
    week_start = (now - timedelta(days=days_since_monday)).replace(hour=0, minute=0, second=0, microsecond=0)
    last_week_start = week_start - timedelta(days=7)

    this_week_sessions = db.query(SessionModel).filter(
        SessionModel.user_id == student_id,
        SessionModel.started_at >= week_start,
        SessionModel.status == "completed",
        SessionModel.is_practice == False,
    ).all()

    # Per-subject breakdown
    subject_counts: dict = {}
    for s in this_week_sessions:
        topic = db.query(Topic).filter(Topic.id == s.topic_id).first()
        chapter = db.query(Chapter).filter(Chapter.id == topic.chapter_id).first() if topic else None
        book = db.query(Book).filter(Book.id == chapter.book_id).first() if chapter else None
        subj = (book.subject if book else "Other") or "Other"
        subject_counts[subj] = subject_counts.get(subj, 0) + 1

    subjects_sorted = sorted(subject_counts.items(), key=lambda x: -x[1])

    # New masteries this week
    new_masteries = db.query(TopicMastery).filter(
        TopicMastery.student_id == student_id,
        TopicMastery.last_practiced_at >= week_start,
        TopicMastery.mastery_level.in_(["L3", "L4", "L5"]),
        TopicMastery.mastery_confirmed == True,
    ).order_by(TopicMastery.last_practiced_at.desc()).limit(3).all()

    # Flagged topics for action item
    flagged = db.query(TopicMastery).filter(
        TopicMastery.student_id == student_id,
        TopicMastery.flagged_for_review == True,
    ).limit(1).first()
    flagged_topic_title = flagged.topic.title if flagged and flagged.topic else None

    # Last week comparison
    last_week_count = db.query(func.count(SessionModel.id)).filter(
        SessionModel.user_id == student_id,
        SessionModel.started_at >= last_week_start,
        SessionModel.started_at < week_start,
        SessionModel.status == "completed",
        SessionModel.is_practice == False,
    ).scalar() or 0

    sessions_this_week = len(this_week_sessions)
    trend = "up" if sessions_this_week > last_week_count else ("down" if sessions_this_week < last_week_count else "same")

    # Personalised headline
    if sessions_this_week == 0:
        headline = f"{student.name} hasn't started any sessions yet this week. A little encouragement could go a long way!"
    elif sessions_this_week >= student.daily_goal_sessions * 5:
        headline = f"What a week! {student.name} is on fire 🔥 — {sessions_this_week} sessions completed and counting."
    elif new_masteries:
        headline = f"{student.name} mastered {len(new_masteries)} new topic{'s' if len(new_masteries) > 1 else ''} this week. Great progress!"
    else:
        headline = f"{student.name} completed {sessions_this_week} session{'s' if sessions_this_week != 1 else ''} this week. Keep up the momentum!"

    return {
        "student_name": student.name,
        "grade": student.grade,
        "week_label": week_start.strftime("Week of %d %b %Y"),
        "headline": headline,
        "metrics": {
            "sessions_this_week": sessions_this_week,
            "sessions_last_week": last_week_count,
            "trend": trend,
            "xp_earned_this_week": student.weekly_xp or 0,
            "streak_days": student.streak_days or 0,
            "new_masteries": len(new_masteries),
        },
        "subjects": [{"subject": s, "sessions": c} for s, c in subjects_sorted],
        "mastered_topics": [
            {"title": m.topic.title if m.topic else "Unknown", "level": m.mastery_level}
            for m in new_masteries
        ],
        "action_tip": (
            f"Ask {student.name} to explain «{flagged_topic_title}» — it's marked for review."
            if flagged_topic_title else
            f"Ask {student.name} what their favourite topic was this week and why!"
        ),
    }


@app.get("/api/parent/family-activity")
def parent_family_activity(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_parent),
):
    """7-day session counts per child plus week-over-week trend — for the family activity chart."""
    links = db.query(ParentStudentLink).filter(
        ParentStudentLink.parent_id == current_user.id
    ).all()
    now = datetime.utcnow()
    today = now.date()
    week_start = now - timedelta(days=6)
    prev_week_start = now - timedelta(days=13)
    prev_week_end = now - timedelta(days=7)
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
        curr_total = sum(day_counts.values())

        # Previous 7-day window for trend comparison (#51)
        prev_total = db.query(func.count(SessionModel.id)).filter(
            SessionModel.user_id == child.id,
            SessionModel.started_at >= prev_week_start,
            SessionModel.started_at < prev_week_end,
        ).scalar() or 0
        if prev_total == 0:
            trend_pct = 100 if curr_total > 0 else 0
        else:
            trend_pct = round((curr_total - prev_total) / prev_total * 100)

        result.append({
            "child_id": child.id,
            "child_name": child.name,
            "activity": [{"date": d, "sessions": day_counts[d]} for d in dates],
            "curr_week_total": curr_total,
            "prev_week_total": prev_total,
            "trend_pct": trend_pct,
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


@app.post("/api/parent/children/{student_id}/encourage")
def encourage_child(
    student_id: int,
    req: EncourageRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_parent),
):
    """Send a cheer/encouragement message to a child via their buddy (#50)."""
    link = db.query(ParentStudentLink).filter(
        ParentStudentLink.parent_id == current_user.id,
        ParentStudentLink.student_id == student_id,
    ).first()
    if not link:
        raise HTTPException(status_code=403, detail="Not your child")

    message = req.message.strip()[:280]
    if not message:
        raise HTTPException(status_code=400, detail="Message cannot be empty")

    child = db.query(User).filter(User.id == student_id).first()
    if not child:
        raise HTTPException(status_code=404, detail="Student not found")

    buddy_name = child.buddy_name or "Buddy"
    parent_name = current_user.name.split()[0] if current_user.name else "Your parent"
    db.add(Notification(
        user_id=student_id,
        type="parent_cheer",
        title=f"💌 {buddy_name} has a message from {parent_name}!",
        body=message,
    ))
    db.commit()
    return {"message": "Cheer sent!"}


# ─── Admin Weekly Challenge Draft (#56) ───────────────────────────────────────

@app.get("/api/admin/weekly-challenge/draft")
def draft_weekly_challenge(
    grade: int = Query(..., ge=1, le=12),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    """Generate (but don't save) a draft weekly challenge for a given grade (#56)."""
    all_topics = (
        db.query(Topic)
        .join(Chapter, Chapter.id == Topic.chapter_id)
        .join(Book, Book.id == Chapter.book_id)
        .filter(Book.grade == grade, Book.ingestion_status == "done")
        .all()
    )
    if not all_topics:
        raise HTTPException(status_code=404, detail="No ingested topics for this grade")

    chosen_topic = random.choice(all_topics)
    chosen_topic.chapter = db.query(Chapter).filter(Chapter.id == chosen_topic.chapter_id).first()
    try:
        nq = generate_question(chosen_topic, "L4", [])
    except Exception:
        raise HTTPException(status_code=500, detail="Failed to generate draft question")

    topic_chapter = chosen_topic.chapter
    topic_book = db.query(Book).filter(Book.id == topic_chapter.book_id).first() if topic_chapter else None

    return {
        "grade": grade,
        "topic_id": chosen_topic.id,
        "topic_title": chosen_topic.title,
        "subject": topic_book.subject if topic_book else "",
        "question": nq["question"],
        "expected_key_points": nq["expected_key_points"],
        "answer_format": nq["answer_format"],
    }


class WeeklyChallengeDraftPublishRequest(BaseModel):
    grade: int
    topic_id: int
    question: str
    expected_key_points: Optional[list] = None
    answer_format: Optional[str] = None


@app.post("/api/admin/weekly-challenge/publish")
def publish_weekly_challenge(
    req: WeeklyChallengeDraftPublishRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    """Save an admin-approved draft as this week's challenge (#56).
    Replaces any existing challenge for the grade+week."""
    week_start = _get_week_start()

    # Delete existing challenge for this grade+week (idempotent)
    existing = db.query(WeeklyChallenge).filter(
        WeeklyChallenge.grade == req.grade,
        WeeklyChallenge.week_start == week_start,
    ).first()
    if existing:
        db.delete(existing)
        db.flush()

    challenge = WeeklyChallenge(
        grade=req.grade,
        week_start=week_start,
        topic_id=req.topic_id,
        question_text=req.question.strip(),
        expected_key_points=json.dumps(req.expected_key_points or []),
        answer_format=req.answer_format or "explanation",
    )
    db.add(challenge)
    db.commit()
    db.refresh(challenge)
    return {
        "id": challenge.id,
        "grade": req.grade,
        "week_start": week_start.isoformat(),
        "question": challenge.question_text,
    }


# ─── Session Recovery & Interleaved Practice Endpoints ────────────────────────

@app.get("/api/student/active-sessions")
def get_active_sessions(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Return all non-completed sessions for the current student (#62 — multi-device resumption)."""
    if current_user.role != "student":
        raise HTTPException(status_code=403, detail="Students only")

    active = (
        db.query(SessionModel)
        .filter(
            SessionModel.user_id == current_user.id,
            SessionModel.status == "active",
        )
        .order_by(SessionModel.started_at.desc())
        .limit(5)
        .all()
    )

    result = []
    for s in active:
        topic = db.query(Topic).filter(Topic.id == s.topic_id).first()
        chapter = db.query(Chapter).filter(Chapter.id == topic.chapter_id).first() if topic else None
        last_turn = (
            db.query(SessionTurn)
            .filter(SessionTurn.session_id == s.id)
            .order_by(SessionTurn.turn_number.desc())
            .first()
        )
        result.append({
            "session_id": s.id,
            "topic_id": s.topic_id,
            "topic_title": topic.title if topic else "",
            "chapter_title": chapter.title if chapter else "",
            "current_level": s.current_level,
            "questions_asked": s.questions_asked or 0,
            "started_at": s.started_at.isoformat() if s.started_at else None,
            "last_question": last_turn.question_text if last_turn else None,
            "answer_format": last_turn.answer_format if last_turn else None,
            "is_practice": bool(s.is_practice),
        })
    return result


@app.get("/api/session/{session_id}/replay")
def get_session_replay(
    session_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Return all answered turns for a completed session so the student can review."""
    session = db.query(SessionModel).filter(SessionModel.id == session_id).first()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    if session.user_id and session.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="Not your session")

    topic = db.query(Topic).filter(Topic.id == session.topic_id).first()
    chapter = db.query(Chapter).filter(Chapter.id == topic.chapter_id).first() if topic else None

    turns = (
        db.query(SessionTurn)
        .filter(
            SessionTurn.session_id == session_id,
            SessionTurn.student_answer.isnot(None),
        )
        .order_by(SessionTurn.turn_number)
        .all()
    )

    import json as _json

    turn_list = []
    for t in turns:
        key_points = []
        if t.expected_key_points:
            try:
                key_points = _json.loads(t.expected_key_points)
            except Exception:
                key_points = [t.expected_key_points]

        missed = []
        if t.missed_key_points:
            try:
                missed = _json.loads(t.missed_key_points)
            except Exception:
                missed = []

        turn_list.append({
            "turn_number": t.turn_number,
            "level": t.level,
            "question_text": t.question_text,
            "answer_format": t.answer_format,
            "student_answer": t.student_answer,
            "score": t.assessment_score,
            "confidence_tag": t.confidence_tag,
            "hint_tier_used": t.hint_tier_used,
            "expected_key_points": key_points,
            "missed_key_points": missed,
        })

    return {
        "session_id": session_id,
        "topic_title": topic.title if topic else "",
        "chapter_title": chapter.title if chapter else "",
        "status": session.status,
        "current_level": session.current_level,
        "questions_asked": session.questions_asked or 0,
        "is_practice": bool(session.is_practice),
        "turns": turn_list,
    }


@app.get("/api/session/{session_id}/info")
def get_session_info(
    session_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Return enough session context to reconstruct the chat page (#62)."""
    session = db.query(SessionModel).filter(SessionModel.id == session_id).first()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    if session.user_id and session.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="Not your session")

    topic = db.query(Topic).filter(Topic.id == session.topic_id).first()
    chapter = db.query(Chapter).filter(Chapter.id == topic.chapter_id).first() if topic else None
    last_turn = (
        db.query(SessionTurn)
        .filter(SessionTurn.session_id == session.id)
        .order_by(SessionTurn.turn_number.desc())
        .first()
    )

    return {
        "session_id": session.id,
        "topic_id": session.topic_id,
        "topic_title": topic.title if topic else "",
        "chapter_title": chapter.title if chapter else "",
        "student_name": session.student_name,
        "current_level": session.current_level,
        "level_label": level_label(session.current_level),
        "status": session.status,
        "is_practice": bool(session.is_practice),
        "diagnostic": bool(session.diagnostic_phase),
        "diagnostic_turn": session.diagnostic_turn or 0,
        "last_question": last_turn.question_text if last_turn else "",
        "answer_format": last_turn.answer_format if last_turn else None,
        "turn_number": last_turn.turn_number if last_turn else 1,
        "questions_asked": session.questions_asked or 0,
    }


@app.get("/api/student/interleaved-topics")
def get_interleaved_topics(
    limit: int = Query(6, ge=2, le=10),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Return topics suitable for an interleaved mixed-practice session (#27).

    Priority order:
    1. Overdue spaced-repetition reviews
    2. Topics studied but not yet at L3 mastery
    3. Any attempted topics — random selection
    """
    if current_user.role != "student":
        raise HTTPException(status_code=403, detail="Students only")
    if not current_user.grade:
        return []

    now = datetime.utcnow()

    # Fetch all mastery records for this student
    all_mastery = (
        db.query(TopicMastery)
        .filter(TopicMastery.student_id == current_user.id)
        .all()
    )
    mastery_map = {m.topic_id: m for m in all_mastery}

    # Grade's topics
    grade_topics = (
        db.query(Topic, Book.subject)
        .join(Chapter, Chapter.id == Topic.chapter_id)
        .join(Book, Book.id == Chapter.book_id)
        .filter(Book.grade == current_user.grade, Book.ingestion_status == "done")
        .all()
    )

    def _topic_dict(t, subj, m):
        return {
            "id": t.id, "title": t.title, "subject": subj,
            "mastery_level": m.mastery_level if m else None,
            "studied": bool(m and m.studied) if m else False,
        }

    # 1. Overdue SR topics
    overdue = [
        _topic_dict(t, subj, mastery_map.get(t.id))
        for t, subj in grade_topics
        if (m := mastery_map.get(t.id)) and m.next_review_at and m.next_review_at <= now
    ]
    random.shuffle(overdue)

    # 2. Studied but below L3
    below_l3 = [
        _topic_dict(t, subj, mastery_map.get(t.id))
        for t, subj in grade_topics
        if (m := mastery_map.get(t.id)) and m.studied
        and m.mastery_level not in ("L3", "L4", "L5")
        and t.id not in {x["id"] for x in overdue}
    ]
    random.shuffle(below_l3)

    # 3. Any studied topics not already included
    studied_rest = [
        _topic_dict(t, subj, mastery_map.get(t.id))
        for t, subj in grade_topics
        if (m := mastery_map.get(t.id)) and m.studied
        and t.id not in {x["id"] for x in overdue}
        and t.id not in {x["id"] for x in below_l3}
    ]
    random.shuffle(studied_rest)

    candidates = (overdue + below_l3 + studied_rest)[:limit]
    return candidates


@app.get("/api/student/transfer-question")
def get_transfer_question(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """#60: Return an AI-generated cross-topic application question.

    Picks 2 topics the student has mastered (L3+) from different subjects (or
    same subject but different chapters). Falls back to any 2 studied topics if
    fewer than 2 are mastered.
    """
    if current_user.role != "student":
        raise HTTPException(status_code=403, detail="Students only")
    if not current_user.grade:
        raise HTTPException(status_code=400, detail="Grade not set")

    # Collect mastered / studied topic records with subject info
    rows = (
        db.query(TopicMastery, Topic, Book.subject)
        .join(Topic, Topic.id == TopicMastery.topic_id)
        .join(Chapter, Chapter.id == Topic.chapter_id)
        .join(Book, Book.id == Chapter.book_id)
        .filter(
            TopicMastery.student_id == current_user.id,
            TopicMastery.studied == True,
            Book.ingestion_status == "done",
        )
        .all()
    )

    if len(rows) < 2:
        raise HTTPException(
            status_code=404,
            detail="not_enough_topics",
        )

    # Prefer mastered (L3+) topics; fall back to any studied
    mastered = [(m, t, s) for m, t, s in rows if m.mastery_level in ("L3", "L4", "L5")]
    pool = mastered if len(mastered) >= 2 else list(rows)

    # Shuffle and pick 2 — try to pick different subjects first
    random.shuffle(pool)
    topic_a = pool[0]
    # Find a second topic from a different subject if possible
    topic_b = next(
        (x for x in pool[1:] if x[2] != topic_a[2]),
        pool[1],
    )

    ma, ta, subject_a = topic_a
    mb, tb, subject_b = topic_b

    result = generate_transfer_question(
        topic_a_title=ta.title,
        topic_a_concepts=ta.key_concepts or [],
        topic_b_title=tb.title,
        topic_b_concepts=tb.key_concepts or [],
        grade=current_user.grade,
        subject=subject_a if subject_a == subject_b else f"{subject_a} & {subject_b}",
    )
    result["topic_a_id"] = ta.id
    result["topic_b_id"] = tb.id
    result["topic_a_mastery"] = ma.mastery_level
    result["topic_b_mastery"] = mb.mastery_level
    return result


# ─── Daily Challenge Routes ────────────────────────────────────────────────────

@app.get("/api/student/daily-challenge")
def get_daily_challenge(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Return today's challenge question for the student, or status if already done."""
    if current_user.role != "student":
        raise HTTPException(status_code=403, detail="Students only")

    today = datetime.utcnow().date()

    # Already completed today?
    if current_user.daily_challenge_date == today:
        return {"completed": True}

    grade = current_user.grade or 1
    student_id = current_user.id

    # ── Candidate topics: ones the student has a TopicMastery record for ──────
    masteries = (
        db.query(TopicMastery)
        .filter(TopicMastery.student_id == student_id)
        .all()
    )

    if not masteries:
        return {"available": False}

    # Priority 1: SM-2 due (next_review_at <= today)
    due = [m for m in masteries if m.next_review_at and m.next_review_at.date() <= today]

    if due:
        chosen_mastery = sorted(due, key=lambda m: m.next_review_at)[0]
    else:
        # Priority 2: L1/L2 topics not practiced in ≥ 3 days
        cutoff = datetime.utcnow() - timedelta(days=3)
        weak = [
            m for m in masteries
            if m.mastery_level in ("L1", "L2")
            and (m.last_practiced_at is None or m.last_practiced_at < cutoff)
        ]
        if weak:
            chosen_mastery = sorted(weak, key=lambda m: m.last_practiced_at or datetime.min)[0]
        else:
            # Priority 3: any topic, least recently practiced
            chosen_mastery = sorted(
                masteries,
                key=lambda m: m.last_practiced_at or datetime.min
            )[0]

    topic = db.query(Topic).filter(Topic.id == chosen_mastery.topic_id).first()
    if not topic:
        return {"available": False}

    chapter = db.query(Chapter).filter(Chapter.id == topic.chapter_id).first()
    book = db.query(Book).filter(Book.id == chapter.book_id).first() if chapter else None

    # Generate a question at the student's current mastery level (or L1 if fresh)
    level = chosen_mastery.mastery_level or "L1"
    q = generate_question(topic, level, [])

    # Base XP reward: 15 pts + 5 bonus if answered correctly
    return {
        "completed": False,
        "available": True,
        "topic_id": topic.id,
        "topic_title": topic.title,
        "subject": book.subject if book else "General",
        "level": level,
        "question": q["question"],
        "answer_format": q.get("answer_format", "explanation"),
        "expected_key_points": q.get("expected_key_points", []),
        "xp_reward": 15,
    }


class DailyChallengeSubmitRequest(BaseModel):
    topic_id: int
    answer: str
    expected_key_points: Optional[list] = None
    answer_format: Optional[str] = "explanation"
    level: Optional[str] = "L1"
    question_text: Optional[str] = ""


@app.post("/api/student/daily-challenge/submit")
def submit_daily_challenge(
    req: DailyChallengeSubmitRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Score the student's daily challenge answer and award XP."""
    if current_user.role != "student":
        raise HTTPException(status_code=403, detail="Students only")

    today = datetime.utcnow().date()

    # Guard against double-submit
    if current_user.daily_challenge_date == today:
        raise HTTPException(status_code=400, detail="Daily challenge already completed today")

    topic = db.query(Topic).filter(Topic.id == req.topic_id).first()
    if not topic:
        raise HTTPException(status_code=404, detail="Topic not found")

    # Score the answer
    assessment = assess_answer(
        topic=topic,
        question=req.question_text,
        answer=req.answer,
        level=req.level or "L1",
        hint_tier=0,
        expected_key_points=req.expected_key_points or [],
        answer_format=req.answer_format or "explanation",
    )

    score = assessment.get("score", 0)
    correct = score >= 70

    # XP: 15 base + 5 bonus if correct
    xp_earned = 15 + (5 if correct else 0)

    # Mark challenge as done for today
    current_user.daily_challenge_date = today

    # Award XP
    current_user.total_xp = (current_user.total_xp or 0) + xp_earned
    current_user.weekly_xp = (current_user.weekly_xp or 0) + xp_earned

    db.commit()

    return {
        "feedback": assessment.get("feedback", ""),
        "score": score,
        "correct": correct,
        "misconception": assessment.get("misconception"),
        "xp_earned": xp_earned,
    }


# ─── Student Goal Journal ──────────────────────────────────────────────────────

class GoalCreateRequest(BaseModel):
    goal_text: str
    topic_id: Optional[int] = None


def _week_start(dt=None):
    """Return the Monday of the current (or given) week as a date."""
    d = (dt or datetime.utcnow()).date()
    return d - timedelta(days=d.weekday())


@app.post("/api/student/goals")
def set_weekly_goal(
    req: GoalCreateRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Create or replace this week's learning goal."""
    if current_user.role != "student":
        raise HTTPException(status_code=403, detail="Students only")

    text_clean = req.goal_text.strip()
    if not text_clean:
        raise HTTPException(status_code=422, detail="Goal text cannot be empty")

    ws = _week_start()
    existing = (
        db.query(StudentGoal)
        .filter(StudentGoal.user_id == current_user.id, StudentGoal.week_start == ws)
        .first()
    )
    if existing:
        existing.goal_text = text_clean
        existing.topic_id = req.topic_id
        existing.status = "active"
        existing.result_note = None
        db.commit()
        goal = existing
    else:
        goal = StudentGoal(
            user_id=current_user.id,
            goal_text=text_clean,
            topic_id=req.topic_id,
            week_start=ws,
        )
        db.add(goal)
        db.commit()
        db.refresh(goal)

    return {"id": goal.id, "goal_text": goal.goal_text, "week_start": goal.week_start.isoformat()}


@app.get("/api/student/goals/current")
def get_current_goal(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Return this week's goal plus a phase-aware status card.
    Phase logic (UTC):
      Mon–Wed  → early:   motivational nudge
      Thu–Fri  → midweek: progress check-in
      Sat–Sun  → endweek: AI evaluation (lazy, cached in result_note)
    """
    if current_user.role != "student":
        raise HTTPException(status_code=403, detail="Students only")

    ws = _week_start()
    goal = (
        db.query(StudentGoal)
        .filter(StudentGoal.user_id == current_user.id, StudentGoal.week_start == ws)
        .first()
    )

    if not goal:
        # Also surface last week's goal for context
        last_ws = ws - timedelta(days=7)
        last_goal = (
            db.query(StudentGoal)
            .filter(StudentGoal.user_id == current_user.id, StudentGoal.week_start == last_ws)
            .first()
        )
        return {
            "has_goal": False,
            "last_goal": {
                "goal_text": last_goal.goal_text,
                "status": last_goal.status,
                "result_note": last_goal.result_note,
            } if last_goal else None,
        }

    today = datetime.utcnow().date()
    weekday = today.weekday()   # 0=Mon … 6=Sun

    # Count sessions completed this week
    week_start_dt = datetime.utcnow().replace(
        hour=0, minute=0, second=0, microsecond=0
    ) - timedelta(days=weekday)
    sessions_this_week = (
        db.query(func.count(SessionModel.id))
        .filter(
            SessionModel.user_id == current_user.id,
            SessionModel.status == "completed",
            SessionModel.started_at >= week_start_dt,
        )
        .scalar() or 0
    )

    # Determine phase
    if weekday <= 2:
        phase = "early"
    elif weekday <= 4:
        phase = "midweek"
    else:
        phase = "endweek"

    # Lazy AI evaluation on Sat/Sun
    if phase == "endweek" and not goal.result_note:
        from session_engine import call_claude, _SONNET

        topic = db.query(Topic).filter(Topic.id == goal.topic_id).first() if goal.topic_id else None
        mastery_note = ""
        if topic:
            m = (
                db.query(TopicMastery)
                .filter(TopicMastery.student_id == current_user.id, TopicMastery.topic_id == goal.topic_id)
                .first()
            )
            if m:
                mastery_note = f"Their mastery level for this topic is now {m.mastery_level}."

        prompt = (
            f"A student set this weekly learning goal: \"{goal.goal_text}\"\n"
            f"They completed {sessions_this_week} practice session(s) this week. {mastery_note}\n\n"
            f"Write a warm, personal 2-sentence end-of-week message to the student. "
            f"If they did well (3+ sessions or strong mastery), celebrate. "
            f"If they fell short, be encouraging without being harsh. "
            f"End with one specific suggestion for next week. "
            f"Address them directly (use 'you'). Keep it under 60 words."
        )
        result_note = call_claude(
            "You are Buddy, a warm and encouraging AI tutor.", prompt,
            max_tokens=150, model=_SONNET,
        )
        goal.result_note = result_note
        goal.status = "achieved" if sessions_this_week >= 3 else ("partial" if sessions_this_week >= 1 else "missed")
        db.commit()

    return {
        "has_goal": True,
        "id": goal.id,
        "goal_text": goal.goal_text,
        "week_start": goal.week_start.isoformat(),
        "status": goal.status,
        "phase": phase,
        "sessions_this_week": sessions_this_week,
        "result_note": goal.result_note,
        "topic_id": goal.topic_id,
    }


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

    # ── Today's session count (for daily goal ring, task #17) ────────────────
    today_start = datetime.utcnow().replace(hour=0, minute=0, second=0, microsecond=0)
    sessions_today = db.query(func.count(SessionModel.id)).filter(
        SessionModel.user_id == student_id,
        SessionModel.started_at >= today_start,
    ).scalar() or 0

    # ── Topics mastered count (for achievement checking, task #29) ───────────
    topics_mastered = sum(
        1 for m in all_masteries if m.mastery_level in ("L3", "L4", "L5")
    )

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
        "total_questions_answered": db.query(func.sum(SessionModel.questions_asked)).filter(
            SessionModel.user_id == student_id,
            SessionModel.status == "completed",
        ).scalar() or 0,
        "total_xp": current_user.total_xp or 0,
        "weekly_xp": current_user.weekly_xp or 0,
        "weekly_challenge_done": weekly_challenge_done,
        "streak_freeze_available": current_user.streak_freeze_available or False,
        # Daily goal (task #17)
        "sessions_today": sessions_today,
        "daily_goal_sessions": current_user.daily_goal_sessions or 1,
        # Achievement snapshot (task #29)
        "topics_mastered": topics_mastered,
        # Mastery goal (#59)
        "weekly_mastery_goal": current_user.weekly_mastery_goal or 0,
        "topics_mastered_this_week": sum(
            1 for m in all_masteries
            if m.mastery_level in ("L3", "L4", "L5")
            and m.last_practiced_at
            and m.last_practiced_at >= week_start
        ),
    }


# ─── Gamification Endpoints ────────────────────────────────────────────────────

class BuddyUpdateRequest(BaseModel):
    buddy_name: Optional[str] = None
    buddy_avatar: Optional[str] = None
    show_on_leaderboard: Optional[bool] = None
    daily_goal_sessions: Optional[int] = None
    weekly_mastery_goal: Optional[int] = None  # #59


def _send_parent_tip_bg(
    student_name: str,
    topic_title: str,
    key_concepts: list,
    mastery_level: str,
    session_summary: str,
    parent_ids: list,
) -> None:
    """Background task (#49): generate AI tip and notify linked parents."""
    from database import SessionLocal
    db = SessionLocal()
    try:
        tip = generate_parent_tip(topic_title, key_concepts, mastery_level, session_summary)
        for pid in parent_ids:
            db.add(Notification(
                user_id=pid,
                type="session_tip",
                title=f"💡 {student_name} practised {topic_title}",
                body=tip,
            ))
        db.commit()
    except Exception:
        pass
    finally:
        db.close()

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
    if req.daily_goal_sessions is not None:
        user.daily_goal_sessions = max(1, min(10, req.daily_goal_sessions))
    if req.weekly_mastery_goal is not None:   # #59
        user.weekly_mastery_goal = max(0, min(20, req.weekly_mastery_goal))

    db.commit()
    return {
        "buddy_name": user.buddy_name or "Buddy",
        "buddy_avatar": user.buddy_avatar or "robot",
        "show_on_leaderboard": user.show_on_leaderboard if user.show_on_leaderboard is not None else False,
        "daily_goal_sessions": user.daily_goal_sessions or 1,
        "weekly_mastery_goal": user.weekly_mastery_goal or 0,
    }


# ── Onboarding endpoint (task #13) ───────────────────────────────────────────

@app.post("/api/student/complete-onboarding")
def complete_onboarding(
    req: CompleteOnboardingRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Mark onboarding complete and persist buddy + daily-goal choices."""
    if current_user.role != "student":
        raise HTTPException(status_code=403, detail="Students only")

    VALID_AVATARS = {"robot", "fox", "panda", "lion", "dolphin", "owl", "dragon", "wizard"}
    user = db.query(User).filter(User.id == current_user.id).first()

    user.has_onboarded = True
    if req.buddy_avatar and req.buddy_avatar in VALID_AVATARS:
        user.buddy_avatar = req.buddy_avatar
    if req.buddy_name:
        name = req.buddy_name.strip()[:20]
        user.buddy_name = name if name else None
    if req.daily_goal_sessions is not None:
        user.daily_goal_sessions = max(1, min(10, req.daily_goal_sessions))

    db.commit()
    db.refresh(user)
    return _user_dict(user)


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

    # #63 Collaborative class challenge — grade-wide participation counts
    class_attempts = db.query(WeeklyChallengeCompletion).filter(
        WeeklyChallengeCompletion.challenge_id == challenge.id,
    ).count()
    class_total = db.query(User).filter(
        User.grade == current_user.grade,
        User.role == "student",
        User.is_active == True,
    ).count()

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
        "class_attempts": class_attempts,
        "class_total": class_total,
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


# =============================================================================
# Admin Personal Task Tracker
# =============================================================================

class TaskCreate(BaseModel):
    title: str
    notes: Optional[str] = None
    status: str = "not_started"
    priority: str = "medium"
    category: str
    start_date: Optional[str] = None
    end_date: Optional[str] = None
    budget: Optional[float] = None
    parent_id: Optional[int] = None
    dependency_ids: Optional[list[int]] = []
    expense_amount: Optional[float] = None
    expense_description: Optional[str] = None
    expense_date: Optional[str] = None

class TaskUpdate(BaseModel):
    title: Optional[str] = None
    notes: Optional[str] = None
    status: Optional[str] = None
    priority: Optional[str] = None
    category: Optional[str] = None
    start_date: Optional[str] = None
    end_date: Optional[str] = None
    budget: Optional[float] = None
    parent_id: Optional[int] = None
    dependency_ids: Optional[list[int]] = None

class ExpenseCreate(BaseModel):
    amount: float
    description: Optional[str] = None
    expense_date: str


def _parse_date(s: Optional[str]) -> Optional[_date]:
    if not s:
        return None
    try:
        return _date.fromisoformat(s)
    except ValueError:
        raise HTTPException(status_code=400, detail=f"Invalid date: {s}")


def _task_dict(t: AdminTask, include_subtasks: bool = False) -> dict:
    total_expense = sum(e.amount for e in t.expenses)
    d = {
        "id": t.id,
        "title": t.title,
        "notes": t.notes,
        "status": t.status,
        "priority": t.priority,
        "category": t.category,
        "start_date": t.start_date.isoformat() if t.start_date else None,
        "end_date": t.end_date.isoformat() if t.end_date else None,
        "budget": t.budget,
        "parent_id": t.parent_id,
        "created_at": t.created_at.isoformat(),
        "updated_at": t.updated_at.isoformat() if t.updated_at else None,
        "total_expense": total_expense,
        "expenses": [
            {
                "id": e.id,
                "amount": e.amount,
                "description": e.description,
                "expense_date": e.expense_date.isoformat(),
            }
            for e in sorted(t.expenses, key=lambda e: e.expense_date)
        ],
        "dependency_ids": [dep.depends_on_id for dep in t.dependencies],
    }
    if include_subtasks:
        d["subtasks"] = [_task_dict(st) for st in t.subtasks]
    return d


def _shift_task_dates(task: AdminTask, delta_days: int, db: Session, visited: set):
    if task.id in visited:
        return
    visited.add(task.id)
    if task.start_date:
        task.start_date = task.start_date + timedelta(days=delta_days)
    if task.end_date:
        task.end_date = task.end_date + timedelta(days=delta_days)
    blocked = db.query(AdminTaskDependency).filter(
        AdminTaskDependency.depends_on_id == task.id
    ).all()
    for dep in blocked:
        downstream = db.query(AdminTask).filter(AdminTask.id == dep.task_id).first()
        if downstream:
            _shift_task_dates(downstream, delta_days, db, visited)


def _has_cycle(task_id: int, dep_id: int, db: Session) -> bool:
    visited = set()
    queue = [dep_id]
    while queue:
        current = queue.pop()
        if current == task_id:
            return True
        if current in visited:
            continue
        visited.add(current)
        deps = db.query(AdminTaskDependency).filter(
            AdminTaskDependency.task_id == current
        ).all()
        queue.extend(d.depends_on_id for d in deps)
    return False


@app.get("/api/admin/tasks")
def list_tasks(
    category: Optional[str] = None,
    status: Optional[str] = None,
    current_user: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    q = db.query(AdminTask).filter(AdminTask.parent_id == None)
    if category:
        q = q.filter(AdminTask.category == category)
    if status:
        q = q.filter(AdminTask.status == status)
    tasks = q.order_by(AdminTask.end_date.asc().nullslast(), AdminTask.created_at.desc()).all()
    return [_task_dict(t, include_subtasks=True) for t in tasks]


@app.get("/api/admin/tasks/categories")
def list_categories(
    current_user: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    rows = db.query(AdminTask.category).distinct().order_by(AdminTask.category).all()
    return [r[0] for r in rows]


@app.get("/api/admin/tasks/summary")
def tasks_summary(
    current_user: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    today = _date.today()
    all_tasks = db.query(AdminTask).all()
    total_expense = db.query(func.sum(AdminTaskExpense.amount)).scalar() or 0.0
    total_budget = sum(t.budget or 0 for t in all_tasks)

    by_status: dict = {}
    for t in all_tasks:
        by_status[t.status] = by_status.get(t.status, 0) + 1

    overdue = [
        t for t in all_tasks
        if t.end_date and t.end_date < today and t.status not in ("completed",)
    ]

    # Build category-wise breakdown
    by_category: dict = {}
    for t in all_tasks:
        cat = t.category
        if cat not in by_category:
            by_category[cat] = {"total": 0, "by_status": {}, "budget": 0.0, "spent": 0.0, "overdue": 0}
        by_category[cat]["total"] += 1
        by_category[cat]["by_status"][t.status] = by_category[cat]["by_status"].get(t.status, 0) + 1
        by_category[cat]["budget"] += t.budget or 0.0
        task_spent = sum(e.amount for e in t.expenses)
        by_category[cat]["spent"] += task_spent
        if t.end_date and t.end_date < today and t.status != "completed":
            by_category[cat]["overdue"] += 1

    expense_by_cat = {cat: round(v["spent"], 2) for cat, v in by_category.items()}

    return {
        "total": len(all_tasks),
        "by_status": by_status,
        "overdue_count": len(overdue),
        "overdue": [_task_dict(t) for t in overdue[:10]],
        "total_expense": round(total_expense, 2),
        "total_budget": round(total_budget, 2),
        "total_spent": round(total_expense, 2),
        "expense_by_category": expense_by_cat,
        "by_category": {
            cat: {
                "total": v["total"],
                "by_status": v["by_status"],
                "budget": round(v["budget"], 2),
                "spent": round(v["spent"], 2),
                "overdue": v["overdue"],
            }
            for cat, v in by_category.items()
        },
    }


@app.get("/api/admin/tasks/{task_id}")
def get_task(
    task_id: int,
    current_user: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    task = db.query(AdminTask).filter(AdminTask.id == task_id).first()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    return _task_dict(task, include_subtasks=True)


@app.post("/api/admin/tasks", status_code=201)
def create_task(
    data: TaskCreate,
    current_user: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    try:
        task = AdminTask(
            title=data.title,
            notes=data.notes,
            status=data.status,
            priority=data.priority,
            category=data.category,
            start_date=_parse_date(data.start_date),
            end_date=_parse_date(data.end_date),
            budget=data.budget,
            parent_id=data.parent_id,
        )
        db.add(task)
        db.flush()
        for dep_id in (data.dependency_ids or []):
            if _has_cycle(task.id, dep_id, db):
                raise HTTPException(status_code=400, detail=f"Circular dependency with task {dep_id}")
            db.add(AdminTaskDependency(task_id=task.id, depends_on_id=dep_id))
        if data.expense_amount and data.expense_amount > 0:
            exp_date = _parse_date(data.expense_date) or _date.today()
            db.add(AdminTaskExpense(
                task_id=task.id,
                amount=data.expense_amount,
                description=data.expense_description,
                expense_date=exp_date,
            ))
        _audit_log(db, current_user, action="create_task", target_type="task",
                   target_id=task.id, target_name=task.title, details=data.category)
        db.commit()
        db.refresh(task)
        return _task_dict(task, include_subtasks=True)
    except HTTPException:
        raise
    except Exception as exc:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(exc))


@app.put("/api/admin/tasks/{task_id}")
def update_task(
    task_id: int,
    data: TaskUpdate,
    current_user: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    task = db.query(AdminTask).filter(AdminTask.id == task_id).first()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    old_end = task.end_date
    if data.title is not None:
        task.title = data.title
    if data.notes is not None:
        task.notes = data.notes
    if data.status is not None:
        task.status = data.status
    if data.priority is not None:
        task.priority = data.priority
    if data.category is not None:
        task.category = data.category
    if data.start_date is not None:
        task.start_date = _parse_date(data.start_date)
    if data.budget is not None:
        task.budget = data.budget if data.budget > 0 else None
    if data.end_date is not None:
        new_end = _parse_date(data.end_date)
        task.end_date = new_end
        if old_end and new_end and new_end != old_end:
            delta = (new_end - old_end).days
            if delta != 0:
                blocked = db.query(AdminTaskDependency).filter(
                    AdminTaskDependency.depends_on_id == task_id
                ).all()
                visited = {task_id}
                for dep in blocked:
                    downstream = db.query(AdminTask).filter(AdminTask.id == dep.task_id).first()
                    if downstream:
                        _shift_task_dates(downstream, delta, db, visited)
    if data.parent_id is not None:
        task.parent_id = data.parent_id
    if data.dependency_ids is not None:
        db.query(AdminTaskDependency).filter(AdminTaskDependency.task_id == task_id).delete()
        for dep_id in data.dependency_ids:
            if dep_id == task_id:
                raise HTTPException(status_code=400, detail="Task cannot depend on itself")
            if _has_cycle(task_id, dep_id, db):
                raise HTTPException(status_code=400, detail=f"Circular dependency with task {dep_id}")
            db.add(AdminTaskDependency(task_id=task_id, depends_on_id=dep_id))
    task.updated_at = datetime.utcnow()
    try:
        _audit_log(db, current_user, action="update_task", target_type="task",
                   target_id=task.id, target_name=task.title)
        db.commit()
    except Exception as exc:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(exc))
    db.refresh(task)
    return _task_dict(task, include_subtasks=True)


@app.delete("/api/admin/tasks/{task_id}", status_code=204)
def delete_task(
    task_id: int,
    current_user: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    task = db.query(AdminTask).filter(AdminTask.id == task_id).first()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    _audit_log(db, current_user, action="delete_task", target_type="task",
               target_id=task.id, target_name=task.title)
    db.delete(task)
    db.commit()


@app.post("/api/admin/tasks/{task_id}/expenses", status_code=201)
def add_expense(
    task_id: int,
    data: ExpenseCreate,
    current_user: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    task = db.query(AdminTask).filter(AdminTask.id == task_id).first()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    expense = AdminTaskExpense(
        task_id=task_id,
        amount=data.amount,
        description=data.description,
        expense_date=_parse_date(data.expense_date),
    )
    db.add(expense)
    _audit_log(db, current_user, action="add_expense", target_type="task",
               target_id=task_id, target_name=task.title,
               details=f"Rs.{data.amount} on {data.expense_date}")
    db.commit()
    db.refresh(expense)
    return {"id": expense.id, "amount": expense.amount,
            "description": expense.description,
            "expense_date": expense.expense_date.isoformat()}


@app.delete("/api/admin/tasks/{task_id}/expenses/{expense_id}", status_code=204)
def delete_expense(
    task_id: int,
    expense_id: int,
    current_user: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    expense = db.query(AdminTaskExpense).filter(
        AdminTaskExpense.id == expense_id,
        AdminTaskExpense.task_id == task_id,
    ).first()
    if not expense:
        raise HTTPException(status_code=404, detail="Expense not found")
    db.delete(expense)
    _audit_log(db, current_user, action="delete_expense", target_type="task",
               target_id=task_id, details=f"Rs.{expense.amount}")
    db.commit()


# ── Telegram Daily Digest ──────────────────────────────────────────────────────

def _fmt_inr(amount: float) -> str:
    """Format amount in Indian units: Cr / L / plain with commas."""
    if amount is None:
        return "Rs.0"
    if amount >= 1_00_00_000:        # 1 Crore+
        val = amount / 1_00_00_000
        return f"Rs.{val:.2f}Cr".rstrip('0').rstrip('.')+"Cr" if '.' in f"{val:.2f}" else f"Rs.{val:.0f}Cr"
    if amount >= 1_00_000:           # 1 Lakh+
        val = amount / 1_00_000
        s = f"{val:.2f}".rstrip('0').rstrip('.')
        return f"Rs.{s}L"
    # Plain with Indian comma grouping
    return f"Rs.{amount:,.0f}"

def _tg_bar(spent: float, total: float, width: int = 16) -> str:
    """Return a text progress bar like [████░░░░]  42%"""
    if not total or total <= 0:
        return ""
    pct = min(spent / total, 1.0)
    filled = round(pct * width)
    bar = chr(9608) * filled + chr(9617) * (width - filled)
    return f"[{bar}] {pct*100:.0f}%"


def _build_digest(db: Session) -> str:
    from datetime import date as _d, timedelta as _td
    today = _d.today()
    in_two = today + _td(days=2)

    tasks = db.query(AdminTask).filter(AdminTask.parent_id.is_(None)).all()

    overdue       = [t for t in tasks if t.end_date and t.end_date < today and t.status != "completed"]
    starting_soon = [t for t in tasks if t.start_date and today <= t.start_date <= in_two and t.status == "not_started"]

    total_budget = sum(t.budget or 0 for t in tasks)
    total_spent  = sum(sum(e.amount for e in t.expenses) for t in tasks)

    # Build category map
    by_category: dict = {}
    for t in tasks:
        cat = t.category
        if cat not in by_category:
            by_category[cat] = []
        by_category[cat].append(t)

    STATUS_LABEL = {
        "not_started": "Not Started",
        "in_progress": "In Progress",
        "completed":   "Completed",
        "on_hold":     "On Hold",
    }
    STATUS_ICON = {
        "not_started": "○",   # ○
        "in_progress": "\U0001f504",  # 🔄
        "completed":   "✅",   # ✅
        "on_hold":     "⏸",   # ⏸
    }

    lines = []
    lines.append("*✅ TutorSnap Daily Digest*")
    lines.append(f"_{today.strftime('%a, %d %b %Y')}_")
    lines.append("")

    # ── Overdue alert ──────────────────────────────────────────────────────────
    if overdue:
        lines.append(f"*\U0001f534 OVERDUE — {len(overdue)} task{'s' if len(overdue)>1 else ''}*")
        for t in overdue:
            due   = t.end_date.strftime('%d %b') if t.end_date else "?"
            spent = sum(e.amount for e in t.expenses)
            lines.append(f"  • *{t.title}*")
            lines.append(f"    [{t.category}] Due: {due}")
            if t.budget:
                lines.append(f"    {_fmt_inr(spent)} spent of {_fmt_inr(t.budget)}  {_tg_bar(spent, t.budget, 12)}")
        lines.append("")

    # ── Starting soon ──────────────────────────────────────────────────────────
    if starting_soon:
        lines.append(f"*⏰ STARTING IN 2 DAYS — {len(starting_soon)} task{'s' if len(starting_soon)>1 else ''}*")
        for t in starting_soon:
            start = t.start_date.strftime('%d %b') if t.start_date else "?"
            lines.append(f"  • *{t.title}*  [{t.category}] starts {start}")
        lines.append("")

    # ── Category-wise breakdown ────────────────────────────────────────────────
    lines.append("*\U0001f4cb CATEGORY BREAKDOWN*")
    lines.append("")

    for cat, cat_tasks in sorted(by_category.items()):
        cat_budget = sum(t.budget or 0 for t in cat_tasks)
        cat_spent  = sum(sum(e.amount for e in t.expenses) for t in cat_tasks)
        cat_overdue= sum(1 for t in cat_tasks if t.end_date and t.end_date < today and t.status != "completed")

        # Count by status
        status_counts: dict = {}
        for t in cat_tasks:
            status_counts[t.status] = status_counts.get(t.status, 0) + 1

        overdue_tag = f"  \U0001f534 {cat_overdue} overdue" if cat_overdue else ""
        lines.append(f"*{cat}* ({len(cat_tasks)} tasks{overdue_tag})")

        # Status summary line
        status_parts = [f"{STATUS_ICON.get(s,'')} {STATUS_LABEL.get(s,s)}: {c}" for s, c in status_counts.items()]
        lines.append("  " + "  |  ".join(status_parts))

        # Budget bar
        if cat_budget > 0:
            remaining = cat_budget - cat_spent
            lines.append(f"  \U0001f4b0 {_fmt_inr(cat_spent)} / {_fmt_inr(cat_budget)}  {_tg_bar(cat_spent, cat_budget, 12)}  Left: {_fmt_inr(remaining)}")
        elif cat_spent > 0:
            lines.append(f"  \U0001f4b0 Spent: {_fmt_inr(cat_spent)}  (no budget set)")

        # Task list — only non-completed tasks
        active = [t for t in cat_tasks if t.status != "completed"]
        for t in active:
            spent  = sum(e.amount for e in t.expenses)
            icon   = STATUS_ICON.get(t.status, "○")
            due    = f" | Due: {t.end_date.strftime('%d %b')}" if t.end_date else ""
            is_od  = " \U0001f534" if t in overdue else ""
            lines.append(f"  {icon} {t.title}{due}{is_od}")
            if t.budget:
                lines.append(f"       {_fmt_inr(spent)} / {_fmt_inr(t.budget)}  {_tg_bar(spent, t.budget, 10)}")
            elif spent > 0:
                lines.append(f"       Spent: {_fmt_inr(spent)}")
        lines.append("")

    # ── Overall budget summary ─────────────────────────────────────────────────
    if total_budget > 0 or total_spent > 0:
        lines.append("*\U0001f4b0 OVERALL BUDGET*")
        lines.append(f"  Allocated: {_fmt_inr(total_budget)}")
        lines.append(f"  Spent:     {_fmt_inr(total_spent)}  {_tg_bar(total_spent, total_budget) if total_budget else ''}")
        lines.append(f"  Remaining: {_fmt_inr(total_budget - total_spent)}")

    return "\n".join(lines)


@app.post("/api/admin/tasks/notify")
def send_task_digest(
    db: Session = Depends(get_db),
    x_notify_secret: Optional[str] = None,
):
    """Called by Cloud Scheduler daily at 7 AM IST. Sends Telegram digest."""
    import urllib.request
    import urllib.parse

    notify_secret = os.getenv("NOTIFY_SECRET", "")
    if notify_secret and x_notify_secret != notify_secret:
        raise HTTPException(status_code=403, detail="Forbidden")

    bot_token = os.getenv("TELEGRAM_BOT_TOKEN", "")
    chat_id   = os.getenv("TELEGRAM_CHAT_ID", "")
    if not bot_token or not chat_id:
        raise HTTPException(status_code=500, detail="Telegram not configured")

    message = _build_digest(db)

    url = f"https://api.telegram.org/bot{bot_token}/sendMessage"
    payload = urllib.parse.urlencode({
        "chat_id": chat_id,
        "text": message,
        "parse_mode": "Markdown",
    }).encode()
    req = urllib.request.Request(url, data=payload, method="POST")
    with urllib.request.urlopen(req, timeout=10) as resp:
        result = json.loads(resp.read())

    if not result.get("ok"):
        raise HTTPException(status_code=500, detail=f"Telegram error: {result}")

    return {"sent": True, "message_length": len(message)}
