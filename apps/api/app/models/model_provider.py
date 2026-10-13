"""Workspace model provider, credential, and model binding records."""

from datetime import datetime

from sqlalchemy import (
    DateTime,
    ForeignKey,
    ForeignKeyConstraint,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.database.base import Base
from app.models.user import utcnow


class ModelCredential(Base):
    __tablename__ = "model_credentials"
    __table_args__ = (
        UniqueConstraint(
            "credential_id",
            "tenant_id",
            "workspace_id",
            name="uq_model_credentials_id_tenant_workspace",
        ),
        UniqueConstraint(
            "credential_id",
            "tenant_id",
            name="uq_model_credentials_id_tenant",
        ),
        ForeignKeyConstraint(
            ["workspace_id", "tenant_id"],
            ["workspaces.workspace_id", "workspaces.tenant_id"],
            name="fk_model_credentials_workspace_tenant",
        ),
    )

    credential_id: Mapped[str] = mapped_column(String(36), primary_key=True)
    tenant_id: Mapped[int] = mapped_column(
        ForeignKey("tenants.tenant_id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    workspace_id: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    owner_user_id: Mapped[int] = mapped_column(
        ForeignKey("users.user_id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    provider_type: Mapped[str] = mapped_column(String(64), nullable=False)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    base_url: Mapped[str] = mapped_column(String(500), nullable=False)
    organization: Mapped[str | None] = mapped_column(String(200))
    encrypted_api_key: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utcnow
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utcnow, onupdate=utcnow
    )


class ModelBinding(Base):
    __tablename__ = "model_bindings"
    __table_args__ = (
        UniqueConstraint(
            "model_binding_id",
            "tenant_id",
            name="uq_model_bindings_id_tenant",
        ),
        UniqueConstraint(
            "workspace_id",
            "tenant_id",
            "display_name",
            name="uq_model_bindings_workspace_name",
        ),
        ForeignKeyConstraint(
            ["workspace_id", "tenant_id"],
            ["workspaces.workspace_id", "workspaces.tenant_id"],
            name="fk_model_bindings_workspace_tenant",
        ),
        ForeignKeyConstraint(
            ["credential_id", "tenant_id", "workspace_id"],
            [
                "model_credentials.credential_id",
                "model_credentials.tenant_id",
                "model_credentials.workspace_id",
            ],
            name="fk_model_bindings_credential_scope",
        ),
    )

    model_binding_id: Mapped[str] = mapped_column(String(36), primary_key=True)
    tenant_id: Mapped[int] = mapped_column(
        ForeignKey("tenants.tenant_id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    workspace_id: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    credential_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    display_name: Mapped[str] = mapped_column(String(100), nullable=False)
    kind: Mapped[str] = mapped_column(String(32), nullable=False, default="chat")
    provider_type: Mapped[str] = mapped_column(String(64), nullable=False)
    model: Mapped[str] = mapped_column(String(200), nullable=False)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="active")
    capabilities_json: Mapped[str] = mapped_column(Text, nullable=False, default="{}")
    default_parameters_json: Mapped[str] = mapped_column(Text, nullable=False, default="{}")
    created_by: Mapped[int] = mapped_column(ForeignKey("users.user_id"), nullable=False)
    updated_by: Mapped[int] = mapped_column(ForeignKey("users.user_id"), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utcnow
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utcnow, onupdate=utcnow
    )
