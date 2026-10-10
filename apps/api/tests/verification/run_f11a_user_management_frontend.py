"""Run F11a build and browser acceptance using disposable SQLite/API/Vite services."""
import json
import os
import shutil
import socket
import subprocess
import sys
import tempfile
import time
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[4]
API = ROOT / "apps" / "api"
WEB = ROOT / "apps" / "web"
FLOW = Path(__file__).with_name("f11a_user_management_frontend.mjs")
PNPM = shutil.which("pnpm") or ("pnpm.cmd" if os.name == "nt" else "pnpm")


def terminate_process_tree(process):
    """Terminate pnpm's child Vite process as well as the command wrapper."""
    if process.poll() is None:
        if os.name == "nt":
            subprocess.run(
                ["taskkill", "/PID", str(process.pid), "/T", "/F"],
                capture_output=True,
            )
        else:
            process.terminate()
    try:
        process.wait(timeout=10)
    except subprocess.TimeoutExpired:
        process.kill()
        process.wait(timeout=10)


def free_port():
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


def wait_url(url, process):
    until = time.time() + 35
    while time.time() < until:
        if process.poll() is not None:
            raise RuntimeError(f"Server exited ({process.returncode}) before {url}")
        try:
            with urllib.request.urlopen(url, timeout=1) as response:
                if response.status < 500:
                    return
        except Exception:
            time.sleep(.25)
    raise RuntimeError(f"Timed out waiting for {url}")


def main():
    build = subprocess.run([PNPM, "build"], cwd=WEB)
    if build.returncode:
        return build.returncode

    with tempfile.TemporaryDirectory(prefix="synapse-f11a-", ignore_cleanup_errors=True) as temp:
        temp_path = Path(temp)
        db_url = f"sqlite:///{temp_path / 'f11a.sqlite'}"
        secret = "f11a-verification-only-jwt-secret"
        os.environ.update({"SYNAPSE_DATABASE_URL": db_url, "SYNAPSE_JWT_SECRET": secret})
        sys.path.insert(0, str(API))
        from alembic import command
        from alembic.config import Config
        from app.auth.security import issue_token, password_hash
        from app.core.config import get_settings
        from app.database.session import get_engine, get_session_factory
        from app.models.user import User

        get_settings.cache_clear(); get_engine.cache_clear(); get_session_factory.cache_clear()
        previous = os.getcwd(); os.chdir(API)
        try:
            command.upgrade(Config("alembic.ini"), "0016_tenant_validity")
        finally:
            os.chdir(previous)
        factory = get_session_factory()
        password = "F11a-Seed-Password-2026!"
        with factory() as db:
            admin = User(user_name="f11a-platform-admin", nick_name="F11a Platform Admin", email="f11a-admin@example.com", password_hash=password_hash(password), platform_role="platform_admin")
            ordinary = User(user_name="f11a-ordinary", nick_name="Ordinary Account", email="f11a-ordinary@example.com", password_hash=password_hash(password))
            victim = User(user_name="f11a-victim", nick_name="Victim Before Edit", email="f11a-victim@example.com", phonenumber="555-0130", password_hash=password_hash(password))
            db.add_all([admin, ordinary, victim])
            db.add_all([
                User(user_name=f"f11a-seed-{index:02d}", nick_name=f"F11a Seed {index:02d}", email=f"f11a-seed-{index:02d}@example.com", password_hash=password_hash(password))
                for index in range(22)
            ])
            db.commit()
            seed = {
                "admin_id": str(admin.user_id), "ordinary_id": str(ordinary.user_id), "victim_id": str(victim.user_id),
                "password": password,
                "admin_token": issue_token(admin.user_id, admin.token_version),
                "ordinary_token": issue_token(ordinary.user_id, ordinary.token_version),
                "victim_token": issue_token(victim.user_id, victim.token_version),
            }
        seed_path = temp_path / "seed.json"
        seed_path.write_text(json.dumps(seed))
        env = os.environ.copy()
        api_port, web_port = free_port(), free_port()
        env.update({"SYNAPSE_DATABASE_URL": db_url, "SYNAPSE_JWT_SECRET": secret, "VITE_API_PROXY_TARGET": f"http://127.0.0.1:{api_port}"})
        api_log = (temp_path / "api.log").open("w")
        web_log = (temp_path / "vite.log").open("w")
        api = subprocess.Popen([sys.executable, "-m", "uvicorn", "app.main:create_app", "--factory", "--host", "127.0.0.1", "--port", str(api_port)], cwd=API, env=env, stdout=api_log, stderr=api_log)
        web = subprocess.Popen([PNPM, "dev", "--host", "127.0.0.1", "--port", str(web_port), "--strictPort"], cwd=WEB, env=env, stdout=web_log, stderr=web_log)
        seed.update({"web": f"http://127.0.0.1:{web_port}", "api": f"http://127.0.0.1:{api_port}/api/v1"})
        seed_path.write_text(json.dumps(seed))
        try:
            wait_url(seed["api"] + "/health", api)
            wait_url(seed["web"], web)
            return subprocess.run(["node", str(FLOW), str(seed_path)], cwd=WEB, env=env).returncode
        finally:
            terminate_process_tree(web); terminate_process_tree(api)
            api_log.close(); web_log.close()


if __name__ == "__main__":
    raise SystemExit(main())
