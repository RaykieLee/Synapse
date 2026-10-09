"""Auditable execution record for one claimed scheduled-task slot."""
from datetime import datetime

from sqlalchemy import CheckConstraint, DateTime, ForeignKeyConstraint, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.database.base import Base


class TenantScheduledTaskRun(Base):
    __tablename__ = "tenant_scheduled_task_runs"
    __table_args__ = (
        ForeignKeyConstraint(
            ["task_id", "tenant_id"],
            ["tenant_scheduled_tasks.task_id", "tenant_scheduled_tasks.tenant_id"],
            name="fk_scheduled_task_run_task_tenant",
            ondelete="CASCADE",
        ),
        CheckConstraint("status IN ('running', 'succeeded', 'failed')", name="ck_scheduled_task_run_status"),
    )

    run_id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    tenant_id: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    task_id: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    slot_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    claim_token_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    execution_target: Mapped[str] = mapped_column(String(100), nullable=False)
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, index=True)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), index=True)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="running", index=True)
    result_summary_json: Mapped[str | None] = mapped_column(Text)
    error_code: Mapped[str | None] = mapped_column(String(80))
