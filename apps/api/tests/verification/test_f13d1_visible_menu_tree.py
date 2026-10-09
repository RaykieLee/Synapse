"""F13d1 visible navigation tree authorization and invalidation verification."""
from datetime import datetime, timezone

from alembic import command
from alembic.config import Config
from fastapi.testclient import TestClient
from sqlalchemy import select


def test_f13d1_visible_tree_permissions_ancestors_and_cache(tmp_path, monkeypatch):
    db_path = tmp_path / "f13d1-visible-tree.sqlite"
    monkeypatch.setenv("SYNAPSE_DATABASE_URL", f"sqlite:///{db_path}")
    monkeypatch.setenv("SYNAPSE_JWT_SECRET", "f13d1-verification-only-secret")

    from app.core.config import get_settings
    from app.database.session import get_engine, get_session_factory
    get_settings.cache_clear()
    get_engine.cache_clear()
    get_session_factory.cache_clear()

    alembic = Config("alembic.ini")
    command.upgrade(alembic, "head")
    from app.models.tenant import Tenant, TenantMember
    from app.models.tenant_member_role import TenantMemberRole
    from app.models.tenant_menu import TenantMenu
    from app.models.tenant_role import TenantRole
    from app.models.user import User

    factory = get_session_factory()
    now = datetime.now(timezone.utc)
    with factory() as db:
        users = [
            User(user_name="f13d1-owner-a", email="f13d1-owner-a@example.test", password_hash="unused"),
            User(user_name="f13d1-admin-a", email="f13d1-admin-a@example.test", password_hash="unused"),
            User(user_name="f13d1-member-a", email="f13d1-member-a@example.test", password_hash="unused"),
            User(user_name="f13d1-no-role-a", email="f13d1-no-role-a@example.test", password_hash="unused"),
            User(user_name="f13d1-platform", email="f13d1-platform@example.test", password_hash="unused", platform_role="platform_admin"),
            User(user_name="f13d1-owner-b", email="f13d1-owner-b@example.test", password_hash="unused"),
        ]
        db.add_all(users)
        db.flush()
        user_ids = {user.user_name: user.user_id for user in users}
        tenant_a = Tenant(slug="f13d1-tenant-a", name="F13d1 Tenant A", status="active", settings_json="{}", membership_version=10)
        tenant_b = Tenant(slug="f13d1-tenant-b", name="F13d1 Tenant B", status="active", settings_json="{}", membership_version=3)
        db.add_all([tenant_a, tenant_b])
        db.flush()
        tenant_a_id, tenant_b_id = tenant_a.tenant_id, tenant_b.tenant_id
        db.add_all([
            TenantMember(tenant_id=tenant_a_id, user_id=user_ids["f13d1-owner-a"], status="active", tenant_role="owner", joined_at=now),
            TenantMember(tenant_id=tenant_a_id, user_id=user_ids["f13d1-admin-a"], status="active", tenant_role="admin", joined_at=now),
            TenantMember(tenant_id=tenant_a_id, user_id=user_ids["f13d1-member-a"], status="active", tenant_role="member", joined_at=now),
            TenantMember(tenant_id=tenant_a_id, user_id=user_ids["f13d1-no-role-a"], status="active", tenant_role="member", joined_at=now),
            TenantMember(tenant_id=tenant_b_id, user_id=user_ids["f13d1-owner-b"], status="active", tenant_role="owner", joined_at=now),
        ])
        role = TenantRole(tenant_id=tenant_a_id, role_name="F13d1 navigation", role_key="f13d1_navigation", status="active",
                          permissions_json='["tenant:read"]', created_by=user_ids["f13d1-owner-a"],
                          updated_by=user_ids["f13d1-owner-a"], created_at=now, updated_at=now)
        disabled_role = TenantRole(tenant_id=tenant_a_id, role_name="F13d1 disabled", role_key="f13d1_disabled", status="disabled",
                                   permissions_json="[]", created_by=user_ids["f13d1-owner-a"],
                                   updated_by=user_ids["f13d1-owner-a"], created_at=now, updated_at=now)
        deleted_role = TenantRole(tenant_id=tenant_a_id, role_name="F13d1 deleted", role_key="f13d1_deleted", status="active", del_flag=True,
                                  permissions_json="[]", created_by=user_ids["f13d1-owner-a"],
                                  updated_by=user_ids["f13d1-owner-a"], created_at=now, updated_at=now)
        role_b = TenantRole(tenant_id=tenant_b_id, role_name="F13d1 B role", role_key="f13d1_b_role", status="active",
                            permissions_json="[]", created_by=user_ids["f13d1-owner-b"],
                            updated_by=user_ids["f13d1-owner-b"], created_at=now, updated_at=now)
        db.add_all([role, disabled_role, deleted_role, role_b])
        db.flush()
        role_id, disabled_role_id, deleted_role_id = role.role_id, disabled_role.role_id, deleted_role.role_id

        def menu(name, *, parent=None, status="0", visible="0", menu_type="C", deleted=False, tenant_id=tenant_a_id):
            creator = user_ids["f13d1-owner-a"] if tenant_id == tenant_a_id else user_ids["f13d1-owner-b"]
            return TenantMenu(tenant_id=tenant_id, parent_id=parent.menu_id if parent else None, menu_name=name,
                              order_num=0, path=f"/{name.lower().replace(' ', '-')}", component=None, query=None,
                              is_frame=1, is_cache=0, menu_type=menu_type, visible=visible, status=status,
                              icon="#", del_flag=deleted, created_by=creator, updated_by=creator,
                              created_at=now, updated_at=now)

        root = menu("Visible Root", menu_type="M")
        db.add(root); db.flush()
        granted_child = menu("Granted Child", parent=root)
        ungranted_child = menu("Unassigned Child", parent=root)
        unauthorized_parent = menu("Unauthorized Parent", menu_type="M")
        db.add(unauthorized_parent); db.flush()
        under_unauthorized = menu("Child Under Unauthorized", parent=unauthorized_parent)
        hidden_parent = menu("Hidden Parent", menu_type="M", visible="1")
        db.add(hidden_parent); db.flush()
        under_hidden = menu("Child Under Hidden", parent=hidden_parent)
        disabled_parent = menu("Disabled Parent", menu_type="M", status="1")
        db.add(disabled_parent); db.flush()
        under_disabled = menu("Child Under Disabled", parent=disabled_parent)
        deleted_parent = menu("Deleted Parent", menu_type="M", deleted=True)
        db.add(deleted_parent); db.flush()
        under_deleted = menu("Child Under Deleted", parent=deleted_parent)
        hidden_root = menu("Hidden Root", visible="1")
        disabled_root = menu("Disabled Root", status="1")
        deleted_root = menu("Deleted Root", deleted=True)
        action_root = menu("Action Root", menu_type="F")
        other_visible_root = menu("Other Visible Root", menu_type="M")
        tenant_b_root = menu("Tenant B Private", tenant_id=tenant_b_id, menu_type="M")
        db.add_all([granted_child, ungranted_child, unauthorized_parent, under_unauthorized, hidden_parent, under_hidden,
                    disabled_parent, under_disabled, deleted_parent, under_deleted, hidden_root, disabled_root,
                    deleted_root, action_root, other_visible_root, tenant_b_root])
        db.flush()
        menu_rows = [root, granted_child, ungranted_child, unauthorized_parent, under_unauthorized,
                     hidden_parent, under_hidden, disabled_parent, under_disabled, deleted_parent, under_deleted,
                     hidden_root, disabled_root, deleted_root, action_root, other_visible_root, tenant_b_root]
        menu_ids = {row.menu_name: row.menu_id for row in menu_rows}
        # Seed deliberately stale/hidden associations for ancestor filtering.
        linked_names = ["Visible Root", "Granted Child", "Child Under Unauthorized", "Hidden Parent",
                        "Child Under Hidden", "Child Under Disabled", "Child Under Deleted",
                        "Hidden Root", "Action Root", "Other Visible Root"]
        db.add_all([
            TenantMemberRole(tenant_id=tenant_a_id, user_id=user_ids["f13d1-no-role-a"], role_id=disabled_role_id,
                             assigned_by=user_ids["f13d1-owner-a"], assigned_at=now),
        ])
        db.commit()

    from app.auth.security import issue_token
    from app.main import create_app
    tokens = {name: issue_token(user_id, 0) for name, user_id in user_ids.items()}
    app = create_app()
    route_a = f"/api/v1/tenants/{tenant_a_id}/menus/visible-tree"
    route_b = f"/api/v1/tenants/{tenant_b_id}/menus/visible-tree"
    with TestClient(app) as client:
        def request(method, path, actor, **kwargs):
            headers = dict(kwargs.pop("headers", {}))
            headers["Authorization"] = f"Bearer {tokens[actor]}"
            return getattr(client, method)(path, headers=headers, **kwargs)

        def version():
            with factory() as db:
                db.expire_all()
                return db.get(Tenant, tenant_a_id).membership_version

        def flatten(nodes):
            result = set()
            for item in nodes:
                result.add(item["menu_id"])
                result.update(flatten(item["children"]))
            return result

        owner_before = request("get", route_a, "f13d1-owner-a")
        admin_before = request("get", route_a, "f13d1-admin-a")
        for response in (owner_before, admin_before):
            assert response.status_code == 200, response.text
            assert response.headers.get("cache-control") == "private, no-store"
            payload = response.json()
            assert payload["tenant_id"] == str(tenant_a_id)
            assert payload["membership_version"] == 10
            visible_ids = flatten(payload["items"])
            expected_manager = {"Visible Root", "Granted Child", "Unassigned Child", "Unauthorized Parent",
                                "Child Under Unauthorized", "Other Visible Root"}
            assert visible_ids == {str(menu_ids[name]) for name in expected_manager}, response.json()

        no_assignment = request("get", route_a, "f13d1-member-a")
        assert no_assignment.status_code == 200 and no_assignment.json()["items"] == []
        assert no_assignment.headers.get("cache-control") == "private, no-store"
        # Disabled and deleted custom role assignments also fail closed to an empty tree.
        no_role = request("get", route_a, "f13d1-no-role-a")
        assert no_role.status_code == 200 and no_role.json()["items"] == []
        assert no_role.headers.get("cache-control") == "private, no-store"
        with factory() as db:
            assignment = db.scalar(select(TenantMemberRole).where(
                TenantMemberRole.tenant_id == tenant_a_id,
                TenantMemberRole.user_id == user_ids["f13d1-no-role-a"],
            ))
            assignment.role_id = deleted_role_id
            db.commit()
        deleted_role_response = request("get", route_a, "f13d1-no-role-a")
        assert deleted_role_response.status_code == 200 and deleted_role_response.json()["items"] == []

        # The empty role grant set replacement is a no-op. Adding the complete grant set increments the version.
        grant_path = f"/api/v1/tenants/{tenant_a_id}/roles/{role_id}/menus"
        before_grants = version()
        granted_ids = [str(menu_ids[name]) for name in linked_names]
        # Cross-tenant values are forbidden and do not reveal menu existence.
        cross_tenant = request("put", grant_path, "f13d1-owner-a", json={"menu_ids": [str(menu_ids["Tenant B Private"])]})
        assert cross_tenant.status_code == 404 and cross_tenant.json()["code"] == "RESOURCE_NOT_FOUND"
        set_grants = request("put", grant_path, "f13d1-admin-a", json={"menu_ids": granted_ids})
        assert set_grants.status_code == 200, set_grants.text
        after_grants = version()
        assert after_grants == before_grants + 1
        repeat_grants = request("put", grant_path, "f13d1-owner-a", json={"menu_ids": granted_ids})
        assert repeat_grants.status_code == 200 and version() == after_grants

        # Grants do not affect members who have no assigned role.
        member_before_assignment = request("get", route_a, "f13d1-member-a")
        assert member_before_assignment.status_code == 200 and member_before_assignment.json()["items"] == []
        assert member_before_assignment.json()["membership_version"] == after_grants
        assignment_path = f"/api/v1/tenants/{tenant_a_id}/members/{user_ids['f13d1-member-a']}/custom-role"
        role_before_assignment = version()
        disabled_assignment = request("put", assignment_path, "f13d1-owner-a", json={"role_id": str(disabled_role_id)})
        assert disabled_assignment.status_code == 404
        assigned = request("put", assignment_path, "f13d1-admin-a", json={"role_id": str(role_id)})
        assert assigned.status_code == 200 and version() == role_before_assignment + 1

        # A role's selected menu IDs still require every parent to be eligible for the current member.
        member = request("get", route_a, "f13d1-member-a")
        assert member.status_code == 200 and member.headers.get("cache-control") == "private, no-store"
        member_payload = member.json()
        assert member_payload["membership_version"] == role_before_assignment + 1
        expected_member = {"Visible Root", "Granted Child", "Other Visible Root"}
        assert flatten(member_payload["items"]) == {str(menu_ids[name]) for name in expected_member}

        # Removing grants takes effect at once and versions only effective changes.
        reduced_ids = [str(menu_ids[name]) for name in ("Visible Root", "Granted Child", "Other Visible Root")]
        reduced = request("put", grant_path, "f13d1-owner-a", json={"menu_ids": reduced_ids})
        assert reduced.status_code == 200 and version() == after_grants + 2
        reduced_tree = request("get", route_a, "f13d1-member-a")
        assert flatten(reduced_tree.json()["items"]) == {str(menu_ids[name]) for name in ("Visible Root", "Granted Child", "Other Visible Root")}

        # Role-definition permission and status changes advance the version while assigned.
        role_before = version()
        role_api = f"/api/v1/tenants/{tenant_a_id}/roles/{role_id}"
        permission_change = request("patch", role_api, "f13d1-admin-a", json={"permissions": ["tenant:read", "tenant:update"]})
        assert permission_change.status_code == 200 and version() == role_before + 1
        role_disabled = request("patch", role_api, "f13d1-owner-a", json={"status": "disabled"})
        assert role_disabled.status_code == 200 and version() == role_before + 2
        empty_for_disabled_role = request("get", route_a, "f13d1-member-a")
        assert empty_for_disabled_role.status_code == 200 and empty_for_disabled_role.json()["items"] == []
        role_enabled = request("patch", role_api, "f13d1-owner-a", json={"status": "active"})
        assert role_enabled.status_code == 200 and version() == role_before + 3
        restored = request("get", route_a, "f13d1-member-a")
        assert flatten(restored.json()["items"]) == {str(menu_ids[name]) for name in ("Visible Root", "Granted Child", "Other Visible Root")}

        # Menu disable/hide/delete eligibility changes immediately remove both the parent and its descendants.
        patch_disabled = request("patch", f"/api/v1/tenants/{tenant_a_id}/menus/{menu_ids['Visible Root']}",
                                 "f13d1-owner-a", json={"status": "1"})
        assert patch_disabled.status_code == 200, patch_disabled.text
        hidden_parent_tree = request("get", route_a, "f13d1-member-a")
        assert flatten(hidden_parent_tree.json()["items"]) == {str(menu_ids["Other Visible Root"])}
        assert hidden_parent_tree.json()["membership_version"] == version()
        patch_enabled = request("patch", f"/api/v1/tenants/{tenant_a_id}/menus/{menu_ids['Visible Root']}",
                                "f13d1-owner-a", json={"status": "0", "visible": "1"})
        assert patch_enabled.status_code == 200
        hidden_tree = request("get", route_a, "f13d1-member-a")
        assert flatten(hidden_tree.json()["items"]) == {str(menu_ids["Other Visible Root"])}
        restore_visibility = request("patch", f"/api/v1/tenants/{tenant_a_id}/menus/{menu_ids['Visible Root']}",
                                     "f13d1-owner-a", json={"visible": "0"})
        assert restore_visibility.status_code == 200
        visible_again = request("get", route_a, "f13d1-member-a")
        assert flatten(visible_again.json()["items"]) == {str(menu_ids[name]) for name in ("Visible Root", "Granted Child", "Other Visible Root")}

        # Tenant membership removal blocks the endpoint immediately; reactivation allows only current grants.
        member_path = f"/api/v1/tenants/{tenant_a_id}/members/{user_ids['f13d1-member-a']}"
        membership_before = version()
        removed = request("patch", member_path, "f13d1-owner-a", json={"status": "removed"})
        assert removed.status_code == 200, removed.text
        assert version() == membership_before + 1
        denied_after_revoke = request("get", route_a, "f13d1-member-a")
        assert denied_after_revoke.status_code == 403
        reactivated = request("patch", member_path, "f13d1-owner-a", json={"status": "active"})
        assert reactivated.status_code == 200 and version() == membership_before + 2
        member_again = request("get", route_a, "f13d1-member-a")
        assert member_again.status_code == 200 and flatten(member_again.json()["items"]) == {
            str(menu_ids[name]) for name in ("Visible Root", "Granted Child", "Other Visible Root")
        }

        # A user cannot use a foreign tenant path, and platform role alone does not bypass membership.
        assert request("get", route_b, "f13d1-owner-a").status_code == 403
        assert request("get", route_a, "f13d1-owner-b").status_code == 403
        assert request("get", route_a, "f13d1-platform").status_code == 403

        # The response version always reflects the authoritative tenant row.
        final = request("get", route_a, "f13d1-member-a")
        assert final.json()["membership_version"] == version()
