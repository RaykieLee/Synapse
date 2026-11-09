"""Add an explicit storage backend for attachment objects."""

import sqlalchemy as sa
from alembic import op


revision = "0019_attachment_storage_backend"
down_revision = "0018_model_provider_management"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "attachments",
        sa.Column(
            "storage_backend",
            sa.String(length=16),
            server_default="local",
            nullable=False,
        ),
    )


def downgrade() -> None:
    op.drop_column("attachments", "storage_backend")
