"""F18b2b verification of persisted scheduler slots, claims, leases, and migration."""
from __future__ import annotations

import os
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from pathlib import Path
from threading import Barrier
from zoneinfo import ZoneInfo

import pytest
from alembic import command
from alembic.config import Config
from alembic.script import ScriptDirectory
from sqlalchemy import inspect, select


def test_f18b2b_persisted_scheduler_claims_lifecycle_and_migration(tmp_path, monkeypatch):
    db_path = tmp_path / "f18b2b-scheduler.sqlite"
    monkeypatch.setenv("SYNAPSE_DATABASE_URL", f"sqlite:///{db_path}")
    monkeypatch.setenv("SYNAPSE_JWT_SECRET", "f18b2b-verification-only-secret")
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
        command.upgrade(alembic, "head")
    finally:
        os.chdir(old_cwd)

    from app.models.tenant import Tenant
    from app.models.tenant_scheduled_task import TenantScheduledTask
    from app.models.tenant_task_schedule_state import TenantTaskScheduleState
    from app.models.user import User
    from app.tasks.scheduler_state import (
        SchedulerStateError,
        claim_due_tasks,
        complete_task_claim,
    )

    factory = get_session_factory()
    base = datetime(2026, 10, 1, 12, 0, tzinfo=timezone.utc)
    with factory() as db:
        actor = User(user_name="f18b2b-actor", email="f18b2b-actor@example.test", password_hash="unused")
        db.add(actor)
        db.flush()
        tenants = [
            Tenant(slug="f18b2b-alpha", name="F18b2b Alpha", status="active", settings_json="{}"),
            Tenant(slug="f18b2b-beta", name="F18b2b Beta", status="active", settings_json="{}"),
        ]
        db.add_all(tenants)
        db.flush()
        tenant_a, tenant_b = [row.tenant_id for row in tenants]

        def task(tenant_id: int, name: str, *, schedule="interval", interval=10, unit="seconds",
                 cron=None, tz="UTC", enabled=True, deleted=False):
            return TenantScheduledTask(
                tenant_id=tenant_id, task_name=name, execution_target="tenant.refresh_resource_summary",
                parameters_json="{}", schedule_type=schedule, cron_expression=cron,
                interval_value=interval if schedule == "interval" else None,
                interval_unit=unit if schedule == "interval" else None,
                timezone=tz, enabled=enabled, del_flag=deleted, created_by=actor.user_id, updated_by=actor.user_id,
                created_at=base, updated_at=base,
            )

        rows = [
            task(tenant_a, "cron ny", schedule="cron", cron="0 9 * * *", tz="America/New_York"),
            task(tenant_b, "interval b", interval=30),
            task(tenant_a, "concurrent slot", interval=10),
            task(tenant_a, "lease slot", interval=10),
            task(tenant_a, "success slot", interval=10),
            task(tenant_a, "failure slot", interval=10),
            task(tenant_a, "disable slot", interval=10),
            task(tenant_a, "modify slot", interval=10),
            task(tenant_a, "delete slot", interval=10),
            task(tenant_a, "initially disabled", interval=10, enabled=False),
            task(tenant_b, "initially deleted", interval=10, deleted=True),
        ]
        db.add_all(rows)
        db.commit()
        task_ids = {row.task_name: row.task_id for row in rows}

    # First scan materializes next_run in UTC without claiming future slots.
    with factory() as db:
        assert claim_due_tasks(db, "init-worker", now=base, lease_seconds=60, limit=100) == []
    with factory() as db:
        states = {row.task_id: row for row in db.scalars(select(TenantTaskScheduleState)).all()}
        ny_expected = datetime(2026, 10, 1, 13, 0, tzinfo=timezone.utc)  # 09:00 EDT
        assert states[task_ids["cron ny"]].next_run_at.replace(tzinfo=timezone.utc) == ny_expected
        assert states[task_ids["interval b"]].next_run_at.replace(tzinfo=timezone.utc) == base + timedelta(seconds=30)
        assert task_ids["initially disabled"] not in states
        assert task_ids["initially deleted"] not in states
        assert inspect(db.get_bind()).has_table("tenant_task_schedule_states")
        assert db.connection().exec_driver_sql("PRAGMA foreign_keys").scalar_one() == 1

    # Four test tasks become due together. Definitions from both tenants are
    # represented, but only active definitions acquire state/claims.
    due_at = base + timedelta(seconds=10)
    for name in ("concurrent slot", "lease slot", "success slot", "failure slot", "disable slot", "modify slot", "delete slot"):
        # Their just-created next run is base + 10; no state mutation needed.
        assert task_ids[name]

    # Two independent SQLite sessions/workers race for the same due slot.
    barrier = Barrier(2)
    def concurrent_claim(worker: str):
        with factory() as db:
            barrier.wait(timeout=10)
            return claim_due_tasks(db, worker, now=due_at, lease_seconds=30, limit=1)
    with ThreadPoolExecutor(max_workers=2) as pool:
        outcomes = list(pool.map(concurrent_claim, ("worker-left", "worker-right")))
    claims = [claim for batch in outcomes for claim in batch]
    concurrent = [claim for claim in claims if claim["task_id"] == str(task_ids["concurrent slot"])]
    assert len(concurrent) == 1
    assert concurrent[0]["tenant_id"] == str(tenant_a)
    assert concurrent[0]["claimed_slot_at"] == due_at.isoformat()

    # A claim can be reclaimed when its lease expires; the previous token is
    # stale and cannot complete the newly claimed slot.
    with factory() as db:
        lease_claim = claim_due_tasks(db, "lease-old", now=due_at, lease_seconds=5, limit=100)
    old_lease = next(item for item in lease_claim if item["task_id"] == str(task_ids["lease slot"]))
    with factory() as db:
        new_claims = claim_due_tasks(db, "lease-new", now=due_at + timedelta(seconds=5), lease_seconds=20, limit=100)
    new_lease = next(item for item in new_claims if item["task_id"] == str(task_ids["lease slot"]))
    assert new_lease["lease_token"] != old_lease["lease_token"]
    # The scan also leased other due rows. Release those fixtures as failures
    # so later assertions can exercise them independently.
    for claim in new_claims:
        if claim["task_id"] == str(task_ids["lease slot"]):
            continue
        with factory() as db:
            complete_task_claim(db, int(claim["task_id"]), int(claim["tenant_id"]), "lease-new",
                                claim["lease_token"], succeeded=False, now=due_at + timedelta(seconds=6))
    with factory() as db, pytest.raises(SchedulerStateError) as exc:
        complete_task_claim(db, task_ids["lease slot"], tenant_a, "lease-old", old_lease["lease_token"], succeeded=True,
                            now=due_at + timedelta(seconds=6))
    assert exc.value.code in {"claim_stale", "claim_expired"}
    with factory() as db:
        completed_new = complete_task_claim(db, task_ids["lease slot"], tenant_a, "lease-new", new_lease["lease_token"],
                                            succeeded=True, now=due_at + timedelta(seconds=6))
    assert completed_new["succeeded"] is True
    assert completed_new["next_run_at"] == (due_at + timedelta(seconds=16)).isoformat()

    # Success advances the interval; failure clears the lease but preserves the
    # same due slot for immediate retry.
    with factory() as db:
        claims = claim_due_tasks(db, "finish-worker", now=due_at, lease_seconds=30, limit=100)
    success_claim = next(item for item in claims if item["task_id"] == str(task_ids["success slot"]))
    failure_claim = next(item for item in claims if item["task_id"] == str(task_ids["failure slot"]))
    with factory() as db:
        succeeded = complete_task_claim(db, task_ids["success slot"], tenant_a, "finish-worker", success_claim["lease_token"],
                                        succeeded=True, now=due_at + timedelta(seconds=1))
    assert succeeded["next_run_at"] == (due_at + timedelta(seconds=11)).isoformat()
    with factory() as db:
        failed = complete_task_claim(db, task_ids["failure slot"], tenant_a, "finish-worker", failure_claim["lease_token"],
                                     succeeded=False, now=due_at + timedelta(seconds=1))
    assert failed["next_run_at"] == due_at.isoformat()
    for claim in claims:
        if claim["task_id"] in {str(task_ids["success slot"]), str(task_ids["failure slot"])}:
            continue
        with factory() as db:
            complete_task_claim(db, int(claim["task_id"]), int(claim["tenant_id"]), "finish-worker",
                                claim["lease_token"], succeeded=False, now=due_at + timedelta(seconds=1))
    with factory() as db:
        retry = claim_due_tasks(db, "retry-worker", now=due_at + timedelta(seconds=2), lease_seconds=30, limit=100)
    assert any(item["task_id"] == str(task_ids["failure slot"]) for item in retry)
    for claim in retry:
        if claim["task_id"] == str(task_ids["failure slot"]):
            continue
        with factory() as db:
            complete_task_claim(db, int(claim["task_id"]), int(claim["tenant_id"]), "retry-worker",
                                claim["lease_token"], succeeded=False, now=due_at + timedelta(seconds=3))

    # Disabling, editing, or soft-deleting a definition invalidates an old
    # slot/lease; the stale claim cannot advance it.
    with factory() as db:
        claims = claim_due_tasks(db, "invalidate-worker", now=due_at, lease_seconds=30, limit=100)
    invalidation_claims = {
        task_name: next(item for item in claims if item["task_id"] == str(task_ids[task_name]))
        for task_name in ("disable slot", "modify slot", "delete slot")
    }
    with factory() as db:
        db.get(TenantScheduledTask, task_ids["disable slot"]).enabled = False
        modified = db.get(TenantScheduledTask, task_ids["modify slot"])
        modified.interval_value = 20
        modified.updated_at = due_at + timedelta(seconds=1)
        db.get(TenantScheduledTask, task_ids["delete slot"]).del_flag = True
        db.commit()
    with factory() as db:
        claim_due_tasks(db, "refresh-worker", now=due_at + timedelta(seconds=2), lease_seconds=30, limit=100)
    with factory() as db:
        disabled_state = db.get(TenantTaskScheduleState, task_ids["disable slot"])
        deleted_state = db.get(TenantTaskScheduleState, task_ids["delete slot"])
        modified_state = db.get(TenantTaskScheduleState, task_ids["modify slot"])
        assert disabled_state.next_run_at is None and disabled_state.lease_token is None
        assert deleted_state.next_run_at is None and deleted_state.lease_token is None
        assert modified_state.next_run_at.replace(tzinfo=timezone.utc) == due_at + timedelta(seconds=22)
        assert modified_state.lease_token is None
    for task_name, claim in invalidation_claims.items():
        with factory() as db, pytest.raises(SchedulerStateError) as exc:
            complete_task_claim(db, task_ids[task_name], tenant_a, "invalidate-worker", claim["lease_token"],
                                succeeded=True, now=due_at + timedelta(seconds=3))
        assert exc.value.code in {"claim_stale", "claim_invalidated"}

    # Dispose and recreate the SQLAlchemy engine to demonstrate that next-run
    # and lease state is durable across process-style restarts.
    get_engine().dispose()
    get_engine.cache_clear()
    restarted_engine = get_engine()
    with restarted_engine.connect() as connection:
        revision = connection.exec_driver_sql("select version_num from alembic_version").scalar_one()
        assert revision == "0016_tenant_validity"
        assert revision == ScriptDirectory.from_config(alembic).get_current_head()
    with get_session_factory()() as db:
        saved = db.get(TenantTaskScheduleState, task_ids["success slot"])
        assert saved is not None
        assert saved.next_run_at.replace(tzinfo=timezone.utc) == due_at + timedelta(seconds=11)
        assert saved.lease_token is None
        durable_lease = db.get(TenantTaskScheduleState, task_ids["concurrent slot"])
        assert durable_lease is not None
        assert durable_lease.lease_owner == concurrent[0]["lease_owner"]
        assert durable_lease.lease_token == concurrent[0]["lease_token"]

    get_engine().dispose()
    get_settings.cache_clear()
    get_engine.cache_clear()
    get_session_factory.cache_clear()
