"""Application service for synchronous manual scheduled-task execution."""

from __future__ import annotations

import hashlib
import json
import threading
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from app.database.session import get_session_factory
from app.models.tenant_scheduled_task import TenantScheduledTask
from app.models.tenant_scheduled_task_run import TenantScheduledTaskRun
from app.models.tenant_task_schedule_state import TenantTaskScheduleState
from app.services.errors import ConflictError, ForbiddenError, NotFoundError, ServiceError
from app.tasks.dispatcher import dispatch_tenant_task
from app.tasks.scheduler_runtime import _safe_error_code, _safe_result_summary
from app.tenancy.context import TenantContext


class ScheduledTaskNotFound(NotFoundError):
    code = "RESOURCE_NOT_FOUND"


class ScheduledTaskUnavailable(ConflictError):
    code = "TASK_UNAVAILABLE"


class ScheduledTaskAlreadyRunning(ConflictError):
    code = "TASK_ALREADY_RUNNING"


class ScheduledTaskRunRecordError(ServiceError):
    code = "RUN_RECORD_ERROR"


@dataclass(frozen=True)
class ScheduledTaskRunResult:
    run_id: str
    tenant_id: str
    task_id: str
    slot_at: str
    execution_target: str
    started_at: str
    finished_at: str | None
    status: str
    result_summary: dict | None
    error_code: str | None


_manual_locks: dict[tuple[int, int], threading.Lock] = {}
_manual_locks_guard = threading.Lock()


def _manual_lock(tenant_id: int, task_id: int) -> threading.Lock:
    key = (tenant_id, task_id)
    with _manual_locks_guard:
        lock = _manual_locks.get(key)
        if lock is None:
            lock = threading.Lock()
            _manual_locks[key] = lock
        return lock


def _as_utc(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def _iso(value: datetime | None) -> str | None:
    if value is None:
        return None
    return _as_utc(value).isoformat()


class ManualScheduledTaskService:
    """Run one persisted task while preserving its tenant and lease rules.

    CRUD requests use ``get_db`` as their request transaction. Manual
    execution is different: the allowlisted handler may have its own
    persistence transaction and the run record must be finalized after it
    returns. Dedicated, context-managed sessions keep those phases isolated
    without putting HTTP transaction code in the router.
    """

    def __init__(
        self,
        *,
        session_factory: sessionmaker[Session] | None = None,
    ):
        self.session_factory = session_factory or get_session_factory()

    def trigger(self, context: TenantContext, task_id: int) -> ScheduledTaskRunResult:
        self._authorize(context)
        with _manual_lock(context.tenant_id, task_id):
            factory = self.session_factory
            if factory.kw.get("bind").dialect.name == "sqlite":
                with factory.begin() as lock_db:
                    task = self._lock_task(lock_db, context.tenant_id, task_id)
                return self._execute(
                    tenant_id=context.tenant_id,
                    task_id=task.task_id,
                    execution_target=task.execution_target,
                )

            # PostgreSQL keeps the row lock until this context exits, so the
            # scheduled worker cannot claim the same task while its handler is
            # executing. SQLite relies on the process mutex above because a
            # read transaction would otherwise block the handler's writes.
            with factory.begin() as lock_db:
                task = self._lock_task(lock_db, context.tenant_id, task_id)
                return self._execute(
                    tenant_id=context.tenant_id,
                    task_id=task.task_id,
                    execution_target=task.execution_target,
                )

    @staticmethod
    def _authorize(context: TenantContext) -> None:
        if context.tenant_role not in {"owner", "admin"}:
            raise ForbiddenError("Tenant owner or admin role is required")

    @staticmethod
    def _lock_task(
        db: Session,
        tenant_id: int,
        task_id: int,
    ) -> TenantScheduledTask:
        task = db.scalar(
            select(TenantScheduledTask)
            .where(
                TenantScheduledTask.task_id == task_id,
                TenantScheduledTask.tenant_id == tenant_id,
                TenantScheduledTask.del_flag.is_(False),
            )
            .with_for_update()
        )
        if task is None:
            raise ScheduledTaskNotFound("Scheduled task not found")
        if not task.enabled:
            raise ScheduledTaskUnavailable("Scheduled task is disabled")

        now = datetime.now(timezone.utc)
        schedule_state = db.scalar(
            select(TenantTaskScheduleState)
            .where(
                TenantTaskScheduleState.task_id == task_id,
                TenantTaskScheduleState.tenant_id == tenant_id,
            )
            .with_for_update()
        )
        if (
            schedule_state is not None
            and schedule_state.claimed_slot_at is not None
            and schedule_state.lease_until is not None
            and _as_utc(schedule_state.lease_until) > now
        ):
            raise ScheduledTaskAlreadyRunning("Scheduled task already has an active run")
        return task

    def _execute(
        self,
        *,
        tenant_id: int,
        task_id: int,
        execution_target: str,
    ) -> ScheduledTaskRunResult:
        now = datetime.now(timezone.utc)
        run_id = self._start_run(
            tenant_id=tenant_id,
            task_id=task_id,
            execution_target=execution_target,
            slot_at=now,
        )

        succeeded = False
        summary_json: str | None = None
        error_code: str | None = None
        try:
            with self.session_factory() as dispatch_db:
                result = dispatch_tenant_task(dispatch_db, task_id, tenant_id)
                summary_json = json.dumps(
                    _safe_result_summary(execution_target, result.get("result")),
                    sort_keys=True,
                    separators=(",", ":"),
                )
            succeeded = True
        except Exception as exc:
            error_code = _safe_error_code(exc)

        return self._finish_run(
            run_id,
            succeeded=succeeded,
            summary_json=summary_json,
            error_code=error_code,
        )

    def _start_run(
        self,
        *,
        tenant_id: int,
        task_id: int,
        execution_target: str,
        slot_at: datetime,
    ) -> int:
        lease_token = str(uuid.uuid4())
        try:
            with self.session_factory.begin() as run_db:
                row = TenantScheduledTaskRun(
                    tenant_id=tenant_id,
                    task_id=task_id,
                    slot_at=slot_at,
                    claim_token_hash=hashlib.sha256(lease_token.encode("utf-8")).hexdigest(),
                    execution_target=execution_target,
                    started_at=slot_at,
                    status="running",
                )
                run_db.add(row)
                run_db.flush()
                return row.run_id
        except Exception as exc:
            raise ScheduledTaskRunRecordError("Could not create scheduled task run record") from exc

    def _finish_run(
        self,
        run_id: int,
        *,
        succeeded: bool,
        summary_json: str | None,
        error_code: str | None,
    ) -> ScheduledTaskRunResult:
        try:
            with self.session_factory.begin() as finish_db:
                row = finish_db.get(TenantScheduledTaskRun, run_id)
                if row is None:
                    raise LookupError("scheduled task run record disappeared")
                row.finished_at = datetime.now(timezone.utc)
                row.status = "succeeded" if succeeded else "failed"
                row.result_summary_json = summary_json if succeeded else None
                row.error_code = None if succeeded else (error_code or "HANDLER_ERROR")
                finish_db.flush()
                return self._result(row)
        except ScheduledTaskRunRecordError:
            raise
        except Exception as exc:
            raise ScheduledTaskRunRecordError("Could not finalize scheduled task run record") from exc

    @staticmethod
    def _result(row: TenantScheduledTaskRun) -> ScheduledTaskRunResult:
        return ScheduledTaskRunResult(
            run_id=str(row.run_id),
            tenant_id=str(row.tenant_id),
            task_id=str(row.task_id),
            slot_at=_iso(row.slot_at) or "",
            execution_target=row.execution_target,
            started_at=_iso(row.started_at) or "",
            finished_at=_iso(row.finished_at),
            status=row.status,
            result_summary=json.loads(row.result_summary_json) if row.result_summary_json else None,
            error_code=row.error_code,
        )
