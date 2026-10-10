"""Repeatable API verification for F05 tenant backend; uses only temporary SQLite."""
from datetime import datetime, timezone

from alembic import command
from alembic.config import Config
from fastapi.testclient import TestClient
from sqlalchemy import func, select


def test_f05_tenant_api_contract(tmp_path, monkeypatch):
    db_path = tmp_path / "f05.sqlite"
    monkeypatch.setenv("SYNAPSE_DATABASE_URL", f"sqlite:///{db_path}")
    monkeypatch.setenv("SYNAPSE_JWT_SECRET", "f05-verification-only-secret")

    from app.core.config import get_settings
    from app.database.session import get_engine, get_session_factory
    get_settings.cache_clear()
    get_engine.cache_clear()
    get_session_factory.cache_clear()

    config = Config("alembic.ini")
    command.upgrade(config, "0016_tenant_validity")

    from app.auth.security import issue_token
    from app.database.session import get_session_factory
    from app.main import create_app
    from app.models.user import User
    from app.models.tenant import Tenant, TenantMember, Workspace, WorkspaceMember

    factory = get_session_factory()
    with factory() as db:
        admin = User(user_name="platform", nick_name="Platform", email="platform@example.test",
                     password_hash="unused", platform_role="platform_admin")
        owner = User(user_name="owner", nick_name="Owner", email="owner@example.test", password_hash="unused")
        admin2 = User(user_name="admin", nick_name="Tenant Admin", email="admin@example.test", password_hash="unused")
        member = User(user_name="member", nick_name="Member", email="member@example.test", password_hash="unused")
        outsider = User(user_name="outsider", nick_name="Outsider", email="outsider@example.test", password_hash="unused")
        db.add_all([admin, owner, admin2, member, outsider]); db.commit()
        ids = {u.user_name: u.user_id for u in (admin, owner, admin2, member, outsider)}

    tokens = {name: issue_token(uid, 0) for name, uid in ids.items()}
    app = create_app()
    with TestClient(app) as client:
        def req(method, path, actor, **kwargs):
            return getattr(client, method)(path, headers={"Authorization": f"Bearer {tokens[actor]}"}, **kwargs)

        # Platform administrator creates tenant, selected active owner, default workspace and owner grants.
        created = req("post", "/api/v1/tenants", "platform", json={"slug": "alpha", "name": "Alpha", "first_owner_user_id": str(ids["owner"])})
        assert created.status_code == 201, f"{created.status_code}: {created.text}; ids={ids}"
        tenant = created.json(); tid = tenant["tenant_id"]
        workspace = tenant["default_workspace"]
        assert tid.isdecimal() and workspace["tenant_id"] == tid and workspace["workspace_id"].isdecimal()
        assert tenant["tenant_role"] == "owner" and workspace["workspace_role"] == "owner"
        assert workspace["slug"] == "default"
        with factory() as db:
            assert db.scalar(select(func.count()).select_from(Tenant)) == 1
            assert db.scalar(select(func.count()).select_from(TenantMember).where(TenantMember.tenant_id == int(tid), TenantMember.user_id == ids["owner"], TenantMember.tenant_role == "owner", TenantMember.status == "active")) == 1
            assert db.scalar(select(func.count()).select_from(WorkspaceMember).where(WorkspaceMember.workspace_id == int(workspace["workspace_id"]), WorkspaceMember.user_id == ids["owner"], WorkspaceMember.workspace_role == "owner", WorkspaceMember.status == "active")) == 1
            assert db.scalar(select(func.count()).select_from(Workspace).where(Workspace.tenant_id == int(tid))) == 1

        # Creation rejects normal member and does not partially create on invalid selected owner.
        assert req("post", "/api/v1/tenants", "member", json={"slug": "denied", "name": "Denied", "first_owner_user_id": str(ids["member"]) }).status_code == 403
        assert req("post", "/api/v1/tenants", "platform", json={"slug": "bad-owner", "name": "Bad", "first_owner_user_id": "999999"}).status_code == 422
        with factory() as db:
            assert db.scalar(select(func.count()).select_from(Tenant)) == 1

        # Provision another active workspace owner/member relation through migrated tables to verify immediate revocation semantics.
        with factory() as db:
            db.add_all([
                TenantMember(tenant_id=int(tid), user_id=ids["admin"], status="active", tenant_role="admin", joined_at=datetime.now(timezone.utc)),
                TenantMember(tenant_id=int(tid), user_id=ids["member"], status="active", tenant_role="member", joined_at=datetime.now(timezone.utc)),
                TenantMember(tenant_id=int(tid), user_id=ids["outsider"], status="active", tenant_role="owner", joined_at=datetime.now(timezone.utc)),
            ])
            # Second owner allows checking first-owner protection and member suspension without breaking invariants.
            db.flush()
            wmem = db.scalar(select(WorkspaceMember).where(WorkspaceMember.workspace_id == int(workspace["workspace_id"]), WorkspaceMember.user_id == ids["owner"]))
            wmem.workspace_role = "owner"
            db.add(WorkspaceMember(workspace_id=int(workspace["workspace_id"]), tenant_id=int(tid), user_id=ids["outsider"], status="active", workspace_role="owner", joined_at=datetime.now(timezone.utc)))
            db.add(WorkspaceMember(workspace_id=int(workspace["workspace_id"]), tenant_id=int(tid), user_id=ids["member"], status="active", workspace_role="member", joined_at=datetime.now(timezone.utc)))
            db.commit()

        # User tenant lists are scoped; outsiders do not learn tenant names through list or direct resource reads.
        listing = req("get", "/api/v1/tenants", "member").json()
        assert listing["total"] == 1 and [x["tenant_id"] for x in listing["items"]] == [tid]
        assert listing["items"][0]["workspaces"][0]["workspace_id"] == workspace["workspace_id"]
        member_page = req("get", f"/api/v1/tenants/{tid}/members", "owner", params={"page": 1, "page_size": 2}).json()
        assert member_page["page"] == 1 and member_page["page_size"] == 2
        assert all(row["user_id"].isdecimal() for row in member_page["items"])
        assert req("get", "/api/v1/tenants", "outsider").json()["total"] == 1  # second owner belongs to same tenant
        assert req("get", f"/api/v1/tenants/{tid}", "outsider").status_code == 200
        # Platform admins are not implicitly made tenant members. They can address known IDs,
        # but GET /tenants is membership-scoped and currently offers no platform management list.
        admin_list = req("get", "/api/v1/tenants", "platform").json()
        assert admin_list["total"] == 0 and admin_list["items"] == []
        assert req("get", f"/api/v1/tenants/{tid}", "platform").status_code == 200
        assert req("patch", f"/api/v1/tenants/{tid}", "platform", json={"status": "suspended"}).status_code == 200
        assert req("patch", f"/api/v1/tenants/{tid}", "platform", json={"status": "active"}).status_code == 200
        platform_page = req("get", "/api/v1/platform/tenants", "platform").json()
        assert platform_page["total"] == 1 and platform_page["items"][0]["tenant_id"] == tid
        assert platform_page["items"][0]["tenant_role"] is None
        assert req("get", "/api/v1/platform/tenants", "member").status_code == 403
        # An account with no membership, after creating a second tenant, cannot see either tenant in list.
        second = req("post", "/api/v1/tenants", "platform", json={"slug": "beta", "name": "Beta", "first_owner_user_id": str(ids["outsider"])})
        assert second.status_code == 201
        beta_id = second.json()["tenant_id"]
        assert req("patch", f"/api/v1/tenants/{beta_id}", "platform", json={"status": "suspended"}).status_code == 200
        third = req("post", "/api/v1/tenants", "platform", json={"slug": "gamma", "name": "Gamma Org", "first_owner_user_id": str(ids["owner"])})
        assert third.status_code == 201
        gamma_id = third.json()["tenant_id"]
        assert req("patch", f"/api/v1/tenants/{gamma_id}", "platform", json={"status": "archived"}).status_code == 200
        suspended = req("get", "/api/v1/platform/tenants", "platform", params={"status": "suspended"}).json()
        assert suspended["total"] == 1 and [row["tenant_id"] for row in suspended["items"]] == [beta_id]
        archived_named = req("get", "/api/v1/platform/tenants", "platform", params={"status": "archived", "name": "gamma"}).json()
        assert archived_named["total"] == 1 and archived_named["items"][0]["tenant_id"] == gamma_id
        no_match = req("get", "/api/v1/platform/tenants", "platform", params={"name": "no such tenant"}).json()
        assert no_match["total"] == 0 and no_match["items"] == []
        first_platform_page = req("get", "/api/v1/platform/tenants", "platform", params={"page": 1, "page_size": 2}).json()
        second_platform_page = req("get", "/api/v1/platform/tenants", "platform", params={"page": 2, "page_size": 2}).json()
        assert first_platform_page["total"] == 3 and len(first_platform_page["items"]) == 2
        assert second_platform_page["total"] == 3 and len(second_platform_page["items"]) == 1
        assert req("get", "/api/v1/platform/tenants", "member", params={"status": "unknown"}).status_code == 403
        with factory() as db:
            assert db.scalar(select(func.count()).select_from(TenantMember).where(TenantMember.user_id == ids["platform"])) == 0
        assert req("get", "/api/v1/tenants", "owner", params={"page": 1, "page_size": 1}).json()["total"] == 1
        assert req("get", "/api/v1/tenants", "owner", params={"page": 2, "page_size": 1}).json()["items"] == []
        assert req("get", "/api/v1/tenants", "member", params={"page_size": 101}).status_code == 422

        # Member cannot add/manage tenant members, update tenant settings, or act on foreign tenant IDs.
        assert req("post", f"/api/v1/tenants/{tid}/members", "member", json={"user_id": str(ids["outsider"])}).status_code == 403
        assert req("patch", f"/api/v1/tenants/{tid}", "member", json={"name": "Changed"}).status_code == 403
        beta_id = second.json()["tenant_id"]
        assert req("get", f"/api/v1/tenants/{beta_id}/members", "member").status_code == 403
        assert req("get", f"/api/v1/tenants/{beta_id}", "member").status_code == 404

        # Tenant admins can manage regular members but cannot create/promote/operate on owners.
        assert req("post", f"/api/v1/tenants/{tid}/members", "admin", json={"user_id": str(ids["outsider"])}).status_code == 409
        assert req("patch", f"/api/v1/tenants/{tid}/members/{ids['owner']}", "admin", json={"status": "removed"}).status_code == 403
        assert req("patch", f"/api/v1/tenants/{tid}/members/{ids['member']}", "admin", json={"tenant_role": "admin"}).status_code == 200
        # Owner can manage tenant members; last active owner is protected.
        assert req("patch", f"/api/v1/tenants/{tid}/members/{ids['outsider']}", "owner", json={"status": "removed"}).status_code == 200
        assert req("patch", f"/api/v1/tenants/{tid}/members/{ids['owner']}", "owner", json={"status": "removed"}).status_code == 409

        # Suspending member revokes workspace membership; reactivation does not restore it.
        with factory() as db:
            member_space = db.scalar(select(WorkspaceMember).where(WorkspaceMember.tenant_id == int(tid), WorkspaceMember.user_id == ids["member"]))
            owner_space = db.scalar(select(WorkspaceMember).where(WorkspaceMember.tenant_id == int(tid), WorkspaceMember.user_id == ids["owner"]))
            owner_space.workspace_role = "member"
            member_space.workspace_role = "owner"
            db.commit()
        assert req("patch", f"/api/v1/tenants/{tid}/members/{ids['member']}", "owner", json={"status": "suspended"}).status_code == 409
        with factory() as db:
            member_space = db.scalar(select(WorkspaceMember).where(WorkspaceMember.tenant_id == int(tid), WorkspaceMember.user_id == ids["member"]))
            member_space.workspace_role = "member"
            owner_space = db.scalar(select(WorkspaceMember).where(WorkspaceMember.tenant_id == int(tid), WorkspaceMember.user_id == ids["owner"]))
            owner_space.workspace_role = "owner"
            db.commit()
        assert req("patch", f"/api/v1/tenants/{tid}/members/{ids['member']}", "owner", json={"status": "suspended"}).status_code == 200
        with factory() as db:
            revoked = db.scalar(select(WorkspaceMember).where(WorkspaceMember.tenant_id == int(tid), WorkspaceMember.user_id == ids["member"]))
            assert revoked.status == "removed"
        assert req("patch", f"/api/v1/tenants/{tid}/members/{ids['member']}", "owner", json={"status": "active"}).status_code == 200
        with factory() as db:
            still_revoked = db.scalar(select(WorkspaceMember).where(WorkspaceMember.tenant_id == int(tid), WorkspaceMember.user_id == ids["member"]))
            assert still_revoked.status == "removed"
        context = req("get", "/api/v1/me/context", "member").json()
        assert all(s["workspace_id"] != workspace["workspace_id"] for t in context["tenants"] for s in t["workspaces"])

        # Pagination and decimal string IDs are part of the API contract.
        page = req("get", "/api/v1/tenants", "owner", params={"page": 1, "page_size": 1}).json()
        assert page["page"] == 1 and page["page_size"] == 1 and page["total"] == 1
        assert all(isinstance(page["items"][0][k], str) and page["items"][0][k].isdecimal() for k in ("tenant_id",))
