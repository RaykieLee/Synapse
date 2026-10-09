"""F15a tenant dictionary API, authorization, migration, and SQLite FK verification."""
from datetime import datetime, timezone

from alembic import command
from alembic.config import Config
from fastapi.testclient import TestClient
from sqlalchemy import inspect, select
from sqlalchemy.exc import IntegrityError


def test_f15a_tenant_dictionary_api_and_migration(tmp_path, monkeypatch):
    db_path = tmp_path / "f15a-dictionaries.sqlite"
    monkeypatch.setenv("SYNAPSE_DATABASE_URL", f"sqlite:///{db_path}")
    monkeypatch.setenv("SYNAPSE_JWT_SECRET", "f15a-verification-only-secret")

    from app.core.config import get_settings
    from app.database.session import get_engine, get_session_factory
    get_settings.cache_clear()
    get_engine.cache_clear()
    get_session_factory.cache_clear()

    alembic = Config("alembic.ini")
    command.upgrade(alembic, "0008_tenant_departments")

    from app.models.tenant import Tenant, TenantMember
    from app.models.tenant_department import TenantDepartment
    from app.models.tenant_menu import TenantMenu
    from app.models.tenant_role import TenantRole
    from app.models.tenant_role_menu import TenantRoleMenu
    from app.models.user import User

    now = datetime.now(timezone.utc)
    factory = get_session_factory()
    with factory() as db:
        users = [
            User(user_name="f15a-platform", email="platform-f15a@example.test", password_hash="unused", platform_role="platform_admin"),
            User(user_name="f15a-owner-a", email="owner-a-f15a@example.test", password_hash="unused"),
            User(user_name="f15a-admin-a", email="admin-a-f15a@example.test", password_hash="unused"),
            User(user_name="f15a-member-a", email="member-a-f15a@example.test", password_hash="unused"),
            User(user_name="f15a-owner-b", email="owner-b-f15a@example.test", password_hash="unused"),
            User(user_name="f15a-member-b", email="member-b-f15a@example.test", password_hash="unused"),
        ]
        db.add_all(users)
        db.flush()
        user_ids = {user.user_name: user.user_id for user in users}
        tenant_a = Tenant(slug="f15a-tenant-a", name="F15a Tenant A", status="active", settings_json="{}", membership_version=1)
        tenant_b = Tenant(slug="f15a-tenant-b", name="F15a Tenant B", status="active", settings_json="{}", membership_version=1)
        db.add_all([tenant_a, tenant_b])
        db.flush()
        tenant_a_id, tenant_b_id = tenant_a.tenant_id, tenant_b.tenant_id
        db.add_all([
            TenantMember(tenant_id=tenant_a_id, user_id=user_ids["f15a-owner-a"], status="active", tenant_role="owner", joined_at=now),
            TenantMember(tenant_id=tenant_a_id, user_id=user_ids["f15a-admin-a"], status="active", tenant_role="admin", joined_at=now),
            TenantMember(tenant_id=tenant_a_id, user_id=user_ids["f15a-member-a"], status="active", tenant_role="member", joined_at=now),
            TenantMember(tenant_id=tenant_b_id, user_id=user_ids["f15a-owner-b"], status="active", tenant_role="owner", joined_at=now),
            TenantMember(tenant_id=tenant_b_id, user_id=user_ids["f15a-member-b"], status="active", tenant_role="member", joined_at=now),
        ])
        # Existing unrelated tenant data must survive the 0009 migration.
        role = TenantRole(tenant_id=tenant_a_id, role_name="Legacy F15a role", role_key="legacy_f15a_role", status="active",
                          permissions_json="[]", created_by=user_ids["f15a-owner-a"], updated_by=user_ids["f15a-owner-a"], created_at=now, updated_at=now)
        menu = TenantMenu(tenant_id=tenant_a_id, parent_id=None, menu_name="Legacy F15a menu", order_num=0, path="/legacy-f15a",
                          is_frame=1, is_cache=0, menu_type="C", visible="0", status="0", icon="#", del_flag=False,
                          created_by=user_ids["f15a-owner-a"], updated_by=user_ids["f15a-owner-a"], created_at=now, updated_at=now)
        department = TenantDepartment(tenant_id=tenant_a_id, parent_id=None, ancestors="0", dept_name="Legacy F15a department",
                                      order_num=0, status="0", del_flag=False, created_by=user_ids["f15a-owner-a"],
                                      updated_by=user_ids["f15a-owner-a"], created_at=now, updated_at=now)
        db.add_all([role, menu, department])
        db.flush()
        db.add(TenantRoleMenu(tenant_id=tenant_a_id, role_id=role.role_id, menu_id=menu.menu_id,
                              created_by=user_ids["f15a-owner-a"], created_at=now))
        legacy_role_id, legacy_menu_id, legacy_department_id = role.role_id, menu.menu_id, department.department_id
        db.commit()

    command.upgrade(alembic, "head")
    from app.models.tenant_dictionary import TenantDictData, TenantDictType

    engine = get_engine()
    with engine.connect() as connection:
        revision = connection.exec_driver_sql("select version_num from alembic_version").scalar_one()
        assert revision == "0009_tenant_dictionaries"
        inspector = inspect(connection)
        assert {"tenant_dict_types", "tenant_dict_data"}.issubset(set(inspector.get_table_names()))
        type_unique = inspector.get_unique_constraints("tenant_dict_types")
        assert any(item["column_names"] == ["tenant_id", "dict_type"] for item in type_unique)
        entry_fk = next(fk for fk in inspector.get_foreign_keys("tenant_dict_data")
                        if fk["constrained_columns"] == ["dict_type_id", "tenant_id"])
        assert entry_fk["referred_table"] == "tenant_dict_types"
        assert entry_fk["referred_columns"] == ["dict_type_id", "tenant_id"]
        foreign_keys_enabled = connection.exec_driver_sql("PRAGMA foreign_keys").scalar_one() == 1
    with factory() as db:
        assert db.get(Tenant, tenant_a_id).name == "F15a Tenant A"
        assert db.get(TenantRole, legacy_role_id).role_key == "legacy_f15a_role"
        assert db.get(TenantMenu, legacy_menu_id).menu_name == "Legacy F15a menu"
        assert db.get(TenantDepartment, legacy_department_id).dept_name == "Legacy F15a department"
        assert db.scalar(select(TenantRoleMenu).where(TenantRoleMenu.tenant_id == tenant_a_id,
                                                       TenantRoleMenu.role_id == legacy_role_id)).menu_id == legacy_menu_id

    from app.auth.security import issue_token
    from app.main import create_app
    tokens = {name: issue_token(user_id, 0) for name, user_id in user_ids.items()}
    app = create_app()
    url_a = f"/api/v1/tenants/{tenant_a_id}/dict"
    url_b = f"/api/v1/tenants/{tenant_b_id}/dict"
    with TestClient(app) as client:
        def request(method, path, actor, **kwargs):
            headers = dict(kwargs.pop("headers", {}))
            headers["Authorization"] = f"Bearer {tokens[actor]}"
            return getattr(client, method)(path, headers=headers, **kwargs)

        # Owner and tenant admin can manage dictionaries; member and platform-only actor cannot.
        assert request("get", f"{url_a}/types", "f15a-member-a").status_code == 403
        assert request("post", f"{url_a}/types", "f15a-member-a", json={"dict_name": "Denied", "dict_type": "denied"}).status_code == 403
        assert request("get", f"{url_a}/types", "f15a-platform").status_code == 403
        assert request("post", f"{url_a}/types", "f15a-platform", json={"dict_name": "Denied", "dict_type": "denied"}).status_code == 403
        assert request("get", f"{url_b}/types", "f15a-owner-a").status_code == 403

        created_a = request("post", f"{url_a}/types", "f15a-owner-a", json={
            "dict_name": "Status", "dict_type": "sys_status", "order_num": 20, "remark": "Tenant-local status",
        })
        assert created_a.status_code == 201, created_a.text
        type_a = created_a.json()
        assert type_a["dict_type_id"].isdecimal() and type_a["tenant_id"] == str(tenant_a_id)
        assert type_a["created_by"] == str(user_ids["f15a-owner-a"])
        created_b = request("post", f"{url_b}/types", "f15a-owner-b", json={"dict_name": "Status", "dict_type": "sys_status"})
        assert created_b.status_code == 201 and created_b.json()["tenant_id"] == str(tenant_b_id)
        created_b_value = request("post", f"{url_b}/types/{created_b.json()['dict_type_id']}/data", "f15a-owner-b", json={
            "dict_label": "Tenant B only", "dict_value": "tenant-b-only",
        })
        assert created_b_value.status_code == 201
        assert request("get", f"{url_a}/types/{created_b.json()['dict_type_id']}", "f15a-owner-a").status_code == 404
        assert request("patch", f"{url_a}/types/{created_b.json()['dict_type_id']}", "f15a-owner-a", json={"dict_name": "Leak"}).status_code == 404
        assert request("delete", f"{url_a}/types/{created_b.json()['dict_type_id']}", "f15a-owner-a").status_code == 404

        # Unique dictionary type/name conflicts are tenant-local and returned through Problem JSON.
        duplicate_key = request("post", f"{url_a}/types", "f15a-admin-a", json={"dict_name": "Another", "dict_type": "sys_status"})
        assert duplicate_key.status_code == 409 and duplicate_key.json()["code"] == "DICT_TYPE_CONFLICT"
        duplicate_name = request("post", f"{url_a}/types", "f15a-admin-a", json={"dict_name": "Status", "dict_type": "another_status"})
        assert duplicate_name.status_code == 409 and duplicate_name.json()["code"] == "DICT_TYPE_CONFLICT"

        type_extra = request("post", f"{url_a}/types", "f15a-admin-a", json={"dict_name": "Priority", "dict_type": "priority", "order_num": 5})
        type_archived = request("post", f"{url_a}/types", "f15a-owner-a", json={"dict_name": "Legacy", "dict_type": "legacy", "order_num": 10, "status": "1"})
        assert type_extra.status_code == type_archived.status_code == 201
        type_ids = [type_a["dict_type_id"], type_extra.json()["dict_type_id"], type_archived.json()["dict_type_id"]]
        all_types = request("get", f"{url_a}/types", "f15a-owner-a").json()
        assert all_types["total"] == 3
        assert [row["dict_type_id"] for row in all_types["items"]] == [type_extra.json()["dict_type_id"], type_archived.json()["dict_type_id"], type_a["dict_type_id"]]
        page_one = request("get", f"{url_a}/types?page=1&page_size=2", "f15a-admin-a").json()
        page_two = request("get", f"{url_a}/types?page=2&page_size=2", "f15a-admin-a").json()
        assert page_one["total"] == 3 and len(page_one["items"]) == 2 and page_two["items"][0]["dict_type_id"] == type_a["dict_type_id"]
        filtered_types = request("get", f"{url_a}/types?dict_name=Prior&dict_type=priority&status=0", "f15a-owner-a").json()
        assert filtered_types["total"] == 1 and filtered_types["items"][0]["dict_type_id"] == type_extra.json()["dict_type_id"]
        assert request("get", f"{url_a}/types?status=1", "f15a-owner-a").json()["total"] == 1
        reordered_types = request("post", f"{url_a}/types/reorder", "f15a-admin-a", json={"items": [
            {"dict_type_id": type_a["dict_type_id"], "order_num": 1},
            {"dict_type_id": type_extra.json()["dict_type_id"], "order_num": 2},
            {"dict_type_id": type_archived.json()["dict_type_id"], "order_num": 3},
        ]})
        assert reordered_types.status_code == 200 and reordered_types.json()["updated"] == 3
        assert [row["dict_type_id"] for row in request("get", f"{url_a}/types", "f15a-owner-a").json()["items"]] == type_ids
        patch_type = request("patch", f"{url_a}/types/{type_a['dict_type_id']}", "f15a-admin-a", json={"dict_name": "Status Codes", "status": "1"})
        assert patch_type.status_code == 200 and patch_type.json()["dict_name"] == "Status Codes" and patch_type.json()["status"] == "1"
        assert request("get", f"{url_a}/types/{type_a['dict_type_id']}", "f15a-owner-a").json()["updated_by"] == str(user_ids["f15a-admin-a"])

        # CRUD, search/status filters, pagination, sorting, and duplicate key behavior for values.
        type_a_id = type_a["dict_type_id"]
        values = [
            {"dict_label": "Enabled low", "dict_value": "enabled-low", "dict_sort": 30, "status": "0"},
            {"dict_label": "Disabled middle", "dict_value": "disabled-middle", "dict_sort": 20, "status": "1"},
            {"dict_label": "Enabled high", "dict_value": "enabled-high", "dict_sort": 10, "status": "0"},
        ]
        created_values = [request("post", f"{url_a}/types/{type_a_id}/data", "f15a-owner-a", json=value) for value in values]
        assert all(response.status_code == 201 for response in created_values), [response.text for response in created_values]
        entry_ids = [response.json()["dict_data_id"] for response in created_values]
        assert all(response.json()["tenant_id"] == str(tenant_a_id) and response.json()["dict_type_id"] == type_a_id for response in created_values)
        assert request("post", f"{url_a}/types/{type_a_id}/data", "f15a-admin-a", json={"dict_label": "Duplicate", "dict_value": "enabled-low"}).status_code == 409
        other_type_value = request("post", f"{url_a}/types/{type_extra.json()['dict_type_id']}/data", "f15a-admin-a", json={"dict_label": "Same value other type", "dict_value": "enabled-low"})
        assert other_type_value.status_code == 201
        entry_list = request("get", f"{url_a}/types/{type_a_id}/data", "f15a-owner-a").json()
        assert entry_list["total"] == 3 and [row["dict_data_id"] for row in entry_list["items"]] == [entry_ids[2], entry_ids[1], entry_ids[0]]
        filtered_entries = request("get", f"{url_a}/types/{type_a_id}/data?dict_label=Enabled&status=0", "f15a-admin-a").json()
        assert filtered_entries["total"] == 2 and {row["dict_data_id"] for row in filtered_entries["items"]} == {entry_ids[0], entry_ids[2]}
        disabled_entries = request("get", f"{url_a}/types/{type_a_id}/data?status=1", "f15a-owner-a").json()
        assert disabled_entries["total"] == 1 and disabled_entries["items"][0]["dict_data_id"] == entry_ids[1]
        entry_page = request("get", f"{url_a}/types/{type_a_id}/data?page=1&page_size=2", "f15a-owner-a").json()
        assert entry_page["total"] == 3 and len(entry_page["items"]) == 2
        reorder_data = request("post", f"{url_a}/types/{type_a_id}/data/reorder", "f15a-admin-a", json={"items": [
            {"dict_data_id": entry_ids[0], "dict_sort": 1},
            {"dict_data_id": entry_ids[1], "dict_sort": 2},
            {"dict_data_id": entry_ids[2], "dict_sort": 3},
        ]})
        assert reorder_data.status_code == 200 and reorder_data.json()["updated"] == 3
        assert [row["dict_data_id"] for row in request("get", f"{url_a}/types/{type_a_id}/data", "f15a-owner-a").json()["items"]] == entry_ids
        patched_entry = request("patch", f"{url_a}/types/{type_a_id}/data/{entry_ids[0]}", "f15a-admin-a", json={"dict_label": "Enabled low updated", "css_class": "success", "status": "1"})
        assert patched_entry.status_code == 200 and patched_entry.json()["dict_label"] == "Enabled low updated"
        assert patched_entry.json()["updated_by"] == str(user_ids["f15a-admin-a"])
        assert request("get", f"{url_a}/types/{type_a_id}/data/{entry_ids[0]}", "f15a-owner-a").status_code == 200
        assert request("get", f"{url_a}/types/{type_extra.json()['dict_type_id']}/data/{entry_ids[0]}", "f15a-owner-a").status_code == 404
        assert request("get", f"{url_a}/types/{type_a_id}/data/{created_b_value.json()['dict_data_id']}", "f15a-owner-a").status_code == 404

        # Type deletion is blocked while values exist; remove values, then delete succeeds.
        blocked_delete_type = request("delete", f"{url_a}/types/{type_a_id}", "f15a-owner-a")
        assert blocked_delete_type.status_code == 409 and blocked_delete_type.json()["code"] == "DICT_TYPE_HAS_DATA"
        assert request("delete", f"{url_a}/types/{type_a_id}/data/{entry_ids[0]}", "f15a-admin-a").status_code == 204
        assert request("delete", f"{url_a}/types/{type_a_id}/data/{entry_ids[1]}", "f15a-owner-a").status_code == 204
        assert request("delete", f"{url_a}/types/{type_a_id}/data/{entry_ids[2]}", "f15a-owner-a").status_code == 204
        assert request("delete", f"{url_a}/types/{type_extra.json()['dict_type_id']}/data/{other_type_value.json()['dict_data_id']}", "f15a-owner-a").status_code == 204
        assert request("delete", f"{url_a}/types/{type_a_id}", "f15a-owner-a").status_code == 204

        # Direct cross-tenant row insertion probes SQLite enforcement of the composite type/tenant FK.
        with factory() as db:
            invalid_entry = TenantDictData(tenant_id=tenant_b_id, dict_type_id=int(type_extra.json()["dict_type_id"]),
                                           dict_sort=0, dict_label="Invalid FK", dict_value="invalid-fk", css_class=None,
                                           list_class=None, is_default="N", status="0", remark=None,
                                           created_by=user_ids["f15a-owner-b"], updated_by=user_ids["f15a-owner-b"],
                                           created_at=now, updated_at=now)
            db.add(invalid_entry)
            try:
                db.flush()
            except IntegrityError:
                db.rollback()
            else:
                db.rollback()
                assert False, "cross-tenant dictionary type composite foreign key was not enforced"
        assert foreign_keys_enabled
