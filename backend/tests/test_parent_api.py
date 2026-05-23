"""
Tests for parent-facing API endpoints.

Covers:
- GET  /api/parent/children                      — list linked children
- GET  /api/parent/children/{id}                 — child detail + mastery
- GET  /api/parent/children/{id}/sessions        — paginated sessions
- GET  /api/parent/children/{id}/weekly-report   — week snapshot
- GET  /api/parent/children/{id}/digest          — weekly digest (#48)
- GET  /api/parent/family-activity               — 7-day activity chart
- POST /api/parent/children/{id}/encourage        — send encouragement (#50)
- GET  /api/parent/notifications                 — notification list
- POST /api/parent/notifications/{id}/read       — mark read
- POST /api/parent/notifications/mark-all-read   — mark all read
"""

import json
import pytest
from datetime import datetime, timedelta

from tests.conftest import (
    make_user, make_book, make_chapter, make_topic, make_session,
    auth_headers,
)


def make_link(db, parent_id, student_id):
    from models import ParentStudentLink
    link = ParentStudentLink(parent_id=parent_id, student_id=student_id)
    db.add(link)
    db.commit()
    return link


def make_notification(db, user_id, title="Test", body="Body"):
    from models import Notification
    n = Notification(user_id=user_id, type="test", title=title, body=body)
    db.add(n)
    db.commit()
    db.refresh(n)
    return n


# ── GET /parent/children ──────────────────────────────────────────────────────

class TestParentChildren:
    def test_requires_parent_role(self, client, db):
        student = make_user(db, email="pch_s@test.com", google_id="g-pch-s")
        resp = client.get("/api/parent/children", headers=auth_headers(student))
        assert resp.status_code == 403

    def test_returns_empty_list_for_no_links(self, client, db):
        parent = make_user(db, email="pch_p@test.com", google_id="g-pch-p", role="parent")
        resp = client.get("/api/parent/children", headers=auth_headers(parent))
        assert resp.status_code == 200
        assert resp.json() == []

    def test_returns_linked_children(self, client, db):
        parent = make_user(db, email="pch2_p@test.com", google_id="g-pch2-p", role="parent")
        child = make_user(db, email="pch2_c@test.com", google_id="g-pch2-c", grade=5)
        make_link(db, parent.id, child.id)

        resp = client.get("/api/parent/children", headers=auth_headers(parent))
        assert resp.status_code == 200
        data = resp.json()
        assert len(data) >= 1
        names = [c.get("name") or c.get("student", {}).get("name") for c in data]
        assert any(child.name in str(n) for n in names if n)

    def test_admin_can_access(self, client, db):
        admin = make_user(db, email="pch_adm@test.com", google_id="g-pch-adm", role="admin")
        resp = client.get("/api/parent/children", headers=auth_headers(admin))
        assert resp.status_code == 200

    def test_does_not_return_unlinked_children(self, client, db):
        parent = make_user(db, email="pchu_p@test.com", google_id="g-pchu-p", role="parent")
        _other = make_user(db, email="pchu_c@test.com", google_id="g-pchu-c", grade=6)
        # No link created
        resp = client.get("/api/parent/children", headers=auth_headers(parent))
        assert resp.status_code == 200
        assert resp.json() == []


# ── GET /parent/children/{id} ─────────────────────────────────────────────────

class TestParentChildDetail:
    def test_requires_parent(self, client, db):
        student = make_user(db, email="pcd_s@test.com", google_id="g-pcd-s")
        resp = client.get(f"/api/parent/children/{student.id}", headers=auth_headers(student))
        assert resp.status_code == 403

    def test_rejects_unlinked_parent(self, client, db):
        parent = make_user(db, email="pcdu_p@test.com", google_id="g-pcdu-p", role="parent")
        child = make_user(db, email="pcdu_c@test.com", google_id="g-pcdu-c", grade=6)
        resp = client.get(f"/api/parent/children/{child.id}", headers=auth_headers(parent))
        assert resp.status_code == 403

    def test_returns_detail_for_linked_child(self, client, db):
        parent = make_user(db, email="pcdl_p@test.com", google_id="g-pcdl-p", role="parent")
        child = make_user(db, email="pcdl_c@test.com", google_id="g-pcdl-c", grade=7)
        make_link(db, parent.id, child.id)

        resp = client.get(f"/api/parent/children/{child.id}", headers=auth_headers(parent))
        assert resp.status_code == 200
        data = resp.json()
        # Response should include student info
        assert "student" in data or "name" in data or "grade" in data

    def test_returns_404_for_nonexistent(self, client, db):
        parent = make_user(db, email="pcd404_p@test.com", google_id="g-pcd404-p", role="parent")
        resp = client.get("/api/parent/children/999999", headers=auth_headers(parent))
        assert resp.status_code in (403, 404)

    def test_includes_score_trend(self, client, db):
        """#51: child detail should include score_trend for 14-day chart."""
        parent = make_user(db, email="pcdst_p@test.com", google_id="g-pcdst-p", role="parent")
        child = make_user(db, email="pcdst_c@test.com", google_id="g-pcdst-c", grade=6)
        make_link(db, parent.id, child.id)

        resp = client.get(f"/api/parent/children/{child.id}", headers=auth_headers(parent))
        assert resp.status_code == 200
        data = resp.json()
        assert "score_trend" in data


# ── GET /parent/children/{id}/sessions ───────────────────────────────────────

class TestParentChildSessions:
    def test_requires_parent(self, client, db):
        student = make_user(db, email="pcse_s@test.com", google_id="g-pcse-s")
        resp = client.get(f"/api/parent/children/{student.id}/sessions", headers=auth_headers(student))
        assert resp.status_code == 403

    def test_rejects_unlinked(self, client, db):
        parent = make_user(db, email="pcse_p@test.com", google_id="g-pcse-p", role="parent")
        child = make_user(db, email="pcse_c@test.com", google_id="g-pcse-c")
        resp = client.get(f"/api/parent/children/{child.id}/sessions", headers=auth_headers(parent))
        assert resp.status_code == 403

    def test_returns_session_list(self, client, db):
        parent = make_user(db, email="pcs_p@test.com", google_id="g-pcs-p", role="parent")
        child = make_user(db, email="pcs_c@test.com", google_id="g-pcs-c", grade=6)
        make_link(db, parent.id, child.id)

        book = make_book(db)
        ch = make_chapter(db, book.id)
        topic = make_topic(db, ch.id)
        make_session(db, child.name, topic.id, user_id=child.id, status="completed")

        resp = client.get(f"/api/parent/children/{child.id}/sessions", headers=auth_headers(parent))
        assert resp.status_code == 200
        data = resp.json()
        assert isinstance(data, list) or isinstance(data, dict)

    def test_pagination_limit(self, client, db):
        parent = make_user(db, email="pcsp_p@test.com", google_id="g-pcsp-p", role="parent")
        child = make_user(db, email="pcsp_c@test.com", google_id="g-pcsp-c", grade=6)
        make_link(db, parent.id, child.id)

        book = make_book(db)
        ch = make_chapter(db, book.id)
        topic = make_topic(db, ch.id)
        for _ in range(5):
            make_session(db, child.name, topic.id, user_id=child.id, status="completed")

        resp = client.get(
            f"/api/parent/children/{child.id}/sessions?limit=2&offset=0",
            headers=auth_headers(parent),
        )
        assert resp.status_code == 200


# ── GET /parent/children/{id}/weekly-report ──────────────────────────────────

class TestParentWeeklyReport:
    def test_requires_parent(self, client, db):
        student = make_user(db, email="pwr_s@test.com", google_id="g-pwr-s")
        resp = client.get(f"/api/parent/children/{student.id}/weekly-report", headers=auth_headers(student))
        assert resp.status_code == 403

    def test_rejects_unlinked(self, client, db):
        parent = make_user(db, email="pwru_p@test.com", google_id="g-pwru-p", role="parent")
        child = make_user(db, email="pwru_c@test.com", google_id="g-pwru-c")
        resp = client.get(f"/api/parent/children/{child.id}/weekly-report", headers=auth_headers(parent))
        assert resp.status_code == 403

    def test_returns_expected_fields(self, client, db):
        parent = make_user(db, email="pwr_p@test.com", google_id="g-pwr-p", role="parent")
        child = make_user(db, email="pwr_c@test.com", google_id="g-pwr-c", grade=6)
        make_link(db, parent.id, child.id)

        resp = client.get(f"/api/parent/children/{child.id}/weekly-report", headers=auth_headers(parent))
        assert resp.status_code == 200
        data = resp.json()
        assert "this_week" in data
        assert "streak_days" in data
        assert "sessions" in data["this_week"]
        assert "xp_earned" in data["this_week"]

    def test_delta_sessions_field(self, client, db):
        parent = make_user(db, email="pwrd_p@test.com", google_id="g-pwrd-p", role="parent")
        child = make_user(db, email="pwrd_c@test.com", google_id="g-pwrd-c", grade=6)
        make_link(db, parent.id, child.id)

        resp = client.get(f"/api/parent/children/{child.id}/weekly-report", headers=auth_headers(parent))
        assert resp.status_code == 200
        data = resp.json()
        assert "delta_sessions" in data


# ── GET /parent/family-activity ───────────────────────────────────────────────

class TestParentFamilyActivity:
    def test_requires_parent(self, client, db):
        student = make_user(db, email="pfa_s@test.com", google_id="g-pfa-s")
        resp = client.get("/api/parent/family-activity", headers=auth_headers(student))
        assert resp.status_code == 403

    def test_returns_list(self, client, db):
        parent = make_user(db, email="pfa_p@test.com", google_id="g-pfa-p", role="parent")
        resp = client.get("/api/parent/family-activity", headers=auth_headers(parent))
        assert resp.status_code == 200
        assert isinstance(resp.json(), list)

    def test_includes_child_activity(self, client, db):
        parent = make_user(db, email="pfac_p@test.com", google_id="g-pfac-p", role="parent")
        child = make_user(db, email="pfac_c@test.com", google_id="g-pfac-c", grade=6)
        make_link(db, parent.id, child.id)

        book = make_book(db)
        ch = make_chapter(db, book.id)
        topic = make_topic(db, ch.id)
        make_session(db, child.name, topic.id, user_id=child.id, status="completed")

        resp = client.get("/api/parent/family-activity", headers=auth_headers(parent))
        assert resp.status_code == 200
        data = resp.json()
        assert len(data) >= 1
        child_entry = next(
            (d for d in data if d.get("child_name") == child.name or d.get("name") == child.name),
            None,
        )
        assert child_entry is not None


# ── POST /parent/children/{id}/encourage (#50) ────────────────────────────────

class TestParentEncourage:
    def test_requires_parent(self, client, db):
        student = make_user(db, email="enc_s@test.com", google_id="g-enc-s")
        resp = client.post(
            f"/api/parent/children/{student.id}/encourage",
            json={"message": "Well done!"},
            headers=auth_headers(student),
        )
        assert resp.status_code == 403

    def test_rejects_unlinked(self, client, db):
        parent = make_user(db, email="encu_p@test.com", google_id="g-encu-p", role="parent")
        child = make_user(db, email="encu_c@test.com", google_id="g-encu-c")
        resp = client.post(
            f"/api/parent/children/{child.id}/encourage",
            json={"message": "Keep going!"},
            headers=auth_headers(parent),
        )
        assert resp.status_code == 403

    def test_sends_encouragement_to_child(self, client, db):
        """Encouragement should create a notification for the child."""
        from models import Notification
        parent = make_user(db, email="encs_p@test.com", google_id="g-encs-p", role="parent")
        child = make_user(db, email="encs_c@test.com", google_id="g-encs-c", grade=6)
        make_link(db, parent.id, child.id)

        resp = client.post(
            f"/api/parent/children/{child.id}/encourage",
            json={"message": "You are doing great!"},
            headers=auth_headers(parent),
        )
        assert resp.status_code == 200

        notif = db.query(Notification).filter(Notification.user_id == child.id).first()
        assert notif is not None
        assert "great" in notif.body.lower() or "encourage" in notif.type.lower()

    def test_rejects_empty_message(self, client, db):
        parent = make_user(db, email="ence_p@test.com", google_id="g-ence-p", role="parent")
        child = make_user(db, email="ence_c@test.com", google_id="g-ence-c")
        make_link(db, parent.id, child.id)

        resp = client.post(
            f"/api/parent/children/{child.id}/encourage",
            json={"message": ""},
            headers=auth_headers(parent),
        )
        assert resp.status_code in (400, 422)


# ── GET /parent/notifications ─────────────────────────────────────────────────

class TestParentNotifications:
    def test_requires_auth(self, client, db):
        resp = client.get("/api/parent/notifications")
        assert resp.status_code == 401

    def test_returns_list(self, client, db):
        parent = make_user(db, email="pn_p@test.com", google_id="g-pn-p", role="parent")
        resp = client.get("/api/parent/notifications", headers=auth_headers(parent))
        assert resp.status_code == 200
        assert isinstance(resp.json(), list)

    def test_returns_own_notifications(self, client, db):
        parent = make_user(db, email="pno_p@test.com", google_id="g-pno-p", role="parent")
        make_notification(db, parent.id, title="New mastery", body="Alice mastered Fractions")

        resp = client.get("/api/parent/notifications", headers=auth_headers(parent))
        assert resp.status_code == 200
        data = resp.json()
        assert len(data) >= 1
        assert any("mastery" in n.get("title", "").lower() or "Alice" in n.get("body", "") for n in data)

    def test_mark_notification_read(self, client, db):
        parent = make_user(db, email="pnr_p@test.com", google_id="g-pnr-p", role="parent")
        notif = make_notification(db, parent.id, title="Tip", body="Encourage today")

        resp = client.post(
            f"/api/parent/notifications/{notif.id}/read",
            headers=auth_headers(parent),
        )
        assert resp.status_code == 200

        from models import Notification
        db.refresh(notif)
        assert notif.is_read is True

    def test_mark_all_read(self, client, db):
        from models import Notification
        parent = make_user(db, email="pnar_p@test.com", google_id="g-pnar-p", role="parent")
        make_notification(db, parent.id, title="N1", body="Body1")
        make_notification(db, parent.id, title="N2", body="Body2")

        resp = client.post("/api/parent/notifications/mark-all-read", headers=auth_headers(parent))
        assert resp.status_code == 200

        unread = db.query(Notification).filter(
            Notification.user_id == parent.id,
            Notification.is_read == False,
        ).count()
        assert unread == 0
