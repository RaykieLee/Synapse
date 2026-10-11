"""F18b2c real FastAPI lifespan polling verification against shared SQLite/Redis."""
from __future__ import annotations

import asyncio
import hashlib
import os
import uuid
from contextlib import AsyncExitStack
from datetime import datetime, timedelta, timezone
from pathlib import Path
from threading import Event, Lock

import pytest

from alembic import command
from alembic.config import Config
from sqlalchemy import func, select

pytestmark = [
    pytest.mark.redis,
    pytest.mark.integration,
]

def test_f18b2c_lifespan_pollers_execute_retry_and_stop_claimed_definitions(tmp_path, monkeypatch):
    db_path = tmp_path / "f18b2c-runtime.sqlite"
    monkeypatch.setenv("SYNAPSE_DATABASE_URL", f"sqlite:///{db_path}")
    monkeypatch.setenv("SYNAPSE_JWT_SECRET", "f18b2c-verification-only-secret")
    monkeypatch.setenv("SYNAPSE_SCHEDULED_TASKS_ENABLED", "true")
    monkeypatch.setenv("SYNAPSE_SCHEDULED_TASK_POLL_INTERVAL_SECONDS", "0.05")
    monkeypatch.setenv("SYNAPSE_SCHEDULED_TASK_LEASE_SECONDS", "10")
    monkeypatch.setenv("SYNAPSE_SCHEDULED_TASK_WORKER_ID", "f18b2c")
    # A Redis 7 service is provided by the local Synapse Docker environment.
    monkeypatch.setenv("SYNAPSE_AGENTSCOPE_REDIS_HOST", "127.0.0.1")
    monkeypatch.setenv("SYNAPSE_AGENTSCOPE_REDIS_PORT", "6380")
    monkeypatch.setenv("SYNAPSE_AGENTSCOPE_STORAGE_REDIS_DB", "13")
    monkeypatch.setenv("SYNAPSE_AGENTSCOPE_BUS_REDIS_DB", "14")
    monkeypatch.setenv("SYNAPSE_AGENTSCOPE_WORKSPACE_PATH", str(tmp_path / "workspaces"))

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
    from app.models.tenant_scheduled_task_run import TenantScheduledTaskRun
    from app.models.tenant_task_schedule_state import TenantTaskScheduleState
    from app.models.user import User
    from app.main import create_app
    import app.tasks.scheduler_runtime as runtime

    factory = get_session_factory()
    now = datetime.now(timezone.utc)
    with factory() as db:
        actor = User(user_name="f18b2c-actor", email="f18b2c-actor@example.test", password_hash="unused")
        tenant = Tenant(slug="f18b2c-alpha", name="F18b2c Alpha", status="active", settings_json="{}")
        db.add_all([actor, tenant])
        db.flush()
        tenant_id, actor_id = tenant.tenant_id, actor.user_id

        def task(name: str, *, target="tenant.expire_pending_invitations", params="{}"):
            return TenantScheduledTask(
                tenant_id=tenant_id, task_name=name, execution_target=target, parameters_json=params,
                schedule_type="interval", cron_expression=None, interval_value=3600, interval_unit="seconds",
                timezone="UTC", enabled=True, del_flag=False, created_by=actor_id, updated_by=actor_id,
                created_at=now, updated_at=now,
            )

        rows = [task("actual effect"), task("fail then retry"), task("crash lease recovery"),
                task("disable while claimed"), task("modify while claimed"), task("delete while claimed")]
        db.add_all(rows)
        db.flush()
        task_ids = {row.task_name: row.task_id for row in rows}
        invitations = []
        for index in range(2):
            invitations.append(TenantInvitation(
                tenant_id=tenant_id, email=f"f18b2c-expired-{index}@example.test", target_user_id=None,
                tenant_role="member", token_hash=(f"f18b2c-{index}".encode().hex()).ljust(64, "0"),
                status="pending", expires_at=now - timedelta(seconds=2), invited_by=actor_id,
            ))
        db.add_all(invitations)
        # Pre-materialize a due slot for every active fixture. The interval is
        # long so each successful task has only one due slot during this test.
        from app.tasks.scheduler_state import _fingerprint
        from app.models.tenant_task_schedule_state import TenantTaskScheduleState
        due_slot = now.replace(microsecond=0)
        for definition in rows:
            if definition.task_name == "crash lease recovery":
                continue
            db.add(TenantTaskScheduleState(
                task_id=definition.task_id, tenant_id=tenant_id,
                definition_fingerprint=_fingerprint(definition), next_run_at=due_slot,
                created_at=now, updated_at=now,
            ))
        # Simulate a worker process dying after persisting its claim. A running
        # run and expired persisted lease must be recoverable by either live
        # FastAPI worker after the lease deadline.
        crashed_token = str(uuid.uuid4())
        db.add(TenantTaskScheduleState(
            task_id=task_ids["crash lease recovery"], tenant_id=tenant_id,
            definition_fingerprint=_fingerprint(next(row for row in rows if row.task_name == "crash lease recovery")), next_run_at=due_slot,
            claimed_slot_at=due_slot, lease_owner="crashed-process", lease_token=crashed_token,
            lease_until=now - timedelta(seconds=1), created_at=now, updated_at=now,
        ))
        db.add(TenantScheduledTaskRun(
            tenant_id=tenant_id, task_id=task_ids["crash lease recovery"], slot_at=due_slot,
            claim_token_hash=hashlib.sha256(crashed_token.encode()).hexdigest(),
            execution_target="tenant.expire_pending_invitations", started_at=now - timedelta(seconds=5),
            status="running",
        ))
        db.commit()
        invitation_ids = [row.invitation_id for row in invitations]

    gate_events = {name: Event() for name in ("disable while claimed", "modify while claimed", "delete while claimed")}
    entered_events = {name: Event() for name in gate_events}
    failed_once: set[int] = set()
    failed_lock = Lock()
    original_dispatch = runtime.dispatch_tenant_task

    def controlled_dispatch(db, task_id: int, dispatch_tenant_id: int):
        name = next((name for name, value in task_ids.items() if value == task_id), None)
        if name == "fail then retry":
            with failed_lock:
                if task_id not in failed_once:
                    failed_once.add(task_id)
                    raise RuntimeError("injected transient handler failure")
        if name in gate_events:
            entered_events[name].set()
            if not gate_events[name].wait(timeout=10):
                raise TimeoutError(f"test did not release {name} dispatch gate")
        return original_dispatch(db, task_id, dispatch_tenant_id)

    monkeypatch.setattr(runtime, "dispatch_tenant_task", controlled_dispatch)

    async def wait_for(predicate, description: str, timeout: float = 12.0):
        deadline = asyncio.get_running_loop().time() + timeout
        while asyncio.get_running_loop().time() < deadline:
            if await asyncio.to_thread(predicate):
                return
            await asyncio.sleep(0.05)
        raise AssertionError(f"timed out waiting for {description}")

    app_one = create_app()
    app_two = create_app()

    async def exercise_lifespans():
        async with AsyncExitStack() as stack:
            await stack.enter_async_context(app_one.router.lifespan_context(app_one))
            await stack.enter_async_context(app_two.router.lifespan_context(app_two))

            def run_count(name: str, status: str | None = None) -> int:
                with factory() as db:
                    query = select(func.count()).select_from(TenantScheduledTaskRun).where(
                        TenantScheduledTaskRun.task_id == task_ids[name]
                    )
                    if status:
                        query = query.where(TenantScheduledTaskRun.status == status)
                    return int(db.scalar(query) or 0)

            # First task uses the real dispatcher and real invitation handler;
            # observe the single due slot before the next interval is due.
            await wait_for(lambda: run_count("actual effect", "succeeded") >= 1, "first real task effect")
            with factory() as db:
                assert [db.get(TenantInvitation, identifier).status for identifier in invitation_ids] == ["expired", "expired"]
                assert run_count("actual effect") == 1

            # Runtime observes a one-time transient exception, marks its run
            # failed/releases the slot, then its next loop executes the actual
            # dispatcher+handler and records success.
            await wait_for(lambda: run_count("fail then retry", "succeeded") >= 1, "failed task retry success")
            assert run_count("fail then retry", "failed") >= 1
            await wait_for(lambda: run_count("crash lease recovery", "succeeded") >= 1,
                           "expired crash lease recovery")
            assert run_count("crash lease recovery") == 2  # one orphaned running row plus recovered success

            # Hold an actual claimed dispatch, mutate its persisted definition,
            # then let the real dispatcher re-read and reject it. Claim
            # completion must not advance the invalidated old slot.
            for name, mutation in (
                ("disable while claimed", "disable"),
                ("modify while claimed", "modify"),
                ("delete while claimed", "delete"),
            ):
                await asyncio.wait_for(asyncio.to_thread(entered_events[name].wait, 12), timeout=13)
                with factory() as db:
                    definition = db.get(TenantScheduledTask, task_ids[name])
                    if mutation == "disable":
                        definition.enabled = False
                    elif mutation == "modify":
                        # Make the changed task's parameters invalid so even
                        # if a subsequent slot becomes due it cannot mutate data.
                        definition.parameters_json = '{"unexpected":true}'
                    else:
                        definition.del_flag = True
                    definition.updated_at = datetime.now(timezone.utc)
                    db.commit()
                gate_events[name].set()
                await wait_for(lambda: run_count(name, "failed") >= 1, f"{mutation} old claimed slot")
                with factory() as db:
                    state = db.get(TenantTaskScheduleState, task_ids[name])
                    assert state is not None
                    assert state.lease_token is None
                    if mutation in {"disable", "delete"}:
                        assert state.next_run_at is None
                    else:
                        assert state.next_run_at is not None

            # Keep serving until leaving both lifespan contexts; graceful
            # shutdown must await scheduler tasks and settle their state.
        # Lifespan exit has stopped both pollers. Definition mutation must have
        # stopped the three changed old slots, while the valid retry definition
        # remains persistently advanced after successful execution.
        with factory() as db:
            for name in ("disable while claimed", "delete while claimed"):
                state = db.get(TenantTaskScheduleState, task_ids[name])
                assert state is not None and state.lease_token is None and state.next_run_at is None
            successful_state = db.get(TenantTaskScheduleState, task_ids["fail then retry"])
            assert successful_state is not None and successful_state.lease_token is None
            recovered_state = db.get(TenantTaskScheduleState, task_ids["crash lease recovery"])
            assert recovered_state is not None and recovered_state.lease_token is None
            assert db.scalar(select(func.count()).select_from(TenantScheduledTaskRun).where(
                TenantScheduledTaskRun.task_id == task_ids["actual effect"],
                TenantScheduledTaskRun.status == "succeeded",
            )) == 1

    try:
        asyncio.run(exercise_lifespans())
    finally:
        # Release gates in case an assertion failed while one app was active.
        for event in gate_events.values():
            event.set()
        get_engine().dispose()
        get_settings.cache_clear()
        get_engine.cache_clear()
        get_session_factory.cache_clear()
