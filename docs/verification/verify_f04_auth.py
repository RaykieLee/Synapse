"""Repeatable F04 auth backend verification; run from apps/api with its .venv."""
from __future__ import annotations

import os
import subprocess
import sys
import tempfile
from pathlib import Path

from fastapi.testclient import TestClient
from sqlalchemy import select

API = Path(__file__).resolve().parents[2] / "apps" / "api"
sys.path.insert(0, str(API))


def main() -> None:
    with tempfile.TemporaryDirectory(prefix="synapse-f04-") as td:
        dbfile = Path(td) / "auth.sqlite"
        env = os.environ.copy()
        env.update(SYNAPSE_DATABASE_URL=f"sqlite:///{dbfile}", SYNAPSE_JWT_SECRET="f04-test-secret",
                   SYNAPSE_ENV="test", SYNAPSE_INITIAL_ADMIN_PASSWORD="F04-test-passphrase-2026")
        subprocess.run([sys.executable, "-m", "alembic", "upgrade", "0001_global_users"], cwd=API, env=env, check=True)
        os.environ.update(env)

        from app.auth.security import password_hash
        from app.core.config import get_settings
        from app.database.session import get_engine, get_session_factory
        from app.main import create_app
        from app.models.user import User

        get_settings.cache_clear()
        engine = get_engine()
        with engine.connect() as conn:
            assert conn.exec_driver_sql("select version_num from alembic_version").scalar() == "0001_global_users"
            cols = {row[1] for row in conn.exec_driver_sql("pragma table_info(users)")}
            assert {"user_id", "password_hash", "token_version", "platform_role", "del_flag"} <= cols
        print("PASS: Alembic upgrade through F04 revision creates global users schema")

        # CLI on a partially migrated database advances to head; later Alembic is idempotent.
        cli = subprocess.run([sys.executable, "-m", "app.cli.create_platform_admin"], cwd=API, env=env,
                             input="f04-admin\n", text=True, capture_output=True)
        assert cli.returncode == 0, cli.stderr
        repeat_migration = subprocess.run([sys.executable, "-m", "alembic", "upgrade", "head"], cwd=API, env=env,
                                          text=True, capture_output=True)
        assert repeat_migration.returncode == 0, repeat_migration.stderr
        duplicate = subprocess.run([sys.executable, "-m", "app.cli.create_platform_admin"], cwd=API, env=env,
                                   input="other-admin\n", text=True, capture_output=True)
        assert duplicate.returncode != 0 and "already exists" in duplicate.stderr
        print("PASS: partially migrated CLI initialization; subsequent Alembic head is idempotent; duplicate admin rejected")

        # A fully migrated empty database also accepts CLI initialization.
        migrated_db = Path(td) / "already-migrated.sqlite"
        migrated_env = env | {"SYNAPSE_DATABASE_URL": f"sqlite:///{migrated_db}"}
        subprocess.run([sys.executable, "-m", "alembic", "upgrade", "head"], cwd=API, env=migrated_env, check=True,
                       capture_output=True, text=True)
        migrated_cli = subprocess.run([sys.executable, "-m", "app.cli.create_platform_admin"], cwd=API, env=migrated_env,
                                      input="f04-already-migrated\n", text=True, capture_output=True)
        assert migrated_cli.returncode == 0, migrated_cli.stderr
        print("PASS: CLI initialization on already migrated database")

        # Force Alembic's first revision to collide with an existing table and ensure no admin is inserted.
        failed_db = Path(td) / "failed-migration.sqlite"
        import sqlite3
        with sqlite3.connect(failed_db) as conn:
            conn.execute("CREATE TABLE users (user_id INTEGER PRIMARY KEY, user_name VARCHAR(64))")
        failed_env = env | {"SYNAPSE_DATABASE_URL": f"sqlite:///{failed_db}"}
        failed_cli = subprocess.run([sys.executable, "-m", "app.cli.create_platform_admin"], cwd=API, env=failed_env,
                                    input="f04-must-not-exist\n", text=True, capture_output=True)
        assert failed_cli.returncode != 0 and "Database migration failed" in failed_cli.stderr
        with sqlite3.connect(failed_db) as conn:
            assert conn.execute("SELECT count(*) FROM users WHERE user_name='f04-must-not-exist'").fetchone()[0] == 0
        print("PASS: failed migration aborts before admin account insertion")

        with get_session_factory()() as db:
            legacy = User(user_name="f04-legacy", nick_name="Legacy", password_hash="$2b$12$" + "x" * 53,
                          status="active", platform_role="user")
            # bcrypt-generated test hash, using fixture-only synthetic password.
            import bcrypt
            legacy.password_hash = bcrypt.hashpw(b"Legacy-test-passphrase-2026", bcrypt.gensalt()).decode()
            inactive = User(user_name="f04-disabled", nick_name="Disabled", password_hash=password_hash("Disabled-test-passphrase-2026"),
                            status="disabled", platform_role="user")
            db.add_all([legacy, inactive]); db.commit()
            legacy_id = legacy.user_id

        client = TestClient(create_app())
        bad1 = client.post("/api/v1/auth/login", json={"user_name": "missing-f04", "password": "bad"})
        bad2 = client.post("/api/v1/auth/login", json={"user_name": "f04-admin", "password": "wrong"})
        assert bad1.status_code == bad2.status_code == 401
        assert bad1.json().get("code") == bad2.json().get("code") == "INVALID_CREDENTIALS"
        assert bad1.headers["content-type"].startswith("application/problem+json")
        disabled = client.post("/api/v1/auth/login", json={"user_name": "f04-disabled", "password": "Disabled-test-passphrase-2026"})
        assert disabled.status_code == 403 and disabled.json().get("code") == "ACCOUNT_INACTIVE"
        print("PASS: invalid password and missing user indistinguishable; disabled account rejected")

        login = client.post("/api/v1/auth/login", json={"user_name": "f04-admin", "password": env["SYNAPSE_INITIAL_ADMIN_PASSWORD"]})
        assert login.status_code == 200 and login.headers.get("set-cookie")
        token = login.json()["access_token"]
        headers = {"Authorization": f"Bearer {token}"}
        me = client.get("/api/v1/auth/me", headers=headers)
        assert me.status_code == 200 and me.json()["user_id"].isdigit()
        assert not ({"password_hash", "token_version", "del_flag"} & me.json().keys())
        invalid_input = client.patch("/api/v1/account/profile", headers=headers, json={"unexpected": "x"})
        assert invalid_input.status_code == 422 and invalid_input.json().get("code") == "VALIDATION_ERROR"
        assert invalid_input.headers["content-type"].startswith("application/problem+json")
        print("PASS: login and /me; summary fields omit sensitive internals")

        profile = client.patch("/api/v1/account/profile", headers=headers, json={"nick_name": "F04 Updated", "email": "f04@example.invalid"})
        assert profile.status_code == 200 and profile.json()["nick_name"] == "F04 Updated"
        extra = client.patch("/api/v1/account/profile", headers=headers, json={"status": "disabled"})
        assert extra.status_code == 422
        print("PASS: profile update; undeclared fields rejected")

        changed = client.post("/api/v1/account/password", headers=headers,
                              json={"current_password": env["SYNAPSE_INITIAL_ADMIN_PASSWORD"], "new_password": "New-admin-passphrase-2026"})
        assert changed.status_code == 204
        assert client.get("/api/v1/auth/me", headers=headers).status_code == 401
        fresh = client.post("/api/v1/auth/login", json={"user_name": "f04-admin", "password": "New-admin-passphrase-2026"})
        assert fresh.status_code == 200
        assert client.post("/api/v1/account/password", headers={"Authorization": f"Bearer {fresh.json()['access_token']}"},
                           json={"current_password": "wrong", "new_password": "Another-admin-passphrase-2026"}).status_code == 400
        print("PASS: password change revokes prior token; new password works; wrong current password rejected")

        logout_token = fresh.json()["access_token"]
        bye = client.post("/api/v1/auth/logout", headers={"Authorization": f"Bearer {logout_token}"})
        assert bye.status_code == 204 and client.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {logout_token}"}).status_code == 401
        print("PASS: logout revokes all existing tokens")

        legacy_login = client.post("/api/v1/auth/login", json={"user_name": "f04-legacy", "password": "Legacy-test-passphrase-2026"})
        assert legacy_login.status_code == 200
        with get_session_factory()() as db:
            assert db.scalar(select(User).where(User.user_id == legacy_id)).password_hash.startswith("scrypt$")
        print("PASS: bcrypt login upgrades stored hash to scrypt")

        # Independently exercise production fail-closed behavior with no secret.
        old_env = {k: os.environ.get(k) for k in ("SYNAPSE_ENV", "SYNAPSE_JWT_SECRET")}
        os.environ["SYNAPSE_ENV"] = "production"; os.environ.pop("SYNAPSE_JWT_SECRET", None)
        get_settings.cache_clear()
        from app.auth.security import signing_key
        try:
            signing_key()
            raise AssertionError("production without secret unexpectedly returned a key")
        except RuntimeError as exc:
            assert "SYNAPSE_JWT_SECRET" in str(exc)
        finally:
            for key, val in old_env.items():
                if val is None: os.environ.pop(key, None)
                else: os.environ[key] = val
            get_settings.cache_clear()
        print("PASS: production signing fails without explicit secret")


if __name__ == "__main__":
    main()
