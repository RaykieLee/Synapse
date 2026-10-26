"""HTTP acceptance for browser-only cookie authentication and deploy secrets."""

from alembic import command
from alembic.config import Config
from fastapi.testclient import TestClient
import pytest


def test_browser_login_uses_only_httponly_cookie(tmp_path, monkeypatch):
    db_path = tmp_path / "auth-cookie-session.sqlite"
    monkeypatch.setenv("SYNAPSE_DATABASE_URL", f"sqlite:///{db_path}")
    monkeypatch.setenv("SYNAPSE_JWT_SECRET", "auth-cookie-session-verification-secret")
    monkeypatch.setenv("SYNAPSE_ENV", "development")
    monkeypatch.setenv("SYNAPSE_AUTH_COOKIE_SECURE", "false")

    from app.core.config import get_settings
    from app.database.session import get_engine, get_session_factory

    get_settings.cache_clear()
    get_engine.cache_clear()
    get_session_factory.cache_clear()
    command.upgrade(Config("alembic.ini"), "head")

    from app.auth.security import password_hash
    from app.main import create_app
    from app.models.user import User

    with get_session_factory()() as db:
        db.add(
            User(
                user_name="cookie-session-user",
                password_hash=password_hash("cookie-session-password"),
            )
        )
        db.commit()

    with TestClient(create_app()) as client:
        login = client.post(
            "/api/v1/auth/login",
            json={
                "user_name": "cookie-session-user",
                "password": "cookie-session-password",
            },
        )

    assert login.status_code == 200
    assert login.json()["user"]["user_name"] == "cookie-session-user"
    assert "access_token" not in login.json()
    assert "token_type" not in login.json()
    set_cookie = login.headers["set-cookie"].lower()
    assert "synapse_session=" in set_cookie
    assert "httponly" in set_cookie
    assert "samesite=lax" in set_cookie
    assert "secure" not in set_cookie

    with TestClient(create_app()) as cookie_client:
        cookie_client.cookies.set(
            "synapse_session",
            login.cookies["synapse_session"],
        )
        me = cookie_client.get("/api/v1/auth/me")
        assert me.status_code == 200
        assert me.json()["user_name"] == "cookie-session-user"

    with TestClient(create_app()) as anonymous_client:
        assert anonymous_client.get("/api/v1/auth/me").status_code == 401


@pytest.mark.parametrize(
    ("secure_setting", "forwarded_proto", "expect_secure"),
    [
        (None, "https", True),
        (None, "http", False),
        ("true", "http", True),
        ("false", "https", False),
    ],
)
def test_cookie_secure_precedence(monkeypatch, secure_setting, forwarded_proto, expect_secure):
    from fastapi import FastAPI, Request, Response
    from fastapi.testclient import TestClient

    from app.api.auth import set_session_cookie
    from app.core.config import get_settings

    monkeypatch.setenv("SYNAPSE_ENV", "production")
    monkeypatch.setenv("SYNAPSE_JWT_SECRET", "x" * 32)
    monkeypatch.setenv(
        "SYNAPSE_AGENTSCOPE_CREDENTIAL_ENCRYPTION_KEY",
        "MDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDA=",
    )
    if secure_setting is None:
        monkeypatch.delenv("SYNAPSE_AUTH_COOKIE_SECURE", raising=False)
    else:
        monkeypatch.setenv("SYNAPSE_AUTH_COOKIE_SECURE", secure_setting)
    get_settings.cache_clear()

    app = FastAPI()

    @app.get("/cookie")
    def cookie(request: Request, response: Response):
        set_session_cookie(response, request, "test-token")
        return {"ok": True}

    with TestClient(app) as client:
        response = client.get(
            "/cookie",
            headers={"X-Forwarded-Proto": forwarded_proto},
        )

    set_cookie = response.headers["set-cookie"].lower()
    assert ("secure" in set_cookie) is expect_secure


@pytest.mark.parametrize(
    "values",
    [
        {"jwt_secret": None},
        {"jwt_secret": "short"},
        {"jwt_secret": "replace-with-a-long-random-jwt-secret"},
        {"agentscope_credential_encryption_key": None},
        {"agentscope_credential_encryption_key": "replace-with-a-fernet-key"},
        {"agentscope_credential_encryption_key": "not-a-fernet-key"},
    ],
)
def test_production_settings_reject_missing_or_invalid_secrets(monkeypatch, values):
    from app.core.config import Settings

    valid = {
        "SYNAPSE_JWT_SECRET": "x" * 32,
        "SYNAPSE_AGENTSCOPE_CREDENTIAL_ENCRYPTION_KEY": (
            "MDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDA="
        ),
    }
    for name, value in valid.items():
        monkeypatch.setenv(name, value)
    monkeypatch.setenv("SYNAPSE_ENV", "production")
    for field, value in values.items():
        env_name = f"SYNAPSE_{field.upper()}"
        if value is None:
            monkeypatch.delenv(env_name, raising=False)
        else:
            monkeypatch.setenv(env_name, value)

    with pytest.raises(ValueError):
        Settings(_env_file=None)
