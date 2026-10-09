"""Tenant-owned runtime parameter configuration."""
from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.database.base import Base
from app.models.user import utcnow


class TenantConfig(Base):
    __tablename__ = "tenant_configs"
    __table_args__ = (
        UniqueConstraint("config_id", "tenant_id", name="uq_tenant_configs_id_tenant"),
        UniqueConstraint("tenant_id", "config_key", name="uq_tenant_configs_tenant_key"),
    )

    config_id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenants.tenant_id", ondelete="CASCADE"), nullable=False, index=True)
    config_name: Mapped[str] = mapped_column(String(100), nullable=False)
    config_key: Mapped[str] = mapped_column(String(100), nullable=False)
    config_value: Mapped[str] = mapped_column(Text, nullable=False)
    group_name: Mapped[str] = mapped_column(String(100), nullable=False, default="")
    is_frontend: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    is_sensitive: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    status: Mapped[str] = mapped_column(String(1), nullable=False, default="0")
    remark: Mapped[str | None] = mapped_column(String(500))
    created_by: Mapped[int] = mapped_column(ForeignKey("users.user_id"), nullable=False)
    updated_by: Mapped[int] = mapped_column(ForeignKey("users.user_id"), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow, onupdate=utcnow)
