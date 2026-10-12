"""F19c manual scheduled-task trigger API and service-boundary verification."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest
from alembic import command
from alembic.config import Config
from fastapi import FastAPI
from fastapi.testclient import TestClient


def _code(response) -> str | None:
    try:
        body = response.json()
    except Exception:
        return None
    if isinstance(body.get("detail"), dict):
        return body["detail"].get("code")
    return body.get("code")


def test_f19c_manual_trigger_scope_lifecycle_and_safe_failure(tmp_path, monkeypatch):
    db_path = tmp_path / "f19c-manual-trigger.sqlite"
    monkeypatch.setenv("SYNAPSE_DATABASE_URL", f"sqlite:///{db_path}")
    monkeypatch.setenv("SYNAPSE_JWT_SECRET", "f19c-verification-only-secret")
    monkeypatch.setenv("SYNAPSE_SCHEDULED_TASKS_ENABLED", "false")
    monkeypatch.setenv("SYNAPSE_AGENTSCOPE_ENABLED", "false")

    from app.core.config import get_settings
    from app.database.session import get_engine, get_session_factory

    get_settings.cache_clear()
    get_engine.cache_clear()
    get_session_factory.cache_clear()
    api_dir = Path(__file__).resolve().parents[2]
    old_cwd = __import__("os").getcwd()
    __import__("os").chdir(api_dir)
    try:
        command.upgrade(Config("alembic.ini"), "head")
    finally:
        __import__("os").chdir(old_cwd)

    from app.auth.security import issue_token
    from app.models.tenant import Tenant, TenantMember
    from app.models.tenant_scheduled_task import TenantScheduledTask
    from app.models.tenant_scheduled_task_run import TenantScheduledTaskRun
    from app.models.tenant_task_schedule_state import TenantTaskScheduleState
    from app.models.user import User
    from app.main import create_app
    from app.tasks.scheduler_state import _fingerprint

    now = datetime.now(timezone.utc)
    factory = get_session_factory()
    with factory() as db:
        owner = User(user_name="f19c-owner", email="f19c-owner@example.test", password_hash="unused")
        admin = User(user_name="f19c-admin", email="f19c-admin@example.test", password_hash="unused")
        member = User(user_name="f19c-member", email="f19c-member@example.test", password_hash="unused")
        other_owner = User(user_name="f19c-other-owner", email="f19c-other-owner@example.test", password_hash="unused")
        db.add_all([owner, admin, member, other_owner])
        db.flush()
        tenant_a = Tenant(slug="f19c-alpha", name="F19c Alpha", status="active", settings_json="{}")
        tenant_b = Tenant(slug="f19c-beta", name="F19c Beta", status="active", settings_json="{}")
        db.add_all([tenant_a, tenant_b])
        db.flush()
        db.add_all([
            TenantMember(tenant_id=tenant_a.tenant_id, user_id=owner.user_id, status="active", tenant_role="owner"),
            TenantMember(tenant_id=tenant_a.tenant_id, user_id=admin.user_id, status="active", tenant_role="admin"),
            TenantMember(tenant_id=tenant_a.tenant_id, user_id=member.user_id, status="active", tenant_role="member"),
            TenantMember(tenant_id=tenant_b.tenant_id, user_id=other_owner.user_id, status="active", tenant_role="owner"),
        ])
        success_task = TenantScheduledTask(
            tenant_id=tenant_a.tenant_id,
            task_name="F19c success",
            execution_target="tenant.reconcile_attachment_metadata",
            parameters_json="{}",
            schedule_type="interval",
            interval_value=60,
            interval_unit="seconds",
            timezone="UTC",
            enabled=True,
            del_flag=False,
            created_by=owner.user_id,
            updated_by=owner.user_id,
            created_at=now,
            updated_at=now,
        )
        failed_task = TenantScheduledTask(
            tenant_id=tenant_a.tenant_id,
            task_name="F19c safe failure",
            execution_target="tenant.refresh_resource_summary",
            parameters_json='{"secret":"do-not-return"}',
            schedule_type="interval",
            interval_value=60,
            interval_unit="seconds",
            timezone="UTC",
            enabled=True,
            del_flag=False,
            created_by=owner.user_id,
            updated_by=owner.user_id,
            created_at=now,
            updated_at=now,
        )
        disabled_task = TenantScheduledTask(
            tenant_id=tenant_a.tenant_id,
            task_name="F19c disabled",
            execution_target="tenant.reconcile_attachment_metadata",
            parameters_json="{}",
            schedule_type="interval",
            interval_value=60,
            interval_unit="seconds",
            timezone="UTC",
            enabled=False,
            del_flag=False,
            created_by=owner.user_id,
            updated_by=owner.user_id,
            created_at=now,
            updated_at=now,
        )
        foreign_task = TenantScheduledTask(
            tenant_id=tenant_b.tenant_id,
            task_name="F19c foreign",
            execution_target="tenant.reconcile_attachment_metadata",
            parameters_json="{}",
            schedule_type="interval",
            interval_value=60,
            interval_unit="seconds",
            timezone="UTC",
            enabled=True,
            del_flag=False,
            created_by=other_owner.user_id,
            updated_by=other_owner.user_id,
            created_at=now,
            updated_at=now,
        )
        db.add_all([success_task, failed_task, disabled_task, foreign_task])
        db.flush()
        leased_task = TenantScheduledTask(
            tenant_id=tenant_a.tenant_id,
            task_name="F19c leased",
            execution_target="tenant.reconcile_attachment_metadata",
            parameters_json="{}",
            schedule_type="interval",
            interval_value=60,
            interval_unit="seconds",
            timezone="UTC",
            enabled=True,
            del_flag=False,
            created_by=owner.user_id,
            updated_by=owner.user_id,
            created_at=now,
            updated_at=now,
        )
        db.add(leased_task)
        db.flush()
        db.add(TenantTaskScheduleState(
            task_id=leased_task.task_id,
            tenant_id=tenant_a.tenant_id,
            definition_fingerprint=_fingerprint(leased_task),
            next_run_at=now,
            claimed_slot_at=now,
            lease_owner="f19c-worker",
            lease_token="f19c-lease-token",
            lease_until=now + timedelta(minutes=5),
            created_at=now,
            updated_at=now,
        ))
        db.commit()
        tenant_a_id = tenant_a.tenant_id
        tenant_b_id = tenant_b.tenant_id
        task_ids = {
            "success": success_task.task_id,
            "failed": failed_task.task_id,
            "disabled": disabled_task.task_id,
            "foreign": foreign_task.task_id,
            "leased": leased_task.task_id,
        }
        users = {
            "owner": owner,
            "admin": admin,
            "member": member,
            "other_owner": other_owner,
        }

    tokens = {
        name: issue_token(row.user_id, row.token_version)
        for name, row in users.items()
    }
    app = create_app()
    base = "/api/v1"

    def request(client, method: str, path: str, actor: str):
        return client.request(
            method,
            base + path,
            headers={"Authorization": f"Bearer {tokens[actor]}"},
        )

    try:
        with TestClient(app) as client:
            success_path = f"/tenants/{tenant_a_id}/scheduled-tasks/{task_ids['success']}/runs"
            success = request(client, "post", success_path, "owner")
            assert success.status_code == 201, success.text
            success_body = success.json()
            assert success_body["status"] == "succeeded"
            assert success_body["tenant_id"] == str(tenant_a_id)
            assert success_body["task_id"] == str(task_ids["success"])

            failed_path = f"/tenants/{tenant_a_id}/scheduled-tasks/{task_ids['failed']}/runs"
            failed = request(client, "post", failed_path, "admin")
            assert failed.status_code == 201, failed.text
            failed_body = failed.json()
            assert failed_body["status"] == "failed"
            assert failed_body["error_code"] == "INVALID_PARAMETERS"
            assert "do-not-return" not in failed.text

            assert request(client, "post", success_path, "member").status_code == 403
            assert _code(request(client, "post", success_path, "member")) == "FORBIDDEN"
            assert request(client, "post", f"/tenants/{tenant_a_id}/scheduled-tasks/{task_ids['disabled']}/runs", "owner").status_code == 409
            unavailable = request(client, "post", f"/tenants/{tenant_a_id}/scheduled-tasks/{task_ids['disabled']}/runs", "owner")
            assert _code(unavailable) == "TASK_UNAVAILABLE"
            leased = request(client, "post", f"/tenants/{tenant_a_id}/scheduled-tasks/{task_ids['leased']}/runs", "owner")
            assert leased.status_code == 409 and _code(leased) == "TASK_ALREADY_RUNNING"
            foreign = request(client, "post", f"/tenants/{tenant_a_id}/scheduled-tasks/{task_ids['foreign']}/runs", "owner")
            assert foreign.status_code == 404 and _code(foreign) == "RESOURCE_NOT_FOUND"
            assert request(client, "post", f"/tenants/{tenant_b_id}/scheduled-tasks/{task_ids['foreign']}/runs", "other_owner").status_code == 201

            with factory() as db:
                saved = db.query(TenantScheduledTaskRun).filter(
                    TenantScheduledTaskRun.task_id == task_ids["failed"],
                    TenantScheduledTaskRun.tenant_id == tenant_a_id,
                ).one()
                assert saved.status == "failed"
                assert saved.result_summary_json is None
                assert saved.error_code == "INVALID_PARAMETERS"
    finally:
        get_engine().dispose()
        get_settings.cache_clear()
        get_engine.cache_clear()
        get_session_factory.cache_clear()
