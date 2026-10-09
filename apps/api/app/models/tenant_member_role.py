"""Assignment of one custom tenant role to a tenant member."""
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, ForeignKeyConstraint, Integer, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.database.base import Base
from app.models.user import utcnow


class TenantMemberRole(Base):
    __tablename__ = "tenant_member_roles"
    __table_args__ = (
        UniqueConstraint("tenant_id", "user_id", name="uq_tenant_member_roles_member"),
        ForeignKeyConstraint(
            ["tenant_id", "user_id"],
            ["tenant_members.tenant_id", "tenant_members.user_id"],
            name="fk_tenant_member_roles_member",
            ondelete="CASCADE",
        ),
        ForeignKeyConstraint(
            ["role_id", "tenant_id"],
            ["tenant_roles.role_id", "tenant_roles.tenant_id"],
            name="fk_tenant_member_roles_role_tenant",
            ondelete="CASCADE",
        ),
    )

    assignment_id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    tenant_id: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    user_id: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    role_id: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    assigned_by: Mapped[int] = mapped_column(ForeignKey("users.user_id"), nullable=False)
    assigned_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)
