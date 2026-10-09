"""Persistent next-run and lease state for tenant scheduled task definitions."""
from datetime import datetime

from sqlalchemy import DateTime, ForeignKeyConstraint, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.database.base import Base


class TenantTaskScheduleState(Base):
    __tablename__ = "tenant_task_schedule_states"
    __table_args__ = (
        ForeignKeyConstraint(
            ["task_id", "tenant_id"],
            ["tenant_scheduled_tasks.task_id", "tenant_scheduled_tasks.tenant_id"],
            name="fk_task_schedule_state_task_tenant",
            ondelete="CASCADE",
        ),
    )

    task_id: Mapped[int] = mapped_column(Integer, primary_key=True)
    tenant_id: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    definition_fingerprint: Mapped[str] = mapped_column(String(64), nullable=False)
    next_run_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), index=True)
    claimed_slot_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    lease_owner: Mapped[str | None] = mapped_column(String(160))
    lease_token: Mapped[str | None] = mapped_column(String(36), unique=True)
    lease_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
