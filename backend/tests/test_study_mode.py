"""
Tests for Study Mode endpoints.

Covers:
- POST /api/topics/{id}/explain   — Buddy generates topic explanation
- POST /api/topics/{id}/study-chat — follow-up Q&A
- POST /api/topics/{id}/study-complete — save study_summary, return check questions
- POST /api/topics/{id}/study-unlock  — set studied=True, award XP
- POST /api/session/start           — blocked (403) when topic not studied
- studied flag returned in GET /api/topics/{book_id}
"""

import pytest
from unittest.mock import patch, MagicMock
from tests.conftest import make_user, make_book, make_chapter, make_topic, auth_headers


# ─── Helpers ──────────────────────────────────────────────────────────────────

def _mock_claude_explanation():
    return (
        "🔍 **What is it?**\nFractions represent parts of a whole.\n\n"
        "💡 **Key Ideas**\nA fraction has a numerator and denominator.\n\n"
        "🧠 **Remember**\n• Numerator = top number\n• Denominator = bottom number\n\n"
        "Got any questions? Ask me anything about this topic! 💬"
    )

def _mock_claude_question():
    import json
    return json.dumps({
        "question": "📘 Fractions — What does the denominator of a fraction represent?",
        "expected_key_points": ["bottom number", "total parts", "whole divided into"],
        "answer_format": "explanation"
    })


# ─── Tests ────────────────────────────────────────────────────────────────────

@pytest.mark.study
class TestTopicExplain:
    def test_explain_returns_explanation(self, client, db):
        """Explain endpoint returns a non-empty explanation string."""
        student = make_user(db, email="s@test.com", google_id="g-s1", role="student")
        book    = make_book(db)
        chapter = make_chapter(db, book.id)
        topic   = make_topic(db, chapter.id)

        with patch("session_engine.call_claude", return_value=_mock_claude_explanation()):
            resp = client.post(
                f"/api/topics/{topic.id}/explain",
                headers=auth_headers(student),
            )

        assert resp.status_code == 200
        data = resp.json()
        assert "explanation" in data
        assert len(data["explanation"]) > 50
        assert data["topic_id"] == topic.id

    def test_explain_requires_auth(self, client, db):
        """Unauthenticated request returns 401."""
        book    = make_book(db)
        chapter = make_chapter(db, book.id)
        topic   = make_topic(db, chapter.id)
        resp    = client.post(f"/api/topics/{topic.id}/explain")
        assert resp.status_code == 401

    def test_explain_admin_blocked(self, client, db):
        """Non-student roles cannot access explain endpoint."""
        admin = make_user(db, email="a@test.com", google_id="g-a1", role="admin")
        book    = make_book(db)
        chapter = make_chapter(db, book.id)
        topic   = make_topic(db, chapter.id)
        resp = client.post(
            f"/api/topics/{topic.id}/explain",
            headers=auth_headers(admin),
        )
        assert resp.status_code == 403

    def test_explain_nonexistent_topic(self, client, db):
        """Returns 404 for unknown topic ID."""
        student = make_user(db, email="s2@test.com", google_id="g-s2", role="student")
        resp = client.post(
            "/api/topics/99999/explain",
            headers=auth_headers(student),
        )
        assert resp.status_code == 404


@pytest.mark.study
class TestStudyChat:
    def test_chat_returns_reply(self, client, db):
        """study-chat returns a reply for a valid message history."""
        student = make_user(db, email="sc@test.com", google_id="g-sc", role="student")
        book    = make_book(db)
        chapter = make_chapter(db, book.id)
        topic   = make_topic(db, chapter.id)

        messages = [
            {"role": "assistant", "content": "Let me explain fractions..."},
            {"role": "user",      "content": "What is the numerator?"},
        ]

        with patch("session_engine.call_claude", return_value="The numerator is the top number of a fraction."):
            resp = client.post(
                f"/api/topics/{topic.id}/study-chat",
                json={"student_name": student.name, "messages": messages},
                headers=auth_headers(student),
            )

        assert resp.status_code == 200
        assert "reply" in resp.json()
        assert len(resp.json()["reply"]) > 5

    def test_chat_requires_student_role(self, client, db):
        """Parent cannot access study chat."""
        parent  = make_user(db, email="p@test.com", google_id="g-p1", role="parent")
        book    = make_book(db)
        chapter = make_chapter(db, book.id)
        topic   = make_topic(db, chapter.id)
        resp = client.post(
            f"/api/topics/{topic.id}/study-chat",
            json={"student_name": "test", "messages": []},
            headers=auth_headers(parent),
        )
        assert resp.status_code == 403


@pytest.mark.study
class TestStudyComplete:
    def test_complete_returns_two_questions(self, client, db):
        """study-complete saves summary and returns exactly 2 check questions."""
        student = make_user(db, email="sco@test.com", google_id="g-sco", role="student")
        book    = make_book(db)
        chapter = make_chapter(db, book.id)
        topic   = make_topic(db, chapter.id)

        with patch("session_engine.call_claude", return_value=_mock_claude_question()):
            resp = client.post(
                f"/api/topics/{topic.id}/study-complete",
                json={"student_name": student.name, "study_summary": "Fractions basics covered."},
                headers=auth_headers(student),
            )

        assert resp.status_code == 200
        data = resp.json()
        assert "check_questions" in data
        assert len(data["check_questions"]) == 2
        for q in data["check_questions"]:
            assert "question" in q
            assert "expected_key_points" in q

    def test_complete_saves_study_summary(self, client, db):
        """study-complete persists the study_summary to TopicMastery."""
        from models import TopicMastery
        student = make_user(db, email="scs@test.com", google_id="g-scs", role="student")
        book    = make_book(db)
        chapter = make_chapter(db, book.id)
        topic   = make_topic(db, chapter.id)
        summary = "Fractions: numerator is top, denominator is bottom."

        with patch("session_engine.call_claude", return_value=_mock_claude_question()):
            client.post(
                f"/api/topics/{topic.id}/study-complete",
                json={"student_name": student.name, "study_summary": summary},
                headers=auth_headers(student),
            )

        mastery = db.query(TopicMastery).filter(
            TopicMastery.student_name == student.name,
            TopicMastery.topic_id == topic.id,
        ).first()
        assert mastery is not None
        assert mastery.study_summary == summary


@pytest.mark.study
class TestStudyUnlock:
    def test_unlock_sets_studied_flag(self, client, db):
        """study-unlock sets studied=True on TopicMastery."""
        from models import TopicMastery
        student = make_user(db, email="su@test.com", google_id="g-su", role="student")
        book    = make_book(db)
        chapter = make_chapter(db, book.id)
        topic   = make_topic(db, chapter.id)

        # First complete study to create the mastery record
        with patch("session_engine.call_claude", return_value=_mock_claude_question()):
            client.post(
                f"/api/topics/{topic.id}/study-complete",
                json={"student_name": student.name, "study_summary": "Fractions."},
                headers=auth_headers(student),
            )

        resp = client.post(
            f"/api/topics/{topic.id}/study-unlock",
            json={"student_name": student.name, "study_summary": "Fractions."},
            headers=auth_headers(student),
        )

        assert resp.status_code == 200
        assert resp.json()["unlocked"] is True
        assert resp.json()["xp_awarded"] == 10

        mastery = db.query(TopicMastery).filter(
            TopicMastery.student_name == student.name,
            TopicMastery.topic_id == topic.id,
        ).first()
        assert mastery.studied is True

    def test_unlock_awards_xp(self, client, db):
        """study-unlock increments user total_xp by 10."""
        from models import TopicMastery, User
        student = make_user(db, email="sux@test.com", google_id="g-sux", role="student", total_xp=50)
        book    = make_book(db)
        chapter = make_chapter(db, book.id)
        topic   = make_topic(db, chapter.id)

        with patch("session_engine.call_claude", return_value=_mock_claude_question()):
            client.post(
                f"/api/topics/{topic.id}/study-complete",
                json={"student_name": student.name, "study_summary": "s"},
                headers=auth_headers(student),
            )

        client.post(
            f"/api/topics/{topic.id}/study-unlock",
            json={"student_name": student.name, "study_summary": "s"},
            headers=auth_headers(student),
        )

        db.refresh(student)
        assert student.total_xp == 60

    def test_unlock_without_mastery_record_returns_404(self, client, db):
        """Cannot unlock a topic that was never studied."""
        student = make_user(db, email="su2@test.com", google_id="g-su2", role="student")
        book    = make_book(db)
        chapter = make_chapter(db, book.id)
        topic   = make_topic(db, chapter.id)

        resp = client.post(
            f"/api/topics/{topic.id}/study-unlock",
            json={"student_name": student.name, "study_summary": ""},
            headers=auth_headers(student),
        )
        assert resp.status_code == 404


@pytest.mark.study
@pytest.mark.session
class TestStudyGate:
    def test_session_start_blocked_before_study(self, client, db):
        """Practice session cannot start until topic is studied (403 study_required)."""
        student = make_user(db, email="sg@test.com", google_id="g-sg", role="student")
        book    = make_book(db)
        chapter = make_chapter(db, book.id)
        topic   = make_topic(db, chapter.id)

        with patch("session_engine.call_claude", return_value=_mock_claude_question()):
            resp = client.post(
                "/api/session/start",
                json={"student_name": student.name, "topic_id": topic.id},
                headers=auth_headers(student),
            )

        assert resp.status_code == 403
        assert resp.json()["detail"] == "study_required"

    def test_session_start_allowed_after_study(self, client, db):
        """Practice session starts successfully after topic is unlocked."""
        student = make_user(db, email="sga@test.com", google_id="g-sga", role="student")
        book    = make_book(db)
        chapter = make_chapter(db, book.id)
        topic   = make_topic(db, chapter.id)

        # Complete study flow
        with patch("session_engine.call_claude", return_value=_mock_claude_question()):
            client.post(
                f"/api/topics/{topic.id}/study-complete",
                json={"student_name": student.name, "study_summary": "s"},
                headers=auth_headers(student),
            )
        client.post(
            f"/api/topics/{topic.id}/study-unlock",
            json={"student_name": student.name, "study_summary": "s"},
            headers=auth_headers(student),
        )

        with patch("session_engine.call_claude", return_value=_mock_claude_question()):
            resp = client.post(
                "/api/session/start",
                json={"student_name": student.name, "topic_id": topic.id},
                headers=auth_headers(student),
            )

        assert resp.status_code == 200
        assert "session_id" in resp.json()


@pytest.mark.study
@pytest.mark.books
class TestStudiedFlagInTopics:
    def test_topics_endpoint_includes_studied_flag(self, client, db):
        """GET /api/topics/{book_id} returns studied=False for unstudied topics."""
        student = make_user(db, email="tf@test.com", google_id="g-tf", role="student")
        book    = make_book(db)
        chapter = make_chapter(db, book.id)
        make_topic(db, chapter.id)

        resp = client.get(f"/api/topics/{book.id}", headers=auth_headers(student))
        assert resp.status_code == 200

        topic_data = resp.json()["chapters"][0]["topics"][0]
        assert "studied" in topic_data
        assert topic_data["studied"] is False
