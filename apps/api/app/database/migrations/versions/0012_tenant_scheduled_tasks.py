"""Add tenant-scoped scheduled task definitions."""
from alembic import op
import sqlalchemy as sa


revision = "0012_tenant_scheduled_tasks"
down_revision = "0011_attachments"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "tenant_scheduled_tasks",
        sa.Column("task_id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("tenant_id", sa.Integer(), sa.ForeignKey("tenants.tenant_id", ondelete="CASCADE"), nullable=False),
        sa.Column("task_name", sa.String(120), nullable=False),
        sa.Column("description", sa.String(1000)),
        sa.Column("execution_target", sa.String(100), nullable=False),
        sa.Column("parameters_json", sa.Text(), nullable=False, server_default="{}"),
        sa.Column("schedule_type", sa.String(16), nullable=False),
        sa.Column("cron_expression", sa.String(120)),
        sa.Column("interval_value", sa.Integer()),
        sa.Column("interval_unit", sa.String(16)),
        sa.Column("timezone", sa.String(64), nullable=False, server_default="UTC"),
        sa.Column("enabled", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("del_flag", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("created_by", sa.Integer(), sa.ForeignKey("users.user_id"), nullable=False),
        sa.Column("updated_by", sa.Integer(), sa.ForeignKey("users.user_id"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("task_id", "tenant_id", name="uq_tenant_scheduled_tasks_id_tenant"),
        sa.UniqueConstraint("tenant_id", "task_name", name="uq_tenant_scheduled_tasks_tenant_name"),
        sa.CheckConstraint(
            "execution_target IN ('tenant.expire_pending_invitations', 'tenant.reconcile_attachment_metadata', 'tenant.refresh_resource_summary')",
            name="ck_tenant_scheduled_tasks_target_allowlist",
        ),
        sa.CheckConstraint("schedule_type IN ('cron', 'interval')", name="ck_tenant_scheduled_tasks_schedule_type"),
        sa.CheckConstraint(
            "(schedule_type = 'cron' AND cron_expression IS NOT NULL AND interval_value IS NULL AND interval_unit IS NULL) OR "
            "(schedule_type = 'interval' AND cron_expression IS NULL AND interval_value IS NOT NULL AND interval_unit IS NOT NULL)",
            name="ck_tenant_scheduled_tasks_schedule_fields",
        ),
        sa.CheckConstraint("interval_unit IS NULL OR interval_unit IN ('seconds', 'minutes', 'hours', 'days', 'weeks')",
                           name="ck_tenant_scheduled_tasks_interval_unit"),
        sa.CheckConstraint("interval_value IS NULL OR interval_value > 0", name="ck_tenant_scheduled_tasks_interval_value"),
    )
    op.create_index("ix_tenant_scheduled_tasks_tenant_id", "tenant_scheduled_tasks", ["tenant_id"])
    op.create_index("ix_tenant_scheduled_tasks_execution_target", "tenant_scheduled_tasks", ["execution_target"])
    op.create_index("ix_tenant_scheduled_tasks_enabled", "tenant_scheduled_tasks", ["enabled"])
    op.create_index("ix_tenant_scheduled_tasks_del_flag", "tenant_scheduled_tasks", ["del_flag"])


def downgrade() -> None:
    op.drop_index("ix_tenant_scheduled_tasks_del_flag", table_name="tenant_scheduled_tasks")
    op.drop_index("ix_tenant_scheduled_tasks_enabled", table_name="tenant_scheduled_tasks")
    op.drop_index("ix_tenant_scheduled_tasks_execution_target", table_name="tenant_scheduled_tasks")
    op.drop_index("ix_tenant_scheduled_tasks_tenant_id", table_name="tenant_scheduled_tasks")
    op.drop_table("tenant_scheduled_tasks")
