"""Add custom tenant role assignment for tenant members."""
from alembic import op
import sqlalchemy as sa


revision = "0005_tenant_member_roles"
down_revision = "0004_tenant_roles"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Composite foreign keys prevent an assignment from pairing a tenant's
    # member with a role belonging to another tenant.
    with op.batch_alter_table("tenant_roles") as batch_op:
        batch_op.create_unique_constraint(
            "uq_tenant_roles_id_tenant", ["role_id", "tenant_id"],
        )
    op.create_table(
        "tenant_member_roles",
        sa.Column("assignment_id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("tenant_id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("role_id", sa.Integer(), nullable=False),
        sa.Column("assigned_by", sa.Integer(), sa.ForeignKey("users.user_id"), nullable=False),
        sa.Column("assigned_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("tenant_id", "user_id", name="uq_tenant_member_roles_member"),
        sa.ForeignKeyConstraint(
            ["tenant_id", "user_id"],
            ["tenant_members.tenant_id", "tenant_members.user_id"],
            name="fk_tenant_member_roles_member",
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["role_id", "tenant_id"],
            ["tenant_roles.role_id", "tenant_roles.tenant_id"],
            name="fk_tenant_member_roles_role_tenant",
            ondelete="CASCADE",
        ),
    )
    op.create_index("ix_tenant_member_roles_tenant_id", "tenant_member_roles", ["tenant_id"])
    op.create_index("ix_tenant_member_roles_user_id", "tenant_member_roles", ["user_id"])
    op.create_index("ix_tenant_member_roles_role_id", "tenant_member_roles", ["role_id"])


def downgrade() -> None:
    op.drop_index("ix_tenant_member_roles_role_id", table_name="tenant_member_roles")
    op.drop_index("ix_tenant_member_roles_user_id", table_name="tenant_member_roles")
    op.drop_index("ix_tenant_member_roles_tenant_id", table_name="tenant_member_roles")
    op.drop_table("tenant_member_roles")
    with op.batch_alter_table("tenant_roles") as batch_op:
        batch_op.drop_constraint("uq_tenant_roles_id_tenant", type_="unique")
