"""Persisted result of the allowlisted tenant resource summary handler."""
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.database.base import Base


class TenantResourceSummary(Base):
    __tablename__ = "tenant_resource_summaries"

    tenant_id: Mapped[int] = mapped_column(
        ForeignKey("tenants.tenant_id", ondelete="CASCADE"), primary_key=True,
    )
    counts_json: Mapped[str] = mapped_column(Text, nullable=False)
    schema_version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    refreshed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
