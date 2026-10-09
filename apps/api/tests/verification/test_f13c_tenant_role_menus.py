from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from threading import Barrier

from alembic import command
from alembic.config import Config
from fastapi.testclient import TestClient
from sqlalchemy import inspect, select
from sqlalchemy.exc import IntegrityError


def test_f13c_tenant_role_menu_grants_and_migration(tmp_path, monkeypatch):
    db_path = tmp_path / "f13c-role-menus.sqlite"
    monkeypatch.setenv("SYNAPSE_DATABASE_URL", f"sqlite:///{db_path}")
    monkeypatch.setenv("SYNAPSE_JWT_SECRET", "f13c-verification-only-jwt-secret")

    from app.core.config import get_settings
    from app.database.session import get_engine, get_session_factory
    get_settings.cache_clear()
    get_engine.cache_clear()
    get_session_factory.cache_clear()

    alembic = Config("alembic.ini")
    command.upgrade(alembic, "0006_tenant_menus")
    from app.models.tenant import Tenant, TenantMember
    from app.models.tenant_member_role import TenantMemberRole
    from app.models.tenant_menu import TenantMenu
    from app.models.tenant_role import TenantRole
    from app.models.user import User

    factory = get_session_factory()
    now = datetime.now(timezone.utc)
    with factory() as db:
        users = [
            User(user_name="f13c-owner-a", email="f13c-owner-a@example.test", password_hash="unused"),
            User(user_name="f13c-admin-a", email="f13c-admin-a@example.test", password_hash="unused"),
            User(user_name="f13c-member-a", email="f13c-member-a@example.test", password_hash="unused"),
            User(user_name="f13c-platform", email="f13c-platform@example.test", password_hash="unused", platform_role="platform_admin"),
            User(user_name="f13c-owner-b", email="f13c-owner-b@example.test", password_hash="unused"),
            User(user_name="f13c-member-b", email="f13c-member-b@example.test", password_hash="unused"),
        ]
        db.add_all(users)
        db.flush()
        user_ids = {user.user_name: user.user_id for user in users}
        tenant_a = Tenant(slug="f13c-tenant-a", name="F13c Tenant A", status="active", settings_json="{}", membership_version=1)
        tenant_b = Tenant(slug="f13c-tenant-b", name="F13c Tenant B", status="active", settings_json="{}", membership_version=1)
        db.add_all([tenant_a, tenant_b])
        db.flush()
        tenant_a_id, tenant_b_id = tenant_a.tenant_id, tenant_b.tenant_id
        db.add_all([
            TenantMember(tenant_id=tenant_a_id, user_id=user_ids["f13c-owner-a"], status="active", tenant_role="owner", joined_at=now),
            TenantMember(tenant_id=tenant_a_id, user_id=user_ids["f13c-admin-a"], status="active", tenant_role="admin", joined_at=now),
            TenantMember(tenant_id=tenant_a_id, user_id=user_ids["f13c-member-a"], status="active", tenant_role="member", joined_at=now),
            TenantMember(tenant_id=tenant_b_id, user_id=user_ids["f13c-owner-b"], status="active", tenant_role="owner", joined_at=now),
            TenantMember(tenant_id=tenant_b_id, user_id=user_ids["f13c-member-b"], status="active", tenant_role="member", joined_at=now),
        ])
        db.flush()
        role_a = TenantRole(tenant_id=tenant_a_id, role_name="Tenant A custom", role_key="tenant_a_custom", status="active", permissions_json='["tenant:read"]', created_by=user_ids["f13c-owner-a"], updated_by=user_ids["f13c-owner-a"], created_at=now, updated_at=now)
        role_a_disabled = TenantRole(tenant_id=tenant_a_id, role_name="Tenant A disabled", role_key="tenant_a_disabled", status="disabled", permissions_json="[]", created_by=user_ids["f13c-owner-a"], updated_by=user_ids["f13c-owner-a"], created_at=now, updated_at=now)
        role_a_deleted = TenantRole(tenant_id=tenant_a_id, role_name="Tenant A deleted", role_key="tenant_a_deleted", status="active", del_flag=True, permissions_json="[]", created_by=user_ids["f13c-owner-a"], updated_by=user_ids["f13c-owner-a"], created_at=now, updated_at=now)
        role_b = TenantRole(tenant_id=tenant_b_id, role_name="Tenant B custom", role_key="tenant_b_custom", status="active", permissions_json='["tenant:update"]', created_by=user_ids["f13c-owner-b"], updated_by=user_ids["f13c-owner-b"], created_at=now, updated_at=now)
        db.add_all([role_a, role_a_disabled, role_a_deleted, role_b])
        db.flush()
        role_a_id, role_a_disabled_id, role_a_deleted_id, role_b_id = role_a.role_id, role_a_disabled.role_id, role_a_deleted.role_id, role_b.role_id

        def menu(tenant_id, name, creator, *, status="0", deleted=False, order=0):
            return TenantMenu(tenant_id=tenant_id, parent_id=None, menu_name=name, order_num=order, path="/" + name.lower().replace(" ", "-"),
                              is_frame=1, is_cache=0, menu_type="C", visible="0", status=status, icon="#", del_flag=deleted,
                              created_by=creator, updated_by=creator, created_at=now, updated_at=now)

        menu_a1 = menu(tenant_a_id, "A Menu One", user_ids["f13c-owner-a"], order=1)
        menu_a2 = menu(tenant_a_id, "A Menu Two", user_ids["f13c-owner-a"], order=2)
        menu_a3 = menu(tenant_a_id, "A Menu Three", user_ids["f13c-owner-a"], order=3)
        menu_a4 = menu(tenant_a_id, "A Menu Four", user_ids["f13c-owner-a"], order=4)
        menu_disabled = menu(tenant_a_id, "A Menu Disabled", user_ids["f13c-owner-a"], status="1", order=5)
        menu_deleted = menu(tenant_a_id, "A Menu Deleted", user_ids["f13c-owner-a"], deleted=True, order=6)
        menu_b = menu(tenant_b_id, "B Menu", user_ids["f13c-owner-b"])
        db.add_all([menu_a1, menu_a2, menu_a3, menu_a4, menu_disabled, menu_deleted, menu_b])
        db.flush()
        menu_ids = {item.menu_name: item.menu_id for item in [menu_a1, menu_a2, menu_a3, menu_a4, menu_disabled, menu_deleted, menu_b]}
        # Seed pre-0007 records to ensure the migration is additive and compatible.
        assignment = TenantMemberRole(tenant_id=tenant_a_id, user_id=user_ids["f13c-member-a"], role_id=role_a_id,
                                      assigned_by=user_ids["f13c-owner-a"], assigned_at=now)
        db.add(assignment)
        db.commit()

    command.upgrade(alembic, "head")
    from app.models.tenant_role_menu import TenantRoleMenu
    engine = get_engine()
    with engine.connect() as connection:
        revision = connection.exec_driver_sql("select version_num from alembic_version").scalar_one()
        assert revision == "0009_tenant_dictionaries"  # current head; includes 0007_tenant_role_menus
        inspector = inspect(connection)
        assert "tenant_role_menus" in inspector.get_table_names()
        fks = inspector.get_foreign_keys("tenant_role_menus")
        assert any(fk["constrained_columns"] == ["role_id", "tenant_id"] and fk["referred_columns"] == ["role_id", "tenant_id"] for fk in fks)
        assert any(fk["constrained_columns"] == ["menu_id", "tenant_id"] and fk["referred_columns"] == ["menu_id", "tenant_id"] for fk in fks)
        foreign_keys_enabled = connection.exec_driver_sql("PRAGMA foreign_keys").scalar_one() == 1
    with factory() as db:
        assert db.get(Tenant, tenant_a_id).name == "F13c Tenant A"
        assert db.get(TenantRole, role_a_id).role_key == "tenant_a_custom"
        assert db.scalar(select(TenantMemberRole).where(TenantMemberRole.tenant_id == tenant_a_id, TenantMemberRole.user_id == user_ids["f13c-member-a"])) is not None

    from app.auth.security import issue_token
    from app.main import create_app
    tokens = {name: issue_token(user_id, 0) for name, user_id in user_ids.items()}
    app = create_app()
    route_a = f"/api/v1/tenants/{tenant_a_id}/roles/{role_a_id}/menus"
    route_b_role_as_a = f"/api/v1/tenants/{tenant_a_id}/roles/{role_b_id}/menus"
    observed_defects = []
    with TestClient(app) as client:
        def request(method, path, actor, **kwargs):
            headers = dict(kwargs.pop("headers", {}))
            headers["Authorization"] = f"Bearer {tokens[actor]}"
            return getattr(client, method)(path, headers=headers, **kwargs)

        def version():
            with factory() as db:
                db.expire_all()
                return db.get(Tenant, tenant_a_id).membership_version

        read = request("get", route_a, "f13c-owner-a")
        assert read.status_code == 200 and read.json() == {"tenant_id": str(tenant_a_id), "role_id": str(role_a_id), "menu_ids": []}, read.text
        first_replace = request("put", route_a, "f13c-owner-a", json={"menu_ids": [str(menu_ids["A Menu Two"]), str(menu_ids["A Menu One"])]})
        expected_pair = sorted([str(menu_ids["A Menu One"]), str(menu_ids["A Menu Two"])], key=int)
        assert first_replace.status_code == 200 and first_replace.json()["menu_ids"] == expected_pair, first_replace.text
        after_first_replace = version()
        assert after_first_replace == 2
        same_set = request("put", route_a, "f13c-owner-a", json={"menu_ids": [str(menu_ids["A Menu One"]), str(menu_ids["A Menu Two"])]})
        assert same_set.status_code == 200 and same_set.json()["menu_ids"] == [str(menu_ids["A Menu One"]), str(menu_ids["A Menu Two"])], same_set.text
        after_same_set = version()
        if after_same_set != after_first_replace:
            observed_defects.append(f"same non-empty menu set advanced membership_version {after_first_replace}->{after_same_set}")
        persisted_get = request("get", route_a, "f13c-owner-a")
        if persisted_get.json().get("menu_ids") != expected_pair:
            observed_defects.append(f"GET after association returned malformed menu_ids: {persisted_get.json().get('menu_ids')!r}")
        assert request("put", route_a, "f13c-owner-a", json={"menu_ids": [str(menu_ids["A Menu One"]), str(menu_ids["A Menu One"])]}).status_code == 422
        assert request("put", route_a, "f13c-owner-a", json={"menu_ids": ["0"]}).status_code == 422
        assert request("put", route_a, "f13c-owner-a", json={"menu_ids": [str(menu_ids["B Menu"])]}).status_code == 404
        assert request("put", route_a, "f13c-owner-a", json={"menu_ids": [str(menu_ids["A Menu Disabled"])]}).status_code == 404
        assert request("put", route_a, "f13c-owner-a", json={"menu_ids": [str(menu_ids["A Menu Deleted"])]}).status_code == 404
        assert request("get", route_b_role_as_a, "f13c-owner-a").status_code == 404

        for bad_role in (role_a_disabled_id, role_a_deleted_id):
            bad_path = f"/api/v1/tenants/{tenant_a_id}/roles/{bad_role}/menus"
            assert request("get", bad_path, "f13c-owner-a").status_code == 404
            assert request("put", bad_path, "f13c-owner-a", json={"menu_ids": []}).status_code == 404

        # Existing stale associations remain visible, but can be replaced with active menu IDs.
        with factory() as db:
            stale = TenantRoleMenu(tenant_id=tenant_a_id, role_id=role_a_id, menu_id=menu_ids["A Menu Disabled"], created_by=user_ids["f13c-owner-a"], created_at=now)
            db.add(stale); db.commit()
        stale_read = request("get", route_a, "f13c-owner-a")
        if stale_read.json().get("menu_ids") != [str(menu_ids["A Menu One"]), str(menu_ids["A Menu Two"]), str(menu_ids["A Menu Disabled"])] :
            observed_defects.append(f"GET stale links returned malformed menu_ids: {stale_read.json().get('menu_ids')!r}")
        active_replace = request("put", route_a, "f13c-owner-a", json={"menu_ids": [str(menu_ids["A Menu One"])]})
        assert active_replace.status_code == 200 and active_replace.json().get("menu_ids") == [str(menu_ids["A Menu One"])], active_replace.text
        after_replace = version()
        assert after_replace == after_same_set + 1
        assert request("put", route_a, "f13c-owner-a", json={"menu_ids": []}).json()["menu_ids"] == []
        after_clear = version()
        assert after_clear == after_replace + 1
        empty_repeat = request("put", route_a, "f13c-owner-a", json={"menu_ids": []})
        assert empty_repeat.status_code == 200 and empty_repeat.json()["menu_ids"] == []
        after_empty_repeat = version()
        if after_empty_repeat != after_clear:
            version_failures.append(f"same empty menu set advanced membership_version {after_clear}->{after_empty_repeat}")

        # Owner/admin can manage; ordinary member/platform admin without membership cannot.
        for index, manager in enumerate(("f13c-owner-a", "f13c-admin-a")):
            manager_read = request("get", route_a, manager)
            assert manager_read.status_code == 200
            expected_manager_ids = [] if index == 0 else [str(menu_ids["A Menu One"])]
            if manager_read.json().get("menu_ids") != expected_manager_ids:
                observed_defects.append(f"{manager} GET returned malformed menu_ids: {manager_read.json().get('menu_ids')!r}")
            assert request("put", route_a, manager, json={"menu_ids": [str(menu_ids["A Menu One"])]}).status_code == 200
        for forbidden in ("f13c-member-a", "f13c-platform", "f13c-owner-b"):
            assert request("get", route_a, forbidden).status_code == 403
            assert request("put", route_a, forbidden, json={"menu_ids": []}).status_code == 403

        # Concurrent distinct replacements serialize/retry and each effective set change increments once.
        concurrent_before = version()
        barrier = Barrier(2)

        def concurrent_replace(menu_name):
            with TestClient(app) as thread_client:
                barrier.wait(timeout=10)
                return thread_client.put(route_a, headers={"Authorization": f"Bearer {tokens['f13c-admin-a']}"},
                                         json={"menu_ids": [str(menu_ids[menu_name])]})

        with ThreadPoolExecutor(max_workers=2) as executor:
            futures = [executor.submit(concurrent_replace, "A Menu Three"), executor.submit(concurrent_replace, "A Menu Four")]
            concurrent_responses = [future.result(timeout=30) for future in futures]
        assert [response.status_code for response in concurrent_responses] == [200, 200], [(r.status_code, r.text) for r in concurrent_responses]
        concurrent_after = version()
        if concurrent_after != concurrent_before + 2:
            observed_defects.append(f"two distinct concurrent set changes advanced membership_version {concurrent_before}->{concurrent_after}, expected +2")
        with factory() as db:
            final_ids = [str(value) for value in db.scalars(select(TenantRoleMenu.menu_id).where(
                TenantRoleMenu.tenant_id == tenant_a_id, TenantRoleMenu.role_id == role_a_id,
            ).order_by(TenantRoleMenu.menu_id)).all()]
        assert final_ids in ([str(menu_ids["A Menu Three"])], [str(menu_ids["A Menu Four"])])
        final_read = request("get", route_a, "f13c-owner-a")
        if final_read.json().get("menu_ids") != final_ids:
            observed_defects.append(f"GET after concurrent replacement returned malformed menu_ids: {final_read.json().get('menu_ids')!r}")

        # The declared tenant-paired FKs must reject a role or menu from the other tenant.
        fk_rejections = 0
        invalid_links = [
            TenantRoleMenu(tenant_id=tenant_a_id, role_id=role_b_id, menu_id=menu_ids["A Menu One"], created_by=user_ids["f13c-owner-a"], created_at=now),
            TenantRoleMenu(tenant_id=tenant_a_id, role_id=role_a_id, menu_id=menu_ids["B Menu"], created_by=user_ids["f13c-owner-a"], created_at=now),
        ]
        for invalid in invalid_links:
            with factory() as db:
                db.add(invalid)
                try:
                    db.flush()
                except IntegrityError:
                    fk_rejections += 1
                    db.rollback()
                else:
                    db.rollback()
        assert foreign_keys_enabled and fk_rejections == 2, "role/menu tenant composite FKs must be enforced on application connections"
    assert not observed_defects, "; ".join(observed_defects)
