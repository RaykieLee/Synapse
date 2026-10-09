"""F11 global-user administration verification with a disposable migrated SQLite DB."""
import bcrypt

from alembic import command
from alembic.config import Config
from fastapi.testclient import TestClient
from sqlalchemy import select


def _assert_no_secret_fields(value):
    if isinstance(value, dict):
        assert not ({"password_hash", "token_version", "del_flag"} & value.keys())
        for child in value.values():
            _assert_no_secret_fields(child)
    elif isinstance(value, list):
        for child in value:
            _assert_no_secret_fields(child)


def test_f11_platform_user_management(tmp_path, monkeypatch):
    db_path = tmp_path / "f11-users.sqlite"
    monkeypatch.setenv("SYNAPSE_DATABASE_URL", f"sqlite:///{db_path}")
    monkeypatch.setenv("SYNAPSE_JWT_SECRET", "f11-verification-only-secret")

    from app.core.config import get_settings
    from app.database.session import get_engine, get_session_factory
    get_settings.cache_clear(); get_engine.cache_clear(); get_session_factory.cache_clear()
    command.upgrade(Config("alembic.ini"), "head")

    from app.auth.security import issue_token
    from app.main import create_app
    from app.models.tenant import Tenant, TenantMember, Workspace, WorkspaceMember
    from app.models.user import User

    factory = get_session_factory()
    with factory() as db:
        accounts = [
            User(user_name="platform-root", email="platform@example.test", password_hash="unused", platform_role="platform_admin"),
            User(user_name="ordinary", email="ordinary@example.test", password_hash="unused"),
            User(user_name="tenant-admin", email="tenant-admin@example.test", password_hash="unused"),
            User(user_name="tenant-owner", email="tenant-owner@example.test", password_hash="unused"),
            User(user_name="legacy-bcrypt", email="legacy@example.test", password_hash=bcrypt.hashpw(b"legacy-password-strong", bcrypt.gensalt(rounds=4)).decode()),
        ]
        db.add_all(accounts); db.commit()
        ids = {account.user_name: account.user_id for account in accounts}
        tenant = Tenant(slug="f11-tenant", name="F11 Tenant", status="active", settings_json="{}", membership_version=1)
        db.add(tenant); db.flush()
        workspace = Workspace(tenant_id=tenant.tenant_id, slug="default", name="F11 Workspace", status="active",
                              settings_json="{}", created_by=ids["platform-root"])
        db.add(workspace); db.flush()
        other_tenant = Tenant(slug="f11-tenant-two", name="F11 Tenant Two", status="active", settings_json="{}", membership_version=1)
        db.add(other_tenant); db.flush()
        other_workspace = Workspace(tenant_id=other_tenant.tenant_id, slug="default", name="F11 Workspace Two", status="active",
                                    settings_json="{}", created_by=ids["platform-root"])
        db.add(other_workspace); db.flush()
        db.add_all([
            TenantMember(tenant_id=tenant.tenant_id, user_id=ids["tenant-owner"], status="active", tenant_role="owner"),
            TenantMember(tenant_id=tenant.tenant_id, user_id=ids["tenant-admin"], status="active", tenant_role="admin"),
        ])
        tenant_id, workspace_id = tenant.tenant_id, workspace.workspace_id
        other_tenant_id, other_workspace_id = other_tenant.tenant_id, other_workspace.workspace_id
        db.commit()

    tokens = {
        name: issue_token(user_id, 0)
        for name, user_id in ids.items()
    }
    with TestClient(create_app()) as client:
        def req(method, path, actor=None, **kwargs):
            headers = dict(kwargs.pop("headers", {}))
            if actor:
                headers["Authorization"] = f"Bearer {tokens[actor]}"
            return getattr(client, method)(path, headers=headers, **kwargs)

        # Every global-user operation is platform-admin-only; tenant admin is not a global admin.
        created = req("post", "/api/v1/users", "platform-root", json={
            "user_name": "victim-account", "password": "first-password-strong",
            "nick_name": "Victim", "email": "Victim@Example.com", "phonenumber": "+1-555-0130",
            "sex": "1", "avatar": "https://example.test/avatar.png",
        })
        assert created.status_code == 201, created.text
        victim = created.json()
        victim_id = int(victim["user_id"])
        assert victim["user_id"].isdecimal() and victim["email"] == "victim@example.com"
        assert victim["platform_role"] == "user" and victim["status"] == "active"
        _assert_no_secret_fields(victim)

        for actor in ("ordinary", "tenant-admin"):
            assert req("get", "/api/v1/users", actor).status_code == 403
            assert req("get", f"/api/v1/users/{victim_id}", actor).status_code == 403
            assert req("post", "/api/v1/users", actor, json={"user_name": "forbidden", "password": "forbidden-password"}).status_code == 403
            assert req("patch", f"/api/v1/users/{victim_id}", actor, json={"nick_name": "No"}).status_code == 403
            assert req("delete", f"/api/v1/users/{victim_id}", actor).status_code == 403
            assert req("post", f"/api/v1/users/{victim_id}/reset-password", actor, json={"new_password": "reset-password-strong"}).status_code == 403
        assert req("get", "/api/v1/users").status_code == 401

        # Request validation rejects weak passwords, malformed fields, blank names, and extra fields.
        assert req("post", "/api/v1/users", "platform-root", json={"user_name": "weak", "password": "short"}).status_code == 422
        assert req("post", "/api/v1/users", "platform-root", json={"user_name": "   ", "password": "long-password-strong"}).status_code == 422
        assert req("post", "/api/v1/users", "platform-root", json={"user_name": "bad-email", "password": "long-password-strong", "email": "not-an-email"}).status_code == 422
        assert req("post", "/api/v1/users", "platform-root", json={"user_name": "bad-sex", "password": "long-password-strong", "sex": "9"}).status_code == 422
        assert req("post", "/api/v1/users", "platform-root", json={"user_name": "extra", "password": "long-password-strong", "platform_role": "platform_admin"}).status_code == 422
        assert req("post", "/api/v1/users", "platform-root", json={"user_name": "duplicate-email", "password": "long-password-strong", "email": "VICTIM@example.com"}).status_code == 409
        assert req("post", "/api/v1/users", "platform-root", json={"user_name": "victim-account", "password": "long-password-strong"}).status_code == 409

        # Search and pagination only include non-deleted users and serialize string IDs.
        listing = req("get", "/api/v1/users?page=1&page_size=2", "platform-root")
        assert listing.status_code == 200, listing.text
        page = listing.json()
        assert page["page"] == 1 and page["page_size"] == 2 and len(page["items"]) == 2
        assert page["total"] >= 6 and all(item["user_id"].isdecimal() for item in page["items"])
        _assert_no_secret_fields(page)
        found = req("get", "/api/v1/users?search=Victim", "platform-root").json()
        assert found["total"] == 1 and found["items"][0]["user_id"] == str(victim_id)
        phone_found = req("get", "/api/v1/users?search=0130", "platform-root").json()
        assert phone_found["total"] == 1
        detail = req("get", f"/api/v1/users/{victim_id}", "platform-root")
        assert detail.status_code == 200 and detail.json()["user_id"] == str(victim_id)
        _assert_no_secret_fields(detail.json())

        # A normal account created with an explicit password can authenticate with it.
        login = req("post", "/api/v1/auth/login", json={"user_name": "victim-account", "password": "first-password-strong"})
        assert login.status_code == 200, login.text
        victim_token = login.json()["access_token"]
        assert req("get", "/api/v1/auth/me", headers={"Authorization": f"Bearer {victim_token}"}).status_code == 200

        # Only supported profile fields/status can be updated; state transitions revoke old JWTs.
        updated = req("patch", f"/api/v1/users/{victim_id}", "platform-root", json={"nick_name": "Updated Victim", "sex": "2"})
        assert updated.status_code == 200 and updated.json()["nick_name"] == "Updated Victim"
        _assert_no_secret_fields(updated.json())
        assert req("patch", f"/api/v1/users/{victim_id}", "platform-root", json={"status": "suspended"}).status_code == 422
        assert req("patch", f"/api/v1/users/{victim_id}", "platform-root", json={"user_name": "changed"}).status_code == 422
        assert req("patch", f"/api/v1/users/{victim_id}", "platform-root", json={"platform_role": "platform_admin"}).status_code == 422
        assert req("patch", f"/api/v1/users/{victim_id}", "platform-root", json={}).status_code == 422
        disabled = req("patch", f"/api/v1/users/{victim_id}", "platform-root", json={"status": "disabled"})
        assert disabled.status_code == 200 and disabled.json()["status"] == "disabled"
        assert req("get", "/api/v1/auth/me", headers={"Authorization": f"Bearer {victim_token}"}).status_code == 401
        assert req("post", "/api/v1/auth/login", json={"user_name": "victim-account", "password": "first-password-strong"}).status_code == 403
        assert req("patch", f"/api/v1/users/{victim_id}", "platform-root", json={"status": "active"}).status_code == 200

        login_again = req("post", "/api/v1/auth/login", json={"user_name": "victim-account", "password": "first-password-strong"})
        assert login_again.status_code == 200
        reset_old_token = login_again.json()["access_token"]
        assert req("post", f"/api/v1/users/{victim_id}/reset-password", "platform-root", json={"new_password": "too-short"}).status_code == 422
        reset = req("post", f"/api/v1/users/{victim_id}/reset-password", "platform-root", json={"new_password": "replacement-password-strong"})
        assert reset.status_code == 204
        assert req("get", "/api/v1/auth/me", headers={"Authorization": f"Bearer {reset_old_token}"}).status_code == 401
        assert req("post", "/api/v1/auth/login", json={"user_name": "victim-account", "password": "first-password-strong"}).status_code == 401
        new_login = req("post", "/api/v1/auth/login", json={"user_name": "victim-account", "password": "replacement-password-strong"})
        assert new_login.status_code == 200, new_login.text
        after_reset_token = new_login.json()["access_token"]

        # Legacy bcrypt login is accepted and upgrades the stored hash to scrypt.
        legacy_login = req("post", "/api/v1/auth/login", json={"user_name": "legacy-bcrypt", "password": "legacy-password-strong"})
        assert legacy_login.status_code == 200, legacy_login.text
        with factory() as db:
            legacy = db.get(User, ids["legacy-bcrypt"])
            assert legacy.password_hash.startswith("scrypt$")
        _assert_no_secret_fields(legacy_login.json())

        # Soft deletion hides the global account and preserves its independent tenant/workspace relations.
        with factory() as db:
            db.add_all([
                TenantMember(tenant_id=tenant_id, user_id=victim_id, status="active", tenant_role="member"),
                WorkspaceMember(workspace_id=workspace_id, tenant_id=tenant_id, user_id=victim_id, status="active", workspace_role="member"),
                TenantMember(tenant_id=other_tenant_id, user_id=victim_id, status="active", tenant_role="admin"),
                WorkspaceMember(workspace_id=other_workspace_id, tenant_id=other_tenant_id, user_id=victim_id, status="active", workspace_role="viewer"),
            ])
            db.commit()
        deleted = req("delete", f"/api/v1/users/{victim_id}", "platform-root")
        assert deleted.status_code == 204
        assert req("get", "/api/v1/auth/me", headers={"Authorization": f"Bearer {after_reset_token}"}).status_code == 401
        assert req("get", f"/api/v1/users/{victim_id}", "platform-root").status_code == 404
        assert req("delete", f"/api/v1/users/{victim_id}", "platform-root").status_code == 404
        remaining = req("get", "/api/v1/users?search=victim-account", "platform-root").json()
        assert remaining["total"] == 0 and remaining["items"] == []
        with factory() as db:
            soft_deleted = db.get(User, victim_id)
            tenant_membership = db.scalar(select(TenantMember).where(TenantMember.tenant_id == tenant_id, TenantMember.user_id == victim_id))
            workspace_membership = db.scalar(select(WorkspaceMember).where(WorkspaceMember.workspace_id == workspace_id, WorkspaceMember.user_id == victim_id))
            other_tenant_membership = db.scalar(select(TenantMember).where(TenantMember.tenant_id == other_tenant_id, TenantMember.user_id == victim_id))
            other_workspace_membership = db.scalar(select(WorkspaceMember).where(WorkspaceMember.workspace_id == other_workspace_id, WorkspaceMember.user_id == victim_id))
            assert soft_deleted.del_flag is True and soft_deleted.status == "disabled"
            assert tenant_membership.status == "active" and tenant_membership.tenant_role == "member"
            assert workspace_membership.status == "active" and workspace_membership.workspace_role == "member"
            assert other_tenant_membership.status == "active" and other_tenant_membership.tenant_role == "admin"
            assert other_workspace_membership.status == "active" and other_workspace_membership.workspace_role == "viewer"
