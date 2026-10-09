"""Tenant-owned dictionary types and values."""
from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, ForeignKeyConstraint, Integer, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.database.base import Base
from app.models.user import utcnow


class TenantDictType(Base):
    __tablename__ = "tenant_dict_types"
    __table_args__ = (
        UniqueConstraint("dict_type_id", "tenant_id", name="uq_tenant_dict_types_id_tenant"),
        UniqueConstraint("tenant_id", "dict_type", name="uq_tenant_dict_types_tenant_key"),
        UniqueConstraint("tenant_id", "dict_name", name="uq_tenant_dict_types_tenant_name"),
    )

    dict_type_id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenants.tenant_id", ondelete="CASCADE"), nullable=False, index=True)
    dict_name: Mapped[str] = mapped_column(String(100), nullable=False)
    dict_type: Mapped[str] = mapped_column(String(100), nullable=False)
    order_num: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    status: Mapped[str] = mapped_column(String(1), nullable=False, default="0")
    remark: Mapped[str | None] = mapped_column(String(500))
    created_by: Mapped[int] = mapped_column(ForeignKey("users.user_id"), nullable=False)
    updated_by: Mapped[int] = mapped_column(ForeignKey("users.user_id"), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow, onupdate=utcnow)


class TenantDictData(Base):
    __tablename__ = "tenant_dict_data"
    __table_args__ = (
        UniqueConstraint("dict_data_id", "tenant_id", name="uq_tenant_dict_data_id_tenant"),
        UniqueConstraint("tenant_id", "dict_type_id", "dict_value", name="uq_tenant_dict_data_type_value"),
        ForeignKeyConstraint(
            ["dict_type_id", "tenant_id"],
            ["tenant_dict_types.dict_type_id", "tenant_dict_types.tenant_id"],
            name="fk_tenant_dict_data_type_tenant",
            ondelete="CASCADE",
        ),
    )

    dict_data_id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenants.tenant_id", ondelete="CASCADE"), nullable=False, index=True)
    dict_type_id: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    dict_sort: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    dict_label: Mapped[str] = mapped_column(String(100), nullable=False)
    dict_value: Mapped[str] = mapped_column(String(100), nullable=False)
    css_class: Mapped[str | None] = mapped_column(String(100))
    list_class: Mapped[str | None] = mapped_column(String(100))
    is_default: Mapped[str] = mapped_column(String(1), nullable=False, default="N")
    status: Mapped[str] = mapped_column(String(1), nullable=False, default="0")
    remark: Mapped[str | None] = mapped_column(String(500))
    created_by: Mapped[int] = mapped_column(ForeignKey("users.user_id"), nullable=False)
    updated_by: Mapped[int] = mapped_column(ForeignKey("users.user_id"), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow, onupdate=utcnow)
