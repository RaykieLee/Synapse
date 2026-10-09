"""F07 tenancy scopes/context verification using real FastAPI dependencies and data."""
from datetime import datetime, timezone

import pytest
from alembic import command
from alembic.config import Config
from fastapi import APIRouter, Depends
from fastapi.testclient import TestClient
from sqlalchemy import Integer, String, select
from sqlalchemy.orm import Mapped, mapped_column


def test_f07_context_scopes_and_permission_boundaries(tmp_path, monkeypatch):
    db_path = tmp_path / "f07-scopes.sqlite"
    monkeypatch.setenv("SYNAPSE_DATABASE_URL", f"sqlite:///{db_path}")
    monkeypatch.setenv("SYNAPSE_JWT_SECRET", "f07-verification-only-secret")

    from app.core.config import get_settings
    from app.database.base import Base
    from app.database.session import get_engine, get_session_factory
    get_settings.cache_clear()
    get_engine.cache_clear()
    get_session_factory.cache_clear()
    command.upgrade(Config("alembic.ini"), "head")

    from app.auth.security import issue_token
    from app.main import create_app
    from app.models.tenant import Tenant, TenantMember, Workspace, WorkspaceMember
    from app.models.user import User
    from app.tenancy.context import (
        TenantContext,
        WorkspaceContext,
        require_tenant_permission,
        require_workspace_permission,
    )
    from app.tenancy.scopes import (
        personal_scope,
        personal_values,
        tenant_scope,
        workspace_scope,
        workspace_values,
    )

    class WorkspaceResource(Base):
        __tablename__ = "f07_workspace_resources"
        resource_id: Mapped[int] = mapped_column(Integer, primary_key=True)
        tenant_id: Mapped[int] = mapped_column(Integer, nullable=False)
        workspace_id: Mapped[int] = mapped_column(Integer, nullable=False)
        label: Mapped[str] = mapped_column(String(80), nullable=False)

    class TenantResource(Base):
        __tablename__ = "f07_tenant_resources"
        resource_id: Mapped[int] = mapped_column(Integer, primary_key=True)
        tenant_id: Mapped[int] = mapped_column(Integer, nullable=False)
        label: Mapped[str] = mapped_column(String(80), nullable=False)

    class PersonalResource(Base):
        __tablename__ = "f07_personal_resources"
        resource_id: Mapped[int] = mapped_column(Integer, primary_key=True)
        owner_user_id: Mapped[int] = mapped_column(Integer, nullable=False)
        tenant_id: Mapped[int] = mapped_column(Integer, nullable=False)
        workspace_id: Mapped[int] = mapped_column(Integer, nullable=False)
        label: Mapped[str] = mapped_column(String(80), nullable=False)

    Base.metadata.create_all(bind=get_engine(), tables=[
        WorkspaceResource.__table__, TenantResource.__table__, PersonalResource.__table__,
    ])

    factory = get_session_factory()
    with factory() as db:
        users = [
            User(user_name="f07-platform", email="platform-f07@example.test", password_hash="unused", platform_role="platform_admin"),
            User(user_name="f07-actor", email="actor-f07@example.test", password_hash="unused"),
            User(user_name="f07-other", email="other-f07@example.test", password_hash="unused"),
            User(user_name="f07-disabled", email="disabled-f07@example.test", password_hash="unused", status="disabled"),
        ]
        db.add_all(users)
        db.flush()
        ids = {user.user_name: user.user_id for user in users}
        tenant_a = Tenant(slug="f07-tenant-a", name="F07 Tenant A", status="active", settings_json="{}", membership_version=1)
        tenant_b = Tenant(slug="f07-tenant-b", name="F07 Tenant B", status="active", settings_json="{}", membership_version=1)
        db.add_all([tenant_a, tenant_b])
        db.flush()
        workspace_a1 = Workspace(tenant_id=tenant_a.tenant_id, slug="a-one", name="A One", status="active", settings_json="{}", created_by=ids["f07-actor"])
        workspace_a2 = Workspace(tenant_id=tenant_a.tenant_id, slug="a-two", name="A Two", status="active", settings_json="{}", created_by=ids["f07-actor"])
        workspace_b1 = Workspace(tenant_id=tenant_b.tenant_id, slug="b-one", name="B One", status="active", settings_json="{}", created_by=ids["f07-actor"])
        db.add_all([workspace_a1, workspace_a2, workspace_b1])
        db.flush()
        now = datetime.now(timezone.utc)
        db.add_all([
            TenantMember(tenant_id=tenant_a.tenant_id, user_id=ids["f07-actor"], status="active", tenant_role="owner", joined_at=now),
            TenantMember(tenant_id=tenant_a.tenant_id, user_id=ids["f07-other"], status="active", tenant_role="member", joined_at=now),
            TenantMember(tenant_id=tenant_b.tenant_id, user_id=ids["f07-actor"], status="removed", tenant_role="member", joined_at=now),
            WorkspaceMember(workspace_id=workspace_a1.workspace_id, tenant_id=tenant_a.tenant_id, user_id=ids["f07-actor"], status="active", workspace_role="owner", joined_at=now),
            WorkspaceMember(workspace_id=workspace_a1.workspace_id, tenant_id=tenant_a.tenant_id, user_id=ids["f07-other"], status="active", workspace_role="admin", joined_at=now),
            WorkspaceMember(workspace_id=workspace_a2.workspace_id, tenant_id=tenant_a.tenant_id, user_id=ids["f07-actor"], status="active", workspace_role="viewer", joined_at=now),
        ])
        db.add_all([
            WorkspaceResource(resource_id=1, tenant_id=tenant_a.tenant_id, workspace_id=workspace_a1.workspace_id, label="a1"),
            WorkspaceResource(resource_id=2, tenant_id=tenant_a.tenant_id, workspace_id=workspace_a2.workspace_id, label="a2"),
            WorkspaceResource(resource_id=3, tenant_id=tenant_b.tenant_id, workspace_id=workspace_b1.workspace_id, label="b1"),
            # Deliberately malformed row: the workspace ID is A1 but tenant ID is B.
            WorkspaceResource(resource_id=4, tenant_id=tenant_b.tenant_id, workspace_id=workspace_a1.workspace_id, label="mismatched-owner"),
            TenantResource(resource_id=11, tenant_id=tenant_a.tenant_id, label="tenant-a"),
            TenantResource(resource_id=12, tenant_id=tenant_b.tenant_id, label="tenant-b"),
            PersonalResource(resource_id=21, owner_user_id=ids["f07-actor"], tenant_id=tenant_a.tenant_id, workspace_id=workspace_a1.workspace_id, label="actor-a1"),
            PersonalResource(resource_id=22, owner_user_id=ids["f07-other"], tenant_id=tenant_a.tenant_id, workspace_id=workspace_a1.workspace_id, label="other-a1"),
            PersonalResource(resource_id=23, owner_user_id=ids["f07-actor"], tenant_id=tenant_a.tenant_id, workspace_id=workspace_a2.workspace_id, label="actor-a2"),
            PersonalResource(resource_id=24, owner_user_id=ids["f07-actor"], tenant_id=tenant_b.tenant_id, workspace_id=workspace_b1.workspace_id, label="actor-b1"),
        ])
        tenant_a_id, tenant_b_id = tenant_a.tenant_id, tenant_b.tenant_id
        workspace_a1_id, workspace_a2_id, workspace_b1_id = workspace_a1.workspace_id, workspace_a2.workspace_id, workspace_b1.workspace_id
        db.commit()

    tokens = {name: issue_token(user_id, 0) for name, user_id in ids.items()}
    router = APIRouter()

    @router.get("/_f07/workspaces/{workspace_id}/resources")
    def workspace_resources(context: WorkspaceContext = Depends(require_workspace_permission("resource:read"))):
        with factory() as db:
            rows = db.scalars(workspace_scope(select(WorkspaceResource), WorkspaceResource, context).order_by(WorkspaceResource.resource_id)).all()
            return {"actor_user_id": context.actor_user_id, "tenant_id": context.tenant_id,
                    "workspace_id": context.workspace_id, "workspace_role": context.workspace_role,
                    "permissions": sorted(context.permission_set), "membership_version": context.membership_version,
                    "items": [row.resource_id for row in rows]}

    @router.get("/_f07/tenants/{tenant_id}/resources")
    def tenant_resources(context: TenantContext = Depends(require_tenant_permission("tenant:read"))):
        with factory() as db:
            rows = db.scalars(tenant_scope(select(TenantResource), TenantResource, context).order_by(TenantResource.resource_id)).all()
            return {"actor_user_id": context.actor_user_id, "tenant_id": context.tenant_id,
                    "tenant_role": context.tenant_role, "permissions": sorted(context.permission_set),
                    "items": [row.resource_id for row in rows]}

    @router.get("/_f07/workspaces/{workspace_id}/personal")
    def personal_resources(context: WorkspaceContext = Depends(require_workspace_permission("resource:read"))):
        with factory() as db:
            rows = db.scalars(personal_scope(select(PersonalResource), PersonalResource, context).order_by(PersonalResource.resource_id)).all()
            return {"items": [row.resource_id for row in rows]}

    @router.get("/_f07/workspaces/{workspace_id}/write")
    def workspace_write(context: WorkspaceContext = Depends(require_workspace_permission("resource:create"))):
        return {"workspace_id": context.workspace_id}

    @router.get("/_f07/tenants/{tenant_id}/manage")
    def tenant_manage(context: TenantContext = Depends(require_tenant_permission("tenant_member:manage"))):
        return {"tenant_id": context.tenant_id}

    app = create_app()
    app.include_router(router)

    with TestClient(app) as client:
        def request(method, path, actor="f07-actor", workspace_id=None):
            headers = {"Authorization": f"Bearer {tokens[actor]}"}
            if workspace_id is not None:
                headers["X-Workspace-ID"] = str(workspace_id)
            return getattr(client, method)(path, headers=headers)

        # Verified contexts bind actor and derived IDs; both ownership columns are filtered.
        workspace = request("get", f"/_f07/workspaces/{workspace_a1_id}/resources", workspace_id=workspace_a1_id)
        assert workspace.status_code == 200, workspace.text
        ws_data = workspace.json()
        assert ws_data["actor_user_id"] == ids["f07-actor"]
        assert ws_data["tenant_id"] == tenant_a_id and ws_data["workspace_id"] == workspace_a1_id
        assert ws_data["workspace_role"] == "owner" and "resource:delete" in ws_data["permissions"]
        assert ws_data["items"] == [1]  # excludes both A2/B1 and malformed tenant-B/workspace-A1 row
        tenant = request("get", f"/_f07/tenants/{tenant_a_id}/resources")
        assert tenant.status_code == 200 and tenant.json()["items"] == [11]
        personal = request("get", f"/_f07/workspaces/{workspace_a1_id}/personal", workspace_id=workspace_a1_id)
        assert personal.status_code == 200 and personal.json()["items"] == [21]
        viewer = request("get", f"/_f07/workspaces/{workspace_a2_id}/resources", workspace_id=workspace_a2_id)
        assert viewer.status_code == 200 and viewer.json()["items"] == [2]
        assert viewer.json()["workspace_role"] == "viewer"
        assert request("get", f"/_f07/workspaces/{workspace_a2_id}/write", workspace_id=workspace_a2_id).status_code == 403

        # Path/header agreement is mandatory; a header alone cannot select a different workspace.
        missing_header = request("get", f"/_f07/workspaces/{workspace_a1_id}/resources")
        assert missing_header.status_code == 400 and missing_header.json()["code"] == "WORKSPACE_CONTEXT_REQUIRED"
        mismatch = request("get", f"/_f07/workspaces/{workspace_a1_id}/resources", workspace_id=workspace_a2_id)
        assert mismatch.status_code == 400 and mismatch.json()["code"] == "CONTEXT_MISMATCH"
        malformed = client.get(f"/_f07/workspaces/{workspace_a1_id}/resources",
                               headers={"Authorization": f"Bearer {tokens['f07-actor']}", "X-Workspace-ID": "1x"})
        assert malformed.status_code == 400 and malformed.json()["code"] == "CONTEXT_MISMATCH"

        # A platform-admin is not implicitly a tenant or workspace member.
        admin_ws = request("get", f"/_f07/workspaces/{workspace_a1_id}/resources", actor="f07-platform", workspace_id=workspace_a1_id)
        assert admin_ws.status_code == 403 and admin_ws.json()["code"] == "MEMBERSHIP_INACTIVE"
        admin_tenant = request("get", f"/_f07/tenants/{tenant_a_id}/resources", actor="f07-platform")
        assert admin_tenant.status_code == 403 and admin_tenant.json()["code"] == "MEMBERSHIP_INACTIVE"
        assert request("get", f"/_f07/tenants/{tenant_a_id}/manage", actor="f07-actor").status_code == 200
        assert request("get", f"/_f07/tenants/{tenant_a_id}/manage", actor="f07-other").status_code == 403
        assert request("get", f"/_f07/tenants/{tenant_b_id}/resources").status_code == 403
        assert request("get", f"/_f07/workspaces/{workspace_b1_id}/resources", workspace_id=workspace_b1_id).status_code == 403

        # Ownership constructors derive immutable scope fields; row filtering remains personal-owner-only.
        context = WorkspaceContext(ids["f07-actor"], tenant_a_id, workspace_a1_id, "owner", "owner",
                                   frozenset({"resource:read"}), 1)
        assert workspace_values(context, label="new") == {
            "label": "new", "tenant_id": tenant_a_id, "workspace_id": workspace_a1_id,
            "created_by": ids["f07-actor"],
        }
        assert personal_values(context, label="private") == {
            "label": "private", "owner_user_id": ids["f07-actor"], "tenant_id": tenant_a_id,
            "workspace_id": workspace_a1_id, "created_by": ids["f07-actor"],
        }
        for helper, reserved in ((workspace_values, {"workspace_id": workspace_a2_id}),
                                 (personal_values, {"owner_user_id": ids["f07-other"]}),
                                 (personal_values, {"tenant_id": tenant_b_id})):
            with pytest.raises(ValueError):
                helper(context, label="override", **reserved)
        with pytest.raises((AttributeError, TypeError)):
            context.workspace_id = workspace_a2_id

        # Revoked WorkspaceMember and TenantMember are checked on each request.
        with factory() as db:
            membership = db.scalar(select(WorkspaceMember).where(
                WorkspaceMember.workspace_id == workspace_a2_id, WorkspaceMember.user_id == ids["f07-actor"],
            ))
            membership.status = "removed"
            tenant_membership = db.scalar(select(TenantMember).where(
                TenantMember.tenant_id == tenant_b_id, TenantMember.user_id == ids["f07-actor"],
            ))
            tenant_membership.status = "suspended"
            db.commit()
        removed_workspace = request("get", f"/_f07/workspaces/{workspace_a2_id}/resources", workspace_id=workspace_a2_id)
        assert removed_workspace.status_code == 403 and removed_workspace.json()["code"] == "WORKSPACE_MEMBERSHIP_REQUIRED"
        suspended_tenant_member = request("get", f"/_f07/workspaces/{workspace_b1_id}/resources", workspace_id=workspace_b1_id)
        assert suspended_tenant_member.status_code == 403 and suspended_tenant_member.json()["code"] == "MEMBERSHIP_INACTIVE"

        # Tenant suspension, workspace archive and inactive global accounts fail closed.
        with factory() as db:
            tenant_row = db.get(Tenant, tenant_a_id)
            tenant_row.status = "suspended"
            db.commit()
        suspended_tenant = request("get", f"/_f07/workspaces/{workspace_a1_id}/resources", workspace_id=workspace_a1_id)
        assert suspended_tenant.status_code == 409 and suspended_tenant.json()["code"] == "TENANT_INACTIVE"
        assert request("get", f"/_f07/tenants/{tenant_a_id}/resources").status_code == 409
        with factory() as db:
            db.get(Tenant, tenant_a_id).status = "active"
            db.get(Workspace, workspace_a1_id).status = "archived"
            db.commit()
        archived_workspace = request("get", f"/_f07/workspaces/{workspace_a1_id}/resources", workspace_id=workspace_a1_id)
        assert archived_workspace.status_code == 409 and archived_workspace.json()["code"] == "WORKSPACE_INACTIVE"
        with factory() as db:
            db.get(Workspace, workspace_a1_id).status = "active"
            disabled_user = db.get(User, ids["f07-disabled"])
            db.commit()
        disabled_token = issue_token(ids["f07-disabled"], 0)
        disabled_response = client.get(f"/_f07/workspaces/{workspace_a1_id}/resources", headers={
            "Authorization": f"Bearer {disabled_token}", "X-Workspace-ID": str(workspace_a1_id),
        })
        assert disabled_response.status_code == 401
