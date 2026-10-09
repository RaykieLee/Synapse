"""Create the first platform administrator without a built-in password."""
import getpass
import os
from pathlib import Path

from alembic import command
from alembic.config import Config
from sqlalchemy import select

from app.auth.security import password_hash
from app.database.session import get_session_factory
from app.models.user import User


def main() -> None:
    username = input("Platform admin username: ").strip()
    if not username:
        raise SystemExit("Username is required")
    password = os.environ.pop("SYNAPSE_INITIAL_ADMIN_PASSWORD", None)
    supplied_by_environment = password is not None
    if not password:
        password = getpass.getpass("New password (12+ chars): ")
        confirmation = getpass.getpass("Confirm password: ")
        if password != confirmation:
            raise SystemExit("Passwords do not match")
    if len(password) < 12:
        raise SystemExit("Password must be at least 12 characters")
    api_root = Path(__file__).resolve().parents[2]
    config = Config(str(api_root / "alembic.ini"))
    config.set_main_option("script_location", str(api_root / "app/database/migrations"))
    try:
        command.upgrade(config, "head")
    except Exception as exc:
        raise SystemExit(
            "Database migration failed; check SYNAPSE_DATABASE_URL and migration access, "
            "then run `alembic upgrade head` from apps/api before retrying."
        ) from exc
    with get_session_factory()() as db:
        if db.scalar(select(User.user_id).where(User.platform_role == "platform_admin", User.del_flag.is_(False))):
            raise SystemExit("A platform administrator already exists")
        if db.scalar(select(User.user_id).where(User.user_name == username)):
            raise SystemExit("Username already exists")
        db.add(User(user_name=username, nick_name=username, password_hash=password_hash(password),
                    status="active", platform_role="platform_admin"))
        db.commit()
    print(f"Created platform administrator {username!r}")
    if supplied_by_environment:
        print("The one-time password was removed from this process; unset SYNAPSE_INITIAL_ADMIN_PASSWORD in the caller shell.")


if __name__ == "__main__":
    main()
