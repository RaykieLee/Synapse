"""Tenant-owned scheduled task definitions; execution is handled by F18b."""
from datetime import datetime

from sqlalchemy import Boolean, CheckConstraint, DateTime, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.database.base import Base
from app.models.user import utcnow


class TenantScheduledTask(Base):
    __tablename__ = "tenant_scheduled_tasks"
    __table_args__ = (
        UniqueConstraint("task_id", "tenant_id", name="uq_tenant_scheduled_tasks_id_tenant"),
        UniqueConstraint("tenant_id", "task_name", name="uq_tenant_scheduled_tasks_tenant_name"),
        CheckConstraint(
            "execution_target IN ('tenant.expire_pending_invitations', 'tenant.reconcile_attachment_metadata', 'tenant.refresh_resource_summary')",
            name="ck_tenant_scheduled_tasks_target_allowlist",
        ),
        CheckConstraint("schedule_type IN ('cron', 'interval')", name="ck_tenant_scheduled_tasks_schedule_type"),
        CheckConstraint(
            "(schedule_type = 'cron' AND cron_expression IS NOT NULL AND interval_value IS NULL AND interval_unit IS NULL) OR "
            "(schedule_type = 'interval' AND cron_expression IS NULL AND interval_value IS NOT NULL AND interval_unit IS NOT NULL)",
            name="ck_tenant_scheduled_tasks_schedule_fields",
        ),
        CheckConstraint("interval_unit IS NULL OR interval_unit IN ('seconds', 'minutes', 'hours', 'days', 'weeks')",
                        name="ck_tenant_scheduled_tasks_interval_unit"),
        CheckConstraint("interval_value IS NULL OR interval_value > 0", name="ck_tenant_scheduled_tasks_interval_value"),
        CheckConstraint("del_flag IN (0, 1)", name="ck_tenant_scheduled_tasks_del_flag"),
    )

    task_id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenants.tenant_id", ondelete="CASCADE"), nullable=False, index=True)
    task_name: Mapped[str] = mapped_column(String(120), nullable=False)
    description: Mapped[str | None] = mapped_column(String(1000))
    execution_target: Mapped[str] = mapped_column(String(100), nullable=False, index=True)
    parameters_json: Mapped[str] = mapped_column(Text, nullable=False, default="{}")
    schedule_type: Mapped[str] = mapped_column(String(16), nullable=False)
    cron_expression: Mapped[str | None] = mapped_column(String(120))
    interval_value: Mapped[int | None] = mapped_column(Integer)
    interval_unit: Mapped[str | None] = mapped_column(String(16))
    timezone: Mapped[str] = mapped_column(String(64), nullable=False, default="UTC")
    enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, index=True)
    del_flag: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, index=True)
    created_by: Mapped[int] = mapped_column(ForeignKey("users.user_id"), nullable=False)
    updated_by: Mapped[int] = mapped_column(ForeignKey("users.user_id"), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow, onupdate=utcnow)
