"""Add persisted tenant resource summary results."""
from alembic import op
import sqlalchemy as sa


revision = "0013_tenant_resource_summaries"
down_revision = "0012_tenant_scheduled_tasks"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "tenant_resource_summaries",
        sa.Column("tenant_id", sa.Integer(), sa.ForeignKey("tenants.tenant_id", ondelete="CASCADE"), primary_key=True),
        sa.Column("counts_json", sa.Text(), nullable=False),
        sa.Column("schema_version", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("refreshed_at", sa.DateTime(timezone=True), nullable=False),
    )


def downgrade() -> None:
    op.drop_table("tenant_resource_summaries")
