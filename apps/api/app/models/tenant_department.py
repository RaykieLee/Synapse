"""Tenant-owned department hierarchy, independent of global users."""
from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, ForeignKeyConstraint, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.database.base import Base
from app.models.user import utcnow


class TenantDepartment(Base):
    __tablename__ = "tenant_departments"
    __table_args__ = (
        UniqueConstraint("department_id", "tenant_id", name="uq_tenant_departments_id_tenant"),
        ForeignKeyConstraint(
            ["parent_id", "tenant_id"],
            ["tenant_departments.department_id", "tenant_departments.tenant_id"],
            name="fk_tenant_departments_parent_tenant",
        ),
    )

    department_id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenants.tenant_id", ondelete="CASCADE"), nullable=False, index=True)
    parent_id: Mapped[int | None] = mapped_column(Integer, nullable=True, index=True)
    ancestors: Mapped[str] = mapped_column(Text, nullable=False, default="0")
    dept_name: Mapped[str] = mapped_column(String(30), nullable=False, default="")
    order_num: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    leader: Mapped[str | None] = mapped_column(String(20))
    phone: Mapped[str | None] = mapped_column(String(11))
    email: Mapped[str | None] = mapped_column(String(50))
    status: Mapped[str] = mapped_column(String(1), nullable=False, default="0")
    del_flag: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, index=True)
    created_by: Mapped[int] = mapped_column(ForeignKey("users.user_id"), nullable=False)
    updated_by: Mapped[int] = mapped_column(ForeignKey("users.user_id"), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow, onupdate=utcnow)
