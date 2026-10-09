from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, ForeignKeyConstraint, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.database.base import Base
from app.models.user import utcnow


class Tenant(Base):
    __tablename__ = "tenants"
    tenant_id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    slug: Mapped[str] = mapped_column(String(64), nullable=False, unique=True, index=True)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="active", index=True)
    settings_json: Mapped[str] = mapped_column(Text, nullable=False, default="{}")
    membership_version: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)


class TenantMember(Base):
    __tablename__ = "tenant_members"
    __table_args__ = (UniqueConstraint("tenant_id", "user_id", name="uq_tenant_members_tenant_user"),)
    tenant_member_id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenants.tenant_id", ondelete="CASCADE"), nullable=False, index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.user_id"), nullable=False, index=True)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="active", index=True)
    tenant_role: Mapped[str] = mapped_column(String(16), nullable=False, default="member")
    joined_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)


class TenantInvitation(Base):
    __tablename__ = "tenant_invitations"
    __table_args__ = (UniqueConstraint("token_hash", name="uq_tenant_invitations_token_hash"),)
    invitation_id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenants.tenant_id", ondelete="CASCADE"), nullable=False, index=True)
    email: Mapped[str | None] = mapped_column(String(254), index=True)
    target_user_id: Mapped[int | None] = mapped_column(ForeignKey("users.user_id"), index=True)
    tenant_role: Mapped[str] = mapped_column(String(16), nullable=False, default="member")
    token_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="pending", index=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    invited_by: Mapped[int] = mapped_column(ForeignKey("users.user_id"), nullable=False)
    accepted_by: Mapped[int | None] = mapped_column(ForeignKey("users.user_id"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    accepted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class Workspace(Base):
    __tablename__ = "workspaces"
    __table_args__ = (UniqueConstraint("tenant_id", "slug", name="uq_workspaces_tenant_slug"),
                      UniqueConstraint("workspace_id", "tenant_id", name="uq_workspaces_id_tenant"))
    workspace_id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenants.tenant_id", ondelete="CASCADE"), nullable=False, index=True)
    slug: Mapped[str] = mapped_column(String(64), nullable=False)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    icon: Mapped[str | None] = mapped_column(String(64))
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="active", index=True)
    settings_json: Mapped[str] = mapped_column(Text, nullable=False, default="{}")
    created_by: Mapped[int] = mapped_column(ForeignKey("users.user_id"), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)


class WorkspaceMember(Base):
    __tablename__ = "workspace_members"
    __table_args__ = (UniqueConstraint("workspace_id", "user_id", name="uq_workspace_members_workspace_user"),
                      ForeignKeyConstraint(["workspace_id", "tenant_id"], ["workspaces.workspace_id", "workspaces.tenant_id"], name="fk_workspace_members_workspace_tenant"))
    workspace_member_id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    workspace_id: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenants.tenant_id", ondelete="CASCADE"), nullable=False, index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.user_id"), nullable=False, index=True)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="active", index=True)
    workspace_role: Mapped[str] = mapped_column(String(16), nullable=False, default="member")
    joined_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)
