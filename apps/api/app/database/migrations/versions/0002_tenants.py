"""Add tenants, tenant membership and default-workspace structures."""
from alembic import op
import sqlalchemy as sa

revision = "0002_tenants"
down_revision = "0001_global_users"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table("tenants",
        sa.Column("tenant_id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("slug", sa.String(64), nullable=False), sa.Column("name", sa.String(120), nullable=False),
        sa.Column("status", sa.String(16), nullable=False, server_default="active"),
        sa.Column("settings_json", sa.Text(), nullable=False, server_default="{}"),
        sa.Column("membership_version", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False))
    op.create_index("ix_tenants_slug", "tenants", ["slug"], unique=True)
    op.create_index("ix_tenants_status", "tenants", ["status"])
    op.create_table("tenant_members",
        sa.Column("tenant_member_id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("tenant_id", sa.Integer(), sa.ForeignKey("tenants.tenant_id", ondelete="CASCADE"), nullable=False),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.user_id"), nullable=False),
        sa.Column("status", sa.String(16), nullable=False, server_default="active"),
        sa.Column("tenant_role", sa.String(16), nullable=False, server_default="member"),
        sa.Column("joined_at", sa.DateTime(timezone=True)), sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("tenant_id", "user_id", name="uq_tenant_members_tenant_user"))
    for col in ("tenant_id", "user_id", "status"):
        op.create_index(f"ix_tenant_members_{col}", "tenant_members", [col])
    op.create_table("workspaces",
        sa.Column("workspace_id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("tenant_id", sa.Integer(), sa.ForeignKey("tenants.tenant_id", ondelete="CASCADE"), nullable=False),
        sa.Column("slug", sa.String(64), nullable=False), sa.Column("name", sa.String(120), nullable=False),
        sa.Column("icon", sa.String(64)), sa.Column("status", sa.String(16), nullable=False, server_default="active"),
        sa.Column("settings_json", sa.Text(), nullable=False, server_default="{}"),
        sa.Column("created_by", sa.Integer(), sa.ForeignKey("users.user_id"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False), sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("tenant_id", "slug", name="uq_workspaces_tenant_slug"),
        sa.UniqueConstraint("workspace_id", "tenant_id", name="uq_workspaces_id_tenant"))
    op.create_index("ix_workspaces_tenant_id", "workspaces", ["tenant_id"])
    op.create_index("ix_workspaces_status", "workspaces", ["status"])
    op.create_table("workspace_members",
        sa.Column("workspace_member_id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("workspace_id", sa.Integer(), nullable=False),
        sa.Column("tenant_id", sa.Integer(), sa.ForeignKey("tenants.tenant_id", ondelete="CASCADE"), nullable=False),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.user_id"), nullable=False),
        sa.Column("status", sa.String(16), nullable=False, server_default="active"),
        sa.Column("workspace_role", sa.String(16), nullable=False, server_default="member"),
        sa.Column("joined_at", sa.DateTime(timezone=True)), sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["workspace_id", "tenant_id"], ["workspaces.workspace_id", "workspaces.tenant_id"], name="fk_workspace_members_workspace_tenant"),
        sa.UniqueConstraint("workspace_id", "user_id", name="uq_workspace_members_workspace_user"))
    for col in ("workspace_id", "tenant_id", "user_id", "status"):
        op.create_index(f"ix_workspace_members_{col}", "workspace_members", [col])


def downgrade() -> None:
    for col in ("workspace_id", "tenant_id", "user_id", "status"):
        op.drop_index(f"ix_workspace_members_{col}", table_name="workspace_members")
    op.drop_table("workspace_members")
    op.drop_index("ix_workspaces_status", table_name="workspaces")
    op.drop_index("ix_workspaces_tenant_id", table_name="workspaces")
    op.drop_table("workspaces")
    for col in ("tenant_id", "user_id", "status"):
        op.drop_index(f"ix_tenant_members_{col}", table_name="tenant_members")
    op.drop_table("tenant_members")
    op.drop_index("ix_tenants_status", table_name="tenants")
    op.drop_index("ix_tenants_slug", table_name="tenants")
    op.drop_table("tenants")
