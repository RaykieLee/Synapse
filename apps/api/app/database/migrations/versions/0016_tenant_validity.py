"""Add tenant validity period columns."""

import sqlalchemy as sa
from alembic import op

revision = "0016_tenant_validity"
down_revision = "0015_tenant_scheduled_task_runs"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("tenants", sa.Column("valid_from", sa.DateTime(timezone=True), nullable=True))
    op.add_column("tenants", sa.Column("valid_until", sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    op.drop_column("tenants", "valid_until")
    op.drop_column("tenants", "valid_from")
