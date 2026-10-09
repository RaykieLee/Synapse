"""Persist append-only execution history for tenant scheduled tasks."""
from alembic import op
import sqlalchemy as sa


revision = "0015_tenant_scheduled_task_runs"
down_revision = "0014_tenant_task_schedule_state"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "tenant_scheduled_task_runs",
        sa.Column("run_id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("tenant_id", sa.Integer(), nullable=False),
        sa.Column("task_id", sa.Integer(), nullable=False),
        sa.Column("slot_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("claim_token_hash", sa.String(length=64), nullable=False),
        sa.Column("execution_target", sa.String(length=100), nullable=False),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("status", sa.String(length=16), nullable=False),
        sa.Column("result_summary_json", sa.Text(), nullable=True),
        sa.Column("error_code", sa.String(length=80), nullable=True),
        sa.ForeignKeyConstraint(
            ["task_id", "tenant_id"],
            ["tenant_scheduled_tasks.task_id", "tenant_scheduled_tasks.tenant_id"],
            name="fk_scheduled_task_run_task_tenant",
            ondelete="CASCADE",
        ),
        sa.CheckConstraint(
            "status IN ('running', 'succeeded', 'failed')",
            name="ck_scheduled_task_run_status",
        ),
    )
    op.create_index(
        "ix_tenant_scheduled_task_runs_tenant_id",
        "tenant_scheduled_task_runs",
        ["tenant_id"],
    )
    op.create_index(
        "ix_tenant_scheduled_task_runs_task_id",
        "tenant_scheduled_task_runs",
        ["task_id"],
    )
    op.create_index(
        "ix_tenant_scheduled_task_runs_started_at",
        "tenant_scheduled_task_runs",
        ["started_at"],
    )
    op.create_index(
        "ix_tenant_scheduled_task_runs_finished_at",
        "tenant_scheduled_task_runs",
        ["finished_at"],
    )
    op.create_index(
        "ix_tenant_scheduled_task_runs_status",
        "tenant_scheduled_task_runs",
        ["status"],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_tenant_scheduled_task_runs_status",
        table_name="tenant_scheduled_task_runs",
    )
    op.drop_index(
        "ix_tenant_scheduled_task_runs_finished_at",
        table_name="tenant_scheduled_task_runs",
    )
    op.drop_index(
        "ix_tenant_scheduled_task_runs_started_at",
        table_name="tenant_scheduled_task_runs",
    )
    op.drop_index(
        "ix_tenant_scheduled_task_runs_task_id",
        table_name="tenant_scheduled_task_runs",
    )
    op.drop_index(
        "ix_tenant_scheduled_task_runs_tenant_id",
        table_name="tenant_scheduled_task_runs",
    )
    op.drop_table("tenant_scheduled_task_runs")
