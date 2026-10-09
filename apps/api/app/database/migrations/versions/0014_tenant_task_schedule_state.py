"""Persist next-run slots and leases for tenant scheduled tasks."""
from alembic import op
import sqlalchemy as sa


revision = "0014_tenant_task_schedule_state"
down_revision = "0013_tenant_resource_summaries"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "tenant_task_schedule_states",
        sa.Column("task_id", sa.Integer(), nullable=False),
        sa.Column("tenant_id", sa.Integer(), nullable=False),
        sa.Column("definition_fingerprint", sa.String(length=64), nullable=False),
        sa.Column("next_run_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("claimed_slot_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("lease_owner", sa.String(length=160), nullable=True),
        sa.Column("lease_token", sa.String(length=36), nullable=True),
        sa.Column("lease_until", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(
            ["task_id", "tenant_id"],
            ["tenant_scheduled_tasks.task_id", "tenant_scheduled_tasks.tenant_id"],
            name="fk_task_schedule_state_task_tenant",
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("task_id"),
        sa.UniqueConstraint("lease_token", name="uq_task_schedule_state_lease_token"),
    )
    op.create_index("ix_tenant_task_schedule_states_tenant_id", "tenant_task_schedule_states", ["tenant_id"])
    op.create_index("ix_tenant_task_schedule_states_next_run_at", "tenant_task_schedule_states", ["next_run_at"])
    op.create_index("ix_tenant_task_schedule_states_lease_until", "tenant_task_schedule_states", ["lease_until"])


def downgrade() -> None:
    op.drop_index("ix_tenant_task_schedule_states_lease_until", table_name="tenant_task_schedule_states")
    op.drop_index("ix_tenant_task_schedule_states_next_run_at", table_name="tenant_task_schedule_states")
    op.drop_index("ix_tenant_task_schedule_states_tenant_id", table_name="tenant_task_schedule_states")
    op.drop_table("tenant_task_schedule_states")
