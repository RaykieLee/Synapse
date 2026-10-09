"""Tenant-owned navigation/menu metadata, separate from system navigation."""
from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, ForeignKeyConstraint, Integer, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.database.base import Base
from app.models.user import utcnow


class TenantMenu(Base):
    __tablename__ = "tenant_menus"
    __table_args__ = (
        UniqueConstraint("menu_id", "tenant_id", name="uq_tenant_menus_id_tenant"),
        ForeignKeyConstraint(
            ["parent_id", "tenant_id"],
            ["tenant_menus.menu_id", "tenant_menus.tenant_id"],
            name="fk_tenant_menus_parent_tenant",
        ),
    )

    menu_id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenants.tenant_id", ondelete="CASCADE"), nullable=False, index=True)
    parent_id: Mapped[int | None] = mapped_column(Integer, nullable=True, index=True)
    menu_name: Mapped[str] = mapped_column(String(50), nullable=False)
    order_num: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    path: Mapped[str] = mapped_column(String(200), nullable=False, default="")
    component: Mapped[str | None] = mapped_column(String(255))
    query: Mapped[str | None] = mapped_column(String(255))
    is_frame: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    is_cache: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    menu_type: Mapped[str] = mapped_column(String(1), nullable=False, default="M")
    visible: Mapped[str] = mapped_column(String(1), nullable=False, default="0")
    status: Mapped[str] = mapped_column(String(1), nullable=False, default="0")
    perms: Mapped[str | None] = mapped_column(String(100))
    icon: Mapped[str] = mapped_column(String(100), nullable=False, default="#")
    remark: Mapped[str | None] = mapped_column(String(500))
    del_flag: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, index=True)
    created_by: Mapped[int] = mapped_column(ForeignKey("users.user_id"), nullable=False)
    updated_by: Mapped[int] = mapped_column(ForeignKey("users.user_id"), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow, onupdate=utcnow)
