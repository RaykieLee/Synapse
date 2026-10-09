"""Custom role definitions scoped to one tenant."""
from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.database.base import Base
from app.models.user import utcnow


class TenantRole(Base):
    __tablename__ = "tenant_roles"
    __table_args__ = (
        UniqueConstraint("role_id", "tenant_id", name="uq_tenant_roles_id_tenant"),
        UniqueConstraint("tenant_id", "role_key", name="uq_tenant_roles_tenant_key"),
        UniqueConstraint("tenant_id", "role_name", name="uq_tenant_roles_tenant_name"),
    )

    role_id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    tenant_id: Mapped[int] = mapped_column(
        ForeignKey("tenants.tenant_id", ondelete="CASCADE"), nullable=False, index=True,
    )
    role_name: Mapped[str] = mapped_column(String(30), nullable=False)
    role_key: Mapped[str] = mapped_column(String(64), nullable=False)
    role_sort: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="active", index=True)
    permissions_json: Mapped[str] = mapped_column(Text, nullable=False, default="[]")
    remark: Mapped[str | None] = mapped_column(String(500))
    del_flag: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, index=True)
    created_by: Mapped[int] = mapped_column(ForeignKey("users.user_id"), nullable=False)
    updated_by: Mapped[int] = mapped_column(ForeignKey("users.user_id"), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)
