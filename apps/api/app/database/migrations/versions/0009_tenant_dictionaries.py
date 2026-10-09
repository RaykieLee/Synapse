"""Add tenant-scoped dictionary types and values."""
from alembic import op
import sqlalchemy as sa


revision = "0009_tenant_dictionaries"
down_revision = "0008_tenant_departments"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "tenant_dict_types",
        sa.Column("dict_type_id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("tenant_id", sa.Integer(), sa.ForeignKey("tenants.tenant_id", ondelete="CASCADE"), nullable=False),
        sa.Column("dict_name", sa.String(100), nullable=False),
        sa.Column("dict_type", sa.String(100), nullable=False),
        sa.Column("order_num", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("status", sa.String(1), nullable=False, server_default="0"),
        sa.Column("remark", sa.String(500)),
        sa.Column("created_by", sa.Integer(), sa.ForeignKey("users.user_id"), nullable=False),
        sa.Column("updated_by", sa.Integer(), sa.ForeignKey("users.user_id"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("dict_type_id", "tenant_id", name="uq_tenant_dict_types_id_tenant"),
        sa.UniqueConstraint("tenant_id", "dict_type", name="uq_tenant_dict_types_tenant_key"),
        sa.UniqueConstraint("tenant_id", "dict_name", name="uq_tenant_dict_types_tenant_name"),
    )
    op.create_index("ix_tenant_dict_types_tenant_id", "tenant_dict_types", ["tenant_id"])

    op.create_table(
        "tenant_dict_data",
        sa.Column("dict_data_id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("tenant_id", sa.Integer(), sa.ForeignKey("tenants.tenant_id", ondelete="CASCADE"), nullable=False),
        sa.Column("dict_type_id", sa.Integer(), nullable=False),
        sa.Column("dict_sort", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("dict_label", sa.String(100), nullable=False),
        sa.Column("dict_value", sa.String(100), nullable=False),
        sa.Column("css_class", sa.String(100)),
        sa.Column("list_class", sa.String(100)),
        sa.Column("is_default", sa.String(1), nullable=False, server_default="N"),
        sa.Column("status", sa.String(1), nullable=False, server_default="0"),
        sa.Column("remark", sa.String(500)),
        sa.Column("created_by", sa.Integer(), sa.ForeignKey("users.user_id"), nullable=False),
        sa.Column("updated_by", sa.Integer(), sa.ForeignKey("users.user_id"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("dict_data_id", "tenant_id", name="uq_tenant_dict_data_id_tenant"),
        sa.UniqueConstraint("tenant_id", "dict_type_id", "dict_value", name="uq_tenant_dict_data_type_value"),
        sa.ForeignKeyConstraint(
            ["dict_type_id", "tenant_id"],
            ["tenant_dict_types.dict_type_id", "tenant_dict_types.tenant_id"],
            name="fk_tenant_dict_data_type_tenant",
            ondelete="CASCADE",
        ),
    )
    op.create_index("ix_tenant_dict_data_tenant_id", "tenant_dict_data", ["tenant_id"])
    op.create_index("ix_tenant_dict_data_dict_type_id", "tenant_dict_data", ["dict_type_id"])


def downgrade() -> None:
    op.drop_index("ix_tenant_dict_data_dict_type_id", table_name="tenant_dict_data")
    op.drop_index("ix_tenant_dict_data_tenant_id", table_name="tenant_dict_data")
    op.drop_table("tenant_dict_data")
    op.drop_index("ix_tenant_dict_types_tenant_id", table_name="tenant_dict_types")
    op.drop_table("tenant_dict_types")
