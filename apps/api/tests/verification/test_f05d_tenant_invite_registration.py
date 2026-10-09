"""F05d: verify invite-only registration against a disposable migrated database."""
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from threading import Barrier

from alembic import command
from alembic.config import Config
from fastapi.testclient import TestClient
from sqlalchemy import select


def test_f05d_invite_registration_and_acceptance(tmp_path, monkeypatch):
    db_path = tmp_path / "f05d.sqlite"
    monkeypatch.setenv("SYNAPSE_DATABASE_URL", f"sqlite:///{db_path}")
    monkeypatch.setenv("SYNAPSE_JWT_SECRET", "f05d-verification-only-secret")

    from app.core.config import get_settings
    from app.database.session import get_engine, get_session_factory
    get_settings.cache_clear()
    get_engine.cache_clear()
    get_session_factory.cache_clear()
    command.upgrade(Config("alembic.ini"), "head")

    from app.auth.security import issue_token
    from app.main import create_app
    from app.models.tenant import TenantInvitation, TenantMember, WorkspaceMember
    from app.models.user import User

    factory = get_session_factory()
    with factory() as db:
        actors = [
            User(user_name="platform", email="platform-f05d@example.test", password_hash="unused", platform_role="platform_admin"),
            User(user_name="tenant-owner", email="owner-f05d@example.test", password_hash="unused"),
            User(user_name="existing-account", email="existing-f05d@example.test", password_hash="unused"),
            User(user_name="username-taken", email="other-f05d@example.test", password_hash="unused"),
        ]
        db.add_all(actors)
        db.commit()
        actor_ids = {user.user_name: user.user_id for user in actors}
    tokens = {name: issue_token(user_id, 0) for name, user_id in actor_ids.items()}
    app = create_app()

    with TestClient(app) as client:
        def api(method, path, **kwargs):
            return getattr(client, method)(path, **kwargs)

        def authenticated(method, path, actor="platform", **kwargs):
            headers = dict(kwargs.pop("headers", {}))
            headers["Authorization"] = f"Bearer {tokens[actor]}"
            return api(method, path, headers=headers, **kwargs)

        tenant_response = authenticated("post", "/api/v1/tenants", json={
            "slug": "f05d-registration", "name": "F05d Registration",
            "first_owner_user_id": str(actor_ids["tenant-owner"]),
        })
        assert tenant_response.status_code == 201, tenant_response.text
        tenant_id = int(tenant_response.json()["tenant_id"])

        def invite(email, *, hours=48, role="member"):
            response = authenticated("post", f"/api/v1/tenants/{tenant_id}/invitations", "tenant-owner", json={
                "email": email, "tenant_role": role, "expires_in_hours": hours,
            })
            assert response.status_code == 201, response.text
            return response.json()

        def register(token, user_name, password="safe-registration-password", **extra):
            return api("post", "/api/v1/tenant-invitations/register-and-accept", json={
                "token": token, "user_name": user_name, "password": password,
                "nick_name": "Registered Invitee", **extra,
            })

        # A live unbound email invitation creates exactly one global account and tenant membership.
        accepted_invite = invite(" New.Member@Example.test ", role="admin")
        success = register(accepted_invite["token"], "new-f05d-member")
        assert success.status_code == 201, success.text
        payload = success.json()
        new_user = payload["user"]
        assert new_user["user_id"].isdecimal()
        assert new_user["email"] == "new.member@example.test"
        assert new_user["platform_role"] == "user" and new_user["status"] == "active"
        assert not ({"password_hash", "token_version", "del_flag"} & new_user.keys())
        assert payload["tenant"]["tenant_id"] == str(tenant_id)
        assert payload["tenant"]["tenant_role"] == "admin"
        assert payload["tenant"]["workspace_memberships_created"] == 0
        assert "access_token" in payload and payload["token_type"] == "bearer"
        assert "synapse_session" in success.cookies
        login = api("post", "/api/v1/auth/login", json={
            "user_name": "new-f05d-member", "password": "safe-registration-password",
        })
        assert login.status_code == 200, login.text
        with factory() as db:
            created_id = int(new_user["user_id"])
            membership = db.scalar(select(TenantMember).where(
                TenantMember.tenant_id == tenant_id, TenantMember.user_id == created_id,
            ))
            assert membership and membership.status == "active" and membership.tenant_role == "admin"
            assert db.scalar(select(WorkspaceMember).where(WorkspaceMember.user_id == created_id)) is None
            invitation = db.get(TenantInvitation, int(accepted_invite["invitation_id"]))
            assert invitation.status == "accepted" and invitation.accepted_by == created_id
        replay = register(accepted_invite["token"], "replay-f05d-user")
        assert replay.status_code == 409 and replay.json()["code"] == "INVITATION_NOT_PENDING"

        # Existing active, disabled and soft-deleted identities cannot be recreated through registration.
        existing_invite = invite("existing-f05d@example.test")
        existing = register(existing_invite["token"], "existing-duplicate")
        assert existing.status_code == 409
        assert existing.json()["code"] == "INVITATION_REQUIRES_EXISTING_ACCOUNT"
        email_conflict_invite = invite("late-email-conflict@example.test")
        with factory() as db:
            db.add(User(user_name="late-email-account", email="late-email-conflict@example.test",
                        password_hash="unused"))
            db.commit()
        email_conflict = register(email_conflict_invite["token"], "late-email-duplicate")
        assert email_conflict.status_code == 409
        assert email_conflict.json()["code"] == "INVITATION_REQUIRES_EXISTING_ACCOUNT"
        disabled_invite = invite("disabled-f05d@example.test")
        with factory() as db:
            db.add(User(user_name="disabled-account", email="disabled-f05d@example.test",
                        password_hash="unused", status="disabled"))
            db.commit()
        disabled = register(disabled_invite["token"], "disabled-duplicate")
        assert disabled.status_code == 403 and disabled.json()["code"] == "ACCOUNT_INACTIVE"
        deleted_invite = invite("deleted-f05d@example.test")
        with factory() as db:
            db.add(User(user_name="deleted-account", email="deleted-f05d@example.test",
                        password_hash="unused", status="disabled", del_flag=True))
            db.commit()
        deleted = register(deleted_invite["token"], "deleted-duplicate")
        assert deleted.status_code == 403 and deleted.json()["code"] == "ACCOUNT_INACTIVE"

        # Weak password and attempts to choose email/tenant/role are rejected before creation.
        validation_invite = invite("validation-f05d@example.test")
        weak = register(validation_invite["token"], "weak-f05d-user", password="short")
        assert weak.status_code == 422
        for tampered in ({"email": "attacker@example.test"}, {"tenant_id": "999999"}, {"tenant_role": "owner"}):
            response = register(validation_invite["token"], "tamper-f05d-user", **tampered)
            assert response.status_code == 422, response.text
        with factory() as db:
            assert db.scalar(select(User).where(User.user_name == "weak-f05d-user")) is None
            assert db.scalar(select(User).where(User.user_name == "tamper-f05d-user")) is None

        # Username uniqueness errors roll back both the invitation claim and any partial membership.
        conflict_invite = invite("conflict-f05d@example.test")
        conflict = register(conflict_invite["token"], "username-taken")
        assert conflict.status_code == 409 and conflict.json()["code"] == "ACCOUNT_CONFLICT"
        with factory() as db:
            assert db.get(TenantInvitation, int(conflict_invite["invitation_id"])).status == "pending"
            assert db.scalar(select(User).where(User.email == "conflict-f05d@example.test")) is None
            assert db.scalar(select(TenantMember).where(TenantMember.tenant_id == tenant_id,
                                                        TenantMember.user_id == actor_ids["username-taken"])) is None

        # Revocation and expiration are one-way failures; expiration is persisted on first attempted use.
        revoked_invite = invite("revoked-f05d@example.test")
        revoked = authenticated("delete", f"/api/v1/tenants/{tenant_id}/invitations/{revoked_invite['invitation_id']}", "tenant-owner")
        assert revoked.status_code == 204
        revoked_attempt = register(revoked_invite["token"], "revoked-f05d-user")
        assert revoked_attempt.status_code == 409 and revoked_attempt.json()["code"] == "INVITATION_NOT_PENDING"

        expired_invite = invite("expired-f05d@example.test", hours=1)
        with factory() as db:
            row = db.get(TenantInvitation, int(expired_invite["invitation_id"]))
            row.expires_at = datetime.now(timezone.utc) - timedelta(seconds=1)
            db.commit()
        expired = register(expired_invite["token"], "expired-f05d-user")
        assert expired.status_code == 410 and expired.json()["code"] == "INVITATION_EXPIRED"
        with factory() as db:
            assert db.get(TenantInvitation, int(expired_invite["invitation_id"])).status == "expired"
            assert db.scalar(select(User).where(User.user_name == "expired-f05d-user")) is None

        inactive_tenant_invite = invite("inactive-f05d@example.test")
        suspended = authenticated("patch", f"/api/v1/tenants/{tenant_id}", json={"status": "suspended"})
        assert suspended.status_code == 200, suspended.text
        inactive = register(inactive_tenant_invite["token"], "inactive-f05d-user")
        assert inactive.status_code == 409 and inactive.json()["code"] == "TENANT_INACTIVE"
        with factory() as db:
            assert db.get(TenantInvitation, int(inactive_tenant_invite["invitation_id"])).status == "pending"
            assert db.scalar(select(User).where(User.user_name == "inactive-f05d-user")) is None
        restored = authenticated("patch", f"/api/v1/tenants/{tenant_id}", json={"status": "active"})
        assert restored.status_code == 200

        # Two concurrent registrations with the same token must not create two users or memberships.
        concurrent_invite = invite("concurrent-f05d@example.test")
        barrier = Barrier(2)

        def concurrent_register(username):
            with TestClient(app) as thread_client:
                barrier.wait(timeout=10)
                return thread_client.post("/api/v1/tenant-invitations/register-and-accept", json={
                    "token": concurrent_invite["token"], "user_name": username,
                    "password": "concurrent-registration-password",
                })

        with ThreadPoolExecutor(max_workers=2) as executor:
            futures = [executor.submit(concurrent_register, "concurrent-one"),
                       executor.submit(concurrent_register, "concurrent-two")]
            concurrent_responses = [future.result(timeout=30) for future in futures]
        statuses = sorted(response.status_code for response in concurrent_responses)
        assert statuses == [201, 409], [(r.status_code, r.text) for r in concurrent_responses]
        with factory() as db:
            winners = db.scalars(select(User).where(User.email == "concurrent-f05d@example.test")).all()
            assert len(winners) == 1
            memberships = db.scalars(select(TenantMember).where(
                TenantMember.tenant_id == tenant_id, TenantMember.user_id == winners[0].user_id,
            )).all()
            assert len(memberships) == 1 and memberships[0].status == "active"
            assert db.get(TenantInvitation, int(concurrent_invite["invitation_id"])).status == "accepted"
