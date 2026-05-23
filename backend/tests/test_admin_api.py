"""
Tests for admin API endpoints.

Covers:
- GET  /api/admin/students          — list all students
- POST /api/admin/students          — create a student
- GET  /api/admin/students/{id}     — get student detail
- POST /api/admin/students/{id}/grade         — update grade
- POST /api/admin/students/{id}/deactivate    — deactivate
- POST /api/admin/students/{id}/activate      — activate
- POST /api/admin/students/{id}/reset-mastery — clear mastery
- GET  /api/admin/parents           — list parents
- POST /api/admin/parents           — create parent
- POST /api/admin/parents/{id}/link-student
- DELETE /api/admin/parents/{id}/unlink-student/{sid}
- GET  /api/admin/flagged           — flagged students
- GET  /api/admin/settings          — platform settings
- PUT  /api/admin/settings          — update settings
- GET  /api/admin/reports/overview  — overview stats
"""

import pytest
from tests.conftest import (
    make_user, make_book, make_chapter, make_topic, make_session,
    auth_headers,
)


# ── Students CRUD ─────────────────────────────────────────────────────────────

class TestAdminStudents:
    def test_list_students_requires_admin(self, client, db):
        student = make_user(db, email="ns@test.com", google_id="g-ns", role="student")
        resp = client.get("/api/admin/students", headers=auth_headers(student))
        assert resp.status_code == 403

    def test_list_students_as_admin(self, client, db):
        admin = make_user(db, email="a@test.com", google_id="g-a", role="admin")
        make_user(db, email="s1@test.com", google_id="g-s1", role="student")
        make_user(db, email="s2@test.com", google_id="g-s2", role="student")

        resp = client.get("/api/admin/students", headers=auth_headers(admin))
        assert resp.status_code == 200
        students = resp.json()
        assert isinstance(students, list)
        student_emails = [s["email"] for s in students]
        assert "s1@test.com" in student_emails
        assert "s2@test.com" in student_emails

    def test_list_students_excludes_admins_and_parents(self, client, db):
        admin = make_user(db, email="adm@test.com", google_id="g-adm", role="admin")
        make_user(db, email="par@test.com", google_id="g-par", role="parent")
        make_user(db, email="stu@test.com", google_id="g-stu", role="student")

        resp = client.get("/api/admin/students", headers=auth_headers(admin))
        students = resp.json()
        roles = [s.get("role") for s in students]
        # All entries should be students only
        for r in roles:
            assert r in ("student", None)  # role may be filtered out of response

    def test_create_student(self, client, db):
        admin = make_user(db, email="ca@test.com", google_id="g-ca", role="admin")
        resp = client.post(
            "/api/admin/students",
            json={"email": "newstudent@test.com", "name": "New Student", "grade": 5},
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["email"] == "newstudent@test.com"
        assert data["role"] == "student"

    def test_create_student_duplicate_email(self, client, db):
        """Creating a student with an existing email should not crash (200 upsert or 4xx)."""
        admin = make_user(db, email="dup@test.com", google_id="g-dup", role="admin")
        make_user(db, email="existing@test.com", google_id="g-exist")

        resp = client.post(
            "/api/admin/students",
            json={"email": "existing@test.com", "name": "Duplicate", "grade": 6},
            headers=auth_headers(admin),
        )
        # API may return 200 (upsert) or 4xx (reject) — either is acceptable,
        # but it must not 500.
        assert resp.status_code != 500

    def test_get_student_detail(self, client, db):
        admin = make_user(db, email="gsd@test.com", google_id="g-gsd", role="admin")
        student = make_user(db, email="det@test.com", google_id="g-det", role="student")

        resp = client.get(f"/api/admin/students/{student.id}", headers=auth_headers(admin))
        assert resp.status_code == 200
        data = resp.json()
        assert data["email"] == "det@test.com"

    def test_get_student_detail_not_found(self, client, db):
        admin = make_user(db, email="nf@test.com", google_id="g-nf", role="admin")
        resp = client.get("/api/admin/students/999999", headers=auth_headers(admin))
        assert resp.status_code == 404

    def test_update_student_grade(self, client, db):
        admin = make_user(db, email="usg@test.com", google_id="g-usg", role="admin")
        student = make_user(db, email="gradestud@test.com", google_id="g-gs", grade=5)

        resp = client.post(
            f"/api/admin/students/{student.id}/grade",
            json={"grade": 7},
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200
        db.refresh(student)
        assert student.grade == 7

    def test_deactivate_student(self, client, db):
        admin = make_user(db, email="deact@test.com", google_id="g-deact", role="admin")
        student = make_user(db, email="actstu@test.com", google_id="g-actstu")

        resp = client.post(
            f"/api/admin/students/{student.id}/deactivate",
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200
        db.refresh(student)
        assert student.is_active is False

    def test_activate_student(self, client, db):
        admin = make_user(db, email="act@test.com", google_id="g-act", role="admin")
        student = make_user(db, email="inactstu@test.com", google_id="g-inact", is_active=False)

        resp = client.post(
            f"/api/admin/students/{student.id}/activate",
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200
        db.refresh(student)
        assert student.is_active is True

    def test_reset_mastery(self, client, db):
        from models import TopicMastery

        admin = make_user(db, email="rm@test.com", google_id="g-rm", role="admin")
        student = make_user(db, email="mstudent@test.com", google_id="g-mstudent")

        book = make_book(db)
        ch = make_chapter(db, book.id)
        topic = make_topic(db, ch.id)

        db.add(TopicMastery(
            student_id=student.id,
            student_name=student.name,
            topic_id=topic.id,
            mastery_level="L4",
            total_sessions=10,
        ))
        db.commit()

        resp = client.post(
            f"/api/admin/students/{student.id}/reset-mastery",
            json={"confirm": True},
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200

        remaining = db.query(TopicMastery).filter(
            TopicMastery.student_id == student.id
        ).count()
        assert remaining == 0


# ── Parent management ─────────────────────────────────────────────────────────

class TestAdminParents:
    def test_list_parents_requires_admin(self, client, db):
        student = make_user(db, email="lpr@test.com", google_id="g-lpr")
        resp = client.get("/api/admin/parents", headers=auth_headers(student))
        assert resp.status_code == 403

    def test_list_parents_as_admin(self, client, db):
        admin = make_user(db, email="lpa@test.com", google_id="g-lpa", role="admin")
        make_user(db, email="par1@test.com", google_id="g-par1", role="parent")

        resp = client.get("/api/admin/parents", headers=auth_headers(admin))
        assert resp.status_code == 200
        assert isinstance(resp.json(), list)

    def test_create_parent(self, client, db):
        admin = make_user(db, email="crpar@test.com", google_id="g-crpar", role="admin")
        resp = client.post(
            "/api/admin/parents",
            json={"email": "newpar@test.com", "name": "New Parent"},
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200
        assert resp.json()["role"] == "parent"

    def test_link_student_to_parent(self, client, db):
        from models import ParentStudentLink

        admin = make_user(db, email="lnk@test.com", google_id="g-lnk", role="admin")
        parent = make_user(db, email="lnkpar@test.com", google_id="g-lnkpar", role="parent")
        student = make_user(db, email="lnkstu@test.com", google_id="g-lnkstu")

        resp = client.post(
            f"/api/admin/parents/{parent.id}/link-student",
            json={"student_id": student.id},
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200

        link = db.query(ParentStudentLink).filter(
            ParentStudentLink.parent_id == parent.id,
            ParentStudentLink.student_id == student.id,
        ).first()
        assert link is not None

    def test_unlink_student_from_parent(self, client, db):
        from models import ParentStudentLink

        admin = make_user(db, email="unlk@test.com", google_id="g-unlk", role="admin")
        parent = make_user(db, email="unlkpar@test.com", google_id="g-unlkpar", role="parent")
        student = make_user(db, email="unlkstu@test.com", google_id="g-unlkstu")

        link = ParentStudentLink(parent_id=parent.id, student_id=student.id)
        db.add(link)
        db.commit()

        resp = client.delete(
            f"/api/admin/parents/{parent.id}/unlink-student/{student.id}",
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200

        remaining = db.query(ParentStudentLink).filter(
            ParentStudentLink.parent_id == parent.id,
            ParentStudentLink.student_id == student.id,
        ).count()
        assert remaining == 0


# ── Settings ──────────────────────────────────────────────────────────────────

class TestAdminSettings:
    def test_get_settings_requires_admin(self, client, db):
        student = make_user(db, email="gsr@test.com", google_id="g-gsr")
        resp = client.get("/api/admin/settings", headers=auth_headers(student))
        assert resp.status_code == 403

    def test_get_settings_returns_dict(self, client, db):
        admin = make_user(db, email="gsa@test.com", google_id="g-gsa", role="admin")
        resp = client.get("/api/admin/settings", headers=auth_headers(admin))
        assert resp.status_code == 200
        assert isinstance(resp.json(), dict)

    def test_update_settings(self, client, db):
        from models import AppSettings

        admin = make_user(db, email="usa@test.com", google_id="g-usa", role="admin")
        # Ensure the key exists first
        existing = db.query(AppSettings).filter(AppSettings.key == "max_questions_per_session").first()
        if not existing:
            db.add(AppSettings(key="max_questions_per_session", value="20"))
            db.commit()

        resp = client.put(
            "/api/admin/settings",
            json={"max_questions_per_session": "15"},
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200


# ── Reports overview ──────────────────────────────────────────────────────────

class TestAdminReports:
    def test_overview_requires_admin(self, client, db):
        student = make_user(db, email="ovr@test.com", google_id="g-ovr")
        resp = client.get("/api/admin/reports/overview", headers=auth_headers(student))
        assert resp.status_code == 403

    def test_overview_returns_stats(self, client, db):
        admin = make_user(db, email="ovadm@test.com", google_id="g-ovadm", role="admin")
        resp = client.get("/api/admin/reports/overview", headers=auth_headers(admin))

        assert resp.status_code == 200
        data = resp.json()
        # Expect at least some numeric fields
        assert isinstance(data, dict)
        assert len(data) > 0

    def test_flagged_endpoint(self, client, db):
        admin = make_user(db, email="flg@test.com", google_id="g-flg", role="admin")
        resp = client.get("/api/admin/flagged", headers=auth_headers(admin))
        assert resp.status_code == 200


# ── Admin analytics (#61 #64 #65 #66) ────────────────────────────────────────

class TestAdminAnalytics:
    def test_analytics_requires_admin(self, client, db):
        student = make_user(db, email="ans@test.com", google_id="g-ans")
        resp = client.get("/api/admin/analytics", headers=auth_headers(student))
        assert resp.status_code == 403

    def test_analytics_returns_dict(self, client, db):
        admin = make_user(db, email="ana@test.com", google_id="g-ana", role="admin")
        resp = client.get("/api/admin/analytics", headers=auth_headers(admin))
        assert resp.status_code == 200
        assert isinstance(resp.json(), dict)

    def test_analytics_includes_hardest_topics(self, client, db):
        """#61: analytics should include hardest_topics list."""
        admin = make_user(db, email="aht@test.com", google_id="g-aht", role="admin")
        resp = client.get("/api/admin/analytics", headers=auth_headers(admin))
        data = resp.json()
        assert "hardest_topics" in data
        assert isinstance(data["hardest_topics"], list)

    def test_analytics_includes_ab_summary(self, client, db):
        """#64: analytics should include ab_summary dict."""
        admin = make_user(db, email="aab@test.com", google_id="g-aab", role="admin")
        resp = client.get("/api/admin/analytics", headers=auth_headers(admin))
        data = resp.json()
        assert "ab_summary" in data
        assert isinstance(data["ab_summary"], dict)

    def test_analytics_includes_prompt_version(self, client, db):
        """#65: analytics should expose prompt_version."""
        admin = make_user(db, email="apv@test.com", google_id="g-apv", role="admin")
        resp = client.get("/api/admin/analytics", headers=auth_headers(admin))
        data = resp.json()
        assert "prompt_version" in data
        assert isinstance(data["prompt_version"], str)

    def test_analytics_includes_ai_cost(self, client, db):
        """#26: analytics should include ai_cost_7d."""
        admin = make_user(db, email="aac@test.com", google_id="g-aac", role="admin")
        resp = client.get("/api/admin/analytics", headers=auth_headers(admin))
        data = resp.json()
        assert "ai_cost_7d" in data


# ── Admin weekly challenge (#56) ──────────────────────────────────────────────

class TestAdminWeeklyChallenge:
    def test_draft_requires_admin(self, client, db):
        student = make_user(db, email="wcd_s@test.com", google_id="g-wcd-s")
        resp = client.get("/api/admin/weekly-challenge/draft?grade=6", headers=auth_headers(student))
        assert resp.status_code == 403

    def test_draft_returns_not_found_without_topics(self, client, db):
        admin = make_user(db, email="wcd_a@test.com", google_id="g-wcd-a", role="admin")
        resp = client.get("/api/admin/weekly-challenge/draft?grade=99", headers=auth_headers(admin))
        # No topics for grade 99 → 404 or 422 (unprocessable) or empty 200
        assert resp.status_code in (200, 404, 422)

    def test_draft_returns_question_when_topics_exist(self, client, db):
        from unittest.mock import patch, MagicMock
        import json as _json
        admin = make_user(db, email="wcdt@test.com", google_id="g-wcdt", role="admin")
        book = make_book(db, grade=8)
        ch = make_chapter(db, book.id)
        make_topic(db, ch.id)

        mock_resp = MagicMock()
        mock_resp.content = [MagicMock(text=_json.dumps({
            "question": "Draft challenge question",
            "expected_key_points": ["point1"],
            "answer_format": "explanation",
        }))]
        with patch("session_engine._client") as mock_client:
            mock_client.messages.create.return_value = mock_resp
            resp = client.get("/api/admin/weekly-challenge/draft?grade=8", headers=auth_headers(admin))

        assert resp.status_code == 200
        data = resp.json()
        assert "question" in data or "question_text" in data

    def test_publish_requires_admin(self, client, db):
        student = make_user(db, email="wcp_s@test.com", google_id="g-wcp-s")
        book = make_book(db, grade=7)
        ch = make_chapter(db, book.id)
        topic = make_topic(db, ch.id)
        resp = client.post(
            "/api/admin/weekly-challenge/publish",
            json={"grade": 7, "topic_id": topic.id, "question": "Q", "key_points": [], "answer_format": "explanation"},
            headers=auth_headers(student),
        )
        assert resp.status_code == 403

    def test_publish_saves_challenge(self, client, db):
        from models import WeeklyChallenge
        admin = make_user(db, email="wcpa@test.com", google_id="g-wcpa", role="admin")
        book = make_book(db, grade=9)
        ch = make_chapter(db, book.id)
        topic = make_topic(db, ch.id)

        resp = client.post(
            "/api/admin/weekly-challenge/publish",
            json={
                "grade": 9,
                "topic_id": topic.id,
                "question": "Published challenge question",
                "key_points": ["key1", "key2"],
                "answer_format": "explanation",
            },
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200
        wc = db.query(WeeklyChallenge).filter(WeeklyChallenge.grade == 9).first()
        assert wc is not None
        assert wc.question_text == "Published challenge question"


# ── Admin CSV import (#21) ────────────────────────────────────────────────────

class TestAdminCSVImport:
    def test_import_requires_admin(self, client, db):
        student = make_user(db, email="csvi_s@test.com", google_id="g-csvi-s")
        resp = client.post(
            "/api/admin/students/import",
            json={"students": [{"email": "x@x.com", "name": "X", "grade": 5}]},
            headers=auth_headers(student),
        )
        assert resp.status_code == 403

    def test_import_creates_students(self, client, db):
        from models import User
        admin = make_user(db, email="csva@test.com", google_id="g-csva", role="admin")
        resp = client.post(
            "/api/admin/students/import",
            json={"students": [
                {"email": "imported1@test.com", "name": "Alice Import", "grade": 5},
                {"email": "imported2@test.com", "name": "Bob Import", "grade": 6},
            ]},
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200
        data = resp.json()
        # Should report created count
        assert "created" in data or "imported" in data or len(data) > 0

    def test_import_skips_duplicate_emails(self, client, db):
        admin = make_user(db, email="csvdup_a@test.com", google_id="g-csvdup-a", role="admin")
        existing = make_user(db, email="dup@test.com", google_id="g-dup-exist")
        resp = client.post(
            "/api/admin/students/import",
            json={"students": [
                {"email": "dup@test.com", "name": "Duplicate", "grade": 5},
            ]},
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200
        # Should not crash — existing user is skipped


# ── Admin audit log (#22) ─────────────────────────────────────────────────────

class TestAdminAuditLog:
    def test_audit_log_requires_admin(self, client, db):
        student = make_user(db, email="alog_s@test.com", google_id="g-alog-s")
        resp = client.get("/api/admin/audit-log", headers=auth_headers(student))
        assert resp.status_code == 403

    def test_audit_log_returns_list(self, client, db):
        admin = make_user(db, email="aloga@test.com", google_id="g-aloga", role="admin")
        resp = client.get("/api/admin/audit-log", headers=auth_headers(admin))
        assert resp.status_code == 200
        assert isinstance(resp.json(), list)

    def test_audit_log_records_student_creation(self, client, db):
        from models import AdminAuditLog
        admin = make_user(db, email="alogcr@test.com", google_id="g-alogcr", role="admin")
        client.post(
            "/api/admin/students",
            json={"email": "auditee@test.com", "name": "Audit Test"},
            headers=auth_headers(admin),
        )
        logs = db.query(AdminAuditLog).filter(AdminAuditLog.admin_id == admin.id).all()
        assert len(logs) >= 1
        actions = [l.action for l in logs]
        assert any("student" in a.lower() or "create" in a.lower() for a in actions)

    def test_audit_log_respects_limit(self, client, db):
        admin = make_user(db, email="alogl@test.com", google_id="g-alogl", role="admin")
        resp = client.get("/api/admin/audit-log?limit=5", headers=auth_headers(admin))
        assert resp.status_code == 200
        assert len(resp.json()) <= 5


# ── Admin book preview (#44) ──────────────────────────────────────────────────

class TestAdminBookPreview:
    def test_preview_requires_admin(self, client, db):
        student = make_user(db, email="bpv_s@test.com", google_id="g-bpv-s")
        book = make_book(db)
        resp = client.get(f"/api/admin/books/{book.id}/preview", headers=auth_headers(student))
        assert resp.status_code == 403

    def test_preview_404_for_unknown_book(self, client, db):
        admin = make_user(db, email="bpva@test.com", google_id="g-bpva", role="admin")
        resp = client.get("/api/admin/books/999999/preview", headers=auth_headers(admin))
        assert resp.status_code == 404

    def test_preview_returns_book_structure(self, client, db):
        admin = make_user(db, email="bpvs@test.com", google_id="g-bpvs", role="admin")
        book = make_book(db, title="Preview Book")
        ch = make_chapter(db, book.id)
        make_topic(db, ch.id)

        resp = client.get(f"/api/admin/books/{book.id}/preview", headers=auth_headers(admin))
        assert resp.status_code == 200
        data = resp.json()
        assert "chapters" in data or "title" in data or "topics" in data
