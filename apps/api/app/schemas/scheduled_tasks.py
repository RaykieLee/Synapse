"""HTTP response models for scheduled-task execution records."""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict


class ScheduledTaskRunResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    run_id: str
    tenant_id: str
    task_id: str
    slot_at: str
    execution_target: str
    started_at: str
    finished_at: str | None
    status: Literal["running", "succeeded", "failed"]
    result_summary: dict[str, Any] | None
    error_code: str | None
