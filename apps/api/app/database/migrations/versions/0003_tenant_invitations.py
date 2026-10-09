"""Add expiring, single-use tenant invitations."""
from alembic import op
import sqlalchemy as sa

revision = "0003_tenant_invitations"
down_revision = "0002_tenants"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "tenant_invitations",
        sa.Column("invitation_id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("tenant_id", sa.Integer(), sa.ForeignKey("tenants.tenant_id", ondelete="CASCADE"), nullable=False),
        sa.Column("email", sa.String(length=254), nullable=True),
        sa.Column("target_user_id", sa.Integer(), sa.ForeignKey("users.user_id"), nullable=True),
        sa.Column("tenant_role", sa.String(length=16), nullable=False, server_default="member"),
        sa.Column("token_hash", sa.String(length=64), nullable=False),
        sa.Column("status", sa.String(length=16), nullable=False, server_default="pending"),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("invited_by", sa.Integer(), sa.ForeignKey("users.user_id"), nullable=False),
        sa.Column("accepted_by", sa.Integer(), sa.ForeignKey("users.user_id"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("accepted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.UniqueConstraint("token_hash", name="uq_tenant_invitations_token_hash"),
    )
    op.create_index("ix_tenant_invitations_tenant_id", "tenant_invitations", ["tenant_id"])
    op.create_index("ix_tenant_invitations_email", "tenant_invitations", ["email"])
    op.create_index("ix_tenant_invitations_target_user_id", "tenant_invitations", ["target_user_id"])
    op.create_index("ix_tenant_invitations_status", "tenant_invitations", ["status"])


def downgrade() -> None:
    op.drop_index("ix_tenant_invitations_status", table_name="tenant_invitations")
    op.drop_index("ix_tenant_invitations_target_user_id", table_name="tenant_invitations")
    op.drop_index("ix_tenant_invitations_email", table_name="tenant_invitations")
    op.drop_index("ix_tenant_invitations_tenant_id", table_name="tenant_invitations")
    op.drop_table("tenant_invitations")
