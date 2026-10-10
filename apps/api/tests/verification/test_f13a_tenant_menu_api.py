"""F13a API, migration, and isolation verification for tenant menu trees."""
from datetime import datetime, timezone

from alembic import command
from alembic.config import Config
from fastapi.testclient import TestClient
from sqlalchemy import inspect, select
from sqlalchemy.exc import IntegrityError


def test_f13a_tenant_menu_api_and_migration(tmp_path, monkeypatch):
    db_path = tmp_path / "f13a-menus.sqlite"
    monkeypatch.setenv("SYNAPSE_DATABASE_URL", f"sqlite:///{db_path}")
    monkeypatch.setenv("SYNAPSE_JWT_SECRET", "f13a-verification-only-secret")

    from app.core.config import get_settings
    from app.database.session import get_engine, get_session_factory
    get_settings.cache_clear()
    get_engine.cache_clear()
    get_session_factory.cache_clear()

    alembic = Config("alembic.ini")
    command.upgrade(alembic, "0016_tenant_validity")
    from app.models.tenant import Tenant, TenantMember
    from app.models.tenant_member_role import TenantMemberRole
    from app.models.tenant_role import TenantRole
    from app.models.user import User

    factory = get_session_factory()
    with factory() as db:
        users = [
            User(user_name="f13a-platform", email="platform-f13a@example.test", password_hash="unused", platform_role="platform_admin"),
            User(user_name="f13a-owner-a", email="owner-a-f13a@example.test", password_hash="unused"),
            User(user_name="f13a-admin-a", email="admin-a-f13a@example.test", password_hash="unused"),
            User(user_name="f13a-member-a", email="member-a-f13a@example.test", password_hash="unused"),
            User(user_name="f13a-owner-b", email="owner-b-f13a@example.test", password_hash="unused"),
            User(user_name="f13a-member-b", email="member-b-f13a@example.test", password_hash="unused"),
        ]
        db.add_all(users)
        db.flush()
        ids = {user.user_name: user.user_id for user in users}
        tenant_a = Tenant(slug="f13a-tenant-a", name="F13a Tenant A", status="active", settings_json="{}", membership_version=1)
        tenant_b = Tenant(slug="f13a-tenant-b", name="F13a Tenant B", status="active", settings_json="{}", membership_version=1)
        db.add_all([tenant_a, tenant_b])
        db.flush()
        now = datetime.now(timezone.utc)
        role = TenantRole(tenant_id=tenant_a.tenant_id, role_name="Legacy member role", role_key="legacy_member_role",
                          status="active", permissions_json='["tenant:read"]', created_by=ids["f13a-owner-a"],
                          updated_by=ids["f13a-owner-a"], created_at=now, updated_at=now)
        db.add(role)
        db.flush()
        members = [
            TenantMember(tenant_id=tenant_a.tenant_id, user_id=ids["f13a-owner-a"], status="active", tenant_role="owner", joined_at=now),
            TenantMember(tenant_id=tenant_a.tenant_id, user_id=ids["f13a-admin-a"], status="active", tenant_role="admin", joined_at=now),
            TenantMember(tenant_id=tenant_a.tenant_id, user_id=ids["f13a-member-a"], status="active", tenant_role="member", joined_at=now),
            TenantMember(tenant_id=tenant_b.tenant_id, user_id=ids["f13a-owner-b"], status="active", tenant_role="owner", joined_at=now),
            TenantMember(tenant_id=tenant_b.tenant_id, user_id=ids["f13a-member-b"], status="active", tenant_role="member", joined_at=now),
        ]
        db.add_all(members)
        assignment = TenantMemberRole(tenant_id=tenant_a.tenant_id, user_id=ids["f13a-member-a"],
                                     role_id=role.role_id, assigned_by=ids["f13a-owner-a"], assigned_at=now)
        db.add(assignment)
        tenant_a_id, tenant_b_id = tenant_a.tenant_id, tenant_b.tenant_id
        role_id = role.role_id
        db.commit()

    # Apply the menu migration on top of existing role, membership and assignment data.
    command.upgrade(alembic, "head")
    from app.models.tenant_menu import TenantMenu
    engine = get_engine()
    with engine.connect() as connection:
        revision = connection.exec_driver_sql("select version_num from alembic_version").scalar_one()
        assert revision == "0016_tenant_validity"
        inspector = inspect(connection)
        assert "tenant_menus" in inspector.get_table_names()
        menu_fks = inspector.get_foreign_keys("tenant_menus")
        parent_fk = next(fk for fk in menu_fks if fk["constrained_columns"] == ["parent_id", "tenant_id"])
        assert parent_fk["referred_table"] == "tenant_menus"
        assert parent_fk["referred_columns"] == ["menu_id", "tenant_id"]
        sqlite_fks_enabled = connection.exec_driver_sql("PRAGMA foreign_keys").scalar_one() == 1
    with factory() as db:
        assert db.get(Tenant, tenant_a_id).name == "F13a Tenant A"
        assert db.get(TenantRole, role_id).role_key == "legacy_member_role"
        assert db.scalar(select(TenantMember).where(
            TenantMember.tenant_id == tenant_a_id, TenantMember.user_id == ids["f13a-member-a"],
        )).tenant_role == "member"
        assert db.scalar(select(TenantMemberRole).where(
            TenantMemberRole.tenant_id == tenant_a_id, TenantMemberRole.user_id == ids["f13a-member-a"],
        )).role_id == role_id

    from app.auth.security import issue_token
    from app.main import create_app

    tokens = {name: issue_token(user_id, 0) for name, user_id in ids.items()}
    app = create_app()
    with TestClient(app) as client:
        def request(method, path, actor, **kwargs):
            headers = dict(kwargs.pop("headers", {}))
            headers["Authorization"] = f"Bearer {tokens[actor]}"
            return getattr(client, method)(path, headers=headers, **kwargs)

        url_a = f"/api/v1/tenants/{tenant_a_id}/menus"
        url_b = f"/api/v1/tenants/{tenant_b_id}/menus"
        shared_a = request("post", url_a, "f13a-owner-a", json={
            "menu_name": "Shared route", "path": "/shared", "order_num": 4,
            "component": "pages/shared", "perms": "tenant:read",
        })
        assert shared_a.status_code == 201, shared_a.text
        root_a = shared_a.json()
        assert root_a["menu_id"].isdecimal() and root_a["tenant_id"] == str(tenant_a_id)
        assert root_a["parent_id"] is None and root_a["created_by"] == str(ids["f13a-owner-a"])

        shared_b = request("post", url_b, "f13a-owner-b", json={
            "menu_name": "Shared route", "path": "/shared", "order_num": 4,
        })
        assert shared_b.status_code == 201, shared_b.text
        root_b = shared_b.json()
        assert root_b["tenant_id"] == str(tenant_b_id)
        assert request("get", f"{url_a}/{root_b['menu_id']}", "f13a-owner-a").status_code == 404
        assert request("patch", f"{url_a}/{root_b['menu_id']}", "f13a-owner-a", json={"menu_name": "leak"}).status_code == 404
        assert request("delete", f"{url_a}/{root_b['menu_id']}", "f13a-owner-a").status_code == 404

        # Same route path and label are tenant-local; listing and trees do not leak between tenants.
        list_a = request("get", url_a, "f13a-owner-a").json()
        list_b = request("get", url_b, "f13a-owner-b").json()
        assert list_a["total"] == 1 and list_a["items"][0]["tenant_id"] == str(tenant_a_id)
        assert list_b["total"] == 1 and list_b["items"][0]["tenant_id"] == str(tenant_b_id)
        tree_a = request("get", f"{url_a}/tree", "f13a-owner-a")
        tree_b = request("get", f"{url_b}/tree", "f13a-owner-b")
        assert tree_a.status_code == 200 and [x["menu_id"] for x in tree_a.json()["items"]] == [root_a["menu_id"]]
        assert tree_b.status_code == 200 and [x["menu_id"] for x in tree_b.json()["items"]] == [root_b["menu_id"]]

        # Owners and tenant admins can manage; members/platform admins without membership cannot.
        created_by_admin = request("post", url_a, "f13a-admin-a", json={"menu_name": "Admin menu"})
        assert created_by_admin.status_code == 201, created_by_admin.text
        assert request("get", url_a, "f13a-member-a").status_code == 403
        assert request("post", url_a, "f13a-member-a", json={"menu_name": "Member menu"}).status_code == 403
        assert request("get", url_a, "f13a-platform").status_code == 403
        assert request("post", url_a, "f13a-platform", json={"menu_name": "Platform menu"}).status_code == 403
        assert request("get", url_b, "f13a-owner-a").status_code == 403

        # Create children, flat search/status filtering, sorted tree, and metadata CRUD.
        child_high = request("post", url_a, "f13a-owner-a", json={
            "menu_name": "Child high", "parent_id": root_a["menu_id"], "order_num": 20,
            "menu_type": "C", "visible": "1", "status": "0", "is_frame": 0, "is_cache": 1,
        })
        child_low = request("post", url_a, "f13a-owner-a", json={
            "menu_name": "Child low", "parent_id": root_a["menu_id"], "order_num": 2,
            "menu_type": "F", "status": "0", "perms": "menu:child:read",
        })
        assert child_high.status_code == 201 and child_low.status_code == 201
        high_id, low_id = child_high.json()["menu_id"], child_low.json()["menu_id"]
        assert child_high.json()["parent_id"] == root_a["menu_id"]
        filtered = request("get", f"{url_a}?search=Child%20low&status=0", "f13a-admin-a")
        assert filtered.status_code == 200 and filtered.json()["total"] == 1
        assert filtered.json()["items"][0]["menu_id"] == low_id
        tree_items = request("get", f"{url_a}/tree", "f13a-owner-a").json()["items"]
        ordered_tree = next(item for item in tree_items if item["menu_id"] == root_a["menu_id"])["children"]
        assert [item["menu_id"] for item in ordered_tree] == [low_id, high_id]
        patch = request("patch", f"{url_a}/{low_id}", "f13a-admin-a", json={
            "menu_name": "Child low updated", "path": "/child-low", "order_num": 6, "remark": "edited",
        })
        assert patch.status_code == 200 and patch.json()["menu_name"] == "Child low updated"
        assert patch.json()["updated_by"] == str(ids["f13a-admin-a"])
        assert request("get", f"{url_a}/{low_id}", "f13a-owner-a").json()["path"] == "/child-low"

        # Route-specific paths must win over the integer menu-id route; reorder changes both order and parent atomically.
        reorder = request("post", f"{url_a}/reorder", "f13a-owner-a", json={"items": [
            {"menu_id": high_id, "parent_id": None, "order_num": 1},
            {"menu_id": low_id, "parent_id": high_id, "order_num": 0},
        ]})
        assert reorder.status_code == 200 and reorder.json()["updated"] == 2, reorder.text
        reordered_tree = request("get", f"{url_a}/tree", "f13a-owner-a").json()["items"]
        root_ids = [item["menu_id"] for item in reordered_tree]
        assert root_ids.index(high_id) < root_ids.index(root_a["menu_id"])
        high_node = next(item for item in reordered_tree if item["menu_id"] == high_id)
        assert [child["menu_id"] for child in high_node["children"]] == [low_id]

        # Cycles, self-parenting, foreign/inactive/deleted parents and route collisions fail with stable errors.
        self_parent = request("patch", f"{url_a}/{high_id}", "f13a-owner-a", json={"parent_id": high_id})
        assert self_parent.status_code == 409 and self_parent.json()["code"] == "MENU_CYCLE"
        cycle = request("patch", f"{url_a}/{high_id}", "f13a-owner-a", json={"parent_id": low_id})
        assert cycle.status_code == 409 and cycle.json()["code"] == "MENU_CYCLE"
        cross_parent = request("post", url_a, "f13a-owner-a", json={"menu_name": "Foreign parent", "parent_id": root_b["menu_id"]})
        assert cross_parent.status_code == 404 and cross_parent.json()["code"] == "RESOURCE_NOT_FOUND"
        route_specific = request("get", f"{url_a}/tree", "f13a-owner-a")
        assert route_specific.status_code == 200 and "items" in route_specific.json()
        duplicate_reorder = request("post", f"{url_a}/reorder", "f13a-owner-a", json={"items": [
            {"menu_id": high_id, "parent_id": None, "order_num": 1},
            {"menu_id": high_id, "parent_id": None, "order_num": 2},
        ]})
        assert duplicate_reorder.status_code == 422

        disabled_parent = request("post", url_a, "f13a-owner-a", json={"menu_name": "Disabled parent", "status": "1"})
        assert disabled_parent.status_code == 201
        inactive_child = request("post", url_a, "f13a-owner-a", json={
            "menu_name": "Under disabled", "parent_id": disabled_parent.json()["menu_id"],
        })
        assert inactive_child.status_code == 409 and inactive_child.json()["code"] == "MENU_PARENT_INACTIVE"
        visible_tree = request("get", f"{url_a}/tree?include_disabled=false", "f13a-owner-a")
        assert visible_tree.status_code == 200
        assert all(node["menu_id"] != disabled_parent.json()["menu_id"] for node in visible_tree.json()["items"])
        deleted_parent = request("delete", f"{url_a}/{disabled_parent.json()['menu_id']}", "f13a-owner-a")
        assert deleted_parent.status_code == 204
        deleted_parent_child = request("post", url_a, "f13a-owner-a", json={
            "menu_name": "Under deleted", "parent_id": disabled_parent.json()["menu_id"],
        })
        assert deleted_parent_child.status_code == 404

        # Parent with a live child cannot be deleted; deleting a leaf is soft and hidden from reads.
        has_children = request("delete", f"{url_a}/{high_id}", "f13a-owner-a")
        assert has_children.status_code == 409 and has_children.json()["code"] == "MENU_HAS_CHILDREN"
        delete_leaf = request("delete", f"{url_a}/{low_id}", "f13a-owner-a")
        assert delete_leaf.status_code == 204
        assert request("get", f"{url_a}/{low_id}", "f13a-owner-a").status_code == 404
        assert request("delete", f"{url_a}/{high_id}", "f13a-owner-a").status_code == 204

        # Direct database attempt probes actual SQLite enforcement of the declared same-tenant parent composite FK.
        cross_tenant_fk_enforced = True
        with factory() as db:
            invalid_child = TenantMenu(
                tenant_id=tenant_b_id, parent_id=int(root_a["menu_id"]), menu_name="Invalid FK child",
                order_num=0, path="", is_frame=1, is_cache=0, menu_type="M", visible="0", status="0",
                icon="#", del_flag=False, created_by=ids["f13a-owner-b"], updated_by=ids["f13a-owner-b"],
                created_at=datetime.now(timezone.utc), updated_at=datetime.now(timezone.utc),
            )
            db.add(invalid_child)
            try:
                db.flush()
            except IntegrityError:
                db.rollback()
            else:
                cross_tenant_fk_enforced = False
                db.rollback()
        assert sqlite_fks_enabled and cross_tenant_fk_enforced, (
            "SQLite menu parent composite foreign key is declared but not enforced by application connections"
        )
