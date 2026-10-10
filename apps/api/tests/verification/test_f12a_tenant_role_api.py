"""F12a API verification for tenant-scoped custom role definitions."""
import hashlib
from datetime import datetime, timezone

from alembic import command
from alembic.config import Config
from fastapi.testclient import TestClient
from sqlalchemy import inspect, select


def test_f12a_tenant_role_api_and_migration(tmp_path, monkeypatch):
    db_path = tmp_path / "f12a-roles.sqlite"
    monkeypatch.setenv("SYNAPSE_DATABASE_URL", f"sqlite:///{db_path}")
    monkeypatch.setenv("SYNAPSE_JWT_SECRET", "f12a-verification-only-secret")

    from app.core.config import get_settings
    from app.database.session import get_engine, get_session_factory
    get_settings.cache_clear()
    get_engine.cache_clear()
    get_session_factory.cache_clear()

    alembic = Config("alembic.ini")
    command.upgrade(alembic, "0016_tenant_validity")
    from app.models.tenant import Tenant, TenantInvitation, TenantMember, Workspace
    from app.models.user import User

    factory = get_session_factory()
    with factory() as db:
        users = [
            User(user_name="f12a-platform", email="f12a-platform@example.test", password_hash="unused", platform_role="platform_admin"),
            User(user_name="f12a-owner-a", email="f12a-owner-a@example.test", password_hash="unused"),
            User(user_name="f12a-admin-a", email="f12a-admin-a@example.test", password_hash="unused"),
            User(user_name="f12a-member-a", email="f12a-member-a@example.test", password_hash="unused"),
            User(user_name="f12a-owner-b", email="f12a-owner-b@example.test", password_hash="unused"),
        ]
        db.add_all(users)
        db.flush()
        ids = {user.user_name: user.user_id for user in users}
        tenant_a = Tenant(slug="f12a-tenant-a", name="F12a Tenant A", status="active", settings_json="{}", membership_version=1)
        tenant_b = Tenant(slug="f12a-tenant-b", name="F12a Tenant B", status="active", settings_json="{}", membership_version=1)
        db.add_all([tenant_a, tenant_b])
        db.flush()
        workspace = Workspace(tenant_id=tenant_a.tenant_id, slug="legacy-default", name="Legacy Default",
                              status="active", settings_json="{}", created_by=ids["f12a-owner-a"])
        db.add(workspace)
        now = datetime.now(timezone.utc)
        invitation = TenantInvitation(tenant_id=tenant_a.tenant_id, email="migration-preserved@example.test",
                                      target_user_id=None, tenant_role="member", token_hash=hashlib.sha256(b"migration-preserved").hexdigest(),
                                      status="pending", expires_at=now, invited_by=ids["f12a-owner-a"], created_at=now)
        db.add_all([
            TenantMember(tenant_id=tenant_a.tenant_id, user_id=ids["f12a-owner-a"], status="active", tenant_role="owner", joined_at=now),
            TenantMember(tenant_id=tenant_a.tenant_id, user_id=ids["f12a-admin-a"], status="active", tenant_role="admin", joined_at=now),
            TenantMember(tenant_id=tenant_a.tenant_id, user_id=ids["f12a-member-a"], status="active", tenant_role="member", joined_at=now),
            TenantMember(tenant_id=tenant_b.tenant_id, user_id=ids["f12a-owner-b"], status="active", tenant_role="owner", joined_at=now),
            invitation,
        ])
        db.flush()
        tenant_a_id, tenant_b_id = tenant_a.tenant_id, tenant_b.tenant_id
        workspace_id = workspace.workspace_id
        invitation_id = invitation.invitation_id
        db.commit()

    # F12c can add a later migration concurrently; pin this independent check to the F12a schema revision.
    command.upgrade(alembic, "0016_tenant_validity")
    engine = get_engine()
    with engine.connect() as connection:
        revision = connection.exec_driver_sql("select version_num from alembic_version").scalar_one()
        assert revision == "0016_tenant_validity"
        table_names = set(inspect(connection).get_table_names())
        assert "tenant_roles" in table_names
        role_columns = {column["name"] for column in inspect(connection).get_columns("tenant_roles")}
        assert {"role_id", "tenant_id", "role_key", "permissions_json", "del_flag", "created_by", "updated_by"} <= role_columns
        unique_sets = {tuple(constraint["column_names"]) for constraint in inspect(connection).get_unique_constraints("tenant_roles")}
        assert ("tenant_id", "role_key") in unique_sets and ("tenant_id", "role_name") in unique_sets
    with factory() as db:
        assert db.get(Tenant, tenant_a_id).name == "F12a Tenant A"
        assert db.get(Workspace, workspace_id).name == "Legacy Default"
        assert db.get(TenantInvitation, invitation_id).status == "pending"
        assert db.scalar(select(TenantMember).where(
            TenantMember.tenant_id == tenant_a_id, TenantMember.user_id == ids["f12a-owner-a"],
        )).tenant_role == "owner"

    from app.auth.security import issue_token
    from app.main import create_app
    from app.models.tenant_role import TenantRole

    tokens = {name: issue_token(user_id, 0) for name, user_id in ids.items()}
    app = create_app()
    with TestClient(app) as client:
        def request(method, path, actor=None, **kwargs):
            headers = dict(kwargs.pop("headers", {}))
            if actor:
                headers["Authorization"] = f"Bearer {tokens[actor]}"
            return getattr(client, method)(path, headers=headers, **kwargs)

        url_a = f"/api/v1/tenants/{tenant_a_id}/roles"
        url_b = f"/api/v1/tenants/{tenant_b_id}/roles"
        role_a = request("post", url_a, "f12a-owner-a", json={
            "role_name": "Billing reviewer", "role_key": "billing_reviewer",
            "role_sort": 20, "status": "active",
            "permissions": ["tenant:read", "tenant_member:manage"], "remark": "Tenant A role",
        })
        assert role_a.status_code == 201, role_a.text
        role_a_data = role_a.json()
        assert role_a_data["role_id"].isdecimal() and role_a_data["tenant_id"] == str(tenant_a_id)
        assert role_a_data["scope"] == "tenant" and role_a_data["created_by"] == str(ids["f12a-owner-a"])
        assert role_a_data["permissions"] == ["tenant:read", "tenant_member:manage"]

        # Same role key/name is legal in another tenant and remains isolated in list/detail/edit/delete.
        role_b = request("post", url_b, "f12a-owner-b", json={
            "role_name": "Billing reviewer", "role_key": "billing_reviewer",
            "permissions": ["tenant:read"], "remark": "Tenant B role",
        })
        assert role_b.status_code == 201, role_b.text
        role_b_data = role_b.json()
        assert role_b_data["tenant_id"] == str(tenant_b_id) and role_b_data["role_id"] != role_a_data["role_id"]
        assert request("get", f"{url_a}/{role_b_data['role_id']}", "f12a-owner-a").status_code == 404
        assert request("patch", f"{url_a}/{role_b_data['role_id']}", "f12a-owner-a", json={"remark": "tamper"}).status_code == 404
        assert request("delete", f"{url_a}/{role_b_data['role_id']}", "f12a-owner-a").status_code == 404
        assert request("get", url_a, "f12a-owner-a").json()["items"][0]["tenant_id"] == str(tenant_a_id)

        # Owners and tenant admins manage role definitions; a tenant member or non-member platform admin cannot.
        admin_created = request("post", url_a, "f12a-admin-a", json={
            "role_name": "Support reader", "role_key": "support_reader", "permissions": ["tenant:read"],
        })
        assert admin_created.status_code == 201, admin_created.text
        assert request("get", url_a, "f12a-member-a").status_code == 403
        assert request("post", url_a, "f12a-member-a", json={"role_name": "No", "role_key": "nope"}).status_code == 403
        assert request("get", url_a, "f12a-platform").status_code == 403
        assert request("post", url_a, "f12a-platform", json={"role_name": "No", "role_key": "nope"}).status_code == 403
        assert request("get", url_b, "f12a-owner-a").status_code == 403

        # Tenant-local duplicate name/key conflicts and permission allowlist validation.
        duplicate_name = request("post", url_a, "f12a-owner-a", json={"role_name": "Billing reviewer", "role_key": "billing_second"})
        duplicate_key = request("post", url_a, "f12a-owner-a", json={"role_name": "Billing second", "role_key": "billing_reviewer"})
        assert duplicate_name.status_code == 409 and duplicate_name.json()["code"] == "ROLE_CONFLICT"
        assert duplicate_key.status_code == 409 and duplicate_key.json()["code"] == "ROLE_CONFLICT"
        for payload in (
            {"role_name": "Unsupported", "role_key": "unsupported", "permissions": ["resource:read"]},
            {"role_name": "Duplicate permission", "role_key": "duplicate_permission", "permissions": ["tenant:read", "tenant:read"]},
            {"role_name": "Built in", "role_key": "admin"},
            {"role_name": "Bad key", "role_key": "UpperCase"},
            {"role_name": "Extra field", "role_key": "extra", "platform_role": "platform_admin"},
        ):
            response = request("post", url_a, "f12a-owner-a", json=payload)
            assert response.status_code == 422, (payload, response.status_code, response.text)

        # Pagination, text search, and status filters are tenant-scoped.
        page = request("get", f"{url_a}?page=1&page_size=1", "f12a-owner-a")
        assert page.status_code == 200 and page.json()["total"] == 2
        assert page.json()["page"] == 1 and page.json()["page_size"] == 1 and len(page.json()["items"]) == 1
        found = request("get", f"{url_a}?search=support", "f12a-admin-a")
        assert found.status_code == 200 and found.json()["total"] == 1
        assert found.json()["items"][0]["role_key"] == "support_reader"
        assert request("get", f"{url_a}?page_size=101", "f12a-owner-a").status_code == 422

        # Patch updates fields/actor and allows active/disabled filtering; empty/invalid state is rejected.
        role_a_id = role_a_data["role_id"]
        updated = request("patch", f"{url_a}/{role_a_id}", "f12a-admin-a", json={
            "role_name": "Billing approver", "role_key": "billing_approver", "role_sort": 5,
            "status": "disabled", "permissions": ["tenant:update"], "remark": "updated",
        })
        assert updated.status_code == 200, updated.text
        assert updated.json()["role_name"] == "Billing approver" and updated.json()["status"] == "disabled"
        assert updated.json()["updated_by"] == str(ids["f12a-admin-a"])
        assert updated.json()["permissions"] == ["tenant:update"]
        disabled_list = request("get", f"{url_a}?status=disabled", "f12a-owner-a")
        assert disabled_list.status_code == 200 and disabled_list.json()["total"] == 1
        active_list = request("get", f"{url_a}?status=active", "f12a-owner-a")
        assert active_list.status_code == 200 and active_list.json()["total"] == 1
        assert request("patch", f"{url_a}/{role_a_id}", "f12a-owner-a", json={}).status_code == 422
        assert request("patch", f"{url_a}/{role_a_id}", "f12a-owner-a", json={"status": "suspended"}).status_code == 422

        # Soft delete hides the role; IDs/keys remain reserved by unique constraints.
        deleted = request("delete", f"{url_a}/{role_a_id}", "f12a-owner-a")
        assert deleted.status_code == 204
        assert request("get", f"{url_a}/{role_a_id}", "f12a-owner-a").status_code == 404
        after_delete = request("get", url_a, "f12a-owner-a")
        assert after_delete.status_code == 200 and after_delete.json()["total"] == 1
        reused = request("post", url_a, "f12a-owner-a", json={
            "role_name": "Billing approver", "role_key": "billing_approver",
        })
        assert reused.status_code == 409 and reused.json()["code"] == "ROLE_CONFLICT"
        with factory() as db:
            deleted_row = db.get(TenantRole, int(role_a_id))
            assert deleted_row.del_flag is True
            assert deleted_row.tenant_id == tenant_a_id
