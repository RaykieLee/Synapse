"""Add custom tenant-scoped role definitions."""
from alembic import op
import sqlalchemy as sa


revision = "0004_tenant_roles"
down_revision = "0003_tenant_invitations"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "tenant_roles",
        sa.Column("role_id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("tenant_id", sa.Integer(), sa.ForeignKey("tenants.tenant_id", ondelete="CASCADE"), nullable=False),
        sa.Column("role_name", sa.String(30), nullable=False),
        sa.Column("role_key", sa.String(64), nullable=False),
        sa.Column("role_sort", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("status", sa.String(16), nullable=False, server_default="active"),
        sa.Column("permissions_json", sa.Text(), nullable=False, server_default="[]"),
        sa.Column("remark", sa.String(500)),
        sa.Column("del_flag", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("created_by", sa.Integer(), sa.ForeignKey("users.user_id"), nullable=False),
        sa.Column("updated_by", sa.Integer(), sa.ForeignKey("users.user_id"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("tenant_id", "role_key", name="uq_tenant_roles_tenant_key"),
        sa.UniqueConstraint("tenant_id", "role_name", name="uq_tenant_roles_tenant_name"),
    )
    op.create_index("ix_tenant_roles_tenant_id", "tenant_roles", ["tenant_id"])
    op.create_index("ix_tenant_roles_status", "tenant_roles", ["status"])
    op.create_index("ix_tenant_roles_del_flag", "tenant_roles", ["del_flag"])


def downgrade() -> None:
    op.drop_index("ix_tenant_roles_del_flag", table_name="tenant_roles")
    op.drop_index("ix_tenant_roles_status", table_name="tenant_roles")
    op.drop_index("ix_tenant_roles_tenant_id", table_name="tenant_roles")
    op.drop_table("tenant_roles")
