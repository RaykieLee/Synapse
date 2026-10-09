"""F12c verification for custom tenant-role assignment and effective grants."""
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from threading import Barrier

from alembic import command
from alembic.config import Config
from fastapi import APIRouter, Depends
from fastapi.testclient import TestClient
from sqlalchemy import inspect, select
from sqlalchemy.exc import IntegrityError


def test_f12c_tenant_member_role_assignment(tmp_path, monkeypatch):
    db_path = tmp_path / "f12c-member-roles.sqlite"
    monkeypatch.setenv("SYNAPSE_DATABASE_URL", f"sqlite:///{db_path}")
    monkeypatch.setenv("SYNAPSE_JWT_SECRET", "f12c-verification-only-secret")

    from app.core.config import get_settings
    from app.database.session import get_engine, get_session_factory
    get_settings.cache_clear()
    get_engine.cache_clear()
    get_session_factory.cache_clear()
    command.upgrade(Config("alembic.ini"), "head")

    from app.auth.security import issue_token
    from app.main import create_app
    from app.models.tenant import Tenant, TenantMember
    from app.models.tenant_member_role import TenantMemberRole
    from app.models.tenant_role import TenantRole
    from app.models.user import User
    from app.tenancy.context import TenantContext, get_tenant_context, require_tenant_permission

    factory = get_session_factory()
    with factory() as db:
        users = [
            User(user_name="f12c-platform", email="platform-f12c@example.test", password_hash="unused", platform_role="platform_admin"),
            User(user_name="f12c-owner-a", email="owner-a-f12c@example.test", password_hash="unused"),
            User(user_name="f12c-admin-a", email="admin-a-f12c@example.test", password_hash="unused"),
            User(user_name="f12c-member-a", email="member-a-f12c@example.test", password_hash="unused"),
            User(user_name="f12c-member-b", email="member-b-f12c@example.test", password_hash="unused"),
            User(user_name="f12c-owner-b", email="owner-b-f12c@example.test", password_hash="unused"),
            User(user_name="f12c-disabled", email="disabled-f12c@example.test", password_hash="unused", status="disabled"),
            User(user_name="f12c-deleted", email="deleted-f12c@example.test", password_hash="unused", status="disabled", del_flag=True),
            User(user_name="f12c-removed", email="removed-f12c@example.test", password_hash="unused"),
            User(user_name="f12c-concurrent", email="concurrent-f12c@example.test", password_hash="unused"),
        ]
        db.add_all(users)
        db.flush()
        ids = {user.user_name: user.user_id for user in users}
        tenant_a = Tenant(slug="f12c-tenant-a", name="F12c Tenant A", status="active", settings_json="{}", membership_version=10)
        tenant_b = Tenant(slug="f12c-tenant-b", name="F12c Tenant B", status="active", settings_json="{}", membership_version=20)
        db.add_all([tenant_a, tenant_b])
        db.flush()
        now = datetime.now(timezone.utc)
        memberships = [
            TenantMember(tenant_id=tenant_a.tenant_id, user_id=ids["f12c-owner-a"], status="active", tenant_role="owner", joined_at=now),
            TenantMember(tenant_id=tenant_a.tenant_id, user_id=ids["f12c-admin-a"], status="active", tenant_role="admin", joined_at=now),
            TenantMember(tenant_id=tenant_a.tenant_id, user_id=ids["f12c-member-a"], status="active", tenant_role="member", joined_at=now),
            TenantMember(tenant_id=tenant_a.tenant_id, user_id=ids["f12c-removed"], status="removed", tenant_role="member", joined_at=now),
            TenantMember(tenant_id=tenant_a.tenant_id, user_id=ids["f12c-disabled"], status="active", tenant_role="member", joined_at=now),
            TenantMember(tenant_id=tenant_a.tenant_id, user_id=ids["f12c-deleted"], status="active", tenant_role="member", joined_at=now),
            TenantMember(tenant_id=tenant_a.tenant_id, user_id=ids["f12c-concurrent"], status="active", tenant_role="member", joined_at=now),
            TenantMember(tenant_id=tenant_b.tenant_id, user_id=ids["f12c-owner-b"], status="active", tenant_role="owner", joined_at=now),
            TenantMember(tenant_id=tenant_b.tenant_id, user_id=ids["f12c-member-b"], status="active", tenant_role="member", joined_at=now),
        ]
        db.add_all(memberships)
        roles = [
            TenantRole(tenant_id=tenant_a.tenant_id, role_name="Reader custom", role_key="reader_custom", role_sort=0,
                       status="active", permissions_json='["tenant:read"]', created_by=ids["f12c-owner-a"], updated_by=ids["f12c-owner-a"], created_at=now, updated_at=now),
            TenantRole(tenant_id=tenant_a.tenant_id, role_name="Updater custom", role_key="updater_custom", role_sort=1,
                       status="active", permissions_json='["tenant:update"]', created_by=ids["f12c-owner-a"], updated_by=ids["f12c-owner-a"], created_at=now, updated_at=now),
            TenantRole(tenant_id=tenant_a.tenant_id, role_name="Disabled custom", role_key="disabled_custom", role_sort=2,
                       status="disabled", permissions_json='["tenant:archive"]', created_by=ids["f12c-owner-a"], updated_by=ids["f12c-owner-a"], created_at=now, updated_at=now),
            TenantRole(tenant_id=tenant_a.tenant_id, role_name="Deleted custom", role_key="deleted_custom", role_sort=3,
                       status="active", permissions_json='["tenant:archive"]', del_flag=True, created_by=ids["f12c-owner-a"], updated_by=ids["f12c-owner-a"], created_at=now, updated_at=now),
            TenantRole(tenant_id=tenant_b.tenant_id, role_name="Tenant B custom", role_key="tenant_b_custom", role_sort=0,
                       status="active", permissions_json='["tenant:archive"]', created_by=ids["f12c-owner-b"], updated_by=ids["f12c-owner-b"], created_at=now, updated_at=now),
        ]
        db.add_all(roles)
        db.flush()
        role_ids = {role.role_key: role.role_id for role in roles}
        tenant_a_id, tenant_b_id = tenant_a.tenant_id, tenant_b.tenant_id
        db.commit()

    # Confirm the migration installed the required composite constraints before exercising them.
    engine = get_engine()
    with engine.connect() as connection:
        inspector = inspect(connection)
        fks = inspector.get_foreign_keys("tenant_member_roles")
        fk_columns = {tuple(fk["constrained_columns"]): tuple(fk["referred_columns"]) for fk in fks}
        assert fk_columns[("tenant_id", "user_id")] == ("tenant_id", "user_id")
        assert fk_columns[("role_id", "tenant_id")] == ("role_id", "tenant_id")
        sqlite_fks_enabled = connection.exec_driver_sql("PRAGMA foreign_keys").scalar_one() == 1

    tokens = {name: issue_token(user_id, 0) for name, user_id in ids.items()}
    router = APIRouter()

    @router.get("/_f12c/tenants/{tenant_id}/context")
    def context_probe(context: TenantContext = Depends(get_tenant_context)):
        return {"actor_user_id": str(context.actor_user_id), "tenant_id": str(context.tenant_id),
                "tenant_role": context.tenant_role, "permissions": sorted(context.permission_set),
                "membership_version": context.membership_version}

    @router.get("/_f12c/tenants/{tenant_id}/read")
    def require_read(context: TenantContext = Depends(require_tenant_permission("tenant:read"))):
        return {"tenant_id": str(context.tenant_id), "membership_version": context.membership_version}

    @router.get("/_f12c/tenants/{tenant_id}/update")
    def require_update(context: TenantContext = Depends(require_tenant_permission("tenant:update"))):
        return {"tenant_id": str(context.tenant_id), "membership_version": context.membership_version}

    @router.get("/_f12c/tenants/{tenant_id}/archive")
    def require_archive(context: TenantContext = Depends(require_tenant_permission("tenant:archive"))):
        return {"tenant_id": str(context.tenant_id), "membership_version": context.membership_version}

    app = create_app()
    app.include_router(router)

    with TestClient(app) as client:
        def request(method, path, actor, **kwargs):
            headers = dict(kwargs.pop("headers", {}))
            headers["Authorization"] = f"Bearer {tokens[actor]}"
            return getattr(client, method)(path, headers=headers, **kwargs)

        member_context_url = f"/_f12c/tenants/{tenant_a_id}/context"
        manager_custom_role_url = f"/api/v1/tenants/{tenant_a_id}/members/{ids['f12c-member-a']}/custom-role"
        before = request("get", member_context_url, "f12c-member-a")
        assert before.status_code == 200 and before.json()["permissions"] == ["tenant:read"]
        assert before.json()["membership_version"] == 10
        old_member_token = tokens["f12c-member-a"]
        assert request("get", f"/_f12c/tenants/{tenant_a_id}/update", "f12c-member-a").status_code == 403

        # Owner/admin can assign roles; custom role API does not grant assignment authority to a member or platform admin.
        first = request("put", manager_custom_role_url, "f12c-owner-a", json={"role_id": str(role_ids["reader_custom"])})
        assert first.status_code == 200, first.text
        assignment = first.json()
        assert assignment["user_id"] == str(ids["f12c-member-a"])
        assert assignment["role"]["role_id"] == str(role_ids["reader_custom"])
        assert assignment["role"]["tenant_id"] == str(tenant_a_id)
        assert request("get", manager_custom_role_url, "f12c-admin-a").json()["role"]["role_key"] == "reader_custom"
        assert request("put", manager_custom_role_url, "f12c-member-a", json={"role_id": str(role_ids["reader_custom"])}).status_code == 403
        assert request("put", manager_custom_role_url, "f12c-platform", json={"role_id": str(role_ids["reader_custom"])}).status_code == 403

        after_first = request("get", member_context_url, "f12c-member-a").json()
        assert after_first["permissions"] == ["tenant:read"] and after_first["membership_version"] == 11
        assert request("get", f"/_f12c/tenants/{tenant_a_id}/read", "f12c-member-a").status_code == 200
        assert request("get", f"/_f12c/tenants/{tenant_a_id}/update", "f12c-member-a").status_code == 403
        # Assignment changes tenant authorization snapshots, not the global token version; the old JWT immediately sees live DB context.
        assert request("get", "/api/v1/auth/me", "f12c-member-a").status_code == 200
        assert request("get", f"/_f12c/tenants/{tenant_a_id}/context", "f12c-member-a",
                       headers={"Authorization": f"Bearer {old_member_token}"}).json()["membership_version"] == 11

        # Reassigning the same role is idempotent: no version bump and stable assignment timestamp.
        repeated = request("put", manager_custom_role_url, "f12c-admin-a", json={"role_id": str(role_ids["reader_custom"])})
        assert repeated.status_code == 200 and repeated.json()["assigned_at"] == assignment["assigned_at"]
        assert request("get", member_context_url, "f12c-member-a").json()["membership_version"] == 11

        # Cross-tenant role and target member IDs cannot be used from Tenant A.
        cross_role = request("put", manager_custom_role_url, "f12c-owner-a", json={"role_id": str(role_ids["tenant_b_custom"])})
        assert cross_role.status_code == 404 and cross_role.json()["code"] == "RESOURCE_NOT_FOUND"
        url_for_other_member = f"/api/v1/tenants/{tenant_a_id}/members/{ids['f12c-member-b']}/custom-role"
        for method, kwargs in (("get", {}), ("put", {"json": {"role_id": str(role_ids["reader_custom"])} }), ("delete", {})):
            response = request(method, url_for_other_member, "f12c-owner-a", **kwargs)
            assert response.status_code == 404 and response.json()["code"] == "RESOURCE_NOT_FOUND"
        for protected_name in ("f12c-owner-a", "f12c-admin-a"):
            protected = request("put", f"/api/v1/tenants/{tenant_a_id}/members/{ids[protected_name]}/custom-role",
                                "f12c-owner-a", json={"role_id": str(role_ids["reader_custom"])})
            assert protected.status_code == 409 and protected.json()["code"] == "BUILTIN_ROLE_PROTECTED"

        # Disabled/deleted roles and inactive/non-member targets are rejected.
        for role_key in ("disabled_custom", "deleted_custom"):
            rejected = request("put", manager_custom_role_url, "f12c-owner-a", json={"role_id": str(role_ids[role_key])})
            assert rejected.status_code == 404 and rejected.json()["code"] == "RESOURCE_NOT_FOUND"
        removed_member_url = f"/api/v1/tenants/{tenant_a_id}/members/{ids['f12c-removed']}/custom-role"
        removed_member = request("put", removed_member_url, "f12c-owner-a", json={"role_id": str(role_ids["reader_custom"])})
        assert removed_member.status_code == 409 and removed_member.json()["code"] == "MEMBERSHIP_INACTIVE"
        for inactive_user in ("f12c-disabled", "f12c-deleted"):
            inactive_url = f"/api/v1/tenants/{tenant_a_id}/members/{ids[inactive_user]}/custom-role"
            inactive_response = request("put", inactive_url, "f12c-owner-a", json={"role_id": str(role_ids["reader_custom"])})
            assert inactive_response.status_code == 409 and inactive_response.json()["code"] == "USER_INACTIVE"

        # Replacement updates effective permissions and increments membership_version exactly once.
        replaced = request("put", manager_custom_role_url, "f12c-owner-a", json={"role_id": str(role_ids["updater_custom"])})
        assert replaced.status_code == 200 and replaced.json()["role"]["role_key"] == "updater_custom"
        after_replace = request("get", member_context_url, "f12c-member-a").json()
        assert after_replace["permissions"] == ["tenant:update"] and after_replace["membership_version"] == 12
        assert request("get", f"/_f12c/tenants/{tenant_a_id}/update", "f12c-member-a").status_code == 200
        assert request("get", f"/_f12c/tenants/{tenant_a_id}/read", "f12c-member-a").status_code == 403
        assert request("get", "/api/v1/auth/me", "f12c-member-a").status_code == 200

        # Permission edits and disable/delete of an assigned role invalidate the membership version and fall back safely.
        update_role = request("patch", f"/api/v1/tenants/{tenant_a_id}/roles/{role_ids['updater_custom']}",
                              "f12c-admin-a", json={"permissions": ["tenant:archive"]})
        assert update_role.status_code == 200, update_role.text
        changed_permissions = request("get", member_context_url, "f12c-member-a").json()
        assert changed_permissions["permissions"] == ["tenant:archive"] and changed_permissions["membership_version"] == 13
        assert request("get", f"/_f12c/tenants/{tenant_a_id}/archive", "f12c-member-a").status_code == 200
        disabled_role = request("patch", f"/api/v1/tenants/{tenant_a_id}/roles/{role_ids['updater_custom']}",
                                "f12c-owner-a", json={"status": "disabled"})
        assert disabled_role.status_code == 200
        disabled_effective = request("get", member_context_url, "f12c-member-a").json()
        assert disabled_effective["permissions"] == ["tenant:read"] and disabled_effective["membership_version"] == 14
        assert request("get", manager_custom_role_url, "f12c-owner-a").json()["role"] is None
        reenabled_role = request("patch", f"/api/v1/tenants/{tenant_a_id}/roles/{role_ids['updater_custom']}",
                                 "f12c-owner-a", json={"status": "active"})
        assert reenabled_role.status_code == 200
        assert request("get", member_context_url, "f12c-member-a").json()["permissions"] == ["tenant:archive"]
        deleted_role = request("delete", f"/api/v1/tenants/{tenant_a_id}/roles/{role_ids['updater_custom']}", "f12c-owner-a")
        assert deleted_role.status_code == 204
        deleted_effective = request("get", member_context_url, "f12c-member-a").json()
        assert deleted_effective["permissions"] == ["tenant:read"] and deleted_effective["membership_version"] == 16
        assert request("get", manager_custom_role_url, "f12c-owner-a").json()["role"] is None

        # Revocation removes the assignment, restores built-in member read baseline and is idempotent.
        revoke_version = deleted_effective["membership_version"]
        revoked = request("delete", manager_custom_role_url, "f12c-admin-a")
        assert revoked.status_code == 204
        assert request("get", manager_custom_role_url, "f12c-owner-a").json() == {"user_id": str(ids["f12c-member-a"]), "role": None}
        revoked_context = request("get", member_context_url, "f12c-member-a").json()
        assert revoked_context["permissions"] == ["tenant:read"] and revoked_context["membership_version"] == revoke_version + 1
        assert request("get", f"/_f12c/tenants/{tenant_a_id}/read", "f12c-member-a").status_code == 200
        assert request("get", f"/_f12c/tenants/{tenant_a_id}/update", "f12c-member-a").status_code == 403
        assert request("get", "/api/v1/auth/me", "f12c-member-a").status_code == 200
        assert request("delete", manager_custom_role_url, "f12c-owner-a").status_code == 204
        assert request("get", member_context_url, "f12c-member-a").json()["membership_version"] == revoke_version + 1

        # Built-in owner/admin permissions ignore custom member grants and remain available to owner/admin.
        assert request("get", f"/_f12c/tenants/{tenant_a_id}/update", "f12c-admin-a").status_code == 200
        assert request("get", f"/_f12c/tenants/{tenant_a_id}/read", "f12c-owner-a").status_code == 200

        # Two concurrent identical assignment requests should converge to one row and a single version change.
        concurrent_url = f"/api/v1/tenants/{tenant_a_id}/members/{ids['f12c-concurrent']}/custom-role"
        concurrent_before = request("get", member_context_url, "f12c-concurrent").json()["membership_version"]
        barrier = Barrier(2)

        def concurrent_assign():
            with TestClient(app) as thread_client:
                barrier.wait(timeout=10)
                return thread_client.put(concurrent_url,
                                         headers={"Authorization": f"Bearer {tokens['f12c-admin-a']}"},
                                         json={"role_id": str(role_ids["reader_custom"])})

        with ThreadPoolExecutor(max_workers=2) as executor:
            futures = [executor.submit(concurrent_assign), executor.submit(concurrent_assign)]
            concurrent_results = [future.result(timeout=30) for future in futures]
        assert [result.status_code for result in concurrent_results] == [200, 200], [
            (result.status_code, result.text) for result in concurrent_results
        ]
        with factory() as db:
            concurrent_assignments = db.scalars(select(TenantMemberRole).where(
                TenantMemberRole.tenant_id == tenant_a_id,
                TenantMemberRole.user_id == ids["f12c-concurrent"],
            )).all()
            assert len(concurrent_assignments) == 1
        concurrent_after = request("get", f"/_f12c/tenants/{tenant_a_id}/context", "f12c-concurrent").json()
        assert concurrent_after["membership_version"] == concurrent_before + 1

        # SQLite migration declares composite FKs; check actual runtime enforcement for both member and role pairing.
        composite_constraints_enforced = True
        bad_assignments = [
            TenantMemberRole(tenant_id=tenant_a_id, user_id=ids["f12c-member-b"],
                             role_id=role_ids["reader_custom"], assigned_by=ids["f12c-owner-a"]),
            TenantMemberRole(tenant_id=tenant_a_id, user_id=ids["f12c-member-a"],
                             role_id=role_ids["tenant_b_custom"], assigned_by=ids["f12c-owner-a"]),
        ]
        for bad in bad_assignments:
            with factory() as db:
                db.add(bad)
                try:
                    db.flush()
                except IntegrityError:
                    db.rollback()
                else:
                    composite_constraints_enforced = False
                    db.rollback()
        assert sqlite_fks_enabled and composite_constraints_enforced, (
            "SQLite composite foreign keys were declared but are not enforced by application connections"
        )
