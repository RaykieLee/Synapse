"""Add tenant and workspace scoped attachment metadata."""
from alembic import op
import sqlalchemy as sa


revision = "0011_attachments"
down_revision = "0010_tenant_configs"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "attachments",
        sa.Column("attachment_id", sa.String(36), primary_key=True),
        sa.Column("tenant_id", sa.Integer(), sa.ForeignKey("tenants.tenant_id", ondelete="CASCADE"), nullable=False),
        sa.Column("workspace_id", sa.Integer(), nullable=False),
        sa.Column("scope_kind", sa.String(16), nullable=False),
        sa.Column("owner_user_id", sa.Integer(), sa.ForeignKey("users.user_id", ondelete="CASCADE")),
        sa.Column("original_filename", sa.String(255), nullable=False),
        sa.Column("media_type", sa.String(127), nullable=False),
        sa.Column("size_bytes", sa.Integer(), nullable=False),
        sa.Column("storage_key", sa.String(100), nullable=False, unique=True),
        sa.Column("created_by", sa.Integer(), sa.ForeignKey("users.user_id"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("attachment_id", "tenant_id", name="uq_attachments_id_tenant"),
        sa.ForeignKeyConstraint(
            ["workspace_id", "tenant_id"],
            ["workspaces.workspace_id", "workspaces.tenant_id"],
            name="fk_attachments_workspace_tenant",
        ),
        sa.CheckConstraint("scope_kind IN ('workspace', 'personal')", name="ck_attachments_scope_kind"),
        sa.CheckConstraint(
            "(scope_kind = 'workspace' AND owner_user_id IS NULL) OR "
            "(scope_kind = 'personal' AND owner_user_id IS NOT NULL)",
            name="ck_attachments_scope_owner",
        ),
        sa.CheckConstraint("size_bytes > 0", name="ck_attachments_positive_size"),
    )
    op.create_index("ix_attachments_tenant_id", "attachments", ["tenant_id"])
    op.create_index("ix_attachments_workspace_id", "attachments", ["workspace_id"])
    op.create_index("ix_attachments_scope_kind", "attachments", ["scope_kind"])
    op.create_index("ix_attachments_owner_user_id", "attachments", ["owner_user_id"])


def downgrade() -> None:
    op.drop_index("ix_attachments_owner_user_id", table_name="attachments")
    op.drop_index("ix_attachments_scope_kind", table_name="attachments")
    op.drop_index("ix_attachments_workspace_id", table_name="attachments")
    op.drop_index("ix_attachments_tenant_id", table_name="attachments")
    op.drop_table("attachments")
