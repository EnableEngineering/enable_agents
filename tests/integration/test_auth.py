"""Integration tests — auth routes (/register, /login in app.py, so they go
through the monolith app rather than the minimal test app)."""
import uuid

import pytest


def _email(prefix="auth"):
    # Unique per call - the users table outlives a test.
    return f"{prefix}-{uuid.uuid4().hex[:10]}@example.com"


class TestRegister:
    def test_register_success(self, monolith_anon_client):
        email = _email("reg")
        res = monolith_anon_client.post("/register", json={
            "email": email, "password": "secret123", "first_name": "Test", "last_name": "User",
        })
        assert res.status_code == 201
        data = res.get_json()
        assert data["message"] == "User registered successfully"
        assert data["email"] == email
        assert data["session_token"]  # signed session for the new account

    def test_register_duplicate_email(self, monolith_anon_client):
        payload = {"email": _email("dup"), "password": "secret"}
        monolith_anon_client.post("/register", json=payload)
        res = monolith_anon_client.post("/register", json=payload)
        assert res.status_code == 400
        assert "already registered" in res.get_json()["error"]

    def test_register_missing_fields(self, monolith_anon_client):
        res = monolith_anon_client.post("/register", json={"email": _email("nopass")})
        assert res.status_code == 400


class TestLogin:
    def test_login_success(self, monolith_anon_client):
        email = _email("login")
        monolith_anon_client.post("/register", json={"email": email, "password": "pass123"})
        res = monolith_anon_client.post("/login", json={"email": email, "password": "pass123"})
        assert res.status_code == 200
        data = res.get_json()
        assert data["message"] == "Login successful"
        assert data["email"] == email
        assert data["session_token"]

    def test_login_wrong_password(self, monolith_anon_client):
        email = _email("wp")
        monolith_anon_client.post("/register", json={"email": email, "password": "right"})
        res = monolith_anon_client.post("/login", json={"email": email, "password": "wrong"})
        assert res.status_code == 401

    def test_login_unknown_user(self, monolith_anon_client):
        res = monolith_anon_client.post("/login", json={"email": _email("nobody"), "password": "x"})
        assert res.status_code == 401

    def test_dev_password_shortcut_is_off_outside_development(self, monolith_anon_client, monkeypatch):
        """The "dev123" login shortcut must fail closed: only an explicit
        ENVIRONMENT=development enables it. (It used to hinge on
        FLASK_ENV != "production", i.e. open whenever that was unset.)"""
        for env in ("production", "test", ""):
            monkeypatch.setenv("ENVIRONMENT", env)
            monkeypatch.delenv("FLASK_ENV", raising=False)
            res = monolith_anon_client.post("/login", json={"email": _email("dev"), "password": "dev123"})
            assert res.status_code == 401, f"dev123 accepted with ENVIRONMENT={env!r}"

        monkeypatch.setenv("ENVIRONMENT", "development")
        res = monolith_anon_client.post("/login", json={"email": _email("dev") , "password": "dev123"})
        assert res.status_code == 200  # the intended local-dev convenience still works
