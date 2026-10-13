"""Add durable F27b team orchestration projections."""

import sqlalchemy as sa
from alembic import op

revision = "0017_team_orchestration"
down_revision = "0016_tenant_validity"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "team_definitions",
        sa.Column("team_id", sa.String(64), primary_key=True),
        sa.Column("tenant_id", sa.Integer(), sa.ForeignKey("tenants.tenant_id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("workspace_id", sa.Integer(), nullable=False, index=True),
        sa.Column("created_by", sa.Integer(), sa.ForeignKey("users.user_id"), nullable=False, index=True),
        sa.Column("updated_by", sa.Integer(), sa.ForeignKey("users.user_id"), nullable=False),
        sa.Column("name", sa.String(100), nullable=False),
        sa.Column("description", sa.Text(), nullable=False, server_default=""),
        sa.Column("status", sa.String(16), nullable=False, server_default="draft", index=True),
        sa.Column("version", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("workspace_id", "created_by", "name", name="uq_team_definitions_workspace_actor_name"),
        sa.UniqueConstraint("team_id", "tenant_id", "workspace_id", name="uq_team_definitions_scope"),
        sa.ForeignKeyConstraint(
            ["workspace_id", "tenant_id"],
            ["workspaces.workspace_id", "workspaces.tenant_id"],
            name="fk_team_definitions_workspace_tenant",
        ),
    )
    op.create_table(
        "team_member_definitions",
        sa.Column("member_id", sa.String(64), primary_key=True),
        sa.Column("team_id", sa.String(64), sa.ForeignKey("team_definitions.team_id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("agent_id", sa.String(128), nullable=False),
        sa.Column("role", sa.String(120), nullable=False, server_default=""),
        sa.Column("is_leader", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("member_id", "team_id", name="uq_team_member_definition_scope"),
    )
    op.create_table(
        "team_task_definitions",
        sa.Column("task_id", sa.String(64), primary_key=True),
        sa.Column("team_id", sa.String(64), sa.ForeignKey("team_definitions.team_id", ondelete="CASCADE"), primary_key=True, index=True),
        sa.Column("subject", sa.String(200), nullable=False),
        sa.Column("description", sa.Text(), nullable=False, server_default=""),
        sa.Column("owner_member_id", sa.String(64), nullable=False),
        sa.Column("depends_on_json", sa.Text(), nullable=False, server_default="[]"),
        sa.Column("allow_failure", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(
            ["owner_member_id", "team_id"],
            ["team_member_definitions.member_id", "team_member_definitions.team_id"],
            name="fk_team_task_owner_scope",
        ),
    )
    op.create_table(
        "team_runs",
        sa.Column("run_id", sa.String(64), primary_key=True),
        sa.Column("team_id", sa.String(64), nullable=False, index=True),
        sa.Column("tenant_id", sa.Integer(), sa.ForeignKey("tenants.tenant_id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("workspace_id", sa.Integer(), nullable=False, index=True),
        sa.Column("created_by", sa.Integer(), sa.ForeignKey("users.user_id"), nullable=False),
        sa.Column("team_version", sa.Integer(), nullable=False),
        sa.Column("run_version", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("status", sa.String(32), nullable=False, server_default="preparing", index=True),
        sa.Column("idempotency_key", sa.String(200), nullable=False),
        sa.Column("snapshot_json", sa.Text(), nullable=False),
        sa.Column("events_json", sa.Text(), nullable=False, server_default="[]"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("team_id", "idempotency_key", name="uq_team_runs_team_idempotency"),
        sa.ForeignKeyConstraint(
            ["team_id", "tenant_id", "workspace_id"],
            ["team_definitions.team_id", "team_definitions.tenant_id", "team_definitions.workspace_id"],
            name="fk_team_runs_team_scope",
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["workspace_id", "tenant_id"],
            ["workspaces.workspace_id", "workspaces.tenant_id"],
            name="fk_team_runs_workspace_tenant",
            ondelete="CASCADE",
        ),
    )
    op.create_index(
        "uq_team_runs_one_active",
        "team_runs",
        ["team_id"],
        unique=True,
        sqlite_where=sa.text(
            "status IN ('preparing', 'running', 'interrupt_requested')"
        ),
        postgresql_where=sa.text(
            "status IN ('preparing', 'running', 'interrupt_requested')"
        ),
    )


def downgrade() -> None:
    op.drop_index("uq_team_runs_one_active", table_name="team_runs")
    op.drop_table("team_runs")
    op.drop_table("team_task_definitions")
    op.drop_table("team_member_definitions")
    op.drop_table("team_definitions")
