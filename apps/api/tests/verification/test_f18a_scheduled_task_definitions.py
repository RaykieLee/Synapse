"""F18a scheduled-task definition API and 0012 migration verification."""
from datetime import datetime, timezone

import pytest
from alembic import command
from alembic.config import Config
from alembic.script import ScriptDirectory
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import inspect, select
from sqlalchemy.exc import IntegrityError


def test_f18a_tenant_scheduled_task_definitions_and_migration(tmp_path, monkeypatch):
    db_path = tmp_path / "f18a.sqlite"
    monkeypatch.setenv("SYNAPSE_DATABASE_URL", f"sqlite:///{db_path}")
    monkeypatch.setenv("SYNAPSE_JWT_SECRET", "f18a-verification-only-secret")
    from app.core.config import get_settings
    from app.database.session import get_engine, get_session_factory
    get_settings.cache_clear()
    get_engine.cache_clear()
    get_session_factory.cache_clear()

    alembic = Config("alembic.ini")
    command.upgrade(alembic, "0016_tenant_validity")
    from app.models.tenant import Tenant, TenantMember, Workspace, WorkspaceMember
    from app.models.attachment import Attachment
    from app.models.user import User
    now = datetime.now(timezone.utc)
    factory = get_session_factory()
    with factory() as db:
        users = [
            User(user_name="f18a-owner-a", email="f18a-owner-a@example.test", password_hash="unused"),
            User(user_name="f18a-admin-a", email="f18a-admin-a@example.test", password_hash="unused"),
            User(user_name="f18a-member-a", email="f18a-member-a@example.test", password_hash="unused"),
            User(user_name="f18a-owner-b", email="f18a-owner-b@example.test", password_hash="unused"),
            User(user_name="f18a-platform", email="f18a-platform@example.test", password_hash="unused", platform_role="platform_admin"),
        ]
        db.add_all(users)
        db.flush()
        ids = {user.user_name: user.user_id for user in users}
        tenant_a = Tenant(slug="f18a-tenant-a", name="F18a A", status="active", settings_json="{}", membership_version=1)
        tenant_b = Tenant(slug="f18a-tenant-b", name="F18a B", status="active", settings_json="{}", membership_version=1)
        db.add_all([tenant_a, tenant_b])
        db.flush()
        tenant_ids = {"a": tenant_a.tenant_id, "b": tenant_b.tenant_id}
        db.add_all([
            TenantMember(tenant_id=tenant_ids["a"], user_id=ids["f18a-owner-a"], status="active", tenant_role="owner", joined_at=now),
            TenantMember(tenant_id=tenant_ids["a"], user_id=ids["f18a-admin-a"], status="active", tenant_role="admin", joined_at=now),
            TenantMember(tenant_id=tenant_ids["a"], user_id=ids["f18a-member-a"], status="active", tenant_role="member", joined_at=now),
            TenantMember(tenant_id=tenant_ids["b"], user_id=ids["f18a-owner-b"], status="active", tenant_role="owner", joined_at=now),
        ])
        # Seed existing workspace and attachment rows before 0012 to check upgrade compatibility.
        workspace = Workspace(tenant_id=tenant_ids["a"], slug="f18a-space", name="F18a space", status="active", settings_json="{}", created_by=ids["f18a-owner-a"])
        db.add(workspace)
        db.flush()
        db.add(WorkspaceMember(workspace_id=workspace.workspace_id, tenant_id=tenant_ids["a"], user_id=ids["f18a-owner-a"],
                               status="active", workspace_role="owner", joined_at=now))
        attachment = Attachment(attachment_id="f18a-existing-attachment", tenant_id=tenant_ids["a"], workspace_id=workspace.workspace_id,
                                scope_kind="workspace", owner_user_id=None, original_filename="existing.txt", media_type="text/plain",
                                size_bytes=4, storage_key="ab" + "1" * 30, created_by=ids["f18a-owner-a"], created_at=now)
        db.add(attachment)
        db.commit()
        tenant_a_id, tenant_b_id, workspace_id = tenant_ids["a"], tenant_ids["b"], workspace.workspace_id

    command.upgrade(alembic, "head")
    from app.models.tenant_scheduled_task import TenantScheduledTask
    engine = get_engine()
    with engine.connect() as connection:
        assert connection.exec_driver_sql("select version_num from alembic_version").scalar_one() == ScriptDirectory.from_config(alembic).get_current_head()
        inspector = inspect(connection)
        assert "tenant_scheduled_tasks" in inspector.get_table_names()
        assert connection.exec_driver_sql("PRAGMA foreign_keys").scalar_one() == 1
        constraints = inspector.get_unique_constraints("tenant_scheduled_tasks")
        assert any(item["column_names"] == ["tenant_id", "task_name"] for item in constraints)
        checks = {item["name"] for item in inspector.get_check_constraints("tenant_scheduled_tasks")}
        assert {"ck_tenant_scheduled_tasks_target_allowlist", "ck_tenant_scheduled_tasks_schedule_type",
                "ck_tenant_scheduled_tasks_schedule_fields", "ck_tenant_scheduled_tasks_interval_unit",
                "ck_tenant_scheduled_tasks_interval_value"}.issubset(checks)
    with factory() as db:
        assert db.get(Tenant, tenant_a_id).name == "F18a A"
        assert db.get(Workspace, workspace_id).slug == "f18a-space"
        assert db.get(Attachment, "f18a-existing-attachment").original_filename == "existing.txt"

    from app.auth.security import issue_token
    import app.main as main_module
    # F18a is scoped to the Synapse task-definition API. AgentScope isn't installed
    # in this verification environment, so replace only the unrelated mounted child.
    monkeypatch.setattr(main_module, "create_agentscope_app", lambda _settings: FastAPI())
    tokens = {name: issue_token(user_id, 0) for name, user_id in ids.items()}
    app = main_module.create_app()
    url_a = f"/api/v1/tenants/{tenant_a_id}/scheduled-tasks"
    url_b = f"/api/v1/tenants/{tenant_b_id}/scheduled-tasks"
    allowed = "tenant.refresh_resource_summary"
    defects = []
    with TestClient(app) as client:
        def request(method, path, actor, **kwargs):
            headers = dict(kwargs.pop("headers", {}))
            headers["Authorization"] = f"Bearer {tokens[actor]}"
            return getattr(client, method)(path, headers=headers, **kwargs)

        target_response = request("get", f"{url_a}/targets", "f18a-owner-a")
        assert target_response.status_code == 200
        targets = target_response.json()["items"]
        assert {target["target_id"] for target in targets} == {
            "tenant.expire_pending_invitations", "tenant.reconcile_attachment_metadata", "tenant.refresh_resource_summary",
        }
        assert all(target["scope"] == "tenant" for target in targets)
        assert request("get", f"{url_a}/targets", "f18a-admin-a").status_code == 200
        for actor in ("f18a-member-a", "f18a-platform"):
            assert request("get", f"{url_a}/targets", actor).status_code == 403
            assert request("get", url_a, actor).status_code == 403
            assert request("post", url_a, actor, json={"task_name": "denied", "execution_target": allowed,
                    "schedule_type": "cron", "cron_expression": "* * * * *"}).status_code == 403

        # Valid five-field cron and IANA timezone; authorization permits owner/admin only.
        cron_body = {
            "task_name": "  Nightly cleanup  ", "description": "test definition", "execution_target": allowed,
            "parameters": {"limit": 10, "dry_run": True, "label": "safe"}, "schedule_type": "cron",
            "cron_expression": " */5 * * * * ", "timezone": "America/New_York", "enabled": True,
        }
        created = request("post", url_a, "f18a-owner-a", json=cron_body)
        assert created.status_code == 201, created.text
        cron = created.json()
        assert cron["task_id"].isdecimal() and cron["tenant_id"] == str(tenant_a_id)
        assert cron["task_name"] == "Nightly cleanup" and cron["cron_expression"] == "*/5 * * * *"
        assert cron["timezone"] == "America/New_York" and cron["parameters"] == cron_body["parameters"]
        assert cron["created_by"] == cron["updated_by"] == str(ids["f18a-owner-a"])
        duplicate = request("post", url_a, "f18a-admin-a", json={**cron_body, "task_name": "Nightly cleanup"})
        assert duplicate.status_code == 409 and duplicate.json()["code"] == "TASK_NAME_CONFLICT"
        same_name_other_tenant = request("post", url_b, "f18a-owner-b", json={**cron_body, "task_name": "Nightly cleanup"})
        assert same_name_other_tenant.status_code == 201
        task_id = cron["task_id"]

        # Interval lower/upper limits (10 seconds and 365 days) plus out-of-range rejection.
        interval_min = request("post", url_a, "f18a-admin-a", json={
            "task_name": "Minimum interval", "execution_target": allowed, "schedule_type": "interval",
            "interval_value": 10, "interval_unit": "seconds", "timezone": "UTC",
        })
        assert interval_min.status_code == 201, interval_min.text
        interval_max = request("post", url_a, "f18a-owner-a", json={
            "task_name": "Maximum interval", "execution_target": allowed, "schedule_type": "interval",
            "interval_value": 365, "interval_unit": "days", "timezone": "UTC",
        })
        assert interval_max.status_code == 201, interval_max.text
        assert request("post", url_a, "f18a-owner-a", json={
            "task_name": "Too short", "execution_target": allowed, "schedule_type": "interval",
            "interval_value": 9, "interval_unit": "seconds",
        }).status_code == 422
        assert request("post", url_a, "f18a-owner-a", json={
            "task_name": "Too long", "execution_target": allowed, "schedule_type": "interval",
            "interval_value": 53, "interval_unit": "weeks",
        }).status_code == 422

        # Schedule expression shape, field exclusivity, target allowlist, timezone and JSON bounds.
        invalid_specs = [
            {**cron_body, "task_name": "Six fields", "cron_expression": "0 0 * * * *"},
            {**cron_body, "task_name": "Bad cron", "cron_expression": "60 * * * *"},
            {**cron_body, "task_name": "Cron plus interval", "interval_value": 1, "interval_unit": "days"},
            {"task_name": "Interval plus cron", "execution_target": allowed, "schedule_type": "interval",
             "interval_value": 10, "interval_unit": "seconds", "cron_expression": "* * * * *"},
            {**cron_body, "task_name": "Unknown target", "execution_target": "shell.exec"},
            {**cron_body, "task_name": "Unknown timezone", "timezone": "Mars/Olympus"},
            {**cron_body, "task_name": "Nested parameter", "parameters": {"nested": {"not": "scalar"}}},
            {**cron_body, "task_name": "Too many params", "parameters": {f"k{i}": i for i in range(33)}},
            {**cron_body, "task_name": "Too large params", "parameters": {"blob": "x" * 9000}},
            {**cron_body, "task_name": "Blank name", "task_name": "   "},
        ]
        for spec in invalid_specs:
            response = request("post", url_a, "f18a-owner-a", json=spec)
            assert response.status_code == 422, (spec.get("task_name"), response.status_code, response.text)

        # List filter/pagination, update, enable/disable, audit actor, and soft delete.
        listing = request("get", url_a, "f18a-owner-a").json()
        assert listing["total"] == 3 and listing["page"] == 1 and listing["page_size"] == 20
        assert request("get", f"{url_a}?enabled=false", "f18a-admin-a").json()["total"] == 0
        assert request("get", f"{url_a}?schedule_type=cron&task_name=Nightly", "f18a-admin-a").json()["total"] == 1
        page = request("get", f"{url_a}?page=1&page_size=1", "f18a-owner-a").json()
        assert len(page["items"]) == 1 and page["total"] == 3
        updated = request("patch", f"{url_a}/{task_id}", "f18a-admin-a", json={"enabled": False, "timezone": "Asia/Shanghai"})
        assert updated.status_code == 200 and updated.json()["enabled"] is False
        assert updated.json()["timezone"] == "Asia/Shanghai" and updated.json()["updated_by"] == str(ids["f18a-admin-a"])
        with factory() as db:
            before_invalid_patch = db.get(TenantScheduledTask, int(task_id))
            before_invalid = (before_invalid_patch.schedule_type, before_invalid_patch.cron_expression,
                              before_invalid_patch.interval_value, before_invalid_patch.interval_unit,
                              before_invalid_patch.updated_by, before_invalid_patch.updated_at)
        invalid_partial_schedule = request("patch", f"{url_a}/{task_id}", "f18a-owner-a", json={"schedule_type": "interval"})
        if invalid_partial_schedule.status_code != 422:
            defects.append(("partial schedule update should be controlled 422", invalid_partial_schedule.status_code,
                            invalid_partial_schedule.headers.get("content-type"), invalid_partial_schedule.text))
        with factory() as db:
            after_invalid_patch = db.get(TenantScheduledTask, int(task_id))
            after_invalid = (after_invalid_patch.schedule_type, after_invalid_patch.cron_expression,
                             after_invalid_patch.interval_value, after_invalid_patch.interval_unit,
                             after_invalid_patch.updated_by, after_invalid_patch.updated_at)
        assert after_invalid == before_invalid, (before_invalid, after_invalid)
        assert request("patch", f"{url_a}/{task_id}", "f18a-owner-a", json={"enabled": None}).status_code == 422
        switched = request("patch", f"{url_a}/{interval_min.json()['task_id']}", "f18a-admin-a", json={
            "schedule_type": "cron", "cron_expression": "0 * * * *", "interval_value": None,
            "interval_unit": None,
        })
        assert switched.status_code == 200 and switched.json()["schedule_type"] == "cron", switched.text

        foreign_id = same_name_other_tenant.json()["task_id"]
        assert request("get", f"{url_b}/{task_id}", "f18a-owner-b").status_code == 404
        assert request("patch", f"{url_b}/{task_id}", "f18a-owner-b", json={"task_name": "leak"}).status_code == 404
        assert request("delete", f"{url_b}/{task_id}", "f18a-owner-b").status_code == 404
        assert request("get", f"{url_a}/{foreign_id}", "f18a-owner-a").status_code == 404
        for actor in ("f18a-member-a", "f18a-platform"):
            assert request("get", f"{url_a}/{task_id}", actor).status_code == 403
            assert request("patch", f"{url_a}/{task_id}", actor, json={"enabled": True}).status_code == 403
            assert request("delete", f"{url_a}/{task_id}", actor).status_code == 403

        deleted = request("delete", f"{url_a}/{task_id}", "f18a-admin-a")
        assert deleted.status_code == 204
        assert request("get", f"{url_a}/{task_id}", "f18a-owner-a").status_code == 404
        assert request("get", url_a, "f18a-owner-a").json()["total"] == 2
        with factory() as db:
            row = db.get(TenantScheduledTask, int(task_id))
            assert row.tenant_id == tenant_a_id and row.del_flag is True and row.enabled is False

    # DB-level constraints must hold even when API/Pydantic validation is bypassed.
    with factory() as db:
        bad_target = TenantScheduledTask(tenant_id=tenant_a_id, task_name="db invalid target", execution_target="shell.exec",
                                         parameters_json="{}", schedule_type="cron", cron_expression="* * * * *", timezone="UTC",
                                         enabled=True, del_flag=False, created_by=ids["f18a-owner-a"], updated_by=ids["f18a-owner-a"],
                                         created_at=now, updated_at=now)
        db.add(bad_target)
        with pytest.raises(IntegrityError):
            db.flush()
        db.rollback()
        invalid_schedule_fields = TenantScheduledTask(tenant_id=tenant_a_id, task_name="db invalid schedule", execution_target=allowed,
                                         parameters_json="{}", schedule_type="cron", cron_expression=None, interval_value=30,
                                         interval_unit="seconds", timezone="UTC", enabled=True, del_flag=False,
                                         created_by=ids["f18a-owner-a"], updated_by=ids["f18a-owner-a"], created_at=now, updated_at=now)
        db.add(invalid_schedule_fields)
        with pytest.raises(IntegrityError):
            db.flush()
        db.rollback()
        duplicate = TenantScheduledTask(tenant_id=tenant_b_id, task_name="Nightly cleanup", execution_target=allowed,
                                         parameters_json="{}", schedule_type="cron", cron_expression="* * * * *", timezone="UTC",
                                         enabled=True, del_flag=False, created_by=ids["f18a-owner-b"], updated_by=ids["f18a-owner-b"],
                                         created_at=now, updated_at=now)
        db.add(duplicate)
        with pytest.raises(IntegrityError):
            db.flush()
        db.rollback()

    assert not defects, defects
