"""Internal dispatcher for persisted, explicitly allowlisted tenant tasks."""
import json
from collections.abc import Callable
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.tenant_scheduled_task import TenantScheduledTask
from app.tasks.attachments import reconcile_attachment_metadata
from app.tasks.resource_summary import refresh_resource_summary
from app.tasks.tenant_invitations import expire_pending_invitations


class TaskDispatchError(Exception):
    """Controlled rejection of an invalid or unavailable persisted task."""

    def __init__(self, code: str, message: str):
        self.code = code
        super().__init__(message)


def _dispatch_expire_invitations(db: Session, tenant_id: int) -> dict[str, Any]:
    return {"expired_count": expire_pending_invitations(db, tenant_id)}


_HANDLERS: dict[str, Callable[[Session, int], dict[str, Any]]] = {
    "tenant.expire_pending_invitations": _dispatch_expire_invitations,
    "tenant.reconcile_attachment_metadata": reconcile_attachment_metadata,
    "tenant.refresh_resource_summary": refresh_resource_summary,
}


def dispatch_tenant_task(db: Session, task_id: int, tenant_id: int) -> dict[str, Any]:
    """Execute one enabled persisted task under its stored tenant scope.

    Both identifiers must be supplied by trusted internal scheduling context.
    This function never accepts a handler name or callable from the caller.
    """
    if type(task_id) is not int or task_id < 1 or type(tenant_id) is not int or tenant_id < 1:
        raise TaskDispatchError("invalid_invocation", "task_id and tenant_id must be positive integers")

    task = db.scalar(
        select(TenantScheduledTask).where(
            TenantScheduledTask.task_id == task_id,
            TenantScheduledTask.tenant_id == tenant_id,
        )
    )
    if task is None:
        raise TaskDispatchError("task_not_found", "scheduled task does not exist in the requested tenant")
    if task.del_flag or not task.enabled:
        raise TaskDispatchError("task_unavailable", "scheduled task is disabled or deleted")

    handler = _HANDLERS.get(task.execution_target)
    if handler is None:
        raise TaskDispatchError("unsupported_target", "scheduled task target is not supported")

    try:
        parameters = json.loads(task.parameters_json or "{}")
    except (TypeError, json.JSONDecodeError) as exc:
        raise TaskDispatchError("invalid_parameters", "scheduled task parameters are not valid JSON") from exc
    if not isinstance(parameters, dict) or parameters:
        raise TaskDispatchError(
            "invalid_parameters",
            "this scheduled task target does not accept parameters; expected an empty JSON object",
        )

    result = handler(db, tenant_id)
    return {
        "task_id": str(task.task_id),
        "tenant_id": str(task.tenant_id),
        "execution_target": task.execution_target,
        "status": "succeeded",
        "result": result,
    }
