"""Add tenant-scoped custom role-to-menu associations."""
from alembic import op
import sqlalchemy as sa


revision = "0007_tenant_role_menus"
down_revision = "0006_tenant_menus"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "tenant_role_menus",
        sa.Column("tenant_id", sa.Integer(), nullable=False),
        sa.Column("role_id", sa.Integer(), nullable=False),
        sa.Column("menu_id", sa.Integer(), nullable=False),
        sa.Column("created_by", sa.Integer(), sa.ForeignKey("users.user_id"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("tenant_id", "role_id", "menu_id", name="pk_tenant_role_menus"),
        sa.ForeignKeyConstraint(
            ["role_id", "tenant_id"],
            ["tenant_roles.role_id", "tenant_roles.tenant_id"],
            name="fk_tenant_role_menus_role_tenant",
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["menu_id", "tenant_id"],
            ["tenant_menus.menu_id", "tenant_menus.tenant_id"],
            name="fk_tenant_role_menus_menu_tenant",
            ondelete="CASCADE",
        ),
    )
    op.create_index("ix_tenant_role_menus_role_id", "tenant_role_menus", ["role_id"])
    op.create_index("ix_tenant_role_menus_menu_id", "tenant_role_menus", ["menu_id"])


def downgrade() -> None:
    op.drop_index("ix_tenant_role_menus_menu_id", table_name="tenant_role_menus")
    op.drop_index("ix_tenant_role_menus_role_id", table_name="tenant_role_menus")
    op.drop_table("tenant_role_menus")
