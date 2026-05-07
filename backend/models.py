from sqlalchemy import (
    Column, Integer, String, Text, DateTime, Boolean, JSON,
    ForeignKey, UniqueConstraint
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
    topic_number = Column(String(20), nullable=True)
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

    topic = relationship("Topic", back_populates="sessions")
    turns = relationship("SessionTurn", back_populates="session")
    user = relationship("User", back_populates="sessions")


class SessionTurn(Base):
    __tablename__ = "session_turns"

    id = Column(Integer, primary_key=True, autoincrement=True)
    session_id = Column(Integer, ForeignKey("sessions.id"), nullable=False)
    turn_number = Column(Integer, nullable=False)
    question_text = Column(Text, nullable=False)
    student_answer = Column(Text, nullable=True)
    assessment_score = Column(Integer, nullable=True)
    confidence_tag = Column(String(20), nullable=True)
    hint_tier_used = Column(Integer, default=0)
    level = Column(String(5), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    session = relationship("Session", back_populates="turns")


class TopicMastery(Base):
    __tablename__ = "topic_mastery"

    id = Column(Integer, primary_key=True, autoincrement=True)
    student_name = Column(String(100), nullable=False)
    topic_id = Column(Integer, ForeignKey("topics.id"), nullable=False)
    mastery_level = Column(String(5), default="L1")
    consecutive_confident = Column(Integer, default=0)
    last_hint_tier_needed = Column(Integer, default=0)
    flagged_for_review = Column(Boolean, default=False)
    last_practiced_at = Column(DateTime, nullable=True)
    total_sessions = Column(Integer, default=1)

    __table_args__ = (UniqueConstraint("student_name", "topic_id"),)

    topic = relationship("Topic", back_populates="masteries")
