"""Add tenant-scoped department hierarchy."""
from alembic import op
import sqlalchemy as sa


revision = "0008_tenant_departments"
down_revision = "0007_tenant_role_menus"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "tenant_departments",
        sa.Column("department_id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("tenant_id", sa.Integer(), sa.ForeignKey("tenants.tenant_id", ondelete="CASCADE"), nullable=False),
        sa.Column("parent_id", sa.Integer(), nullable=True),
        sa.Column("ancestors", sa.Text(), nullable=False, server_default="0"),
        sa.Column("dept_name", sa.String(30), nullable=False, server_default=""),
        sa.Column("order_num", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("leader", sa.String(20)),
        sa.Column("phone", sa.String(11)),
        sa.Column("email", sa.String(50)),
        sa.Column("status", sa.String(1), nullable=False, server_default="0"),
        sa.Column("del_flag", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("created_by", sa.Integer(), sa.ForeignKey("users.user_id"), nullable=False),
        sa.Column("updated_by", sa.Integer(), sa.ForeignKey("users.user_id"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("department_id", "tenant_id", name="uq_tenant_departments_id_tenant"),
        sa.ForeignKeyConstraint(
            ["parent_id", "tenant_id"],
            ["tenant_departments.department_id", "tenant_departments.tenant_id"],
            name="fk_tenant_departments_parent_tenant",
        ),
    )
    op.create_index("ix_tenant_departments_tenant_id", "tenant_departments", ["tenant_id"])
    op.create_index("ix_tenant_departments_parent_id", "tenant_departments", ["parent_id"])
    op.create_index("ix_tenant_departments_del_flag", "tenant_departments", ["del_flag"])


def downgrade() -> None:
    op.drop_index("ix_tenant_departments_del_flag", table_name="tenant_departments")
    op.drop_index("ix_tenant_departments_parent_id", table_name="tenant_departments")
    op.drop_index("ix_tenant_departments_tenant_id", table_name="tenant_departments")
    op.drop_table("tenant_departments")
