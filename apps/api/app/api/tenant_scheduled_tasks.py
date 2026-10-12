"""Tenant-scoped scheduled task definition and run HTTP endpoints."""
import json
from datetime import datetime, timezone
from typing import Literal
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from croniter import croniter
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator, model_validator
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.database.session import get_db
from app.models.tenant_scheduled_task_run import TenantScheduledTaskRun
from app.models.tenant_scheduled_task import TenantScheduledTask
from app.schemas.scheduled_tasks import ScheduledTaskRunResponse
from app.services.scheduled_tasks import ManualScheduledTaskService
from app.task_targets import SCHEDULED_TASK_TARGETS
from app.tenancy.context import TenantContext, get_tenant_context
from app.tenancy.scopes import tenant_scope

router = APIRouter(prefix="/tenants/{tenant_id}/scheduled-tasks", tags=["scheduled tasks"])
INTERVAL_SECONDS = {"seconds": 1, "minutes": 60, "hours": 3600, "days": 86400, "weeks": 604800}
MAX_INTERVAL_SECONDS = 365 * 86400
MIN_INTERVAL_SECONDS = 10


class TaskSpec(BaseModel):
    model_config = ConfigDict(extra="forbid")
    task_name: str = Field(min_length=1, max_length=120)
    description: str | None = Field(default=None, max_length=1000)
    execution_target: str = Field(min_length=1, max_length=100)
    parameters: dict[str, str | int | float | bool | None] = Field(default_factory=dict, max_length=32)
    schedule_type: Literal["cron", "interval"]
    cron_expression: str | None = Field(default=None, max_length=120)
    interval_value: int | None = Field(default=None, ge=1, le=31_536_000)
    interval_unit: Literal["seconds", "minutes", "hours", "days", "weeks"] | None = None
    timezone: str = Field(default="UTC", min_length=1, max_length=64)

    @field_validator("task_name")
    @classmethod
    def task_name_not_blank(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("Task name cannot be blank")
        return value

    @field_validator("execution_target")
    @classmethod
    def target_is_allowlisted(cls, value: str) -> str:
        if value not in SCHEDULED_TASK_TARGETS:
            raise ValueError("Execution target is not allowlisted")
        return value

    @field_validator("timezone")
    @classmethod
    def timezone_is_known(cls, value: str) -> str:
        try:
            ZoneInfo(value)
        except (ZoneInfoNotFoundError, ValueError) as exc:
            raise ValueError("Timezone must be a known IANA timezone") from exc
        return value

    @field_validator("parameters")
    @classmethod
    def parameters_are_bounded_json(cls, value: dict[str, str | int | float | bool | None]) -> dict[str, str | int | float | bool | None]:
        encoded = json.dumps(value, ensure_ascii=False, separators=(",", ":"), allow_nan=False)
        if len(encoded.encode("utf-8")) > 8192:
            raise ValueError("Parameters must not exceed 8 KiB")
        return value

    @model_validator(mode="after")
    def validate_schedule(self):
        if self.schedule_type == "cron":
            if self.interval_value is not None or self.interval_unit is not None:
                raise ValueError("Cron schedules cannot include interval fields")
            expression = (self.cron_expression or "").strip()
            if len(expression.split()) != 5 or not croniter.is_valid(expression):
                raise ValueError("Cron expression must be a valid five-field expression")
            self.cron_expression = expression
        else:
            if self.cron_expression is not None:
                raise ValueError("Interval schedules cannot include a cron expression")
            if self.interval_value is None or self.interval_unit is None:
                raise ValueError("Interval schedules require interval_value and interval_unit")
            seconds = self.interval_value * INTERVAL_SECONDS[self.interval_unit]
            if not MIN_INTERVAL_SECONDS <= seconds <= MAX_INTERVAL_SECONDS:
                raise ValueError("Interval must be between 10 seconds and 365 days")
        return self


class TaskCreate(TaskSpec):
    enabled: bool = True


class TaskPatch(BaseModel):
    model_config = ConfigDict(extra="forbid")
    task_name: str | None = Field(default=None, min_length=1, max_length=120)
    description: str | None = Field(default=None, max_length=1000)
    execution_target: str | None = Field(default=None, min_length=1, max_length=100)
    parameters: dict[str, str | int | float | bool | None] | None = Field(default=None, max_length=32)
    schedule_type: Literal["cron", "interval"] | None = None
    cron_expression: str | None = Field(default=None, max_length=120)
    interval_value: int | None = Field(default=None, ge=1, le=31_536_000)
    interval_unit: Literal["seconds", "minutes", "hours", "days", "weeks"] | None = None
    timezone: str | None = Field(default=None, min_length=1, max_length=64)
    enabled: bool | None = None

    @field_validator("task_name")
    @classmethod
    def patch_name_not_blank(cls, value: str | None) -> str | None:
        if value is not None and not value.strip():
            raise ValueError("Task name cannot be blank")
        return value.strip() if value is not None else None


def _fail(status: int, code: str) -> None:
    raise HTTPException(status_code=status, detail={"code": code})


def _authorize(context: TenantContext) -> None:
    if context.tenant_role not in {"owner", "admin"}:
        _fail(403, "FORBIDDEN")


def _scope(context: TenantContext, task_id: int | None = None, *, include_deleted: bool = False):
    statement = tenant_scope(select(TenantScheduledTask), TenantScheduledTask, context)
    if not include_deleted:
        statement = statement.where(TenantScheduledTask.del_flag.is_(False))
    if task_id is not None:
        statement = statement.where(TenantScheduledTask.task_id == task_id)
    return statement


def _get_task(db: Session, context: TenantContext, task_id: int) -> TenantScheduledTask:
    task = db.scalar(_scope(context, task_id))
    if task is None:
        _fail(404, "RESOURCE_NOT_FOUND")
    return task


def _iso(value: datetime | None) -> str | None:
    if value is None:
        return None
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    else:
        value = value.astimezone(timezone.utc)
    return value.isoformat()


def _data(task: TenantScheduledTask) -> dict:
    return {
        "task_id": str(task.task_id),
        "tenant_id": str(task.tenant_id),
        "task_name": task.task_name,
        "description": task.description,
        "execution_target": task.execution_target,
        "parameters": json.loads(task.parameters_json or "{}"),
        "schedule_type": task.schedule_type,
        "cron_expression": task.cron_expression,
        "interval_value": task.interval_value,
        "interval_unit": task.interval_unit,
        "timezone": task.timezone,
        "enabled": task.enabled,
        "created_by": str(task.created_by),
        "updated_by": str(task.updated_by),
        "created_at": _iso(task.created_at),
        "updated_at": _iso(task.updated_at),
    }


def _run_data(run: TenantScheduledTaskRun) -> dict:
    return {
        "run_id": str(run.run_id),
        "tenant_id": str(run.tenant_id),
        "task_id": str(run.task_id),
        "slot_at": _iso(run.slot_at),
        "execution_target": run.execution_target,
        "started_at": _iso(run.started_at),
        "finished_at": _iso(run.finished_at),
        "status": run.status,
        "result_summary": json.loads(run.result_summary_json) if run.result_summary_json else None,
        "error_code": run.error_code,
    }


def _ensure_unique_name(db: Session, context: TenantContext, name: str, exclude_id: int | None = None) -> None:
    statement = tenant_scope(select(TenantScheduledTask.task_id).where(
        TenantScheduledTask.task_name == name,
    ), TenantScheduledTask, context)
    if exclude_id is not None:
        statement = statement.where(TenantScheduledTask.task_id != exclude_id)
    if db.scalar(statement) is not None:
        _fail(409, "TASK_NAME_CONFLICT")


def _values(spec: TaskSpec) -> dict:
    data = spec.model_dump()
    data["parameters_json"] = json.dumps(data.pop("parameters"), ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return data


@router.get("/targets")
def list_allowed_targets(context: TenantContext = Depends(get_tenant_context)):
    _authorize(context)
    return {"items": [{"target_id": target_id, **metadata} for target_id, metadata in SCHEDULED_TASK_TARGETS.items()]}


@router.get("")
def list_scheduled_tasks(
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
    task_name: str | None = Query(default=None, max_length=120),
    execution_target: str | None = Query(default=None, max_length=100),
    schedule_type: Literal["cron", "interval"] | None = None,
    enabled: bool | None = None,
    context: TenantContext = Depends(get_tenant_context),
    db: Session = Depends(get_db),
):
    _authorize(context)
    statement = _scope(context)
    if task_name:
        statement = statement.where(TenantScheduledTask.task_name.contains(task_name.strip()))
    if execution_target:
        statement = statement.where(TenantScheduledTask.execution_target == execution_target)
    if schedule_type:
        statement = statement.where(TenantScheduledTask.schedule_type == schedule_type)
    if enabled is not None:
        statement = statement.where(TenantScheduledTask.enabled.is_(enabled))
    total = db.scalar(select(func.count()).select_from(statement.subquery())) or 0
    rows = db.scalars(statement.order_by(TenantScheduledTask.task_id.desc())
                      .offset((page - 1) * page_size).limit(page_size)).all()
    return {"items": [_data(task) for task in rows], "total": total, "page": page, "page_size": page_size}


@router.post("", status_code=201)
def create_scheduled_task(
    body: TaskCreate,
    context: TenantContext = Depends(get_tenant_context),
    db: Session = Depends(get_db),
):
    _authorize(context)
    _ensure_unique_name(db, context, body.task_name)
    values = _values(body)
    now = datetime.now(timezone.utc)
    task = TenantScheduledTask(
        **values,
        tenant_id=context.tenant_id,
        created_by=context.actor_user_id,
        updated_by=context.actor_user_id,
        created_at=now,
        updated_at=now,
    )
    db.add(task)
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail={"code": "TASK_NAME_CONFLICT"}) from exc
    db.refresh(task)
    return _data(task)


@router.get("/{task_id}")
def get_scheduled_task(
    task_id: int,
    context: TenantContext = Depends(get_tenant_context),
    db: Session = Depends(get_db),
):
    _authorize(context)
    return _data(_get_task(db, context, task_id))


@router.get("/{task_id}/runs")
def list_scheduled_task_runs(
    task_id: int,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
    status: Literal["running", "succeeded", "failed"] | None = None,
    started_from: datetime | None = None,
    started_to: datetime | None = None,
    context: TenantContext = Depends(get_tenant_context),
    db: Session = Depends(get_db),
):
    _authorize(context)
    if db.scalar(_scope(context, task_id, include_deleted=True)) is None:
        _fail(404, "RESOURCE_NOT_FOUND")
    if started_from and started_to and started_from > started_to:
        _fail(422, "VALIDATION_ERROR")
    statement = select(TenantScheduledTaskRun).where(
        TenantScheduledTaskRun.tenant_id == context.tenant_id,
        TenantScheduledTaskRun.task_id == task_id,
    )
    if status:
        statement = statement.where(TenantScheduledTaskRun.status == status)
    if started_from:
        statement = statement.where(TenantScheduledTaskRun.started_at >= started_from)
    if started_to:
        statement = statement.where(TenantScheduledTaskRun.started_at <= started_to)
    total = db.scalar(select(func.count()).select_from(statement.subquery())) or 0
    rows = db.scalars(
        statement.order_by(TenantScheduledTaskRun.started_at.desc(), TenantScheduledTaskRun.run_id.desc())
        .offset((page - 1) * page_size).limit(page_size)
    ).all()
    return {"items": [_run_data(run) for run in rows], "total": total, "page": page, "page_size": page_size}


@router.get("/{task_id}/runs/{run_id}")
def get_scheduled_task_run(
    task_id: int,
    run_id: int,
    context: TenantContext = Depends(get_tenant_context),
    db: Session = Depends(get_db),
):
    _authorize(context)
    if db.scalar(_scope(context, task_id, include_deleted=True)) is None:
        _fail(404, "RESOURCE_NOT_FOUND")
    run = db.scalar(select(TenantScheduledTaskRun).where(
        TenantScheduledTaskRun.run_id == run_id,
        TenantScheduledTaskRun.tenant_id == context.tenant_id,
        TenantScheduledTaskRun.task_id == task_id,
    ))
    if run is None:
        _fail(404, "RESOURCE_NOT_FOUND")
    return _run_data(run)


def get_manual_scheduled_task_service() -> ManualScheduledTaskService:
    return ManualScheduledTaskService()


@router.post("/{task_id}/runs", status_code=201, response_model=ScheduledTaskRunResponse)
def trigger_scheduled_task(
    task_id: int,
    context: TenantContext = Depends(get_tenant_context),
    service: ManualScheduledTaskService = Depends(get_manual_scheduled_task_service),
):
    return service.trigger(context, task_id)


@router.patch("/{task_id}")
def update_scheduled_task(
    task_id: int,
    body: TaskPatch,
    context: TenantContext = Depends(get_tenant_context),
    db: Session = Depends(get_db),
):
    _authorize(context)
    task = _get_task(db, context, task_id)
    fields = body.model_dump(exclude_unset=True)
    if not fields:
        return _data(task)
    if "task_name" in fields:
        _ensure_unique_name(db, context, fields["task_name"], task_id)
    mutable_fields = {key: value for key, value in fields.items() if key != "enabled"}
    if mutable_fields:
        current = {
            "task_name": task.task_name,
            "description": task.description,
            "execution_target": task.execution_target,
            "parameters": json.loads(task.parameters_json or "{}"),
            "schedule_type": task.schedule_type,
            "cron_expression": task.cron_expression,
            "interval_value": task.interval_value,
            "interval_unit": task.interval_unit,
            "timezone": task.timezone,
        }
        current.update(mutable_fields)
        try:
            spec = TaskSpec.model_validate(current)
        except ValidationError as exc:
            problems = []
            for issue in exc.errors(include_url=False):
                field_name = ".".join(str(part) for part in issue.get("loc", ())) or "schedule"
                problems.append(f"{field_name}: {issue.get('msg', 'invalid value')}")
            detail = "; ".join(problems) or "Task definition is invalid"
            raise HTTPException(
                status_code=422,
                detail={"code": "VALIDATION_ERROR", "detail": f"Invalid task definition: {detail}"},
            ) from exc
        for key, value in _values(spec).items():
            setattr(task, key, value)
    if "enabled" in fields:
        if fields["enabled"] is None:
            _fail(422, "VALIDATION_ERROR")
        task.enabled = fields["enabled"]
    task.updated_by = context.actor_user_id
    task.updated_at = datetime.now(timezone.utc)
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail={"code": "TASK_NAME_CONFLICT"}) from exc
    db.refresh(task)
    return _data(task)


@router.delete("/{task_id}", status_code=204)
def delete_scheduled_task(
    task_id: int,
    context: TenantContext = Depends(get_tenant_context),
    db: Session = Depends(get_db),
):
    _authorize(context)
    task = _get_task(db, context, task_id)
    task.del_flag = True
    task.enabled = False
    task.updated_by = context.actor_user_id
    task.updated_at = datetime.now(timezone.utc)
    db.commit()
    return None
