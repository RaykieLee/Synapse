"""F05a tenant invitation API verification with disposable SQLite and signed API tokens."""
import hashlib
from datetime import datetime, timedelta, timezone

from alembic import command
from alembic.config import Config
from fastapi.testclient import TestClient
from sqlalchemy import func, select


def test_f05a_tenant_invite_lifecycle(tmp_path, monkeypatch):
    db_path = tmp_path / "f05a.sqlite"
    monkeypatch.setenv("SYNAPSE_DATABASE_URL", f"sqlite:///{db_path}")
    monkeypatch.setenv("SYNAPSE_JWT_SECRET", "f05a-verification-only-secret")
    from app.core.config import get_settings
    from app.database.session import get_engine, get_session_factory
    get_settings.cache_clear(); get_engine.cache_clear(); get_session_factory.cache_clear()
    command.upgrade(Config("alembic.ini"), "0003_tenant_invitations")

    from app.auth.security import issue_token
    from app.models.user import User
    from app.models.tenant import Tenant, TenantInvitation, TenantMember, Workspace, WorkspaceMember
    from app.main import create_app

    factory = get_session_factory()
    with factory() as db:
        records = [
            User(user_name="platform", nick_name="Platform", email="platform@example.test", password_hash="unused", platform_role="platform_admin"),
            User(user_name="owner", nick_name="Owner", email="owner@example.test", password_hash="unused"),
            User(user_name="admin", nick_name="Admin", email="admin@example.test", password_hash="unused"),
            User(user_name="member", nick_name="Member", email="member@example.test", password_hash="unused"),
            User(user_name="target", nick_name="Target", email="target@example.test", password_hash="unused"),
            User(user_name="wrong", nick_name="Wrong", email="wrong@example.test", password_hash="unused"),
            User(user_name="unbound", nick_name="Unbound", email="unbound@example.test", password_hash="unused"),
            User(user_name="revoked", nick_name="Revoked", email="revoked@example.test", password_hash="unused"),
        ]
        db.add_all(records); db.commit()
        ids = {u.user_name: u.user_id for u in records}
    tokens = {name: issue_token(uid, 0) for name, uid in ids.items()}

    with TestClient(create_app()) as client:
        def req(method, path, actor, **kwargs):
            return getattr(client, method)(path, headers={"Authorization": f"Bearer {tokens[actor]}"}, **kwargs)

        created = req("post", "/api/v1/tenants", "platform", json={"slug": "invite-alpha", "name": "Invite Alpha", "first_owner_user_id": str(ids["owner"])})
        assert created.status_code == 201, created.text
        tid = created.json()["tenant_id"]
        default_workspace_id = created.json()["default_workspace"]["workspace_id"]
        with factory() as db:
            now = datetime.now(timezone.utc)
            db.add_all([
                TenantMember(tenant_id=int(tid), user_id=ids["admin"], status="active", tenant_role="admin", joined_at=now),
                TenantMember(tenant_id=int(tid), user_id=ids["member"], status="active", tenant_role="member", joined_at=now),
                TenantMember(tenant_id=int(tid), user_id=ids["revoked"], status="removed", tenant_role="member", joined_at=now),
                WorkspaceMember(workspace_id=int(default_workspace_id), tenant_id=int(tid), user_id=ids["revoked"], status="removed", workspace_role="member", joined_at=now),
            ])
            db.commit()
        second = req("post", "/api/v1/tenants", "platform", json={"slug": "invite-beta", "name": "Invite Beta", "first_owner_user_id": str(ids["wrong"])})
        assert second.status_code == 201
        other_tid = second.json()["tenant_id"]

        # Owner can create invite; response has the sole raw token and metadata, while DB stores only SHA-256.
        invite = req("post", f"/api/v1/tenants/{tid}/invitations", "owner", json={"user_id": str(ids["target"]), "tenant_role": "admin", "expires_in_hours": 2})
        assert invite.status_code == 201, invite.text
        data = invite.json(); raw = data["token"]; invitation_id = data["invitation_id"]
        assert data["target_user_id"] == str(ids["target"]) and data["email"] == "target@example.test"
        assert data["invite_link"].endswith(raw) and data["invitation_id"].isdecimal()
        assert "token_hash" not in data and raw in data["invite_link"]
        with factory() as db:
            stored = db.get(TenantInvitation, int(invitation_id))
            assert stored.token_hash == hashlib.sha256(raw.encode()).hexdigest()
            assert stored.token_hash != raw and raw not in repr(stored)

        # Member cannot create/list/revoke; admin can create member-only invites but cannot self-elevate.
        assert req("post", f"/api/v1/tenants/{tid}/invitations", "member", json={"email": "new@example.test"}).status_code == 403
        assert req("get", f"/api/v1/tenants/{tid}/invitations", "member").status_code == 403
        assert req("post", f"/api/v1/tenants/{tid}/invitations", "admin", json={"email": "admin-target@example.test", "tenant_role": "member"}).status_code == 201
        assert req("post", f"/api/v1/tenants/{tid}/invitations", "admin", json={"email": "elevate@example.test", "tenant_role": "admin"}).status_code == 403
        assert req("post", f"/api/v1/tenants/{tid}/invitations", "owner", json={"email": "owner-escalation@example.test", "tenant_role": "owner"}).status_code == 422
        assert req("post", f"/api/v1/tenants/{tid}/invitations", "owner", json={"email": "both@example.test", "user_id": str(ids["target"])}).status_code == 422

        # Cross-tenant tenant ID/invitation ID operations are rejected and don't mutate invitations.
        assert req("get", f"/api/v1/tenants/{other_tid}/invitations", "owner").status_code == 403
        assert req("delete", f"/api/v1/tenants/{other_tid}/invitations/{invitation_id}", "owner").status_code in (403, 404)
        assert req("delete", f"/api/v1/tenants/{tid}/invitations/{invitation_id}", "owner").status_code == 204
        assert req("post", "/api/v1/tenant-invitations/accept", "target", json={"token": raw}).status_code == 409
        assert req("post", "/api/v1/tenant-invitations/accept", "target", json={"token": raw}).status_code == 409

        # Target-user binding rejects another account, then exact intended user accepts once.
        valid = req("post", f"/api/v1/tenants/{tid}/invitations", "owner", json={"user_id": str(ids["target"]), "tenant_role": "admin"})
        valid_data = valid.json(); valid_token = valid_data["token"]
        assert req("post", "/api/v1/tenant-invitations/accept", "wrong", json={"token": valid_token}).status_code == 403
        accepted = req("post", "/api/v1/tenant-invitations/accept", "target", json={"token": valid_token})
        assert accepted.status_code == 200, accepted.text
        assert accepted.json()["tenant_role"] == "admin" and accepted.json()["workspace_memberships_created"] == 0
        assert req("post", "/api/v1/tenant-invitations/accept", "target", json={"token": valid_token}).status_code == 409
        with factory() as db:
            membership = db.scalar(select(TenantMember).where(TenantMember.tenant_id == int(tid), TenantMember.user_id == ids["target"]))
            assert membership.status == "active" and membership.tenant_role == "admin"
            assert db.scalar(select(func.count()).select_from(WorkspaceMember).where(WorkspaceMember.tenant_id == int(tid), WorkspaceMember.user_id == ids["target"])) == 0

        # Email invitation resolves to an existing account and case-insensitive login email matches.
        email_inv = req("post", f"/api/v1/tenants/{tid}/invitations", "owner", json={"email": "UNBOUND@example.test"})
        assert email_inv.status_code == 201, email_inv.text
        assert email_inv.json()["target_user_id"] == str(ids["unbound"])
        with factory() as db:
            account = db.get(User, ids["unbound"]); account.email = "UnBound@Example.Test"; db.commit()
        email_accept = req("post", "/api/v1/tenant-invitations/accept", "unbound", json={"token": email_inv.json()["token"]})
        assert email_accept.status_code == 200, email_accept.text

        # Email invite with no account at creation stays address-bound and rejects other emails.
        unbound_inv = req("post", f"/api/v1/tenants/{tid}/invitations", "owner", json={"email": "later@example.test"})
        assert unbound_inv.status_code == 201 and unbound_inv.json()["target_user_id"] is None
        assert req("post", "/api/v1/tenant-invitations/accept", "wrong", json={"token": unbound_inv.json()["token"]}).status_code == 403

        # Previously removed tenant membership can be reactivated, but workspace grant stays revoked.
        rejoin_inv = req("post", f"/api/v1/tenants/{tid}/invitations", "owner", json={"user_id": str(ids["revoked"])})
        assert rejoin_inv.status_code == 201
        rejoined = req("post", "/api/v1/tenant-invitations/accept", "revoked", json={"token": rejoin_inv.json()["token"]})
        assert rejoined.status_code == 200 and rejoined.json()["workspace_memberships_created"] == 0
        with factory() as db:
            old_space = db.scalar(select(WorkspaceMember).where(WorkspaceMember.tenant_id == int(tid), WorkspaceMember.user_id == ids["revoked"]))
            assert old_space.status == "removed"

        # Expiration is surfaced by the list, then acceptance returns 410 and transitions it to expired.
        expired_inv = req("post", f"/api/v1/tenants/{tid}/invitations", "owner", json={"email": "expired@example.test", "expires_in_hours": 1})
        assert expired_inv.status_code == 201
        with factory() as db:
            exp_row = db.get(TenantInvitation, int(expired_inv.json()["invitation_id"]))
            exp_row.expires_at = datetime.now(timezone.utc) - timedelta(seconds=1); db.commit()
        listed = req("get", f"/api/v1/tenants/{tid}/invitations", "admin").json()["items"]
        expired_listed = next(item for item in listed if item["invitation_id"] == expired_inv.json()["invitation_id"])
        assert expired_listed["expired"] is True
        assert not any("token" in key or "hash" in key for item in listed for key in item)
        expired_accept = req("post", "/api/v1/tenant-invitations/accept", "wrong", json={"token": expired_inv.json()["token"]})
        assert expired_accept.status_code == 410
        with factory() as db:
            assert db.get(TenantInvitation, int(expired_inv.json()["invitation_id"])).status == "expired"

        # Tenant suspension prevents new invitations and acceptance; restoring permits later operations.
        inactive_inv = req("post", f"/api/v1/tenants/{tid}/invitations", "owner", json={"email": "inactive@example.test"}).json()
        assert req("patch", f"/api/v1/tenants/{tid}", "platform", json={"status": "suspended"}).status_code == 200
        assert req("post", f"/api/v1/tenants/{tid}/invitations", "owner", json={"email": "blocked@example.test"}).status_code == 409
        assert req("post", "/api/v1/tenant-invitations/accept", "wrong", json={"token": inactive_inv["token"]}).status_code == 409
        assert req("patch", f"/api/v1/tenants/{tid}", "platform", json={"status": "active"}).status_code == 200

        # Revoke inviter's tenant-admin membership: it no longer authorizes invitation administration.
        with factory() as db:
            admin_member = db.scalar(select(TenantMember).where(TenantMember.tenant_id == int(tid), TenantMember.user_id == ids["admin"]))
            admin_member.status = "removed"; db.commit()
        assert req("get", f"/api/v1/tenants/{tid}/invitations", "admin").status_code == 403


def test_f05a_invite_expiry_revocation_and_tenant_boundary(tmp_path, monkeypatch):
    """Keep independently testable lifecycle boundaries running even if SQLite claim fails."""
    db_path = tmp_path / "f05a-boundary.sqlite"
    monkeypatch.setenv("SYNAPSE_DATABASE_URL", f"sqlite:///{db_path}")
    monkeypatch.setenv("SYNAPSE_JWT_SECRET", "f05a-boundary-verification-secret")
    from app.core.config import get_settings
    from app.database.session import get_engine, get_session_factory
    get_settings.cache_clear(); get_engine.cache_clear(); get_session_factory.cache_clear()
    command.upgrade(Config("alembic.ini"), "0003_tenant_invitations")
    from app.auth.security import issue_token
    from app.main import create_app
    from app.models.tenant import TenantInvitation, TenantMember
    from app.models.user import User
    factory = get_session_factory()
    with factory() as db:
        users = [
            User(user_name="platform", email="platform@example.test", password_hash="unused", platform_role="platform_admin"),
            User(user_name="owner", email="owner@example.test", password_hash="unused"),
            User(user_name="admin", email="admin@example.test", password_hash="unused"),
            User(user_name="member", email="member@example.test", password_hash="unused"),
            User(user_name="target", email="target@example.test", password_hash="unused"),
        ]
        db.add_all(users); db.commit(); ids = {u.user_name: u.user_id for u in users}
    tokens = {name: issue_token(uid, 0) for name, uid in ids.items()}
    with TestClient(create_app()) as client:
        def req(method, path, actor, **kwargs):
            return getattr(client, method)(path, headers={"Authorization": f"Bearer {tokens[actor]}"}, **kwargs)
        tenant = req("post", "/api/v1/tenants", "platform", json={"slug": "boundary", "name": "Boundary", "first_owner_user_id": str(ids["owner"])})
        assert tenant.status_code == 201
        tid = tenant.json()["tenant_id"]
        with factory() as db:
            db.add_all([
                TenantMember(tenant_id=int(tid), user_id=ids["admin"], status="active", tenant_role="admin"),
                TenantMember(tenant_id=int(tid), user_id=ids["member"], status="active", tenant_role="member"),
            ]); db.commit()

        # Admin-created member invitation can be revoked by owner, and token replay is rejected.
        revoked = req("post", f"/api/v1/tenants/{tid}/invitations", "admin", json={"user_id": str(ids["target"])})
        assert revoked.status_code == 201
        inv_id, raw = revoked.json()["invitation_id"], revoked.json()["token"]
        assert req("delete", f"/api/v1/tenants/{tid}/invitations/{inv_id}", "member").status_code == 403
        assert req("delete", f"/api/v1/tenants/{tid}/invitations/{inv_id}", "owner").status_code == 204
        assert req("post", "/api/v1/tenant-invitations/accept", "target", json={"token": raw}).status_code == 409

        # Expiration reports 410 and is retained as expired; list redacts token and hash.
        expired = req("post", f"/api/v1/tenants/{tid}/invitations", "owner", json={"email": "expired@example.test", "expires_in_hours": 1})
        assert expired.status_code == 201
        with factory() as db:
            row = db.get(TenantInvitation, int(expired.json()["invitation_id"]))
            row.expires_at = datetime.now(timezone.utc) - timedelta(seconds=1); db.commit()
        listed = req("get", f"/api/v1/tenants/{tid}/invitations", "admin").json()["items"]
        assert next(x for x in listed if x["invitation_id"] == expired.json()["invitation_id"])["expired"]
        assert not any("token" in key or "hash" in key for item in listed for key in item)
        assert req("post", "/api/v1/tenant-invitations/accept", "target", json={"token": expired.json()["token"]}).status_code == 410
        with factory() as db:
            assert db.get(TenantInvitation, int(expired.json()["invitation_id"])).status == "expired"

        # Tenant suspension blocks both invitation creation and acceptance; restoring it restores admission.
        pending = req("post", f"/api/v1/tenants/{tid}/invitations", "owner", json={"user_id": str(ids["target"])})
        assert pending.status_code == 201
        assert req("patch", f"/api/v1/tenants/{tid}", "platform", json={"status": "suspended"}).status_code == 200
        assert req("post", f"/api/v1/tenants/{tid}/invitations", "owner", json={"email": "blocked@example.test"}).status_code == 409
        assert req("post", "/api/v1/tenant-invitations/accept", "target", json={"token": pending.json()["token"]}).status_code == 409
        assert req("patch", f"/api/v1/tenants/{tid}", "platform", json={"status": "active"}).status_code == 200
        with factory() as db:
            admin = db.scalar(select(TenantMember).where(TenantMember.tenant_id == int(tid), TenantMember.user_id == ids["admin"]))
            admin.status = "removed"; db.commit()
        assert req("get", f"/api/v1/tenants/{tid}/invitations", "admin").status_code == 403
