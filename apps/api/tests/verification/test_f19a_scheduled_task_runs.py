"""F19a migration preservation and tenant-authorized task run API verification."""
from __future__ import annotations

import os
from datetime import datetime, timezone
from pathlib import Path

import pytest
from alembic import command
from alembic.config import Config
from alembic.script import ScriptDirectory
from fastapi.testclient import TestClient
from sqlalchemy import inspect, select
from sqlalchemy.exc import IntegrityError


def _code(response) -> str | None:
    try:
        body = response.json()
        detail = body.get("detail")
        return detail.get("code") if isinstance(detail, dict) else body.get("code")
    except Exception:
        return None


def test_f19a_task_run_migration_api_scope_filters_and_redaction(tmp_path, monkeypatch):
    redis_host = os.environ.get("F19A_REDIS_HOST", "127.0.0.1")
    redis_port = int(os.environ.get("F19A_REDIS_PORT", "6380"))
    try:
        import redis
        redis.Redis(host=redis_host, port=redis_port, socket_connect_timeout=1).ping()
    except Exception as exc:
        pytest.fail(f"F19a TestClient lifespan requires Redis at {redis_host}:{redis_port}: {exc}")

    db_path = tmp_path / "f19a-task-runs.sqlite"
    monkeypatch.setenv("SYNAPSE_DATABASE_URL", f"sqlite:///{db_path}")
    monkeypatch.setenv("SYNAPSE_JWT_SECRET", "f19a-verification-only-secret")
    monkeypatch.setenv("SYNAPSE_AGENTSCOPE_REDIS_HOST", redis_host)
    monkeypatch.setenv("SYNAPSE_AGENTSCOPE_REDIS_PORT", str(redis_port))
    monkeypatch.setenv("SYNAPSE_AGENTSCOPE_STORAGE_REDIS_DB", "9")
    monkeypatch.setenv("SYNAPSE_AGENTSCOPE_BUS_REDIS_DB", "10")
    monkeypatch.setenv("SYNAPSE_AGENTSCOPE_WORKSPACE_PATH", str(tmp_path / "workspace-roots"))
    monkeypatch.setenv("SYNAPSE_SCHEDULED_TASKS_ENABLED", "false")

    from app.core.config import get_settings
    from app.database.session import get_engine, get_session_factory
    get_settings.cache_clear(); get_engine.cache_clear(); get_session_factory.cache_clear()
    old_cwd = os.getcwd()
    api_dir = Path(__file__).resolve().parents[2]
    os.chdir(api_dir)
    alembic = Config("alembic.ini")
    try:
        command.upgrade(alembic, "0016_tenant_validity")
    finally:
        os.chdir(old_cwd)

    from app.auth.security import issue_token
    from app.models.tenant import Tenant, TenantMember
    from app.models.tenant_scheduled_task import TenantScheduledTask
    from app.models.tenant_scheduled_task_run import TenantScheduledTaskRun
    from app.models.user import User
    from app.main import create_app

    factory = get_session_factory()
    with factory() as db:
        owner_a = User(user_name="f19a-owner-a", email="f19a-owner-a@example.test", password_hash="unused", status="active", del_flag=False)
        admin_a = User(user_name="f19a-admin-a", email="f19a-admin-a@example.test", password_hash="unused", status="active", del_flag=False)
        member_a = User(user_name="f19a-member-a", email="f19a-member-a@example.test", password_hash="unused", status="active", del_flag=False)
        owner_b = User(user_name="f19a-owner-b", email="f19a-owner-b@example.test", password_hash="unused", status="active", del_flag=False)
        outsider_platform = User(user_name="f19a-platform", email="f19a-platform@example.test", password_hash="unused", status="active", del_flag=False, platform_role="platform_admin")
        db.add_all([owner_a, admin_a, member_a, owner_b, outsider_platform]); db.flush()
        tenants = [
            Tenant(slug="f19a-alpha", name="F19a Alpha", status="active", settings_json="{}"),
            Tenant(slug="f19a-beta", name="F19a Beta", status="active", settings_json="{}"),
        ]
        db.add_all(tenants); db.flush()
        tenant_a, tenant_b = [row.tenant_id for row in tenants]
        db.add_all([
            TenantMember(tenant_id=tenant_a, user_id=owner_a.user_id, status="active", tenant_role="owner"),
            TenantMember(tenant_id=tenant_a, user_id=admin_a.user_id, status="active", tenant_role="admin"),
            TenantMember(tenant_id=tenant_a, user_id=member_a.user_id, status="active", tenant_role="member"),
            TenantMember(tenant_id=tenant_b, user_id=owner_b.user_id, status="active", tenant_role="owner"),
        ])

        created_at = datetime(2026, 10, 1, 8, 0, tzinfo=timezone.utc)
        def task(tenant_id: int, creator_id: int, name: str):
            return TenantScheduledTask(
                tenant_id=tenant_id, task_name=name, execution_target="tenant.expire_pending_invitations",
                parameters_json='{"credential":"PARAMETER-SECRET-SENTINEL"}', schedule_type="interval",
                cron_expression=None, interval_value=60, interval_unit="seconds", timezone="UTC",
                enabled=True, del_flag=False, created_by=creator_id, updated_by=creator_id,
                created_at=created_at, updated_at=created_at,
            )

        task_a = task(tenant_a, owner_a.user_id, "A cleanup")
        task_b = task(tenant_b, owner_b.user_id, "B cleanup")
        db.add_all([task_a, task_b]); db.commit()
        task_a_id, task_b_id = task_a.task_id, task_b.task_id
        user_ids = {"owner": owner_a.user_id, "admin": admin_a.user_id, "member": member_a.user_id,
                    "owner_b": owner_b.user_id, "platform": outsider_platform.user_id}
        token_versions = {"owner": owner_a.token_version, "admin": admin_a.token_version,
                          "member": member_a.token_version, "owner_b": owner_b.token_version,
                          "platform": outsider_platform.token_version}

    # Upgrade from 0014 after task definitions already exist; migration must
    # retain them and add the append-only run table.
    os.chdir(api_dir)
    try:
        command.upgrade(alembic, "head")
    finally:
        os.chdir(old_cwd)
    engine = get_engine()
    with engine.connect() as connection:
        revision = connection.exec_driver_sql("select version_num from alembic_version").scalar_one()
        assert revision == "0015_tenant_scheduled_task_runs"
        inspector = inspect(connection)
        assert "tenant_scheduled_task_runs" in inspector.get_table_names()
        assert connection.exec_driver_sql("PRAGMA foreign_keys").scalar_one() == 1
        assert connection.exec_driver_sql("SELECT COUNT(*) FROM tenant_scheduled_tasks").scalar_one() == 2

    # Insert four distinct lifecycle runs on A, plus a B run. Persist only a
    # digest of the claim token and sanitized numeric summary/error fields.
    claim_token = "F19A-RAW-CLAIM-TOKEN-MUST-NOT-LEAK"
    import hashlib
    digest = hashlib.sha256(claim_token.encode()).hexdigest()
    times = [datetime(2026, 10, 2, hour, 0, tzinfo=timezone.utc) for hour in (8, 9, 10, 11)]
    with factory() as db:
        runs_a = [
            TenantScheduledTaskRun(tenant_id=tenant_a, task_id=task_a_id, slot_at=times[0], claim_token_hash=digest,
                                   execution_target="tenant.expire_pending_invitations", started_at=times[0],
                                   finished_at=times[0], status="succeeded", result_summary_json='{"expired_count":3}'),
            TenantScheduledTaskRun(tenant_id=tenant_a, task_id=task_a_id, slot_at=times[1], claim_token_hash=digest,
                                   execution_target="tenant.expire_pending_invitations", started_at=times[1],
                                   finished_at=times[1], status="failed", error_code="HANDLER_ERROR"),
            TenantScheduledTaskRun(tenant_id=tenant_a, task_id=task_a_id, slot_at=times[2], claim_token_hash=digest,
                                   execution_target="tenant.expire_pending_invitations", started_at=times[2],
                                   finished_at=None, status="running"),
            TenantScheduledTaskRun(tenant_id=tenant_a, task_id=task_a_id, slot_at=times[3], claim_token_hash=digest,
                                   execution_target="tenant.expire_pending_invitations", started_at=times[3],
                                   finished_at=times[3], status="succeeded", result_summary_json='{"expired_count":5}'),
        ]
        run_b = TenantScheduledTaskRun(tenant_id=tenant_b, task_id=task_b_id, slot_at=times[0], claim_token_hash=digest,
                                       execution_target="tenant.expire_pending_invitations", started_at=times[0],
                                       finished_at=times[0], status="succeeded", result_summary_json='{"expired_count":99}')
        db.add_all([*runs_a, run_b]); db.commit()
        run_ids_a = [row.run_id for row in runs_a]
        run_id_b = run_b.run_id

    # SQLite enforces both run status CHECK and the composite task/tenant FK.
    with factory() as db:
        bad_status = TenantScheduledTaskRun(tenant_id=tenant_a, task_id=task_a_id, slot_at=times[0], claim_token_hash=digest,
                                            execution_target="tenant.expire_pending_invitations", started_at=times[0], status="queued")
        db.add(bad_status)
        with pytest.raises(IntegrityError):
            db.commit()
        db.rollback()
        bad_scope = TenantScheduledTaskRun(tenant_id=tenant_a, task_id=task_b_id, slot_at=times[0], claim_token_hash=digest,
                                           execution_target="tenant.expire_pending_invitations", started_at=times[0], status="running")
        db.add(bad_scope)
        with pytest.raises(IntegrityError):
            db.commit()
        db.rollback()

    tokens = {key: issue_token(user_ids[key], token_versions[key]) for key in user_ids}
    app = create_app()
    base = "/api/v1"
    def request(client, method: str, path: str, actor: str, **kwargs):
        headers = dict(kwargs.pop("headers", {}))
        headers["Authorization"] = f"Bearer {tokens[actor]}"
        return client.request(method, base + path, headers=headers, **kwargs)

    try:
        with TestClient(app) as client:
            path = f"/tenants/{tenant_a}/scheduled-tasks/{task_a_id}/runs"
            first = request(client, "get", path + "?page=1&page_size=2", "owner")
            assert first.status_code == 200, first.text
            page = first.json()
            assert page["total"] == 4 and page["page"] == 1 and page["page_size"] == 2
            assert [item["run_id"] for item in page["items"]] == [str(run_ids_a[3]), str(run_ids_a[2])]
            assert all(item["tenant_id"] == str(tenant_a) and item["task_id"] == str(task_a_id) for item in page["items"])
            assert {item["status"] for item in page["items"]} == {"succeeded", "running"}

            page_two = request(client, "get", path + "?page=2&page_size=2", "admin")
            assert page_two.status_code == 200 and page_two.json()["total"] == 4
            assert [item["run_id"] for item in page_two.json()["items"]] == [str(run_ids_a[1]), str(run_ids_a[0])]

            failed = request(client, "get", path + "?status=failed", "owner")
            assert failed.status_code == 200
            assert failed.json()["total"] == 1 and failed.json()["items"][0]["run_id"] == str(run_ids_a[1])
            window = request(client, "get", path, "admin", params={
                "started_from": "2026-10-02T09:00:00Z", "started_to": "2026-10-02T10:00:00Z",
            })
            assert window.status_code == 200
            assert window.json()["total"] == 2
            assert {item["run_id"] for item in window.json()["items"]} == {str(run_ids_a[1]), str(run_ids_a[2])}
            assert request(client, "get", path + "?status=unknown", "owner").status_code == 422
            assert request(client, "get", path, "owner", params={
                "started_from": "2026-10-02T11:00:00Z", "started_to": "2026-10-02T08:00:00Z",
            }).status_code == 422

            detail = request(client, "get", path + f"/{run_ids_a[0]}", "owner")
            assert detail.status_code == 200
            result = detail.json()
            assert result["result_summary"] == {"expired_count": 3}
            assert result["status"] == "succeeded"
            assert result["error_code"] is None
            assert result["tenant_id"] == str(tenant_a) and result["task_id"] == str(task_a_id)
            failed_detail = request(client, "get", path + f"/{run_ids_a[1]}", "admin")
            assert failed_detail.json()["error_code"] == "HANDLER_ERROR"

            # No run response may expose the raw claim token/digest, task
            # parameter credentials, password hashes, or internal columns.
            serialized = first.text + page_two.text + failed.text + window.text + detail.text + failed_detail.text
            for secret_value in (claim_token, digest, "PARAMETER-SECRET-SENTINEL", "claim_token_hash", "parameters_json"):
                assert secret_value not in serialized
            assert "result_summary" in result and "expired_count" in result["result_summary"]

            # Members and platform admins without tenant membership cannot
            # access global/tenant run data, while tenant owner/admin can.
            member_denied = request(client, "get", path, "member")
            assert member_denied.status_code == 403 and _code(member_denied) == "FORBIDDEN"
            platform_denied = request(client, "get", path, "platform")
            assert platform_denied.status_code == 403 and _code(platform_denied) == "MEMBERSHIP_INACTIVE"

            # Tenant, task, and run identifiers are jointly scoped; foreign IDs
            # are consistently hidden as 404 from authorized tenant A callers.
            assert request(client, "get", f"/tenants/{tenant_a}/scheduled-tasks/{task_b_id}/runs", "owner").status_code == 404
            assert request(client, "get", path + f"/{run_id_b}", "owner").status_code == 404
            assert request(client, "get", f"/tenants/{tenant_b}/scheduled-tasks/{task_b_id}/runs", "owner").status_code == 403
            assert request(client, "get", path + "/99999999", "owner").status_code == 404
    finally:
        get_engine().dispose()
        get_settings.cache_clear(); get_engine.cache_clear(); get_session_factory.cache_clear()
