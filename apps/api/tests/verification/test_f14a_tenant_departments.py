from datetime import datetime, timezone

from alembic import command
from alembic.config import Config
from fastapi.testclient import TestClient
from sqlalchemy import inspect, select
from sqlalchemy.exc import IntegrityError


def test_f14a_tenant_department_api_and_migration(tmp_path, monkeypatch):
    db_path = tmp_path / "f14a-departments.sqlite"
    monkeypatch.setenv("SYNAPSE_DATABASE_URL", f"sqlite:///{db_path}")
    monkeypatch.setenv("SYNAPSE_JWT_SECRET", "f14a-verification-only-secret")

    from app.core.config import get_settings
    from app.database.session import get_engine, get_session_factory
    get_settings.cache_clear()
    get_engine.cache_clear()
    get_session_factory.cache_clear()

    alembic = Config("alembic.ini")
    command.upgrade(alembic, "0016_tenant_validity")
    from app.models.tenant import Tenant, TenantMember
    from app.models.tenant_menu import TenantMenu
    from app.models.tenant_role import TenantRole
    from app.models.tenant_role_menu import TenantRoleMenu
    from app.models.user import User

    factory = get_session_factory()
    now = datetime.now(timezone.utc)
    with factory() as db:
        users = [
            User(user_name="f14a-owner-a", email="owner-a-f14a@example.test", password_hash="unused"),
            User(user_name="f14a-admin-a", email="admin-a-f14a@example.test", password_hash="unused"),
            User(user_name="f14a-member-a", email="member-a-f14a@example.test", password_hash="unused"),
            User(user_name="f14a-platform", email="platform-f14a@example.test", password_hash="unused", platform_role="platform_admin"),
            User(user_name="f14a-owner-b", email="owner-b-f14a@example.test", password_hash="unused"),
        ]
        db.add_all(users); db.flush()
        user_ids = {user.user_name: user.user_id for user in users}
        tenant_a = Tenant(slug="f14a-tenant-a", name="F14a Tenant A", status="active", settings_json="{}", membership_version=1)
        tenant_b = Tenant(slug="f14a-tenant-b", name="F14a Tenant B", status="active", settings_json="{}", membership_version=1)
        db.add_all([tenant_a, tenant_b]); db.flush()
        tenant_a_id, tenant_b_id = tenant_a.tenant_id, tenant_b.tenant_id
        db.add_all([
            TenantMember(tenant_id=tenant_a_id, user_id=user_ids["f14a-owner-a"], status="active", tenant_role="owner", joined_at=now),
            TenantMember(tenant_id=tenant_a_id, user_id=user_ids["f14a-admin-a"], status="active", tenant_role="admin", joined_at=now),
            TenantMember(tenant_id=tenant_a_id, user_id=user_ids["f14a-member-a"], status="active", tenant_role="member", joined_at=now),
            TenantMember(tenant_id=tenant_b_id, user_id=user_ids["f14a-owner-b"], status="active", tenant_role="owner", joined_at=now),
        ])
        db.flush()
        role = TenantRole(tenant_id=tenant_a_id, role_name="Legacy F14a role", role_key="legacy_f14a_role", status="active", permissions_json="[]", created_by=user_ids["f14a-owner-a"], updated_by=user_ids["f14a-owner-a"], created_at=now, updated_at=now)
        legacy_menu = TenantMenu(tenant_id=tenant_a_id, parent_id=None, menu_name="Legacy F14a menu", order_num=0, path="/legacy-f14a", is_frame=1, is_cache=0, menu_type="C", visible="0", status="0", icon="#", del_flag=False, created_by=user_ids["f14a-owner-a"], updated_by=user_ids["f14a-owner-a"], created_at=now, updated_at=now)
        db.add_all([role, legacy_menu]); db.flush()
        role_id, legacy_menu_id = role.role_id, legacy_menu.menu_id
        db.add(TenantRoleMenu(tenant_id=tenant_a_id, role_id=role_id, menu_id=legacy_menu_id, created_by=user_ids["f14a-owner-a"], created_at=now))
        db.commit()

    # Migrate with pre-existing tenant/menu/role data in place.
    command.upgrade(alembic, "head")
    from app.models.tenant_department import TenantDepartment
    engine = get_engine()
    with engine.connect() as connection:
        revision = connection.exec_driver_sql("select version_num from alembic_version").scalar_one()
        assert revision == "0016_tenant_validity"  # current head; includes 0008_tenant_departments
        inspector = inspect(connection)
        assert "tenant_departments" in inspector.get_table_names()
        parent_fk = next(fk for fk in inspector.get_foreign_keys("tenant_departments") if fk["constrained_columns"] == ["parent_id", "tenant_id"])
        assert parent_fk["referred_table"] == "tenant_departments"
        assert parent_fk["referred_columns"] == ["department_id", "tenant_id"]
        foreign_keys_enabled = connection.exec_driver_sql("PRAGMA foreign_keys").scalar_one() == 1
    with factory() as db:
        assert db.get(Tenant, tenant_a_id).name == "F14a Tenant A"
        assert db.get(TenantRole, role_id).role_key == "legacy_f14a_role"
        assert db.get(TenantMenu, legacy_menu_id).menu_name == "Legacy F14a menu"
        assert db.scalar(select(TenantRoleMenu).where(TenantRoleMenu.tenant_id == tenant_a_id, TenantRoleMenu.role_id == role_id)).menu_id == legacy_menu_id

    from app.auth.security import issue_token
    from app.main import create_app
    tokens = {name: issue_token(user_id, 0) for name, user_id in user_ids.items()}
    app = create_app()
    url_a = f"/api/v1/tenants/{tenant_a_id}/departments"
    url_b = f"/api/v1/tenants/{tenant_b_id}/departments"
    with TestClient(app) as client:
        def request(method, path, actor, **kwargs):
            headers = dict(kwargs.pop("headers", {}))
            headers["Authorization"] = f"Bearer {tokens[actor]}"
            return getattr(client, method)(path, headers=headers, **kwargs)

        root = request("post", url_a, "f14a-owner-a", json={"dept_name": "Research", "order_num": 5, "leader": "A Lead", "phone": "13800000000", "email": "research@example.test"})
        assert root.status_code == 201, root.text
        root_data = root.json()
        root_id = root_data["department_id"]
        assert root_id.isdecimal() and root_data["tenant_id"] == str(tenant_a_id)
        assert root_data["parent_id"] is None and root_data["ancestors"] == "0"
        root_b = request("post", url_b, "f14a-owner-b", json={"dept_name": "Research"})
        assert root_b.status_code == 201 and root_b.json()["tenant_id"] == str(tenant_b_id)
        foreign_id = root_b.json()["department_id"]
        assert request("get", f"{url_a}/{foreign_id}", "f14a-owner-a").status_code == 404
        assert request("patch", f"{url_a}/{foreign_id}", "f14a-owner-a", json={"dept_name": "leak"}).status_code == 404
        assert request("delete", f"{url_a}/{foreign_id}", "f14a-owner-a").status_code == 404
        assert request("get", url_a, "f14a-owner-a").json()["total"] == 1
        assert request("get", f"{url_b}/tree", "f14a-owner-b").json()["items"][0]["department_id"] == foreign_id

        # Build a hierarchy and confirm generated ancestor paths.
        child = request("post", url_a, "f14a-admin-a", json={"dept_name": "Applied Research", "parent_id": root_id, "order_num": 20, "leader": "Child Lead"})
        assert child.status_code == 201, child.text
        child_id = child.json()["department_id"]
        assert child.json()["ancestors"] == f"0,{root_id}"
        grandchild = request("post", url_a, "f14a-owner-a", json={"dept_name": "Robotics", "parent_id": child_id, "order_num": 1})
        assert grandchild.status_code == 201, grandchild.text
        grandchild_id = grandchild.json()["department_id"]
        assert grandchild.json()["ancestors"] == f"0,{root_id},{child_id}"

        second_root = request("post", url_a, "f14a-owner-a", json={"dept_name": "Operations", "order_num": 1})
        assert second_root.status_code == 201, second_root.text
        second_root_id = second_root.json()["department_id"]
        # Flat listing, query/status filters, and nested ordering.
        filtered = request("get", f"{url_a}?search=Applied&status=0", "f14a-admin-a")
        assert filtered.status_code == 200 and filtered.json()["total"] == 1 and filtered.json()["items"][0]["department_id"] == child_id
        tree = request("get", f"{url_a}/tree", "f14a-owner-a")
        assert tree.status_code == 200
        roots = tree.json()["items"]
        assert [node["department_id"] for node in roots] == [second_root_id, root_id]
        root_node = next(node for node in roots if node["department_id"] == root_id)
        assert [node["department_id"] for node in root_node["children"]] == [child_id]
        assert root_node["children"][0]["children"][0]["department_id"] == grandchild_id

        # PATCH fields and reparenting refresh all active descendants' ancestors.
        updated = request("patch", f"{url_a}/{child_id}", "f14a-admin-a", json={"parent_id": second_root_id, "order_num": 0, "email": "applied@example.test"})
        assert updated.status_code == 200, updated.text
        assert updated.json()["parent_id"] == second_root_id and updated.json()["ancestors"] == f"0,{second_root_id}"
        assert updated.json()["email"] == "applied@example.test" and updated.json()["updated_by"] == str(user_ids["f14a-admin-a"])
        moved_grandchild = request("get", f"{url_a}/{grandchild_id}", "f14a-owner-a")
        assert moved_grandchild.status_code == 200 and moved_grandchild.json()["ancestors"] == f"0,{second_root_id},{child_id}"
        reordered = request("post", f"{url_a}/reorder", "f14a-owner-a", json={"items": [
            {"department_id": root_id, "parent_id": second_root_id, "order_num": 2},
            {"department_id": child_id, "parent_id": second_root_id, "order_num": 1},
        ]})
        assert reordered.status_code == 200 and reordered.json()["updated"] == 2, reordered.text
        refreshed_root = request("get", f"{url_a}/{root_id}", "f14a-owner-a").json()
        assert refreshed_root["ancestors"] == f"0,{second_root_id}"

        # Duplicate department names are tenant-local and rejected within tenant.
        duplicate = request("post", url_a, "f14a-owner-a", json={"dept_name": "Research"})
        assert duplicate.status_code == 409 and duplicate.json()["code"] == "DEPARTMENT_NAME_CONFLICT"
        assert request("post", url_a, "f14a-owner-a", json={"dept_name": "Foreign child", "parent_id": foreign_id}).status_code == 404

        disabled = request("post", url_a, "f14a-owner-a", json={"dept_name": "Disabled parent", "status": "1"})
        assert disabled.status_code == 201
        disabled_id = disabled.json()["department_id"]
        inactive_child = request("post", url_a, "f14a-owner-a", json={"dept_name": "No child", "parent_id": disabled_id})
        assert inactive_child.status_code == 409 and inactive_child.json()["code"] == "DEPARTMENT_PARENT_INACTIVE"
        disabled_tree = request("get", f"{url_a}/tree?include_disabled=false", "f14a-owner-a")
        assert all(item["department_id"] != disabled_id for item in disabled_tree.json()["items"])
        status_patch = request("patch", f"{url_a}/{second_root_id}", "f14a-owner-a", json={"status": "1"})
        assert status_patch.status_code == 200 and status_patch.json()["status"] == "1"
        status_restore = request("patch", f"{url_a}/{second_root_id}", "f14a-owner-a", json={"status": "0"})
        assert status_restore.status_code == 200

        # Self/ancestor cycles and deleting parents with children fail closed.
        self_cycle = request("patch", f"{url_a}/{root_id}", "f14a-owner-a", json={"parent_id": root_id})
        assert self_cycle.status_code == 409 and self_cycle.json()["code"] == "DEPARTMENT_CYCLE"
        cyclic_move = request("patch", f"{url_a}/{second_root_id}", "f14a-owner-a", json={"parent_id": grandchild_id})
        assert cyclic_move.status_code == 409 and cyclic_move.json()["code"] == "DEPARTMENT_CYCLE"
        duplicate_reorder = request("post", f"{url_a}/reorder", "f14a-owner-a", json={"items": [
            {"department_id": root_id, "parent_id": None, "order_num": 0},
            {"department_id": root_id, "parent_id": None, "order_num": 1},
        ]})
        assert duplicate_reorder.status_code == 422
        has_children = request("delete", f"{url_a}/{second_root_id}", "f14a-owner-a")
        assert has_children.status_code == 409 and has_children.json()["code"] == "DEPARTMENT_HAS_CHILDREN"

        # Soft-delete a leaf and reject it as a parent afterward.
        leaf = request("post", url_a, "f14a-owner-a", json={"dept_name": "Temporary"})
        assert leaf.status_code == 201
        leaf_id = leaf.json()["department_id"]
        assert request("delete", f"{url_a}/{leaf_id}", "f14a-owner-a").status_code == 204
        assert request("get", f"{url_a}/{leaf_id}", "f14a-owner-a").status_code == 404
        deleted_parent = request("post", url_a, "f14a-owner-a", json={"dept_name": "Deleted child", "parent_id": leaf_id})
        assert deleted_parent.status_code == 404

        # Role boundary: owner/admin manage; member, platform admin without membership, and another tenant owner cannot.
        assert request("post", url_a, "f14a-admin-a", json={"dept_name": "Admin created"}).status_code == 201
        for actor in ("f14a-member-a", "f14a-platform", "f14a-owner-b"):
            assert request("get", url_a, actor).status_code == 403
            assert request("post", url_a, actor, json={"dept_name": f"Denied {actor}"}).status_code == 403
        assert request("get", url_b, "f14a-owner-a").status_code == 403

        # Direct cross-tenant parent insertion probes SQLite's composite FK enforcement.
        invalid_child = TenantDepartment(tenant_id=tenant_b_id, parent_id=int(root_id), ancestors="0", dept_name="Invalid FK child", order_num=0,
                                         status="0", del_flag=False, created_by=user_ids["f14a-owner-b"], updated_by=user_ids["f14a-owner-b"],
                                         created_at=now, updated_at=now)
        with factory() as db:
            db.add(invalid_child)
            try:
                db.flush()
            except IntegrityError:
                db.rollback()
            else:
                db.rollback()
                assert False, "cross-tenant department parent composite FK was not enforced"
        assert foreign_keys_enabled
