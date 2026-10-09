"""Tenant-scoped custom role to menu authorization associations."""
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, ForeignKeyConstraint, Integer, PrimaryKeyConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.database.base import Base
from app.models.user import utcnow


class TenantRoleMenu(Base):
    __tablename__ = "tenant_role_menus"
    __table_args__ = (
        PrimaryKeyConstraint("tenant_id", "role_id", "menu_id", name="pk_tenant_role_menus"),
        ForeignKeyConstraint(
            ["role_id", "tenant_id"],
            ["tenant_roles.role_id", "tenant_roles.tenant_id"],
            name="fk_tenant_role_menus_role_tenant",
            ondelete="CASCADE",
        ),
        ForeignKeyConstraint(
            ["menu_id", "tenant_id"],
            ["tenant_menus.menu_id", "tenant_menus.tenant_id"],
            name="fk_tenant_role_menus_menu_tenant",
            ondelete="CASCADE",
        ),
    )

    tenant_id: Mapped[int] = mapped_column(Integer, nullable=False)
    role_id: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    menu_id: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    created_by: Mapped[int] = mapped_column(ForeignKey("users.user_id"), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow)
