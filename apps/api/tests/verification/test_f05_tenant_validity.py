"""Tenant validity-period API verification with a disposable SQLite database."""
from datetime import datetime, timezone

from alembic import command
from alembic.config import Config
from fastapi.testclient import TestClient


def test_tenant_validity_period_contract(tmp_path, monkeypatch):
    db_path = tmp_path / "tenant-validity.sqlite"
    monkeypatch.setenv("SYNAPSE_DATABASE_URL", f"sqlite:///{db_path}")
    monkeypatch.setenv("SYNAPSE_JWT_SECRET", "tenant-validity-verification-secret")

    from app.core.config import get_settings
    from app.database.session import get_engine, get_session_factory

    get_settings.cache_clear()
    get_engine.cache_clear()
    get_session_factory.cache_clear()
    command.upgrade(Config("alembic.ini"), "0016_tenant_validity")

    from app.auth.security import issue_token
    from app.main import create_app
    from app.models.user import User

    factory = get_session_factory()
    with factory() as db:
        admin = User(
            user_name="platform",
            nick_name="Platform",
            email="platform@example.test",
            password_hash="unused",
            platform_role="platform_admin",
        )
        owner = User(
            user_name="owner",
            nick_name="Owner",
            email="owner@example.test",
            password_hash="unused",
        )
        db.add_all([admin, owner])
        db.commit()
        admin_id, owner_id = admin.user_id, owner.user_id

    token = issue_token(admin_id, 0)
    app = create_app()
    with TestClient(app) as client:
        headers = {"Authorization": f"Bearer {token}"}
        valid_from = datetime(2026, 1, 1, tzinfo=timezone.utc)
        valid_until = datetime(2026, 12, 31, tzinfo=timezone.utc)

        created = client.post(
            "/api/v1/tenants",
            headers=headers,
            json={
                "slug": "validity",
                "name": "Validity",
                "first_owner_user_id": str(owner_id),
                "valid_from": valid_from.isoformat(),
                "valid_until": valid_until.isoformat(),
            },
        )
        assert created.status_code == 201, created.text
        tenant_id = created.json()["tenant_id"]
        assert created.json()["valid_from"].startswith("2026-01-01T00:00:00")
        assert created.json()["valid_until"].startswith("2026-12-31T00:00:00")

        patched = client.patch(
            f"/api/v1/tenants/{tenant_id}",
            headers=headers,
            json={
                "valid_from": datetime(2026, 2, 1, tzinfo=timezone.utc).isoformat(),
                "valid_until": datetime(2026, 11, 30, tzinfo=timezone.utc).isoformat(),
            },
        )
        assert patched.status_code == 200, patched.text
        assert patched.json()["valid_from"].startswith("2026-02-01T00:00:00")
        assert patched.json()["valid_until"].startswith("2026-11-30T00:00:00")

        invalid = client.patch(
            f"/api/v1/tenants/{tenant_id}",
            headers=headers,
            json={
                "valid_from": datetime(2026, 12, 1, tzinfo=timezone.utc).isoformat(),
                "valid_until": datetime(2026, 1, 1, tzinfo=timezone.utc).isoformat(),
            },
        )
        assert invalid.status_code == 422
        assert invalid.json()["code"] == "VALIDITY_RANGE"
