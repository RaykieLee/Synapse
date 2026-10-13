"""Add F32 provider credentials and workspace model bindings."""

import sqlalchemy as sa
from alembic import op

revision = "0018_model_provider_management"
down_revision = "0017_team_orchestration"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "model_credentials",
        sa.Column("credential_id", sa.String(length=36), nullable=False),
        sa.Column("tenant_id", sa.Integer(), nullable=False),
        sa.Column("workspace_id", sa.Integer(), nullable=False),
        sa.Column("owner_user_id", sa.Integer(), nullable=False),
        sa.Column("provider_type", sa.String(length=64), nullable=False),
        sa.Column("name", sa.String(length=100), nullable=False),
        sa.Column("base_url", sa.String(length=500), nullable=False),
        sa.Column("organization", sa.String(length=200), nullable=True),
        sa.Column("encrypted_api_key", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["owner_user_id"], ["users.user_id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.tenant_id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(
            ["workspace_id", "tenant_id"],
            ["workspaces.workspace_id", "workspaces.tenant_id"],
            name="fk_model_credentials_workspace_tenant",
        ),
        sa.PrimaryKeyConstraint("credential_id"),
        sa.UniqueConstraint("credential_id", "tenant_id", name="uq_model_credentials_id_tenant"),
        sa.UniqueConstraint(
            "credential_id",
            "tenant_id",
            "workspace_id",
            name="uq_model_credentials_id_tenant_workspace",
        ),
    )
    op.create_index("ix_model_credentials_tenant_id", "model_credentials", ["tenant_id"])
    op.create_index("ix_model_credentials_workspace_id", "model_credentials", ["workspace_id"])
    op.create_index("ix_model_credentials_owner_user_id", "model_credentials", ["owner_user_id"])

    op.create_table(
        "model_bindings",
        sa.Column("model_binding_id", sa.String(length=36), nullable=False),
        sa.Column("tenant_id", sa.Integer(), nullable=False),
        sa.Column("workspace_id", sa.Integer(), nullable=False),
        sa.Column("credential_id", sa.String(length=36), nullable=False),
        sa.Column("display_name", sa.String(length=100), nullable=False),
        sa.Column("kind", sa.String(length=32), nullable=False),
        sa.Column("provider_type", sa.String(length=64), nullable=False),
        sa.Column("model", sa.String(length=200), nullable=False),
        sa.Column("status", sa.String(length=16), nullable=False),
        sa.Column("capabilities_json", sa.Text(), nullable=False),
        sa.Column("default_parameters_json", sa.Text(), nullable=False),
        sa.Column("created_by", sa.Integer(), nullable=False),
        sa.Column("updated_by", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["created_by"], ["users.user_id"]),
        sa.ForeignKeyConstraint(["updated_by"], ["users.user_id"]),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.tenant_id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(
            ["workspace_id", "tenant_id"],
            ["workspaces.workspace_id", "workspaces.tenant_id"],
            name="fk_model_bindings_workspace_tenant",
        ),
        sa.ForeignKeyConstraint(
            ["credential_id", "tenant_id", "workspace_id"],
            [
                "model_credentials.credential_id",
                "model_credentials.tenant_id",
                "model_credentials.workspace_id",
            ],
            name="fk_model_bindings_credential_scope",
        ),
        sa.PrimaryKeyConstraint("model_binding_id"),
        sa.UniqueConstraint("model_binding_id", "tenant_id", name="uq_model_bindings_id_tenant"),
        sa.UniqueConstraint("workspace_id", "tenant_id", "display_name", name="uq_model_bindings_workspace_name"),
    )
    op.create_index("ix_model_bindings_tenant_id", "model_bindings", ["tenant_id"])
    op.create_index("ix_model_bindings_workspace_id", "model_bindings", ["workspace_id"])
    op.create_index("ix_model_bindings_credential_id", "model_bindings", ["credential_id"])


def downgrade() -> None:
    op.drop_index("ix_model_bindings_credential_id", table_name="model_bindings")
    op.drop_index("ix_model_bindings_workspace_id", table_name="model_bindings")
    op.drop_index("ix_model_bindings_tenant_id", table_name="model_bindings")
    op.drop_table("model_bindings")
    op.drop_index("ix_model_credentials_owner_user_id", table_name="model_credentials")
    op.drop_index("ix_model_credentials_workspace_id", table_name="model_credentials")
    op.drop_index("ix_model_credentials_tenant_id", table_name="model_credentials")
    op.drop_table("model_credentials")
