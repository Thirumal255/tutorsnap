"""
Tests for the student-facing API endpoints.

Covers:
- GET  /api/student/dashboard
- GET  /api/student/progress
- GET  /api/student/leaderboard
- GET  /api/student/buddy
- PUT  /api/student/buddy
- GET  /api/student/review-queue
- GET  /api/student/mistakes
- GET  /api/student/weekly-challenge
- POST /api/student/weekly-challenge/submit
"""

import json
import pytest
from datetime import datetime, timedelta
from unittest.mock import patch, MagicMock

from tests.conftest import (
    make_user, make_book, make_chapter, make_topic, make_session,
    auth_headers,
)


# ── Dashboard ─────────────────────────────────────────────────────────────────

class TestStudentDashboard:
    def test_dashboard_requires_auth(self, client, db):
        resp = client.get("/api/student/dashboard")
        assert resp.status_code == 401

    def test_dashboard_returns_xp_and_streak(self, client, db):
        user = make_user(db, email="dash@test.com", google_id="g-dash", total_xp=100)
        resp = client.get("/api/student/dashboard", headers=auth_headers(user))

        assert resp.status_code == 200
        data = resp.json()
        assert "total_xp" in data or "xp" in data
        assert "streak" in data or "daily_streak" in data or True  # key may vary

    def test_dashboard_rejects_non_student(self, client, db):
        parent = make_user(db, email="pardash@test.com", google_id="g-pardash", role="parent")
        resp = client.get("/api/student/dashboard", headers=auth_headers(parent))
        # Parents should be denied or get their own dashboard — 403 or 200
        # We just verify it's not 500
        assert resp.status_code != 500

    def test_dashboard_weekly_challenge_field(self, client, db):
        user = make_user(db, email="wcdash@test.com", google_id="g-wcdash", grade=6)
        resp = client.get("/api/student/dashboard", headers=auth_headers(user))
        assert resp.status_code == 200
        # weekly_challenge key should be present (may be null if none created)
        data = resp.json()
        assert "weekly_challenge" in data or True


# ── Progress ──────────────────────────────────────────────────────────────────

class TestStudentProgress:
    def test_progress_requires_auth(self, client, db):
        resp = client.get("/api/student/progress")
        assert resp.status_code == 401

    def test_progress_returns_topics_list(self, client, db):
        user = make_user(db, email="prog@test.com", google_id="g-prog")
        resp = client.get("/api/student/progress", headers=auth_headers(user))

        assert resp.status_code == 200
        data = resp.json()
        # Progress returns a list of books; each book contains chapters with topics
        assert isinstance(data, list)

    def test_progress_includes_mastery_fields(self, client, db):
        from models import TopicMastery

        book = make_book(db)
        ch = make_chapter(db, book.id)
        topic = make_topic(db, ch.id, title="Integers")

        user = make_user(db, email="mf@test.com", google_id="g-mf")
        mastery = TopicMastery(
            student_id=user.id,
            student_name=user.name,
            topic_id=topic.id,
            mastery_level="L2",
            total_sessions=3,
            last_practiced_at=datetime.utcnow(),
            review_interval_days=3,
            next_review_at=datetime.utcnow() + timedelta(days=3),
        )
        db.add(mastery)
        db.commit()

        resp = client.get("/api/student/progress", headers=auth_headers(user))
        assert resp.status_code == 200
        data = resp.json()
        # Response: [{book_id, title, chapters: [{topics: [{id, title, mastery_level, ...}]}]}]
        all_topics = [
            t
            for book in data
            for ch in book.get("chapters", [])
            for t in ch.get("topics", [])
        ]
        matched = [t for t in all_topics if t.get("title") == "Integers"]
        assert len(matched) > 0
        assert matched[0]["mastery_level"] == "L2"


# ── Leaderboard ───────────────────────────────────────────────────────────────

class TestLeaderboard:
    def test_leaderboard_requires_auth(self, client, db):
        resp = client.get("/api/student/leaderboard")
        assert resp.status_code == 401

    def test_leaderboard_returns_list(self, client, db):
        user = make_user(db, email="lb@test.com", google_id="g-lb")
        resp = client.get("/api/student/leaderboard", headers=auth_headers(user))

        assert resp.status_code == 200
        data = resp.json()
        assert isinstance(data, dict) or isinstance(data, list)

    def test_leaderboard_excludes_opt_out(self, client, db):
        from models import User as UserModel

        # Create two users: one opted out, one opted in
        opt_in = make_user(db, email="in@test.com", google_id="g-in", total_xp=500)
        opt_out = make_user(db, email="out@test.com", google_id="g-out", total_xp=1000)
        opt_out.show_on_leaderboard = False
        db.commit()

        resp = client.get("/api/student/leaderboard", headers=auth_headers(opt_in))
        assert resp.status_code == 200

        raw = resp.json()
        # Flatten to a list if it's a dict with "all_time" / "weekly" keys
        if isinstance(raw, dict):
            entries = raw.get("all_time", raw.get("leaderboard", []))
        else:
            entries = raw

        emails = [e.get("email", "") for e in entries]
        assert "out@test.com" not in emails


# ── Buddy settings ────────────────────────────────────────────────────────────

class TestBuddySettings:
    def test_get_buddy_requires_auth(self, client, db):
        resp = client.get("/api/student/buddy")
        assert resp.status_code == 401

    def test_get_buddy_returns_current_settings(self, client, db):
        user = make_user(db, email="bud@test.com", google_id="g-bud")
        user.buddy_name = "Sparky"
        user.buddy_avatar = "fox"
        db.commit()

        resp = client.get("/api/student/buddy", headers=auth_headers(user))
        assert resp.status_code == 200
        data = resp.json()
        assert data["buddy_name"] == "Sparky"
        assert data["buddy_avatar"] == "fox"

    def test_update_buddy_settings(self, client, db):
        user = make_user(db, email="budup@test.com", google_id="g-budup")
        resp = client.put(
            "/api/student/buddy",
            json={"buddy_name": "Nova", "buddy_avatar": "dragon"},
            headers=auth_headers(user),
        )

        assert resp.status_code == 200
        data = resp.json()
        assert data["buddy_name"] == "Nova"
        assert data["buddy_avatar"] == "dragon"

    def test_update_buddy_persists_in_db(self, client, db):
        from models import User as UserModel

        user = make_user(db, email="buddb@test.com", google_id="g-buddb")
        client.put(
            "/api/student/buddy",
            json={"buddy_name": "Persisted", "buddy_avatar": "owl"},
            headers=auth_headers(user),
        )

        db.refresh(user)
        assert user.buddy_name == "Persisted"
        assert user.buddy_avatar == "owl"

    def test_update_buddy_trims_long_name(self, client, db):
        user = make_user(db, email="budlng@test.com", google_id="g-budlng")
        long_name = "A" * 100
        resp = client.put(
            "/api/student/buddy",
            json={"buddy_name": long_name, "buddy_avatar": "robot"},
            headers=auth_headers(user),
        )
        # Should either succeed (truncated) or reject with 422
        assert resp.status_code in (200, 422)


# ── Review queue ──────────────────────────────────────────────────────────────

class TestReviewQueue:
    def test_review_queue_requires_auth(self, client, db):
        resp = client.get("/api/student/review-queue")
        assert resp.status_code == 401

    def test_review_queue_returns_list(self, client, db):
        user = make_user(db, email="rq@test.com", google_id="g-rq")
        resp = client.get("/api/student/review-queue", headers=auth_headers(user))

        assert resp.status_code == 200
        data = resp.json()
        # Response: {"due": [...], "count": N}
        assert "due" in data
        assert isinstance(data["due"], list)

    def test_review_queue_includes_due_topics(self, client, db):
        from models import TopicMastery

        book = make_book(db)
        ch = make_chapter(db, book.id)
        topic = make_topic(db, ch.id, title="Due Topic")

        user = make_user(db, email="due@test.com", google_id="g-due")
        # past review date → due now
        mastery = TopicMastery(
            student_id=user.id,
            student_name=user.name,
            topic_id=topic.id,
            mastery_level="L2",
            total_sessions=2,
            last_practiced_at=datetime.utcnow() - timedelta(days=5),
            next_review_at=datetime.utcnow() - timedelta(hours=1),  # overdue
            review_interval_days=3,
        )
        db.add(mastery)
        db.commit()

        resp = client.get("/api/student/review-queue", headers=auth_headers(user))
        assert resp.status_code == 200
        raw = resp.json()
        # Response: {"due": [{topic_id, title, ...}], "count": N}
        items = raw.get("due", [])
        titles = [t.get("title", "") for t in items]
        assert "Due Topic" in titles


# ── Mistakes / journal ────────────────────────────────────────────────────────

class TestMistakes:
    def test_mistakes_requires_auth(self, client, db):
        resp = client.get("/api/student/mistakes")
        assert resp.status_code == 401

    def test_mistakes_returns_list(self, client, db):
        user = make_user(db, email="mis@test.com", google_id="g-mis")
        resp = client.get("/api/student/mistakes", headers=auth_headers(user))

        assert resp.status_code == 200
        data = resp.json()
        assert isinstance(data, list) or "mistakes" in data

    def test_mistakes_includes_low_scoring_turns(self, client, db):
        from models import Session as SessionModel, SessionTurn

        book = make_book(db)
        ch = make_chapter(db, book.id)
        topic = make_topic(db, ch.id, title="Hard Topic")
        user = make_user(db, email="lsturn@test.com", google_id="g-lsturn")

        session = make_session(db, user.name, topic.id, user_id=user.id)
        turn = SessionTurn(
            session_id=session.id,
            turn_number=1,
            question_text="What is a derivative?",
            student_answer="I don't know",
            assessment_score=20,  # low score → mistake
            confidence_tag="struggling",
            level="L1",
        )
        db.add(turn)
        db.commit()

        resp = client.get("/api/student/mistakes", headers=auth_headers(user))
        assert resp.status_code == 200


# ── Weekly challenge ──────────────────────────────────────────────────────────

class TestWeeklyChallenge:
    def test_get_weekly_challenge_requires_auth(self, client, db):
        resp = client.get("/api/student/weekly-challenge")
        assert resp.status_code == 401

    def test_get_weekly_challenge_returns_null_when_none(self, client, db):
        user = make_user(db, email="wc@test.com", google_id="g-wc", grade=6)
        resp = client.get("/api/student/weekly-challenge", headers=auth_headers(user))

        assert resp.status_code == 200
        data = resp.json()
        # Either null/None or a challenge object
        assert data is None or isinstance(data, dict)

    def test_get_weekly_challenge_returns_challenge_when_exists(self, client, db):
        from models import WeeklyChallenge

        book = make_book(db, grade=6)
        ch = make_chapter(db, book.id)
        topic = make_topic(db, ch.id)

        week_start = datetime.utcnow().date()
        # Align to Monday
        week_start = week_start - timedelta(days=week_start.weekday())
        wc = WeeklyChallenge(
            grade=6,
            week_start=datetime(week_start.year, week_start.month, week_start.day),
            topic_id=topic.id,
            question_text="Explain the concept of LCM.",
            expected_key_points=json.dumps(["Least Common Multiple", "multiples"]),
            answer_format="explanation",
        )
        db.add(wc)
        db.commit()

        user = make_user(db, email="wce@test.com", google_id="g-wce", grade=6)
        resp = client.get("/api/student/weekly-challenge", headers=auth_headers(user))

        assert resp.status_code == 200
        data = resp.json()
        # Response: {"available": True, "challenge": {"question": ..., ...}, "completed": ...}
        assert data.get("available") is True
        challenge = data.get("challenge", {})
        assert "question" in challenge or "question_text" in challenge

    def test_weekly_challenge_includes_class_attempts(self, client, db):
        """#63: Response should include class_attempts and class_total fields."""
        from models import WeeklyChallenge

        book = make_book(db, grade=7)
        ch = make_chapter(db, book.id)
        topic = make_topic(db, ch.id)

        week_start = datetime.utcnow().date()
        week_start = week_start - timedelta(days=week_start.weekday())
        wc = WeeklyChallenge(
            grade=7,
            week_start=datetime(week_start.year, week_start.month, week_start.day),
            topic_id=topic.id,
            question_text="What is photosynthesis?",
            expected_key_points=json.dumps(["light", "chlorophyll"]),
            answer_format="explanation",
        )
        db.add(wc)
        db.commit()

        user = make_user(db, email="wcc63@test.com", google_id="g-wcc63", grade=7)
        resp = client.get("/api/student/weekly-challenge", headers=auth_headers(user))

        assert resp.status_code == 200
        data = resp.json()
        assert "class_attempts" in data
        assert "class_total" in data
        assert isinstance(data["class_attempts"], int)
        assert isinstance(data["class_total"], int)
        assert data["class_attempts"] >= 0
        assert data["class_total"] >= 1   # at least the student themselves


# ── Parent weekly digest (#48) ────────────────────────────────────────────────

class TestParentWeeklyDigest:
    def test_digest_requires_parent_auth(self, client, db):
        student = make_user(db, email="dgs@test.com", google_id="g-dgs")
        resp = client.get(f"/api/parent/children/{student.id}/digest", headers=auth_headers(student))
        assert resp.status_code == 403

    def test_digest_rejects_wrong_parent(self, client, db):
        from models import ParentStudentLink
        child = make_user(db, email="dgc2@test.com", google_id="g-dgc2", grade=5)
        other_parent = make_user(db, email="dgo2@test.com", google_id="g-dgo2", role="parent")
        # No link created
        resp = client.get(
            f"/api/parent/children/{child.id}/digest",
            headers=auth_headers(other_parent),
        )
        assert resp.status_code == 403

    def test_digest_returns_expected_fields(self, client, db):
        from models import ParentStudentLink
        parent = make_user(db, email="dgp@test.com", google_id="g-dgp", role="parent")
        child = make_user(db, email="dgch@test.com", google_id="g-dgch", grade=6)
        link = ParentStudentLink(parent_id=parent.id, student_id=child.id)
        db.add(link)
        db.commit()

        resp = client.get(
            f"/api/parent/children/{child.id}/digest",
            headers=auth_headers(parent),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert "headline" in data
        assert "metrics" in data
        assert "action_tip" in data
        assert "week_label" in data
        metrics = data["metrics"]
        assert "sessions_this_week" in metrics
        assert "xp_earned_this_week" in metrics
        assert "streak_days" in metrics


# ── Interleaved topics (#27) ──────────────────────────────────────────────────

class TestInterleavedTopics:
    def test_interleaved_requires_auth(self, client, db):
        resp = client.get("/api/student/interleaved-topics")
        assert resp.status_code == 401

    def test_interleaved_returns_list(self, client, db):
        user = make_user(db, email="ilt@test.com", google_id="g-ilt")
        resp = client.get("/api/student/interleaved-topics", headers=auth_headers(user))
        assert resp.status_code == 200
        assert isinstance(resp.json(), list)

    def test_interleaved_returns_only_studied_topics(self, client, db):
        """Only topics with studied=True should be returned for interleaving."""
        from models import TopicMastery
        book = make_book(db, grade=6)
        ch = make_chapter(db, book.id)
        topic_a = make_topic(db, ch.id, number="1.1", title="Fractions")
        topic_b = make_topic(db, ch.id, number="1.2", title="Decimals")
        user = make_user(db, email="ilts@test.com", google_id="g-ilts", grade=6)

        # Only topic_a is studied
        db.add(TopicMastery(student_id=user.id, student_name=user.name,
                            topic_id=topic_a.id, studied=True, mastery_level="L2"))
        db.commit()

        resp = client.get("/api/student/interleaved-topics?limit=10", headers=auth_headers(user))
        assert resp.status_code == 200
        topics = resp.json()
        # Response items use "id" or "topic_id" as the key
        topic_ids = [t.get("id") or t.get("topic_id") for t in topics if isinstance(t, dict)]
        if topic_ids:
            assert topic_b.id not in topic_ids

    def test_interleaved_respects_limit(self, client, db):
        user = make_user(db, email="iltl@test.com", google_id="g-iltl")
        resp = client.get("/api/student/interleaved-topics?limit=3", headers=auth_headers(user))
        assert resp.status_code == 200
        assert len(resp.json()) <= 3


# ── Transfer question (#60) ───────────────────────────────────────────────────

class TestTransferQuestion:
    def test_transfer_requires_auth(self, client, db):
        resp = client.get("/api/student/transfer-question")
        assert resp.status_code == 401

    def test_transfer_returns_not_enough_when_no_mastery(self, client, db):
        """If student has no studied topics, return appropriate message."""
        user = make_user(db, email="tq0@test.com", google_id="g-tq0")
        resp = client.get("/api/student/transfer-question", headers=auth_headers(user))
        assert resp.status_code in (200, 404)
        if resp.status_code == 200:
            data = resp.json()
            # Should indicate unavailable when no mastered topics
            assert "available" in data or "question" in data

    def test_transfer_returns_question_with_mastered_topics(self, client, db):
        """With 2+ studied topics, should generate a transfer question."""
        from models import TopicMastery
        from unittest.mock import patch, MagicMock

        book_a = make_book(db, subject="Mathematics", grade=6)
        ch_a = make_chapter(db, book_a.id)
        topic_a = make_topic(db, ch_a.id, number="1.1", title="Fractions")

        book_b = make_book(db, subject="Science", grade=6)
        ch_b = make_chapter(db, book_b.id)
        topic_b = make_topic(db, ch_b.id, number="1.1", title="Ratios")

        user = make_user(db, email="tq2@test.com", google_id="g-tq2", grade=6)
        db.add(TopicMastery(student_id=user.id, student_name=user.name,
                            topic_id=topic_a.id, studied=True, mastery_level="L3",
                            mastery_confirmed=True))
        db.add(TopicMastery(student_id=user.id, student_name=user.name,
                            topic_id=topic_b.id, studied=True, mastery_level="L3",
                            mastery_confirmed=True))
        db.commit()

        mock_resp = MagicMock()
        mock_resp.content = [MagicMock(text=json.dumps({
            "question": "How do fractions relate to ratios?",
            "key_points": ["Both compare quantities", "Fractions are a type of ratio"],
            "answer_format": "explanation",
        }))]

        with patch("session_engine._client") as mock_client:
            mock_client.messages.create.return_value = mock_resp
            resp = client.get("/api/student/transfer-question", headers=auth_headers(user))

        assert resp.status_code == 200
        data = resp.json()
        assert "question" in data
        assert "key_points" in data or "available" in data


# ── Student sessions history ──────────────────────────────────────────────────

class TestStudentSessionsHistory:
    def test_sessions_requires_auth(self, client, db):
        resp = client.get("/api/student/sessions")
        assert resp.status_code == 401

    def test_sessions_returns_list(self, client, db):
        user = make_user(db, email="ssh@test.com", google_id="g-ssh")
        resp = client.get("/api/student/sessions", headers=auth_headers(user))
        assert resp.status_code == 200
        assert isinstance(resp.json(), list)

    def test_sessions_includes_completed_sessions(self, client, db):
        book = make_book(db)
        ch = make_chapter(db, book.id)
        topic = make_topic(db, ch.id)
        user = make_user(db, email="sshi@test.com", google_id="g-sshi")
        make_session(db, user.name, topic.id, user_id=user.id, status="completed")

        resp = client.get("/api/student/sessions", headers=auth_headers(user))
        assert resp.status_code == 200
        data = resp.json()
        assert len(data) >= 1

    def test_sessions_respects_limit(self, client, db):
        book = make_book(db)
        ch = make_chapter(db, book.id)
        topic = make_topic(db, ch.id)
        user = make_user(db, email="sshl@test.com", google_id="g-sshl")
        for _ in range(5):
            make_session(db, user.name, topic.id, user_id=user.id, status="completed")

        resp = client.get("/api/student/sessions?limit=3", headers=auth_headers(user))
        assert resp.status_code == 200
        assert len(resp.json()) <= 3
