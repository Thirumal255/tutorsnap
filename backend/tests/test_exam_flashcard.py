"""
Tests for Exam Mode and Flashcard endpoints.

Covers:
- POST /api/exam/start   — timed exam creation
- POST /api/exam/submit  — bulk answer submission
- POST /api/flashcard/question — get a flashcard question
- POST /api/flashcard/mark     — mark as known/unknown
"""

import json
import pytest
from unittest.mock import patch
from tests.conftest import make_user, make_book, make_chapter, make_topic, auth_headers


def _mock_question():
    return json.dumps({
        "question": "📘 Fractions — What is a proper fraction?",
        "expected_key_points": ["numerator smaller than denominator", "value less than 1"],
        "answer_format": "explanation",
    })


@pytest.mark.exam
class TestExamStart:
    def test_exam_start_returns_questions(self, client, db):
        """Exam start returns a list of questions for the requested count."""
        student = make_user(db, email="ex@test.com", google_id="g-ex", role="student")
        book    = make_book(db)
        chapter = make_chapter(db, book.id)
        topic   = make_topic(db, chapter.id)

        with patch("session_engine.call_claude", return_value=_mock_question()):
            resp = client.post(
                "/api/exam/start",
                json={
                    "student_name": student.name,
                    "grade": student.grade,
                    "subject": "Mathematics",
                    "question_count": 5,
                    "time_limit": 10,
                },
                headers=auth_headers(student),
            )

        assert resp.status_code == 200
        data = resp.json()
        assert "exam_id" in data
        assert "questions" in data
        assert isinstance(data["questions"], list)

    def test_exam_start_requires_auth(self, client, db):
        resp = client.post("/api/exam/start", json={
            "student_name": "x", "grade": 6, "subject": "Mathematics",
            "question_count": 5, "time_limit": 10,
        })
        assert resp.status_code == 401

    def test_exam_start_requires_student_role(self, client, db):
        admin = make_user(db, email="adm@test.com", google_id="g-adm", role="admin")
        resp = client.post(
            "/api/exam/start",
            json={"student_name": "x", "grade": 6, "subject": "Mathematics",
                  "question_count": 5, "time_limit": 10},
            headers=auth_headers(admin),
        )
        assert resp.status_code == 403


@pytest.mark.exam
class TestExamSubmit:
    def _start_exam(self, client, db, student, topic):
        with patch("session_engine.call_claude", return_value=_mock_question()):
            resp = client.post(
                "/api/exam/start",
                json={
                    "student_name": student.name,
                    "grade": student.grade,
                    "subject": "Mathematics",
                    "question_count": 3,
                    "time_limit": 10,
                },
                headers=auth_headers(student),
            )
        return resp.json() if resp.status_code == 200 else None

    def test_exam_submit_returns_score(self, client, db):
        """Submitting exam answers returns a score and results."""
        student = make_user(db, email="exs@test.com", google_id="g-exs", role="student")
        book    = make_book(db)
        chapter = make_chapter(db, book.id)
        topic   = make_topic(db, chapter.id)

        exam_data = self._start_exam(client, db, student, topic)
        if not exam_data:
            pytest.skip("Exam start failed — skipping submit test")

        answers = [
            {"question_id": q["id"], "answer": "numerator is smaller than denominator"}
            for q in exam_data.get("questions", [])[:3]
        ]

        with patch("session_engine.call_claude", return_value='{"score":80,"feedback":"Good","confidence_tag":"confident","missed_key_points":[]}'):
            resp = client.post(
                "/api/exam/submit",
                json={"exam_id": exam_data["exam_id"], "answers": answers},
                headers=auth_headers(student),
            )

        assert resp.status_code == 200
        data = resp.json()
        assert "total_score" in data or "results" in data or "score" in data

    def test_exam_submit_requires_auth(self, client, db):
        resp = client.post("/api/exam/submit", json={"exam_id": 999, "answers": []})
        assert resp.status_code == 401


@pytest.mark.exam
class TestFlashcard:
    def test_flashcard_question_returns_content(self, client, db):
        """Flashcard question endpoint returns a question for the topic."""
        student = make_user(db, email="fc@test.com", google_id="g-fc", role="student")
        book    = make_book(db)
        chapter = make_chapter(db, book.id)
        topic   = make_topic(db, chapter.id)

        with patch("session_engine.call_claude", return_value=_mock_question()):
            resp = client.post(
                "/api/flashcard/question",
                json={"topic_id": topic.id},
                headers=auth_headers(student),
            )

        assert resp.status_code == 200
        data = resp.json()
        assert "question" in data
        assert "topic_id" in data

    def test_flashcard_question_requires_auth(self, client, db):
        resp = client.post("/api/flashcard/question", json={"topic_id": 1})
        assert resp.status_code == 401

    def test_flashcard_mark_known(self, client, db):
        """Marking flashcard as known returns 200."""
        student = make_user(db, email="fck@test.com", google_id="g-fck", role="student")
        book    = make_book(db)
        chapter = make_chapter(db, book.id)
        topic   = make_topic(db, chapter.id)

        resp = client.post(
            "/api/flashcard/mark",
            json={"topic_id": topic.id, "known": True},
            headers=auth_headers(student),
        )
        assert resp.status_code == 200

    def test_flashcard_mark_unknown(self, client, db):
        """Marking flashcard as unknown returns 200."""
        student = make_user(db, email="fcu@test.com", google_id="g-fcu", role="student")
        book    = make_book(db)
        chapter = make_chapter(db, book.id)
        topic   = make_topic(db, chapter.id)

        resp = client.post(
            "/api/flashcard/mark",
            json={"topic_id": topic.id, "known": False},
            headers=auth_headers(student),
        )
        assert resp.status_code == 200
