"""
Tests for the session (practice) API endpoints.

Covers:
- POST /api/session/start    — start a practice session
- POST /api/session/answer   — submit an answer
- POST /api/session/hint     — request a hint
- POST /api/session/end      — end session + summary
- POST /api/session/sub-question — scaffolded sub-question
"""

import json
import pytest
from unittest.mock import patch, MagicMock

from tests.conftest import (
    make_user, make_book, make_chapter, make_topic, make_session, make_studied,
    auth_headers,
)


# ── Helpers ───────────────────────────────────────────────────────────────────

def _mock_claude_question(text="What is 2+2?", key_points=None, fmt="number"):
    """Return a mock response object that generate_question will produce."""
    mock = MagicMock()
    mock.content = [MagicMock(text=json.dumps({
        "question": text,
        "expected_key_points": key_points or ["4"],
        "answer_format": fmt,
    }))]
    return mock


def _mock_claude_assess(score=85, feedback="Good job!", tag="confident"):
    mock = MagicMock()
    mock.content = [MagicMock(text=json.dumps({
        "score": score,
        "feedback": feedback,
        "confidence": tag,
        "missed_key_points": [],
    }))]
    return mock


def _mock_claude_hint(text="Think about addition…"):
    mock = MagicMock()
    mock.content = [MagicMock(text=text)]
    return mock


# ── Start session ─────────────────────────────────────────────────────────────

class TestStartSession:
    @patch("session_engine._client")
    def test_start_session_returns_question(self, mock_client, client, db):
        mock_client.messages.create.return_value = _mock_claude_question()

        book = make_book(db)
        ch = make_chapter(db, book.id)
        topic = make_topic(db, ch.id)

        user = make_user(db, email="ss@test.com", google_id="g-ss")
        make_studied(db, user.name, topic.id)  # unlock: studied=True required
        resp = client.post(
            "/api/session/start",
            json={"student_name": user.name, "topic_id": topic.id},
            headers=auth_headers(user),
        )

        assert resp.status_code == 200
        data = resp.json()
        assert "session_id" in data
        assert "message" in data or "question" in data
        assert "current_level" in data

    def test_start_session_requires_auth(self, client, db):
        resp = client.post("/api/session/start", json={"student_name": "x", "topic_id": 1})
        assert resp.status_code == 401

    @patch("session_engine._client")
    def test_start_session_invalid_topic(self, mock_client, client, db):
        user = make_user(db, email="inv@test.com", google_id="g-inv")
        resp = client.post(
            "/api/session/start",
            json={"student_name": user.name, "topic_id": 999999},
            headers=auth_headers(user),
        )
        assert resp.status_code == 404

    @patch("session_engine._client")
    def test_start_session_records_in_db(self, mock_client, client, db):
        mock_client.messages.create.return_value = _mock_claude_question()

        book = make_book(db)
        ch = make_chapter(db, book.id)
        topic = make_topic(db, ch.id)
        user = make_user(db, email="rec@test.com", google_id="g-rec")
        make_studied(db, user.name, topic.id)

        resp = client.post(
            "/api/session/start",
            json={"student_name": user.name, "topic_id": topic.id},
            headers=auth_headers(user),
        )
        assert resp.status_code == 200

        from models import Session as SessionModel
        session = db.query(SessionModel).filter(
            SessionModel.id == resp.json()["session_id"]
        ).first()
        assert session is not None
        assert session.status == "active"

    @patch("session_engine._client")
    def test_start_session_sets_current_level(self, mock_client, client, db):
        mock_client.messages.create.return_value = _mock_claude_question()

        book = make_book(db)
        ch = make_chapter(db, book.id)
        topic = make_topic(db, ch.id)
        user = make_user(db, email="lvl@test.com", google_id="g-lvl")
        make_studied(db, user.name, topic.id)

        resp = client.post(
            "/api/session/start",
            json={"student_name": user.name, "topic_id": topic.id},
            headers=auth_headers(user),
        )
        assert resp.status_code == 200
        assert resp.json()["current_level"] in ["L1", "L2", "L3", "L4", "L5"]


# ── Submit answer ─────────────────────────────────────────────────────────────

class TestSubmitAnswer:
    def test_answer_requires_auth(self, client, db):
        resp = client.post("/api/session/answer", json={"session_id": 1, "answer": "test"})
        assert resp.status_code == 401

    @patch("session_engine._client")
    def test_submit_correct_answer_returns_score(self, mock_client, client, db):
        mock_client.messages.create.side_effect = [
            _mock_claude_question(),   # generate_question (called inside start)
            _mock_claude_assess(score=90, tag="confident"),  # assess_answer
            _mock_claude_question(),   # next question
        ]

        book = make_book(db)
        ch = make_chapter(db, book.id)
        topic = make_topic(db, ch.id)
        user = make_user(db, email="ans@test.com", google_id="g-ans")
        make_studied(db, user.name, topic.id)

        start_resp = client.post(
            "/api/session/start",
            json={"student_name": user.name, "topic_id": topic.id},
            headers=auth_headers(user),
        )
        session_id = start_resp.json()["session_id"]

        ans_resp = client.post(
            "/api/session/answer",
            json={"session_id": session_id, "answer": "4"},
            headers=auth_headers(user),
        )

        assert ans_resp.status_code == 200
        data = ans_resp.json()
        assert "score" in data or "assessment_score" in data
        assert "feedback" in data

    @patch("session_engine._client")
    def test_submit_answer_wrong_session_returns_error(self, mock_client, client, db):
        user = make_user(db, email="ws@test.com", google_id="g-ws")
        resp = client.post(
            "/api/session/answer",
            json={"session_id": 999999, "answer": "something"},
            headers=auth_headers(user),
        )
        assert resp.status_code in (404, 400)

    @patch("session_engine._client")
    def test_submit_answer_increments_questions_asked(self, mock_client, client, db):
        mock_client.messages.create.side_effect = [
            _mock_claude_question(),
            _mock_claude_assess(score=75, tag="developing"),
            _mock_claude_question(),
        ]

        book = make_book(db)
        ch = make_chapter(db, book.id)
        topic = make_topic(db, ch.id)
        user = make_user(db, email="inc@test.com", google_id="g-inc")
        make_studied(db, user.name, topic.id)

        start_resp = client.post(
            "/api/session/start",
            json={"student_name": user.name, "topic_id": topic.id},
            headers=auth_headers(user),
        )
        session_id = start_resp.json()["session_id"]

        client.post(
            "/api/session/answer",
            json={"session_id": session_id, "answer": "something"},
            headers=auth_headers(user),
        )

        from models import Session as SessionModel
        session = db.query(SessionModel).filter(SessionModel.id == session_id).first()
        assert session.questions_asked >= 1


# ── Hint endpoint ─────────────────────────────────────────────────────────────

class TestHintEndpoint:
    def test_hint_requires_auth(self, client, db):
        resp = client.post("/api/session/hint", json={"session_id": 1})
        assert resp.status_code == 401

    @patch("session_engine._client")
    def test_hint_returns_hint_text(self, mock_client, client, db):
        mock_client.messages.create.side_effect = [
            _mock_claude_question(),
            _mock_claude_hint("Here's a clue: think about multiplication."),
        ]

        book = make_book(db)
        ch = make_chapter(db, book.id)
        topic = make_topic(db, ch.id)
        user = make_user(db, email="hint@test.com", google_id="g-hint")
        make_studied(db, user.name, topic.id)

        start_resp = client.post(
            "/api/session/start",
            json={"student_name": user.name, "topic_id": topic.id},
            headers=auth_headers(user),
        )
        session_id = start_resp.json()["session_id"]

        hint_resp = client.post(
            "/api/session/hint",
            json={"session_id": session_id},
            headers=auth_headers(user),
        )

        assert hint_resp.status_code == 200
        data = hint_resp.json()
        assert "hint_message" in data or "hint" in data  # API returns hint_message
        assert "hint_tier" in data

    @patch("session_engine._client")
    def test_hint_increments_tier(self, mock_client, client, db):
        mock_client.messages.create.side_effect = [
            _mock_claude_question(),
            _mock_claude_hint("Hint 1"),
            _mock_claude_hint("Hint 2"),
        ]

        book = make_book(db)
        ch = make_chapter(db, book.id)
        topic = make_topic(db, ch.id)
        user = make_user(db, email="ht@test.com", google_id="g-ht")
        make_studied(db, user.name, topic.id)

        start_resp = client.post(
            "/api/session/start",
            json={"student_name": user.name, "topic_id": topic.id},
            headers=auth_headers(user),
        )
        session_id = start_resp.json()["session_id"]

        h1 = client.post(
            "/api/session/hint",
            json={"session_id": session_id},
            headers=auth_headers(user),
        )
        h2 = client.post(
            "/api/session/hint",
            json={"session_id": session_id},
            headers=auth_headers(user),
        )

        assert h1.json()["hint_tier"] < h2.json()["hint_tier"]


# ── End session ───────────────────────────────────────────────────────────────

class TestEndSession:
    def test_end_session_requires_auth(self, client, db):
        resp = client.post("/api/session/end", json={"session_id": 1})
        assert resp.status_code == 401

    @patch("session_engine._client")
    def test_end_session_returns_summary(self, mock_client, client, db):
        summary_mock = MagicMock()
        summary_mock.content = [MagicMock(text="Great job! You showed good understanding.")]
        mock_client.messages.create.side_effect = [
            _mock_claude_question(),
            summary_mock,
        ]

        book = make_book(db)
        ch = make_chapter(db, book.id)
        topic = make_topic(db, ch.id)
        user = make_user(db, email="end@test.com", google_id="g-end")
        make_studied(db, user.name, topic.id)

        start_resp = client.post(
            "/api/session/start",
            json={"student_name": user.name, "topic_id": topic.id},
            headers=auth_headers(user),
        )
        session_id = start_resp.json()["session_id"]

        end_resp = client.post(
            "/api/session/end",
            json={"session_id": session_id},
            headers=auth_headers(user),
        )

        assert end_resp.status_code == 200
        data = end_resp.json()
        assert "summary" in data
        assert "level_reached" in data or "level" in data

    @patch("session_engine._client")
    def test_end_session_marks_session_ended(self, mock_client, client, db):
        summary_mock = MagicMock()
        summary_mock.content = [MagicMock(text="Session complete.")]
        mock_client.messages.create.side_effect = [
            _mock_claude_question(),
            summary_mock,
        ]

        book = make_book(db)
        ch = make_chapter(db, book.id)
        topic = make_topic(db, ch.id)
        user = make_user(db, email="mark@test.com", google_id="g-mark")
        make_studied(db, user.name, topic.id)

        start_resp = client.post(
            "/api/session/start",
            json={"student_name": user.name, "topic_id": topic.id},
            headers=auth_headers(user),
        )
        session_id = start_resp.json()["session_id"]

        client.post(
            "/api/session/end",
            json={"session_id": session_id},
            headers=auth_headers(user),
        )

        from models import Session as SessionModel
        session = db.query(SessionModel).filter(SessionModel.id == session_id).first()
        assert session.status in ("ended", "complete", "done", "completed")
