"""Synapse-owned durable team orchestration projections."""

from datetime import datetime

from sqlalchemy import (
    DateTime,
    ForeignKey,
    ForeignKeyConstraint,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.database.base import Base
from app.models.user import utcnow


class TeamDefinition(Base):
    __tablename__ = "team_definitions"
    __table_args__ = (
        UniqueConstraint("workspace_id", "created_by", "name", name="uq_team_definitions_workspace_actor_name"),
        UniqueConstraint("team_id", "tenant_id", "workspace_id", name="uq_team_definitions_scope"),
        ForeignKeyConstraint(
            ["workspace_id", "tenant_id"],
            ["workspaces.workspace_id", "workspaces.tenant_id"],
            name="fk_team_definitions_workspace_tenant",
        ),
    )

    team_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenants.tenant_id", ondelete="CASCADE"), nullable=False, index=True)
    workspace_id: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    created_by: Mapped[int] = mapped_column(ForeignKey("users.user_id"), nullable=False, index=True)
    updated_by: Mapped[int] = mapped_column(ForeignKey("users.user_id"), nullable=False)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False, default="")
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="draft", index=True)
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)


class TeamMemberDefinition(Base):
    __tablename__ = "team_member_definitions"
    __table_args__ = (
        UniqueConstraint("member_id", "team_id", name="uq_team_member_definition_scope"),
    )

    member_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    team_id: Mapped[str] = mapped_column(ForeignKey("team_definitions.team_id", ondelete="CASCADE"), nullable=False, index=True)
    agent_id: Mapped[str] = mapped_column(String(128), nullable=False)
    role: Mapped[str] = mapped_column(String(120), nullable=False, default="")
    is_leader: Mapped[bool] = mapped_column(nullable=False, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class TeamTaskDefinition(Base):
    __tablename__ = "team_task_definitions"
    __table_args__ = (
        ForeignKeyConstraint(
            ["owner_member_id", "team_id"],
            ["team_member_definitions.member_id", "team_member_definitions.team_id"],
            name="fk_team_task_owner_scope",
        ),
    )

    task_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    team_id: Mapped[str] = mapped_column(ForeignKey("team_definitions.team_id", ondelete="CASCADE"), primary_key=True, index=True)
    subject: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False, default="")
    owner_member_id: Mapped[str] = mapped_column(String(64), nullable=False)
    depends_on_json: Mapped[str] = mapped_column(Text, nullable=False, default="[]")
    allow_failure: Mapped[bool] = mapped_column(nullable=False, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class TeamRun(Base):
    __tablename__ = "team_runs"
    __table_args__ = (
        UniqueConstraint("team_id", "idempotency_key", name="uq_team_runs_team_idempotency"),
        ForeignKeyConstraint(
            ["team_id", "tenant_id", "workspace_id"],
            ["team_definitions.team_id", "team_definitions.tenant_id", "team_definitions.workspace_id"],
            name="fk_team_runs_team_scope",
            ondelete="CASCADE",
        ),
        ForeignKeyConstraint(
            ["workspace_id", "tenant_id"],
            ["workspaces.workspace_id", "workspaces.tenant_id"],
            name="fk_team_runs_workspace_tenant",
            ondelete="CASCADE",
        ),
        Index(
            "uq_team_runs_one_active",
            "team_id",
            unique=True,
            sqlite_where=text(
                "status IN ('preparing', 'running', 'interrupt_requested')"
            ),
            postgresql_where=text(
                "status IN ('preparing', 'running', 'interrupt_requested')"
            ),
        ),
    )

    run_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    team_id: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenants.tenant_id", ondelete="CASCADE"), nullable=False, index=True)
    workspace_id: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    created_by: Mapped[int] = mapped_column(ForeignKey("users.user_id"), nullable=False)
    team_version: Mapped[int] = mapped_column(Integer, nullable=False)
    run_version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="preparing", index=True)
    idempotency_key: Mapped[str] = mapped_column(String(200), nullable=False)
    snapshot_json: Mapped[str] = mapped_column(Text, nullable=False)
    events_json: Mapped[str] = mapped_column(Text, nullable=False, default="[]")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)
