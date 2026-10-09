"""Add tenant-scoped menu tree metadata."""
from alembic import op
import sqlalchemy as sa


revision = "0006_tenant_menus"
down_revision = "0005_tenant_member_roles"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "tenant_menus",
        sa.Column("menu_id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("tenant_id", sa.Integer(), sa.ForeignKey("tenants.tenant_id", ondelete="CASCADE"), nullable=False),
        sa.Column("parent_id", sa.Integer(), nullable=True),
        sa.Column("menu_name", sa.String(50), nullable=False),
        sa.Column("order_num", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("path", sa.String(200), nullable=False, server_default=""),
        sa.Column("component", sa.String(255)),
        sa.Column("query", sa.String(255)),
        sa.Column("is_frame", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("is_cache", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("menu_type", sa.String(1), nullable=False, server_default="M"),
        sa.Column("visible", sa.String(1), nullable=False, server_default="0"),
        sa.Column("status", sa.String(1), nullable=False, server_default="0"),
        sa.Column("perms", sa.String(100)),
        sa.Column("icon", sa.String(100), nullable=False, server_default="#"),
        sa.Column("remark", sa.String(500)),
        sa.Column("del_flag", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("created_by", sa.Integer(), sa.ForeignKey("users.user_id"), nullable=False),
        sa.Column("updated_by", sa.Integer(), sa.ForeignKey("users.user_id"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("menu_id", "tenant_id", name="uq_tenant_menus_id_tenant"),
        sa.ForeignKeyConstraint(
            ["parent_id", "tenant_id"],
            ["tenant_menus.menu_id", "tenant_menus.tenant_id"],
            name="fk_tenant_menus_parent_tenant",
        ),
    )
    op.create_index("ix_tenant_menus_tenant_id", "tenant_menus", ["tenant_id"])
    op.create_index("ix_tenant_menus_parent_id", "tenant_menus", ["parent_id"])
    op.create_index("ix_tenant_menus_del_flag", "tenant_menus", ["del_flag"])


def downgrade() -> None:
    op.drop_index("ix_tenant_menus_del_flag", table_name="tenant_menus")
    op.drop_index("ix_tenant_menus_parent_id", table_name="tenant_menus")
    op.drop_index("ix_tenant_menus_tenant_id", table_name="tenant_menus")
    op.drop_table("tenant_menus")
