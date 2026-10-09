"""Create global account table."""
from alembic import op
import sqlalchemy as sa

revision = "0001_global_users"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "users",
        sa.Column("user_id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("user_name", sa.String(length=64), nullable=False),
        sa.Column("nick_name", sa.String(length=100), nullable=False, server_default=""),
        sa.Column("email", sa.String(length=254), nullable=True),
        sa.Column("phonenumber", sa.String(length=32), nullable=True),
        sa.Column("sex", sa.String(length=1), nullable=True),
        sa.Column("avatar", sa.Text(), nullable=True),
        sa.Column("password_hash", sa.String(length=256), nullable=False),
        sa.Column("status", sa.String(length=16), nullable=False, server_default="active"),
        sa.Column("del_flag", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("platform_role", sa.String(length=32), nullable=False, server_default="user"),
        sa.Column("token_version", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_users_user_name", "users", ["user_name"], unique=True)
    op.create_index("ix_users_email", "users", ["email"], unique=True)
    op.create_index("ix_users_status", "users", ["status"])


def downgrade() -> None:
    op.drop_index("ix_users_status", table_name="users")
    op.drop_index("ix_users_email", table_name="users")
    op.drop_index("ix_users_user_name", table_name="users")
    op.drop_table("users")
