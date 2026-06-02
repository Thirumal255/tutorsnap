from sqlalchemy import (
    Column, Integer, String, Text, DateTime, Boolean, JSON, Float,
    ForeignKey, UniqueConstraint, Date
)
from sqlalchemy.orm import relationship
from datetime import datetime
from database import Base


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, autoincrement=True)
    email = Column(String(255), unique=True, nullable=False)
    name = Column(String(200), nullable=False)
    google_id = Column(String(200), unique=True, nullable=False)
    avatar_url = Column(String(500), nullable=True)
    role = Column(String(20), nullable=False, default="student")
    grade = Column(Integer, nullable=True)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    last_login_at = Column(DateTime, nullable=True)

    # ── Gamification ──────────────────────────────────────────────────────────
    total_xp = Column(Integer, default=0)
    weekly_xp = Column(Integer, default=0)
    weekly_xp_reset_at = Column(DateTime, nullable=True)
    show_on_leaderboard = Column(Boolean, default=True)
    buddy_name = Column(String(50), nullable=True)    # e.g. "Bloxy"
    buddy_avatar = Column(String(50), nullable=True)  # preset key: robot/fox/etc.
    avatar_preset = Column(String(50), nullable=True) # profile avatar preset key e.g. "fox"

    # ── Streak ────────────────────────────────────────────────────────────────
    streak_days = Column(Integer, default=0)                 # persisted current streak
    streak_freeze_available = Column(Boolean, default=False) # has an unused freeze token
    streak_freeze_used_at = Column(DateTime, nullable=True)  # when the last freeze was consumed

    # ── Onboarding & daily goal ───────────────────────────────────────────────
    has_onboarded = Column(Boolean, default=False)           # True after first-login flow complete
    daily_goal_sessions = Column(Integer, default=1)         # target sessions per day
    weekly_mastery_goal = Column(Integer, default=0)         # #59: topics to master per week (0 = no goal)
    daily_challenge_date = Column(Date, nullable=True)       # date of last completed daily challenge

    parent_links = relationship("ParentStudentLink", foreign_keys="ParentStudentLink.parent_id", back_populates="parent")
    student_links = relationship("ParentStudentLink", foreign_keys="ParentStudentLink.student_id", back_populates="student")
    notifications = relationship("Notification", back_populates="user")
    sessions = relationship("Session", back_populates="user")


class ParentStudentLink(Base):
    __tablename__ = "parent_student_links"

    id = Column(Integer, primary_key=True, autoincrement=True)
    parent_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    student_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)

    __table_args__ = (UniqueConstraint("parent_id", "student_id"),)

    parent = relationship("User", foreign_keys=[parent_id], back_populates="parent_links")
    student = relationship("User", foreign_keys=[student_id], back_populates="student_links")


class Notification(Base):
    __tablename__ = "notifications"

    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    type = Column(String(50), nullable=False)
    title = Column(String(200), nullable=False)
    body = Column(Text, nullable=False)
    is_read = Column(Boolean, default=False)
    related_topic_id = Column(Integer, ForeignKey("topics.id"), nullable=True)
    related_session_id = Column(Integer, ForeignKey("sessions.id"), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    user = relationship("User", back_populates="notifications")


class AppSettings(Base):
    __tablename__ = "app_settings"

    id = Column(Integer, primary_key=True, autoincrement=True)
    key = Column(String(100), unique=True, nullable=False)
    value = Column(Text, nullable=False)
    updated_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    updated_at = Column(DateTime, default=datetime.utcnow)


class Book(Base):
    __tablename__ = "books"

    id = Column(Integer, primary_key=True, autoincrement=True)
    title = Column(String(300), nullable=True)
    subject = Column(String(100), nullable=False, default="General")
    grade = Column(Integer, nullable=False, default=1)
    filename = Column(String(255), nullable=False)
    filepath = Column(String(500), nullable=False)
    ingestion_status = Column(String(20), default="pending")
    ingestion_error = Column(Text, nullable=True)
    chapter_count = Column(Integer, default=0)
    topic_count = Column(Integer, default=0)
    upload_stage = Column(String(50), nullable=True)   # uploading|reading|analysing|saving|done|failed
    upload_progress = Column(Integer, default=0)        # 0-100
    toc_pages = Column(String(20), nullable=True)       # e.g. "3-5" — PDF pages containing the TOC/index
    chapter_structure = Column(Text, nullable=True)     # e.g. "Chapter → Topic → Example → Exercise"
    chapter_limit = Column(Integer, nullable=True)      # if set, ingest only first N chapters (for test runs)
    created_at = Column(DateTime, default=datetime.utcnow)

    chapters = relationship("Chapter", back_populates="book")


class Chapter(Base):
    __tablename__ = "chapters"

    id = Column(Integer, primary_key=True, autoincrement=True)
    book_id = Column(Integer, ForeignKey("books.id"), nullable=False)
    chapter_number = Column(Integer, nullable=False)
    title = Column(String(300), nullable=False)
    page_start = Column(Integer, nullable=True)
    page_end = Column(Integer, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    book = relationship("Book", back_populates="chapters")
    topics = relationship("Topic", back_populates="chapter")


class Topic(Base):
    __tablename__ = "topics"

    id = Column(Integer, primary_key=True, autoincrement=True)
    chapter_id = Column(Integer, ForeignKey("chapters.id"), nullable=False)
    topic_number = Column(String(200), nullable=True)
    title = Column(String(300), nullable=False)
    key_concepts = Column(JSON, nullable=True)
    vocabulary = Column(JSON, nullable=True)
    exercises = Column(JSON, nullable=True)
    difficulty_ceiling = Column(String(5), default="L3")
    raw_content = Column(Text, nullable=True)
    page_start = Column(Integer, nullable=True)
    page_end = Column(Integer, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    chapter = relationship("Chapter", back_populates="topics")
    sessions = relationship("Session", back_populates="topic")
    masteries = relationship("TopicMastery", back_populates="topic")


class Session(Base):
    __tablename__ = "sessions"

    id = Column(Integer, primary_key=True, autoincrement=True)
    student_name = Column(String(100), nullable=False)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    topic_id = Column(Integer, ForeignKey("topics.id"), nullable=False)
    started_at = Column(DateTime, default=datetime.utcnow)
    ended_at = Column(DateTime, nullable=True)
    status = Column(String(20), default="active")
    current_level = Column(String(5), default="L1")
    consecutive_confident = Column(Integer, default=0)
    questions_asked = Column(Integer, default=0)
    hint_tier = Column(Integer, default=0)
    concept_reset_done = Column(Boolean, default=False)
    flagged_for_review = Column(Boolean, default=False)
    final_confidence = Column(String(20), nullable=True)
    level_question_count = Column(Integer, default=0)  # questions asked at current level; resets on level-up

    # ── Diagnostic pre-assessment (first practice on a topic) ─────────────────
    diagnostic_phase = Column(Boolean, default=False)   # True during the 3-question placement test
    diagnostic_turn = Column(Integer, default=0)        # which diagnostic question we're on (1-3)

    # ── Practice mode (#58) — no mastery/XP updates ──────────────────────────
    is_practice = Column(Boolean, default=False)        # True → low-stakes; skips mastery & XP

    # ── A/B testing (#64) ─────────────────────────────────────────────────────
    ab_variant = Column(String(1), nullable=True)       # "A" | "B" — assigned at session start

    topic = relationship("Topic", back_populates="sessions")
    turns = relationship("SessionTurn", back_populates="session")
    user = relationship("User", back_populates="sessions")


class SessionTurn(Base):
    __tablename__ = "session_turns"

    id = Column(Integer, primary_key=True, autoincrement=True)
    session_id = Column(Integer, ForeignKey("sessions.id"), nullable=False)
    turn_number = Column(Integer, nullable=False)
    question_text = Column(Text, nullable=False)
    expected_key_points = Column(Text, nullable=True)   # JSON list of strings
    answer_format = Column(String(30), nullable=True)   # number|yes_no|rule|explanation|working
    student_answer = Column(Text, nullable=True)
    assessment_score = Column(Integer, nullable=True)
    confidence_tag = Column(String(20), nullable=True)
    hint_tier_used = Column(Integer, default=0)
    level = Column(String(5), nullable=True)
    missed_key_points = Column(Text, nullable=True)   # JSON list — key points student missed; used to sharpen hints
    created_at = Column(DateTime, default=datetime.utcnow)

    session = relationship("Session", back_populates="turns")


class WeeklyChallenge(Base):
    """One cross-topic challenge question per grade per week (Monday–Sunday UTC)."""
    __tablename__ = "weekly_challenges"

    id = Column(Integer, primary_key=True, autoincrement=True)
    grade = Column(Integer, nullable=False)
    week_start = Column(DateTime, nullable=False)   # Monday 00:00 UTC
    topic_id = Column(Integer, ForeignKey("topics.id"), nullable=False)
    question_text = Column(Text, nullable=False)
    expected_key_points = Column(Text, nullable=True)  # JSON list
    answer_format = Column(String(30), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    __table_args__ = (UniqueConstraint("grade", "week_start"),)
    topic = relationship("Topic")


class WeeklyChallengeCompletion(Base):
    """Records each student's attempt at a weekly challenge (one per student per challenge)."""
    __tablename__ = "weekly_challenge_completions"

    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    challenge_id = Column(Integer, ForeignKey("weekly_challenges.id"), nullable=False)
    score = Column(Integer, nullable=False)
    xp_earned = Column(Integer, nullable=False)
    feedback = Column(Text, nullable=True)
    completed_at = Column(DateTime, default=datetime.utcnow)

    __table_args__ = (UniqueConstraint("user_id", "challenge_id"),)


class TopicMastery(Base):
    __tablename__ = "topic_mastery"

    id = Column(Integer, primary_key=True, autoincrement=True)
    student_id = Column(Integer, ForeignKey("users.id"), nullable=True)   # preferred FK
    student_name = Column(String(100), nullable=False)                     # legacy display name (kept for history)
    topic_id = Column(Integer, ForeignKey("topics.id"), nullable=False)
    mastery_level = Column(String(5), default="L1")
    consecutive_confident = Column(Integer, default=0)
    last_hint_tier_needed = Column(Integer, default=0)
    flagged_for_review = Column(Boolean, default=False)
    last_practiced_at = Column(DateTime, nullable=True)
    total_sessions = Column(Integer, default=1)

    # ── Spaced repetition (SM-2) ──────────────────────────────────────────
    next_review_at = Column(DateTime, nullable=True)       # when to resurface this topic
    review_interval_days = Column(Integer, default=1)      # current interval in days
    ease_factor = Column(Float, default=2.5)               # SM-2 ease factor (1.3 – 2.5+)

    # ── Study Mode ────────────────────────────────────────────────────────
    studied = Column(Boolean, default=False)               # True after first Study session completed
    study_summary = Column(Text, nullable=True)            # compact summary of what Buddy explained

    # ── Mastery quality gate (task #38) ──────────────────────────────────
    # True only when level >= L3 AND total_sessions >= 2 (rigorous threshold)
    mastery_confirmed = Column(Boolean, default=False)

    # ── Session-to-session AI memory (task #40) ───────────────────────────
    # JSON array of last 3 session summaries [{summary, level, date}, ...]
    session_memory = Column(Text, nullable=True)

    __table_args__ = (UniqueConstraint("student_id", "topic_id"),)

    topic = relationship("Topic", back_populates="masteries")
    student = relationship("User", foreign_keys=[student_id])


class AIUsageLog(Base):
    """Per-call AI usage log for cost monitoring."""
    __tablename__ = "ai_usage_log"

    id = Column(Integer, primary_key=True, autoincrement=True)
    student_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    endpoint = Column(String(80), nullable=False)          # e.g. "submit_answer", "study_chat"
    model = Column(String(80), nullable=True)
    input_tokens = Column(Integer, default=0)
    output_tokens = Column(Integer, default=0)
    cost_usd = Column(Float, default=0.0)                  # estimated cost
    called_at = Column(DateTime, default=datetime.utcnow)


class AdminAuditLog(Base):
    """Records admin actions for accountability (task #22)."""
    __tablename__ = "admin_audit_log"

    id = Column(Integer, primary_key=True, autoincrement=True)
    admin_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    admin_name = Column(String(200), nullable=True)
    action = Column(String(100), nullable=False)    # e.g. "create_student"
    target_type = Column(String(50), nullable=True) # "student" | "book" | "students"
    target_id = Column(Integer, nullable=True)
    target_name = Column(String(200), nullable=True)
    details = Column(Text, nullable=True)           # free-text or JSON extra info
    created_at = Column(DateTime, default=datetime.utcnow)


class QuestionBank(Base):
    """Pre-generated questions for a topic + level combination."""
    __tablename__ = "question_bank"

    id = Column(Integer, primary_key=True, autoincrement=True)
    topic_id = Column(Integer, ForeignKey("topics.id"), nullable=False)
    level = Column(String(5), nullable=False)               # L1..L5
    question_text = Column(Text, nullable=False)
    expected_key_points = Column(Text, nullable=True)       # JSON list
    answer_format = Column(String(30), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    topic = relationship("Topic")


class ExamSession(Base):
    """Stores a timed mock-exam: questions generated upfront, answers submitted in bulk."""
    __tablename__ = "exam_sessions"

    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    grade = Column(Integer, nullable=False)
    subjects_json = Column(Text, nullable=True)    # JSON list of subject names chosen
    questions_json = Column(Text, nullable=False)  # JSON list of question objects
    answers_json = Column(Text, nullable=True)     # JSON list of student answer strings
    scores_json = Column(Text, nullable=True)      # JSON list of int scores
    feedbacks_json = Column(Text, nullable=True)   # JSON list of feedback strings
    time_limit_seconds = Column(Integer, default=900)
    question_count = Column(Integer, default=10)
    started_at = Column(DateTime, default=datetime.utcnow)
    ended_at = Column(DateTime, nullable=True)
    status = Column(String(20), default="active")  # active / completed
    total_score = Column(Integer, nullable=True)   # 0-100 average
    xp_earned = Column(Integer, nullable=True)


class AdminTask(Base):
    """Personal task tracker for admin — flat purchase, investments, etc."""
    __tablename__ = "admin_tasks"

    id = Column(Integer, primary_key=True, autoincrement=True)
    title = Column(String(200), nullable=False)
    notes = Column(Text, nullable=True)
    status = Column(String(20), nullable=False, default="not_started")  # not_started | in_progress | completed | on_hold
    priority = Column(String(10), nullable=False, default="medium")     # low | medium | high
    category = Column(String(100), nullable=False)
    start_date = Column(Date, nullable=True)
    end_date = Column(Date, nullable=True)
    budget = Column(Float, nullable=True)
    parent_id = Column(Integer, ForeignKey("admin_tasks.id"), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    expenses = relationship("AdminTaskExpense", back_populates="task", cascade="all, delete-orphan")
    subtasks = relationship("AdminTask", foreign_keys="AdminTask.parent_id",
                            back_populates="parent", lazy="select")
    parent = relationship("AdminTask", foreign_keys="AdminTask.parent_id",
                          remote_side="AdminTask.id", back_populates="subtasks")
    dependencies = relationship("AdminTaskDependency",
                                foreign_keys="AdminTaskDependency.task_id",
                                back_populates="task", cascade="all, delete-orphan")


class AdminTaskExpense(Base):
    __tablename__ = "admin_task_expenses"

    id = Column(Integer, primary_key=True, autoincrement=True)
    task_id = Column(Integer, ForeignKey("admin_tasks.id"), nullable=False)
    amount = Column(Float, nullable=False)
    description = Column(String(300), nullable=True)
    expense_date = Column(Date, nullable=False)
    status = Column(String(20), nullable=False, default='paid')  # 'planned' | 'paid'
    created_at = Column(DateTime, default=datetime.utcnow)

    task = relationship("AdminTask", back_populates="expenses")


class AdminTaskDependency(Base):
    """task_id must wait for depends_on_id to be completed before it can start."""
    __tablename__ = "admin_task_dependencies"

    id = Column(Integer, primary_key=True, autoincrement=True)
    task_id = Column(Integer, ForeignKey("admin_tasks.id"), nullable=False)
    depends_on_id = Column(Integer, ForeignKey("admin_tasks.id"), nullable=False)

    __table_args__ = (UniqueConstraint("task_id", "depends_on_id"),)

    task = relationship("AdminTask", foreign_keys=[task_id], back_populates="dependencies")
    depends_on = relationship("AdminTask", foreign_keys=[depends_on_id])


class PaymentAccount(Base):
    __tablename__ = "payment_accounts"

    id = Column(Integer, primary_key=True, autoincrement=True)
    name = Column(String(200), nullable=False)
    type = Column(String(20), nullable=False, default="bank")  # bank|cash|credit
    current_balance = Column(Float, nullable=False, default=0.0)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    receipts = relationship("FundReceipt", back_populates="account")


class FundSource(Base):
    __tablename__ = "fund_sources"

    id = Column(Integer, primary_key=True, autoincrement=True)
    name = Column(String(200), nullable=False)
    type = Column(String(30), nullable=False, default="other")  # salary|rent|freelance|other
    expected_amount = Column(Float, nullable=True)
    frequency = Column(String(20), nullable=False, default="monthly")  # monthly|one-time
    is_active = Column(Boolean, nullable=False, default=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    receipts = relationship("FundReceipt", back_populates="source")


class FundReceipt(Base):
    __tablename__ = "fund_receipts"

    id = Column(Integer, primary_key=True, autoincrement=True)
    source_id = Column(Integer, ForeignKey("fund_sources.id", ondelete="SET NULL"), nullable=True)
    account_id = Column(Integer, ForeignKey("payment_accounts.id", ondelete="SET NULL"), nullable=True)
    amount = Column(Float, nullable=False)
    description = Column(String(300), nullable=True)
    received_date = Column(Date, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)

    source = relationship("FundSource", back_populates="receipts")
    account = relationship("PaymentAccount", back_populates="receipts")


class CategoryAllocation(Base):
    __tablename__ = "category_allocations"

    id = Column(Integer, primary_key=True, autoincrement=True)
    category = Column(String(100), nullable=False)
    allocated_amount = Column(Float, nullable=False, default=0.0)
    period = Column(String(7), nullable=False)  # YYYY-MM
    account_id = Column(Integer, ForeignKey("payment_accounts.id", ondelete="SET NULL"), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    __table_args__ = (UniqueConstraint("category", "period"),)

    account = relationship("PaymentAccount", foreign_keys=[account_id])


class FundTransfer(Base):
    __tablename__ = "fund_transfers"

    id = Column(Integer, primary_key=True, autoincrement=True)
    from_account_id = Column(Integer, ForeignKey("payment_accounts.id", ondelete="SET NULL"), nullable=True)
    to_account_id   = Column(Integer, ForeignKey("payment_accounts.id", ondelete="SET NULL"), nullable=True)
    amount = Column(Float, nullable=False)
    description = Column(String(300), nullable=True)
    transfer_date = Column(Date, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)

    from_account = relationship("PaymentAccount", foreign_keys=[from_account_id])
    to_account   = relationship("PaymentAccount", foreign_keys=[to_account_id])


class StudentGoal(Base):
    """Weekly learning goal set by the student."""
    __tablename__ = "student_goals"

    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    goal_text = Column(String(300), nullable=False)
    topic_id = Column(Integer, ForeignKey("topics.id"), nullable=True)   # optional focus topic
    week_start = Column(Date, nullable=False)                             # Monday of the goal week
    created_at = Column(DateTime, default=datetime.utcnow)
    status = Column(String(20), default="active")   # active | achieved | partial | missed
    result_note = Column(Text, nullable=True)        # AI-generated end-of-week evaluation

    __table_args__ = (UniqueConstraint("user_id", "week_start"),)

    user  = relationship("User", foreign_keys=[user_id])
    topic = relationship("Topic", foreign_keys=[topic_id])
