"""Internal due-slot claiming and lease completion primitives (no scheduler loop)."""
import hashlib
import json
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from croniter import croniter
from sqlalchemy import and_, exists, or_, select, update
from sqlalchemy.dialects.postgresql import insert as postgresql_insert
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.orm import Session

from app.models.tenant_scheduled_task import TenantScheduledTask
from app.models.tenant_task_schedule_state import TenantTaskScheduleState

_INTERVAL_SECONDS = {"seconds": 1, "minutes": 60, "hours": 3600, "days": 86400, "weeks": 604800}


class SchedulerStateError(Exception):
    """Stable controlled error returned by the internal scheduler state API."""

    def __init__(self, code: str, message: str):
        self.code = code
        super().__init__(message)


def _utc(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def _fingerprint(task: TenantScheduledTask) -> str:
    updated_at = _utc(task.updated_at).isoformat() if task.updated_at else None
    definition = {
        "task_id": task.task_id,
        "tenant_id": task.tenant_id,
        "task_name": task.task_name,
        "description": task.description,
        "execution_target": task.execution_target,
        "parameters_json": task.parameters_json,
        "schedule_type": task.schedule_type,
        "cron_expression": task.cron_expression,
        "interval_value": task.interval_value,
        "interval_unit": task.interval_unit,
        "timezone": task.timezone,
        "enabled": task.enabled,
        "del_flag": task.del_flag,
        "updated_at": updated_at,
    }
    canonical = json.dumps(definition, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def _next_run(task: TenantScheduledTask, after: datetime) -> datetime:
    after = _utc(after)
    if task.schedule_type == "interval":
        try:
            seconds = task.interval_value * _INTERVAL_SECONDS[task.interval_unit]
        except (KeyError, TypeError):
            raise SchedulerStateError("invalid_schedule", "interval schedule is incomplete") from None
        return after + timedelta(seconds=seconds)
    if task.schedule_type == "cron" and task.cron_expression:
        try:
            local_after = after.astimezone(ZoneInfo(task.timezone))
            next_local = croniter(task.cron_expression, local_after).get_next(datetime)
            if next_local.tzinfo is None:
                next_local = next_local.replace(tzinfo=ZoneInfo(task.timezone))
            return next_local.astimezone(timezone.utc)
        except (ValueError, ZoneInfoNotFoundError, KeyError) as exc:
            raise SchedulerStateError("invalid_schedule", "cron schedule or IANA timezone is invalid") from exc
    raise SchedulerStateError("invalid_schedule", "task schedule fields are incomplete")


def _insert_state(db: Session, task: TenantScheduledTask, now: datetime) -> None:
    values = {
        "task_id": task.task_id,
        "tenant_id": task.tenant_id,
        "definition_fingerprint": _fingerprint(task),
        "next_run_at": _next_run(task, now),
        "created_at": now,
        "updated_at": now,
    }
    dialect = db.get_bind().dialect.name
    if dialect == "sqlite":
        statement = sqlite_insert(TenantTaskScheduleState).values(**values).on_conflict_do_nothing(
            index_elements=[TenantTaskScheduleState.task_id]
        )
    elif dialect == "postgresql":
        statement = postgresql_insert(TenantTaskScheduleState).values(**values).on_conflict_do_nothing(
            index_elements=[TenantTaskScheduleState.task_id]
        )
    else:
        raise SchedulerStateError("unsupported_database", "scheduler state requires SQLite or PostgreSQL")
    db.execute(statement)


def _validate_worker(worker_id: str, lease_seconds: int, limit: int) -> None:
    if not isinstance(worker_id, str) or not worker_id.strip() or len(worker_id) > 160:
        raise SchedulerStateError("invalid_worker", "worker_id must be a non-empty string up to 160 characters")
    if type(lease_seconds) is not int or not 1 <= lease_seconds <= 86400:
        raise SchedulerStateError("invalid_lease", "lease_seconds must be between 1 and 86400")
    if type(limit) is not int or not 1 <= limit <= 500:
        raise SchedulerStateError("invalid_limit", "limit must be between 1 and 500")


def claim_due_tasks(
    db: Session,
    worker_id: str,
    *,
    now: datetime | None = None,
    lease_seconds: int = 60,
    limit: int = 50,
) -> list[dict[str, Any]]:
    """Atomically claim due schedule slots across tenants for one worker.

    This is an internal primitive, not an HTTP route or background loop. New or
    changed definitions receive their next future run; missed occurrences are
    coalesced rather than replayed as a backlog.
    """
    _validate_worker(worker_id, lease_seconds, limit)
    current = _utc(now or datetime.now(timezone.utc))
    tasks = db.scalars(select(TenantScheduledTask).order_by(TenantScheduledTask.task_id)).all()
    task_map = {task.task_id: task for task in tasks}
    states = db.scalars(select(TenantTaskScheduleState)).all()
    state_map = {state.task_id: state for state in states}

    # Clear old leases for inactive definitions and reset slots when any
    # definition field changed (updated_at is part of the fingerprint).
    for state in states:
        task = task_map.get(state.task_id)
        if task is None or task.tenant_id != state.tenant_id or not task.enabled or task.del_flag:
            state.next_run_at = None
            state.claimed_slot_at = None
            state.lease_owner = None
            state.lease_token = None
            state.lease_until = None
            if task is not None:
                state.definition_fingerprint = _fingerprint(task)
            state.updated_at = current
        elif state.definition_fingerprint != _fingerprint(task):
            state.definition_fingerprint = _fingerprint(task)
            state.next_run_at = _next_run(task, current)
            state.claimed_slot_at = None
            state.lease_owner = None
            state.lease_token = None
            state.lease_until = None
            state.updated_at = current

    for task in tasks:
        if not task.enabled or task.del_flag:
            continue
        state = state_map.get(task.task_id)
        if state is None:
            _insert_state(db, task, current)
        elif state.next_run_at is None and state.definition_fingerprint == _fingerprint(task):
            state.next_run_at = _next_run(task, current)
            state.updated_at = current

    db.flush()
    active_tasks = db.scalars(
        select(TenantScheduledTask)
        .join(TenantTaskScheduleState, and_(
            TenantTaskScheduleState.task_id == TenantScheduledTask.task_id,
            TenantTaskScheduleState.tenant_id == TenantScheduledTask.tenant_id,
        ))
        .where(TenantScheduledTask.enabled.is_(True), TenantScheduledTask.del_flag.is_(False))
        .order_by(TenantScheduledTask.task_id)
    ).all()
    task_map.update({task.task_id: task for task in active_tasks})

    due_states = db.scalars(
        select(TenantTaskScheduleState)
        .join(TenantScheduledTask, and_(
            TenantScheduledTask.task_id == TenantTaskScheduleState.task_id,
            TenantScheduledTask.tenant_id == TenantTaskScheduleState.tenant_id,
        ))
        .where(
            TenantScheduledTask.enabled.is_(True),
            TenantScheduledTask.del_flag.is_(False),
            TenantTaskScheduleState.next_run_at <= current,
            or_(TenantTaskScheduleState.lease_until.is_(None), TenantTaskScheduleState.lease_until <= current),
        )
        .order_by(TenantTaskScheduleState.next_run_at, TenantTaskScheduleState.task_id)
        .limit(limit)
    ).all()

    claims: list[dict[str, Any]] = []
    for state in due_states:
        task = task_map.get(state.task_id)
        if task is None or state.definition_fingerprint != _fingerprint(task):
            continue
        slot = _utc(state.next_run_at)
        token = str(uuid.uuid4())
        valid_definition = exists(select(1).where(
            TenantScheduledTask.task_id == state.task_id,
            TenantScheduledTask.tenant_id == state.tenant_id,
            TenantScheduledTask.enabled.is_(True),
            TenantScheduledTask.del_flag.is_(False),
            TenantScheduledTask.updated_at == task.updated_at,
        ))
        result = db.execute(
            update(TenantTaskScheduleState)
            .where(
                TenantTaskScheduleState.task_id == state.task_id,
                TenantTaskScheduleState.tenant_id == state.tenant_id,
                TenantTaskScheduleState.definition_fingerprint == state.definition_fingerprint,
                TenantTaskScheduleState.next_run_at == state.next_run_at,
                or_(TenantTaskScheduleState.lease_until.is_(None), TenantTaskScheduleState.lease_until <= current),
                valid_definition,
            )
            .values(
                claimed_slot_at=state.next_run_at,
                lease_owner=worker_id,
                lease_token=token,
                lease_until=current + timedelta(seconds=lease_seconds),
                updated_at=current,
            )
            .execution_options(synchronize_session=False)
        )
        if result.rowcount == 1:
            claims.append({
                "task_id": str(state.task_id),
                "tenant_id": str(state.tenant_id),
                "execution_target": task.execution_target,
                "claimed_slot_at": slot.isoformat(),
                "lease_owner": worker_id,
                "lease_token": token,
                "lease_until": (current + timedelta(seconds=lease_seconds)).isoformat(),
            })
    db.commit()
    return claims


def complete_task_claim(
    db: Session,
    task_id: int,
    tenant_id: int,
    worker_id: str,
    lease_token: str,
    *,
    succeeded: bool,
    now: datetime | None = None,
) -> dict[str, Any]:
    """Finish a live claim; failures release the same due slot for retry."""
    if type(task_id) is not int or task_id < 1 or type(tenant_id) is not int or tenant_id < 1:
        raise SchedulerStateError("invalid_invocation", "task_id and tenant_id must be positive integers")
    if not isinstance(worker_id, str) or not worker_id.strip() or len(worker_id) > 160:
        raise SchedulerStateError("invalid_worker", "worker_id is invalid")
    try:
        token = str(uuid.UUID(lease_token))
    except (ValueError, TypeError, AttributeError) as exc:
        raise SchedulerStateError("invalid_claim", "lease_token must be a claim UUID") from exc
    if type(succeeded) is not bool:
        raise SchedulerStateError("invalid_completion", "succeeded must be a boolean")

    current = _utc(now or datetime.now(timezone.utc))
    state = db.scalar(select(TenantTaskScheduleState).where(
        TenantTaskScheduleState.task_id == task_id,
        TenantTaskScheduleState.tenant_id == tenant_id,
    ))
    task = db.scalar(select(TenantScheduledTask).where(
        TenantScheduledTask.task_id == task_id,
        TenantScheduledTask.tenant_id == tenant_id,
    ))
    if state is None or task is None:
        raise SchedulerStateError("claim_not_found", "schedule claim does not exist")
    if state.lease_owner != worker_id or state.lease_token != token or state.claimed_slot_at is None:
        raise SchedulerStateError("claim_stale", "claim owner or token does not match the active lease")
    if state.lease_until is None or _utc(state.lease_until) <= current:
        raise SchedulerStateError("claim_expired", "claim lease has expired")
    if not task.enabled or task.del_flag or state.definition_fingerprint != _fingerprint(task):
        state.next_run_at = None
        state.claimed_slot_at = None
        state.lease_owner = None
        state.lease_token = None
        state.lease_until = None
        state.definition_fingerprint = _fingerprint(task)
        state.updated_at = current
        db.commit()
        raise SchedulerStateError("claim_invalidated", "task was disabled, deleted, or changed after this slot was claimed")

    slot = _utc(state.claimed_slot_at)
    if succeeded:
        state.next_run_at = _next_run(task, current)
    # A failed task keeps its due slot and is immediately claimable again.
    state.claimed_slot_at = None
    state.lease_owner = None
    state.lease_token = None
    state.lease_until = None
    state.updated_at = current
    db.commit()
    return {
        "task_id": str(task_id),
        "tenant_id": str(tenant_id),
        "completed_slot_at": slot.isoformat(),
        "succeeded": succeeded,
        "next_run_at": _utc(state.next_run_at).isoformat() if state.next_run_at is not None else None,
    }
