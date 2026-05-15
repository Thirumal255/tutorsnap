"""
Tests for SQLAlchemy models and database constraints.

Covers:
- User model creation, defaults, gamification fields
- Book / Chapter / Topic relationships
- Session / SessionTurn relationships
- TopicMastery uniqueness constraint
- ParentStudentLink uniqueness constraint
- Notification model
- AppSettings model
- WeeklyChallenge model
- ExamSession model
"""

import pytest
from datetime import datetime, timedelta
import json

from tests.conftest import make_user, make_book, make_chapter, make_topic


class TestUserModel:
    def test_create_user_with_defaults(self, db):
        from models import User

        u = User(email="u@test.com", name="Test", google_id="sub-1", role="student")
        db.add(u)
        db.commit()
        db.refresh(u)

        assert u.id is not None
        assert u.is_active is True
        assert u.total_xp == 0
        assert u.weekly_xp == 0
        assert u.show_on_leaderboard is True

    def test_user_role_values(self, db):
        """Admin, parent, student roles can all be stored."""
        from models import User

        for i, role in enumerate(["admin", "parent", "student"]):
            u = User(email=f"role{i}@test.com", name=role, google_id=f"sub-role-{i}", role=role)
            db.add(u)
        db.commit()

    def test_user_email_unique(self, db):
        from models import User
        from sqlalchemy.exc import IntegrityError

        db.add(User(email="dup@test.com", name="A", google_id="sub-dup-1", role="student"))
        db.commit()
        db.add(User(email="dup@test.com", name="B", google_id="sub-dup-2", role="student"))

        with pytest.raises(IntegrityError):
            db.commit()

    def test_user_google_id_unique(self, db):
        from models import User
        from sqlalchemy.exc import IntegrityError

        db.add(User(email="a1@test.com", name="A", google_id="same-sub", role="student"))
        db.commit()
        db.add(User(email="a2@test.com", name="B", google_id="same-sub", role="student"))

        with pytest.raises(IntegrityError):
            db.commit()

    def test_user_gamification_fields_stored(self, db):
        from models import User

        u = User(
            email="xp@test.com", name="XP User", google_id="sub-xp",
            role="student",
            total_xp=500, weekly_xp=100,
            buddy_name="Sparky", buddy_avatar="dragon",
        )
        db.add(u)
        db.commit()
        db.refresh(u)

        assert u.total_xp == 500
        assert u.weekly_xp == 100
        assert u.buddy_name == "Sparky"
        assert u.buddy_avatar == "dragon"

    def test_user_grade_nullable(self, db):
        from models import User

        u = User(email="ng@test.com", name="No Grade", google_id="sub-ng", role="student")
        db.add(u)
        db.commit()
        assert u.grade is None


class TestBookModel:
    def test_create_book(self, db):
        from models import Book

        b = Book(
            title="Math G6", subject="Mathematics", grade=6,
            filename="math.pdf", filepath="uploads/math.pdf",
            ingestion_status="done",
        )
        db.add(b)
        db.commit()
        db.refresh(b)

        assert b.id is not None
        assert b.ingestion_status == "done"

    def test_book_default_upload_progress(self, db):
        from models import Book

        b = Book(
            subject="Science", grade=7, filename="sci.pdf",
            filepath="uploads/sci.pdf",
        )
        db.add(b)
        db.commit()
        db.refresh(b)

        assert b.upload_progress == 0

    def test_book_chapter_relationship(self, db):
        from models import Book, Chapter

        book = make_book(db)
        ch = make_chapter(db, book.id, title="Chapter 1")

        db.refresh(book)
        assert len(book.chapters) == 1
        assert book.chapters[0].title == "Chapter 1"

    def test_chapter_topic_relationship(self, db):
        from models import Chapter, Topic

        book = make_book(db)
        ch = make_chapter(db, book.id)
        t = make_topic(db, ch.id, title="Topic A")

        db.refresh(ch)
        assert len(ch.topics) == 1
        assert ch.topics[0].title == "Topic A"

    def test_topic_json_fields(self, db):
        from models import Topic

        book = make_book(db)
        ch = make_chapter(db, book.id)
        topic = Topic(
            chapter_id=ch.id,
            title="JSON Topic",
            key_concepts=["A", "B", "C"],
            vocabulary=["w1", "w2"],
            exercises=["Q1", "Q2"],
        )
        db.add(topic)
        db.commit()
        db.refresh(topic)

        assert topic.key_concepts == ["A", "B", "C"]
        assert topic.vocabulary == ["w1", "w2"]
        assert topic.exercises == ["Q1", "Q2"]


class TestSessionModel:
    def test_create_session(self, db):
        from models import Session as SessionModel

        book = make_book(db)
        ch = make_chapter(db, book.id)
        topic = make_topic(db, ch.id)

        s = SessionModel(
            student_name="Alice",
            topic_id=topic.id,
            status="active",
            current_level="L1",
        )
        db.add(s)
        db.commit()
        db.refresh(s)

        assert s.id is not None
        assert s.status == "active"
        assert s.questions_asked == 0

    def test_session_has_turns_relationship(self, db):
        from models import Session as SessionModel, SessionTurn

        book = make_book(db)
        ch = make_chapter(db, book.id)
        topic = make_topic(db, ch.id)

        s = SessionModel(student_name="Bob", topic_id=topic.id, status="active")
        db.add(s)
        db.commit()

        turn = SessionTurn(
            session_id=s.id,
            turn_number=1,
            question_text="What is 2+2?",
            student_answer="4",
            assessment_score=100,
            level="L1",
        )
        db.add(turn)
        db.commit()
        db.refresh(s)

        assert len(s.turns) == 1
        assert s.turns[0].question_text == "What is 2+2?"

    def test_session_turn_fields(self, db):
        from models import Session as SessionModel, SessionTurn

        book = make_book(db)
        ch = make_chapter(db, book.id)
        topic = make_topic(db, ch.id)
        s = SessionModel(student_name="Charlie", topic_id=topic.id)
        db.add(s)
        db.commit()

        turn = SessionTurn(
            session_id=s.id,
            turn_number=1,
            question_text="Solve x+2=5",
            expected_key_points=json.dumps(["x=3"]),
            answer_format="number",
            student_answer="3",
            assessment_score=95,
            confidence_tag="confident",
            hint_tier_used=0,
            level="L3",
            missed_key_points=json.dumps([]),
        )
        db.add(turn)
        db.commit()
        db.refresh(turn)

        assert turn.expected_key_points is not None
        assert turn.answer_format == "number"
        assert turn.confidence_tag == "confident"


class TestTopicMastery:
    def test_create_mastery(self, db):
        from models import TopicMastery

        book = make_book(db)
        ch = make_chapter(db, book.id)
        topic = make_topic(db, ch.id)

        m = TopicMastery(
            student_name="David",
            topic_id=topic.id,
            mastery_level="L3",
            total_sessions=5,
            review_interval_days=7,
            next_review_at=datetime.utcnow() + timedelta(days=7),
        )
        db.add(m)
        db.commit()
        db.refresh(m)

        assert m.mastery_level == "L3"
        assert m.review_interval_days == 7

    def test_mastery_uniqueness_constraint(self, db):
        from models import TopicMastery
        from sqlalchemy.exc import IntegrityError

        book = make_book(db)
        ch = make_chapter(db, book.id)
        topic = make_topic(db, ch.id)

        db.add(TopicMastery(student_name="Eve", topic_id=topic.id, mastery_level="L1"))
        db.commit()

        db.add(TopicMastery(student_name="Eve", topic_id=topic.id, mastery_level="L2"))
        with pytest.raises(IntegrityError):
            db.commit()


class TestParentStudentLink:
    def test_create_link(self, db):
        from models import ParentStudentLink

        parent = make_user(db, email="par@test.com", google_id="g-par", role="parent")
        student = make_user(db, email="stu@test.com", google_id="g-stu")

        link = ParentStudentLink(parent_id=parent.id, student_id=student.id)
        db.add(link)
        db.commit()

        assert link.id is not None

    def test_link_uniqueness(self, db):
        from models import ParentStudentLink
        from sqlalchemy.exc import IntegrityError

        parent = make_user(db, email="par2@test.com", google_id="g-par2", role="parent")
        student = make_user(db, email="stu2@test.com", google_id="g-stu2")

        db.add(ParentStudentLink(parent_id=parent.id, student_id=student.id))
        db.commit()
        db.add(ParentStudentLink(parent_id=parent.id, student_id=student.id))

        with pytest.raises(IntegrityError):
            db.commit()


class TestAppSettings:
    def test_create_setting(self, db):
        from models import AppSettings

        s = AppSettings(key="test_key", value="test_value")
        db.add(s)
        db.commit()
        db.refresh(s)

        assert s.key == "test_key"
        assert s.value == "test_value"

    def test_setting_key_unique(self, db):
        from models import AppSettings
        from sqlalchemy.exc import IntegrityError

        db.add(AppSettings(key="dup_key", value="v1"))
        db.commit()
        db.add(AppSettings(key="dup_key", value="v2"))

        with pytest.raises(IntegrityError):
            db.commit()


class TestNotificationModel:
    def test_create_notification(self, db):
        from models import Notification

        user = make_user(db)
        n = Notification(
            user_id=user.id,
            type="flagged_for_review",
            title="Topic flagged",
            body="Your child needs help with Integers.",
        )
        db.add(n)
        db.commit()
        db.refresh(n)

        assert n.id is not None
        assert n.is_read is False

    def test_notification_mark_read(self, db):
        from models import Notification

        user = make_user(db, email="notf@test.com", google_id="g-notf")
        n = Notification(user_id=user.id, type="info", title="Hi", body="Hello!")
        db.add(n)
        db.commit()

        n.is_read = True
        db.commit()
        db.refresh(n)
        assert n.is_read is True


class TestWeeklyChallengeModel:
    def test_create_weekly_challenge(self, db):
        from models import WeeklyChallenge

        book = make_book(db, grade=6)
        ch = make_chapter(db, book.id)
        topic = make_topic(db, ch.id)

        wc = WeeklyChallenge(
            grade=6,
            week_start=datetime.utcnow(),
            topic_id=topic.id,
            question_text="What is LCM?",
            expected_key_points=json.dumps(["Least Common Multiple"]),
            answer_format="explanation",
        )
        db.add(wc)
        db.commit()
        db.refresh(wc)

        assert wc.id is not None
        assert wc.grade == 6


class TestExamSessionModel:
    def test_create_exam_session(self, db):
        from models import ExamSession

        user = make_user(db, email="exam@test.com", google_id="g-exam")
        es = ExamSession(
            user_id=user.id,
            grade=6,
            questions_json=json.dumps([{"q": "What is 2+2?", "answer_format": "number"}]),
            time_limit_seconds=600,
            question_count=5,
            status="active",
        )
        db.add(es)
        db.commit()
        db.refresh(es)

        assert es.id is not None
        assert es.status == "active"
        assert es.question_count == 5
