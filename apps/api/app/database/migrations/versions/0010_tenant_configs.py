"""Add tenant-scoped parameter configuration."""
from alembic import op
import sqlalchemy as sa


revision = "0010_tenant_configs"
down_revision = "0009_tenant_dictionaries"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "tenant_configs",
        sa.Column("config_id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("tenant_id", sa.Integer(), sa.ForeignKey("tenants.tenant_id", ondelete="CASCADE"), nullable=False),
        sa.Column("config_name", sa.String(100), nullable=False),
        sa.Column("config_key", sa.String(100), nullable=False),
        sa.Column("config_value", sa.Text(), nullable=False),
        sa.Column("group_name", sa.String(100), nullable=False, server_default=""),
        sa.Column("is_frontend", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("is_sensitive", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("status", sa.String(1), nullable=False, server_default="0"),
        sa.Column("remark", sa.String(500)),
        sa.Column("created_by", sa.Integer(), sa.ForeignKey("users.user_id"), nullable=False),
        sa.Column("updated_by", sa.Integer(), sa.ForeignKey("users.user_id"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("config_id", "tenant_id", name="uq_tenant_configs_id_tenant"),
        sa.UniqueConstraint("tenant_id", "config_key", name="uq_tenant_configs_tenant_key"),
    )
    op.create_index("ix_tenant_configs_tenant_id", "tenant_configs", ["tenant_id"])


def downgrade() -> None:
    op.drop_index("ix_tenant_configs_tenant_id", table_name="tenant_configs")
    op.drop_table("tenant_configs")
