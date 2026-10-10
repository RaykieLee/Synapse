"""F18b4 tenant resource summary handler and 0013 migration verification."""
from __future__ import annotations

import json
import os
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from pathlib import Path
from threading import Barrier

import pytest
from alembic import command
from alembic.config import Config
from alembic.script import ScriptDirectory
from sqlalchemy import func, inspect, select


def test_f18b4_resource_summary_counts_are_scoped_replaceable_and_concurrent(tmp_path, monkeypatch):
    db_path = tmp_path / "f18b4-summary.sqlite"
    monkeypatch.setenv("SYNAPSE_DATABASE_URL", f"sqlite:///{db_path}")
    monkeypatch.setenv("SYNAPSE_JWT_SECRET", "f18b4-verification-only-secret")

    from app.core.config import get_settings
    from app.database.session import get_engine, get_session_factory
    get_settings.cache_clear()
    get_engine.cache_clear()
    get_session_factory.cache_clear()
    old_cwd = os.getcwd()
    api_dir = Path(__file__).resolve().parents[2]
    os.chdir(api_dir)
    alembic = Config("alembic.ini")
    try:
        # Seed all source tables before 0013 exists, then advance the existing
        # rows through the summary-table migration and current head.
        command.upgrade(alembic, "0016_tenant_validity")
    finally:
        os.chdir(old_cwd)

    from app.models.attachment import Attachment
    from app.models.tenant import Tenant, TenantMember, Workspace
    from app.models.tenant_config import TenantConfig
    from app.models.tenant_department import TenantDepartment
    from app.models.tenant_dictionary import TenantDictData, TenantDictType
    from app.models.tenant_menu import TenantMenu
    from app.models.tenant_role import TenantRole
    from app.models.tenant_scheduled_task import TenantScheduledTask
    from app.models.user import User

    now = datetime(2026, 10, 2, 12, 0, tzinfo=timezone.utc)
    factory = get_session_factory()
    with factory() as db:
        users = [
            User(user_name="f18b4-a-active", email="f18b4-a-active@example.test", password_hash="unused", status="active", del_flag=False),
            User(user_name="f18b4-a-disabled", email="f18b4-a-disabled@example.test", password_hash="unused", status="disabled", del_flag=False),
            User(user_name="f18b4-a-deleted", email="f18b4-a-deleted@example.test", password_hash="unused", status="active", del_flag=True),
            User(user_name="f18b4-b-active", email="f18b4-b-active@example.test", password_hash="unused", status="active", del_flag=False),
        ]
        db.add_all(users)
        db.flush()
        active_a, disabled_a, deleted_a, active_b = [user.user_id for user in users]
        tenant_a = Tenant(slug="f18b4-alpha", name="F18b4 Alpha", status="active", settings_json="{}", membership_version=41)
        tenant_b = Tenant(slug="f18b4-beta", name="F18b4 Beta", status="active", settings_json="{}", membership_version=42)
        db.add_all([tenant_a, tenant_b])
        db.flush()
        ta, tb = tenant_a.tenant_id, tenant_b.tenant_id
        db.add_all([
            TenantMember(tenant_id=ta, user_id=active_a, status="active", tenant_role="owner", joined_at=now),
            TenantMember(tenant_id=ta, user_id=disabled_a, status="active", tenant_role="member", joined_at=now),
            TenantMember(tenant_id=ta, user_id=deleted_a, status="active", tenant_role="member", joined_at=now),
            TenantMember(tenant_id=ta, user_id=active_b, status="removed", tenant_role="member", joined_at=now),
            TenantMember(tenant_id=tb, user_id=active_b, status="active", tenant_role="owner", joined_at=now),
        ])
        db.flush()

        workspaces = [
            Workspace(tenant_id=ta, slug="a-active", name="A Active", status="active", settings_json="{}", created_by=active_a),
            Workspace(tenant_id=ta, slug="a-archived", name="A Archived", status="archived", settings_json="{}", created_by=active_a),
            Workspace(tenant_id=tb, slug="b-active", name="B Active", status="active", settings_json="{}", created_by=active_b),
        ]
        db.add_all(workspaces)
        db.flush()
        wa_active, wa_archived, wb_active = [workspace.workspace_id for workspace in workspaces]

        db.add_all([
            Attachment(attachment_id="f18b4-a-attachment-1", tenant_id=ta, workspace_id=wa_active, scope_kind="workspace", owner_user_id=None, original_filename="a1.txt", media_type="text/plain", size_bytes=1, storage_key="a1" + "a" * 30, created_by=active_a, created_at=now),
            Attachment(attachment_id="f18b4-a-attachment-2", tenant_id=ta, workspace_id=wa_active, scope_kind="personal", owner_user_id=active_a, original_filename="a2.txt", media_type="text/plain", size_bytes=2, storage_key="a2" + "a" * 30, created_by=active_a, created_at=now),
            Attachment(attachment_id="f18b4-b-attachment", tenant_id=tb, workspace_id=wb_active, scope_kind="workspace", owner_user_id=None, original_filename="b.txt", media_type="text/plain", size_bytes=1, storage_key="b1" + "b" * 30, created_by=active_b, created_at=now),
        ])

        types = [
            TenantDictType(tenant_id=ta, dict_name="A active type", dict_type="a_active", status="0", created_by=active_a, updated_by=active_a),
            TenantDictType(tenant_id=ta, dict_name="A disabled type", dict_type="a_disabled", status="1", created_by=active_a, updated_by=active_a),
            TenantDictType(tenant_id=tb, dict_name="B active type", dict_type="b_active", status="0", created_by=active_b, updated_by=active_b),
        ]
        db.add_all(types)
        db.flush()
        active_type_a, disabled_type_a, active_type_b = [row.dict_type_id for row in types]
        db.add_all([
            TenantDictData(tenant_id=ta, dict_type_id=active_type_a, dict_sort=1, dict_label="A active value", dict_value="a1", status="0", created_by=active_a, updated_by=active_a),
            TenantDictData(tenant_id=ta, dict_type_id=active_type_a, dict_sort=2, dict_label="A disabled value", dict_value="a2", status="1", created_by=active_a, updated_by=active_a),
            TenantDictData(tenant_id=ta, dict_type_id=disabled_type_a, dict_sort=1, dict_label="A in disabled type", dict_value="a3", status="0", created_by=active_a, updated_by=active_a),
            TenantDictData(tenant_id=tb, dict_type_id=active_type_b, dict_sort=1, dict_label="B active value", dict_value="b1", status="0", created_by=active_b, updated_by=active_b),
        ])

        configs = [
            TenantConfig(tenant_id=ta, config_name="A active", config_key="a.active", config_value="a", status="0", created_by=active_a, updated_by=active_a, created_at=now, updated_at=now),
            TenantConfig(tenant_id=ta, config_name="A disabled", config_key="a.disabled", config_value="a", status="1", created_by=active_a, updated_by=active_a, created_at=now, updated_at=now),
            TenantConfig(tenant_id=tb, config_name="B active", config_key="b.active", config_value="b", status="0", created_by=active_b, updated_by=active_b, created_at=now, updated_at=now),
        ]
        db.add_all(configs)
        db.add_all([
            TenantDepartment(tenant_id=ta, parent_id=None, ancestors="0", dept_name="A active", status="0", del_flag=False, created_by=active_a, updated_by=active_a, created_at=now, updated_at=now),
            TenantDepartment(tenant_id=ta, parent_id=None, ancestors="0", dept_name="A disabled", status="1", del_flag=False, created_by=active_a, updated_by=active_a, created_at=now, updated_at=now),
            TenantDepartment(tenant_id=ta, parent_id=None, ancestors="0", dept_name="A deleted", status="0", del_flag=True, created_by=active_a, updated_by=active_a, created_at=now, updated_at=now),
            TenantDepartment(tenant_id=tb, parent_id=None, ancestors="0", dept_name="B active", status="0", del_flag=False, created_by=active_b, updated_by=active_b, created_at=now, updated_at=now),
        ])
        db.add_all([
            TenantRole(tenant_id=ta, role_name="A active", role_key="a_active", status="active", del_flag=False, permissions_json="[]", created_by=active_a, updated_by=active_a, created_at=now, updated_at=now),
            TenantRole(tenant_id=ta, role_name="A disabled", role_key="a_disabled", status="disabled", del_flag=False, permissions_json="[]", created_by=active_a, updated_by=active_a, created_at=now, updated_at=now),
            TenantRole(tenant_id=ta, role_name="A deleted", role_key="a_deleted", status="active", del_flag=True, permissions_json="[]", created_by=active_a, updated_by=active_a, created_at=now, updated_at=now),
            TenantRole(tenant_id=tb, role_name="B active", role_key="b_active", status="active", del_flag=False, permissions_json="[]", created_by=active_b, updated_by=active_b, created_at=now, updated_at=now),
        ])
        db.add_all([
            TenantMenu(tenant_id=ta, parent_id=None, menu_name="A visible active", status="0", visible="0", del_flag=False, created_by=active_a, updated_by=active_a, created_at=now, updated_at=now),
            TenantMenu(tenant_id=ta, parent_id=None, menu_name="A hidden", status="0", visible="1", del_flag=False, created_by=active_a, updated_by=active_a, created_at=now, updated_at=now),
            TenantMenu(tenant_id=ta, parent_id=None, menu_name="A disabled menu", status="1", visible="0", del_flag=False, created_by=active_a, updated_by=active_a, created_at=now, updated_at=now),
            TenantMenu(tenant_id=ta, parent_id=None, menu_name="A deleted menu", status="0", visible="0", del_flag=True, created_by=active_a, updated_by=active_a, created_at=now, updated_at=now),
            TenantMenu(tenant_id=tb, parent_id=None, menu_name="B visible active", status="0", visible="0", del_flag=False, created_by=active_b, updated_by=active_b, created_at=now, updated_at=now),
        ])

        task_kwargs = dict(schedule_type="interval", cron_expression=None, interval_value=60, interval_unit="seconds", timezone="UTC", parameters_json="{}", created_at=now, updated_at=now)
        db.add_all([
            TenantScheduledTask(tenant_id=ta, task_name="A enabled", execution_target="tenant.expire_pending_invitations", enabled=True, del_flag=False, created_by=active_a, updated_by=active_a, **task_kwargs),
            TenantScheduledTask(tenant_id=ta, task_name="A disabled", execution_target="tenant.expire_pending_invitations", enabled=False, del_flag=False, created_by=active_a, updated_by=active_a, **task_kwargs),
            TenantScheduledTask(tenant_id=ta, task_name="A deleted", execution_target="tenant.expire_pending_invitations", enabled=True, del_flag=True, created_by=active_a, updated_by=active_a, **task_kwargs),
            TenantScheduledTask(tenant_id=tb, task_name="B enabled", execution_target="tenant.expire_pending_invitations", enabled=True, del_flag=False, created_by=active_b, updated_by=active_b, **task_kwargs),
        ])
        db.commit()
        pre_migration = {
            "tenants": db.scalar(select(func.count()).select_from(Tenant)),
            "workspaces": db.scalar(select(func.count()).select_from(Workspace)),
            "attachments": db.scalar(select(func.count()).select_from(Attachment)),
        }
        ta_id, tb_id = ta, tb
        disabled_config_id = next(row.config_id for row in configs if row.config_key == "a.disabled")
        archived_workspace_id = wa_archived

    os.chdir(api_dir)
    try:
        command.upgrade(alembic, "head")
    finally:
        os.chdir(old_cwd)

    engine = get_engine()
    with engine.connect() as connection:
        revision = connection.exec_driver_sql("select version_num from alembic_version").scalar_one()
        assert revision == ScriptDirectory.from_config(alembic).get_current_head()
        inspector = inspect(connection)
        assert "tenant_resource_summaries" in inspector.get_table_names()
        assert inspector.get_pk_constraint("tenant_resource_summaries")["constrained_columns"] == ["tenant_id"]
        assert connection.exec_driver_sql("PRAGMA foreign_keys").scalar_one() == 1
        assert connection.exec_driver_sql("SELECT COUNT(*) FROM tenants").scalar_one() == pre_migration["tenants"]
        assert connection.exec_driver_sql("SELECT COUNT(*) FROM workspaces").scalar_one() == pre_migration["workspaces"]
        assert connection.exec_driver_sql("SELECT COUNT(*) FROM attachments").scalar_one() == pre_migration["attachments"]
        assert connection.exec_driver_sql("SELECT COUNT(*) FROM tenant_resource_summaries").scalar_one() == 0

    from app.models.tenant_resource_summary import TenantResourceSummary
    from app.tasks.resource_summary import SUMMARY_SCHEMA_VERSION, refresh_resource_summary

    expected = {
        "active_user_member_count": 1,
        "active_workspace_count": 1,
        "attachment_count": 2,
        "active_dictionary_type_count": 1,
        "active_dictionary_value_count": 1,
        "active_config_count": 1,
        "active_department_count": 1,
        "active_custom_role_count": 1,
        "active_menu_count": 1,
        "enabled_scheduled_task_count": 1,
    }
    sentinel_b = TenantResourceSummary(tenant_id=tb_id, counts_json='{"sentinel":"tenant-b-only"}', schema_version=99, refreshed_at=now)
    with factory() as db:
        db.add(sentinel_b)
        db.commit()

    with factory() as db:
        initial = refresh_resource_summary(db, ta_id, now=now)
    assert initial == {
        "task_target": "tenant.refresh_resource_summary",
        "tenant_id": str(ta_id),
        "schema_version": SUMMARY_SCHEMA_VERSION,
        "refreshed_at": now.isoformat(),
        "counts": expected,
    }
    with factory() as db:
        row = db.get(TenantResourceSummary, ta_id)
        assert row is not None and json.loads(row.counts_json) == expected
        assert row.schema_version == SUMMARY_SCHEMA_VERSION
        assert db.get(TenantResourceSummary, tb_id).counts_json == '{"sentinel":"tenant-b-only"}'

    # Repeated refresh replaces the same row and document, not incremental
    # counters. Then run two real SQLAlchemy sessions concurrently.
    repeat_time = now + timedelta(seconds=1)
    with factory() as db:
        repeated = refresh_resource_summary(db, ta_id, now=repeat_time)
    assert repeated["counts"] == expected
    with factory() as db:
        assert db.scalar(select(func.count()).select_from(TenantResourceSummary).where(TenantResourceSummary.tenant_id == ta_id)) == 1

    concurrent_barrier = Barrier(2)
    concurrent_times = [repeat_time + timedelta(seconds=index + 1) for index in range(2)]
    def refresh_concurrently(index: int):
        with factory() as db:
            concurrent_barrier.wait(timeout=10)
            return refresh_resource_summary(db, ta_id, now=concurrent_times[index])

    with ThreadPoolExecutor(max_workers=2) as pool:
        concurrent_results = list(pool.map(refresh_concurrently, range(2)))
    assert [result["counts"] for result in concurrent_results] == [expected, expected]
    with factory() as db:
        summaries = db.scalars(select(TenantResourceSummary).where(TenantResourceSummary.tenant_id == ta_id)).all()
        assert len(summaries) == 1
        assert json.loads(summaries[0].counts_json) == expected
        assert summaries[0].refreshed_at.replace(tzinfo=timezone.utc) in concurrent_times

    # Change the source set: activate one Workspace and one config. The handler
    # must replace its document with the fresh counts without retaining stale data.
    changed = {**expected, "active_workspace_count": 2, "active_config_count": 2}
    refresh_after_change = repeat_time + timedelta(minutes=1)
    with factory() as db:
        db.get(Workspace, archived_workspace_id).status = "active"
        db.get(TenantConfig, disabled_config_id).status = "0"
        db.commit()
    with factory() as db:
        refreshed = refresh_resource_summary(db, ta_id, now=refresh_after_change)
    assert refreshed["counts"] == changed
    with factory() as db:
        row = db.get(TenantResourceSummary, ta_id)
        assert row is not None and json.loads(row.counts_json) == changed
        assert row.refreshed_at.replace(tzinfo=timezone.utc) == refresh_after_change
        assert row.schema_version == 1
        assert db.get(TenantResourceSummary, tb_id).counts_json == '{"sentinel":"tenant-b-only"}'
        assert db.scalar(select(func.count()).select_from(TenantResourceSummary).where(TenantResourceSummary.tenant_id == ta_id)) == 1

    for invalid in (0, -1, True, 1.2, "1", None):
        with factory() as db, pytest.raises(ValueError, match="positive integer"):
            refresh_resource_summary(db, invalid, now=now)
    with factory() as db, pytest.raises(LookupError, match="tenant does not exist"):
        refresh_resource_summary(db, 999_999_999, now=now)

    get_engine().dispose()
    get_settings.cache_clear()
    get_engine.cache_clear()
    get_session_factory.cache_clear()
