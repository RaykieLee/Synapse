"""Metadata for locally stored, tenant/workspace-scoped attachments."""
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, ForeignKeyConstraint, Integer, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.database.base import Base
from app.models.user import utcnow


class Attachment(Base):
    __tablename__ = "attachments"
    __table_args__ = (
        UniqueConstraint("attachment_id", "tenant_id", name="uq_attachments_id_tenant"),
        ForeignKeyConstraint(
            ["workspace_id", "tenant_id"],
            ["workspaces.workspace_id", "workspaces.tenant_id"],
            name="fk_attachments_workspace_tenant",
        ),
    )

    attachment_id: Mapped[str] = mapped_column(String(36), primary_key=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenants.tenant_id", ondelete="CASCADE"), nullable=False, index=True)
    # Personal files remain within the Workspace context in which they were uploaded,
    # and are additionally private to owner_user_id.
    workspace_id: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    scope_kind: Mapped[str] = mapped_column(String(16), nullable=False, index=True)
    owner_user_id: Mapped[int | None] = mapped_column(ForeignKey("users.user_id", ondelete="CASCADE"), index=True)
    original_filename: Mapped[str] = mapped_column(String(255), nullable=False)
    media_type: Mapped[str] = mapped_column(String(127), nullable=False)
    size_bytes: Mapped[int] = mapped_column(Integer, nullable=False)
    storage_key: Mapped[str] = mapped_column(String(100), nullable=False, unique=True)
    created_by: Mapped[int] = mapped_column(ForeignKey("users.user_id"), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow)
