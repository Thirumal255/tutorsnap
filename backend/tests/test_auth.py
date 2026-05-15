"""
Tests for authentication utilities and /api/auth/* endpoints.

Covers:
- JWT creation & decoding (valid, expired, tampered)
- /api/auth/me  — authenticated user info
- /api/auth/logout
- /api/auth/dev-login  — dev shortcut (returns token for existing user)
- Role-based access guards (require_admin, require_parent)
"""

import os
import pytest
from datetime import datetime, timedelta
from unittest.mock import patch

from tests.conftest import make_user, make_jwt, auth_headers


# ─── JWT helpers ──────────────────────────────────────────────────────────────

class TestJWTHelpers:
    def test_create_and_decode_round_trip(self):
        """create_jwt → decode_jwt should give back the same payload."""
        from auth import create_jwt, decode_jwt

        token = create_jwt(user_id=42, email="a@test.com", role="student")
        payload = decode_jwt(token)

        assert payload["user_id"] == 42
        assert payload["email"] == "a@test.com"
        assert payload["role"] == "student"

    def test_expired_token_raises(self):
        """decode_jwt raises ValueError for expired tokens."""
        import jwt as _jwt
        from auth import decode_jwt

        payload = {
            "user_id": 1,
            "email": "x@test.com",
            "role": "student",
            "exp": datetime.utcnow() - timedelta(hours=1),  # already expired
            "iat": datetime.utcnow() - timedelta(hours=2),
        }
        token = _jwt.encode(payload, os.getenv("JWT_SECRET"), algorithm="HS256")

        with pytest.raises(ValueError, match="expired"):
            decode_jwt(token)

    def test_tampered_token_raises(self):
        """decode_jwt raises ValueError for tampered tokens."""
        from auth import decode_jwt

        with pytest.raises(ValueError, match="Invalid"):
            decode_jwt("eyJhbGciOiJIUzI1NiJ9.bad.payload")

    def test_missing_token_raises(self):
        """decode_jwt raises ValueError for empty strings."""
        from auth import decode_jwt

        with pytest.raises(Exception):
            decode_jwt("")

    def test_different_secret_raises(self):
        """A token signed with a different secret should be rejected."""
        import jwt as _jwt
        from auth import decode_jwt

        payload = {
            "user_id": 99,
            "email": "y@test.com",
            "role": "admin",
            "exp": datetime.utcnow() + timedelta(hours=1),
        }
        token = _jwt.encode(payload, "wrong-secret-here-padding-32", algorithm="HS256")

        with pytest.raises(ValueError):
            decode_jwt(token)

    def test_token_has_expiry_in_future(self):
        """Freshly created token should have exp > now."""
        from auth import create_jwt, decode_jwt

        token = create_jwt(user_id=1, email="z@test.com", role="student")
        payload = decode_jwt(token)
        assert payload["exp"] > datetime.utcnow().timestamp()


# ─── /api/auth/me ─────────────────────────────────────────────────────────────

class TestAuthMe:
    def test_me_returns_user_info(self, client, db):
        user = make_user(db, email="me@test.com", name="Me User", role="student")
        resp = client.get("/api/auth/me", headers=auth_headers(user))

        assert resp.status_code == 200
        data = resp.json()
        assert data["email"] == "me@test.com"
        assert data["name"] == "Me User"
        assert data["role"] == "student"

    def test_me_without_token_returns_401(self, client, db):
        resp = client.get("/api/auth/me")
        assert resp.status_code == 401

    def test_me_with_bad_token_returns_401(self, client, db):
        resp = client.get("/api/auth/me", headers={"Authorization": "Bearer garbage"})
        assert resp.status_code == 401

    def test_me_includes_gamification_fields(self, client, db):
        user = make_user(db, total_xp=250)
        resp = client.get("/api/auth/me", headers=auth_headers(user))

        assert resp.status_code == 200
        data = resp.json()
        assert "total_xp" in data
        assert data["total_xp"] == 250
        assert "buddy_avatar" in data
        assert "buddy_name" in data

    def test_me_inactive_user_returns_401(self, client, db):
        user = make_user(db, email="inactive@test.com", google_id="g-inactive", is_active=False)
        resp = client.get("/api/auth/me", headers=auth_headers(user))
        assert resp.status_code == 401


# ─── /api/auth/logout ─────────────────────────────────────────────────────────

class TestAuthLogout:
    def test_logout_succeeds(self, client, db):
        user = make_user(db, email="logout@test.com", google_id="g-logout")
        resp = client.post("/api/auth/logout", headers=auth_headers(user))
        assert resp.status_code == 200

    def test_logout_without_auth_returns_200(self, client, db):
        """logout endpoint is stateless — always returns 200 regardless of auth."""
        resp = client.post("/api/auth/logout")
        assert resp.status_code == 200


# ─── /api/auth/dev-login ──────────────────────────────────────────────────────

class TestDevLogin:
    def test_dev_login_returns_token_for_existing_user(self, client, db):
        make_user(db, email="dev@test.com", google_id="g-dev", role="student")
        resp = client.post("/api/auth/dev-login", json={"email": "dev@test.com"})

        assert resp.status_code == 200
        data = resp.json()
        assert "access_token" in data
        assert data["user"]["email"] == "dev@test.com"

    def test_dev_login_unknown_email_creates_user(self, client, db):
        """dev-login auto-creates unknown users (dev convenience behaviour)."""
        resp = client.post("/api/auth/dev-login", json={"email": "brand_new@test.com"})
        assert resp.status_code == 200
        data = resp.json()
        assert "access_token" in data
        assert data["user"]["email"] == "brand_new@test.com"

    def test_dev_login_token_is_valid_jwt(self, client, db):
        make_user(db, email="devjwt@test.com", google_id="g-devjwt")
        resp = client.post("/api/auth/dev-login", json={"email": "devjwt@test.com"})
        token = resp.json()["access_token"]

        from auth import decode_jwt
        payload = decode_jwt(token)
        assert payload["email"] == "devjwt@test.com"


# ─── Role guards ──────────────────────────────────────────────────────────────

class TestRoleGuards:
    def test_admin_endpoint_rejects_student(self, client, db):
        student = make_user(db, email="s@test.com", google_id="g-s", role="student")
        resp = client.get("/api/admin/students", headers=auth_headers(student))
        assert resp.status_code == 403

    def test_admin_endpoint_accepts_admin(self, client, db):
        admin = make_user(db, email="admin@test.com", google_id="g-admin", role="admin")
        resp = client.get("/api/admin/students", headers=auth_headers(admin))
        # 200 OK (empty list) or any non-403 success
        assert resp.status_code == 200

    def test_parent_endpoint_rejects_student(self, client, db):
        student = make_user(db, email="sp@test.com", google_id="g-sp", role="student")
        resp = client.get("/api/parent/children", headers=auth_headers(student))
        assert resp.status_code == 403

    def test_parent_endpoint_accepts_parent(self, client, db):
        parent = make_user(db, email="par@test.com", google_id="g-par", role="parent")
        resp = client.get("/api/parent/children", headers=auth_headers(parent))
        assert resp.status_code == 200

    def test_admin_can_access_parent_endpoint(self, client, db):
        admin = make_user(db, email="adm2@test.com", google_id="g-adm2", role="admin")
        resp = client.get("/api/parent/children", headers=auth_headers(admin))
        assert resp.status_code == 200
