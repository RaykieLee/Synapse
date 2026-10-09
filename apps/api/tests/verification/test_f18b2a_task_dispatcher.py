"""F18b2a verification of persisted tenant task dispatch and target allowlist."""
from __future__ import annotations

import inspect
import os
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest
from alembic import command
from alembic.config import Config
from sqlalchemy import select


def test_f18b2a_dispatcher_reloads_scoped_tasks_and_only_uses_allowlisted_targets(tmp_path, monkeypatch):
    db_path = tmp_path / "f18b2a-dispatcher.sqlite"
    storage = tmp_path / "attachments"
    storage.mkdir()
    monkeypatch.setenv("SYNAPSE_DATABASE_URL", f"sqlite:///{db_path}")
    monkeypatch.setenv("SYNAPSE_JWT_SECRET", "f18b2a-verification-only-secret")
    monkeypatch.setenv("SYNAPSE_ATTACHMENTS_STORAGE_PATH", str(storage))

    from app.core.config import get_settings
    from app.database.session import get_engine, get_session_factory
    get_settings.cache_clear()
    get_engine.cache_clear()
    get_session_factory.cache_clear()
    old_cwd = os.getcwd()
    api_dir = Path(__file__).resolve().parents[2]
    os.chdir(api_dir)
    try:
        command.upgrade(Config("alembic.ini"), "head")
    finally:
        os.chdir(old_cwd)

    from app.models.tenant import Tenant, TenantInvitation
    from app.models.tenant_scheduled_task import TenantScheduledTask
    from app.models.user import User
    from app.tasks.dispatcher import TaskDispatchError, dispatch_tenant_task

    now = datetime.now(timezone.utc)
    factory = get_session_factory()
    with factory() as db:
        users = [
            User(user_name="f18b2a-a", email="f18b2a-a@example.test", password_hash="unused"),
            User(user_name="f18b2a-b", email="f18b2a-b@example.test", password_hash="unused"),
        ]
        db.add_all(users)
        db.flush()
        tenants = [
            Tenant(slug="f18b2a-alpha", name="F18b2a Alpha", status="active", settings_json="{}"),
            Tenant(slug="f18b2a-beta", name="F18b2a Beta", status="active", settings_json="{}"),
        ]
        db.add_all(tenants)
        db.flush()
        tenant_a, tenant_b = [tenant.tenant_id for tenant in tenants]

        def task(tenant_id: int, creator: int, name: str, target: str, *, params="{}", enabled=True, deleted=False):
            return TenantScheduledTask(
                tenant_id=tenant_id, task_name=name, execution_target=target, parameters_json=params,
                schedule_type="interval", cron_expression=None, interval_value=60, interval_unit="seconds",
                timezone="UTC", enabled=enabled, del_flag=deleted, created_by=creator, updated_by=creator,
                created_at=now, updated_at=now,
            )

        definitions = [
            task(tenant_a, users[0].user_id, "expire A", "tenant.expire_pending_invitations"),
            task(tenant_a, users[0].user_id, "reconcile A", "tenant.reconcile_attachment_metadata"),
            task(tenant_a, users[0].user_id, "summary A", "tenant.refresh_resource_summary"),
            task(tenant_b, users[1].user_id, "expire B", "tenant.expire_pending_invitations"),
            task(tenant_a, users[0].user_id, "nonempty parameters", "tenant.refresh_resource_summary", params='{"tenant_id": 2}'),
            task(tenant_a, users[0].user_id, "malformed parameters", "tenant.refresh_resource_summary", params="{"),
            task(tenant_a, users[0].user_id, "disabled", "tenant.refresh_resource_summary", enabled=False),
            task(tenant_a, users[0].user_id, "deleted", "tenant.refresh_resource_summary", deleted=True),
        ]
        db.add_all(definitions)
        db.flush()
        ids = {row.task_name: row.task_id for row in definitions}
        invitation = TenantInvitation(
            tenant_id=tenant_a, email="f18b2a-expired@example.test", target_user_id=None,
            tenant_role="member", token_hash="f18b2a".encode().hex().ljust(64, "0"),
            status="pending", expires_at=now - timedelta(seconds=1), invited_by=users[0].user_id,
        )
        b_invitation = TenantInvitation(
            tenant_id=tenant_b, email="f18b2a-b-expired@example.test", target_user_id=None,
            tenant_role="member", token_hash="f18b2b".encode().hex().ljust(64, "0"),
            status="pending", expires_at=now - timedelta(seconds=1), invited_by=users[1].user_id,
        )
        db.add_all([invitation, b_invitation])
        db.commit()
        a_invitation_id, b_invitation_id = invitation.invitation_id, b_invitation.invitation_id
        a_user_id = users[0].user_id

    # Three persisted allowlisted definitions execute the real handlers and
    # return the documented common envelope.
    with factory() as db:
        result = dispatch_tenant_task(db, ids["expire A"], tenant_a)
    assert result == {
        "task_id": str(ids["expire A"]), "tenant_id": str(tenant_a),
        "execution_target": "tenant.expire_pending_invitations", "status": "succeeded",
        "result": {"expired_count": 1},
    }
    with factory() as db:
        assert db.get(TenantInvitation, a_invitation_id).status == "expired"
        assert db.get(TenantInvitation, b_invitation_id).status == "pending"
    with factory() as db:
        reconciled = dispatch_tenant_task(db, ids["reconcile A"], tenant_a)
    assert reconciled["execution_target"] == "tenant.reconcile_attachment_metadata"
    assert reconciled["status"] == "succeeded"
    assert reconciled["tenant_id"] == str(tenant_a)
    assert reconciled["result"]["metadata_count"] == 0
    with factory() as db:
        summarized = dispatch_tenant_task(db, ids["summary A"], tenant_a)
    assert summarized["execution_target"] == "tenant.refresh_resource_summary"
    assert summarized["status"] == "succeeded"
    assert summarized["tenant_id"] == str(tenant_a)
    assert summarized["result"]["tenant_id"] == str(tenant_a)
    assert summarized["result"]["counts"]["active_user_member_count"] == 0

    # Requesting A's task under B, or B's task under A, cannot dispatch it.
    for task_id, tenant_id in ((ids["expire A"], tenant_b), (ids["expire B"], tenant_a)):
        with factory() as db, pytest.raises(TaskDispatchError) as exc:
            dispatch_tenant_task(db, task_id, tenant_id)
        assert exc.value.code == "task_not_found"
    for task_name in ("disabled", "deleted"):
        with factory() as db, pytest.raises(TaskDispatchError) as exc:
            dispatch_tenant_task(db, ids[task_name], tenant_a)
        assert exc.value.code == "task_unavailable"
    for task_name in ("nonempty parameters", "malformed parameters"):
        with factory() as db, pytest.raises(TaskDispatchError) as exc:
            dispatch_tenant_task(db, ids[task_name], tenant_a)
        assert exc.value.code == "invalid_parameters"

    # DB constraints normally reject unknown target strings. To exercise the
    # dispatcher's defensive check against pre-existing/corrupt rows, bypass
    # only the SQLite CHECK for one update; invocation still exposes no target.
    with get_engine().begin() as connection:
        connection.exec_driver_sql("PRAGMA ignore_check_constraints=ON")
        connection.exec_driver_sql(
            "UPDATE tenant_scheduled_tasks SET execution_target = ? WHERE task_id = ?",
            ("python:os.system", ids["summary A"]),
        )
        connection.exec_driver_sql("PRAGMA ignore_check_constraints=OFF")
    with factory() as db, pytest.raises(TaskDispatchError) as exc:
        dispatch_tenant_task(db, ids["summary A"], tenant_a)
    assert exc.value.code == "unsupported_target"
    assert list(inspect.signature(dispatch_tenant_task).parameters) == ["db", "task_id", "tenant_id"]

    for task_id, tenant_id in ((0, tenant_a), (True, tenant_a), (ids["summary A"], 0), (ids["summary A"], True)):
        with factory() as db, pytest.raises(TaskDispatchError) as exc:
            dispatch_tenant_task(db, task_id, tenant_id)
        assert exc.value.code == "invalid_invocation"
    with factory() as db, pytest.raises(TaskDispatchError) as exc:
        dispatch_tenant_task(db, 999_999, tenant_a)
    assert exc.value.code == "task_not_found"

    get_engine().dispose()
    get_settings.cache_clear()
    get_engine.cache_clear()
    get_session_factory.cache_clear()
