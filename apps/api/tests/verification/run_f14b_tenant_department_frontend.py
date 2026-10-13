"""Build and browser-verify tenant department management against disposable API data."""
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
FLOW = Path(__file__).with_name("f14b_tenant_department_frontend.mjs")
PNPM = shutil.which("pnpm") or ("pnpm.cmd" if os.name == "nt" else "pnpm")


def free_port():
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


def wait_url(url, process):
    deadline = time.time() + 40
    while time.time() < deadline:
        if process.poll() is not None:
            raise RuntimeError(f"Server exited ({process.returncode}) before {url}")
        try:
            with urllib.request.urlopen(url, timeout=1) as response:
                if response.status < 500:
                    return
        except Exception:
            time.sleep(.25)
    raise RuntimeError(f"Timed out waiting for {url}")


def terminate_process_tree(process):
    """Terminate the server and any child process holding temporary logs."""
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


def main():
    if os.environ.get("F14B_SKIP_BUILD") != "1":
        build = subprocess.run([PNPM, "build"], cwd=WEB)
        if build.returncode:
            return build.returncode

    with tempfile.TemporaryDirectory(prefix="synapse-f14b-") as temporary:
        temp = Path(temporary)
        database_url = f"sqlite:///{temp / 'f14b.sqlite'}"
        secret = "f14b-verification-only-secret"
        os.environ.update({"SYNAPSE_DATABASE_URL": database_url, "SYNAPSE_JWT_SECRET": secret})
        sys.path.insert(0, str(API))
        from alembic import command
        from alembic.config import Config
        from app.auth.security import issue_token
        from app.core.config import get_settings
        from app.database.session import get_engine, get_session_factory
        from app.models.tenant import Tenant, TenantMember
        from app.models.tenant_department import TenantDepartment
        from app.models.user import User

        get_settings.cache_clear(); get_engine.cache_clear(); get_session_factory.cache_clear()
        old_cwd = os.getcwd(); os.chdir(API)
        try:
            command.upgrade(Config("alembic.ini"), "head")
        finally:
            os.chdir(old_cwd)

        now = datetime.now(timezone.utc)
        factory = get_session_factory()
        with factory() as db:
            manager = User(user_name="f14b-manager", nick_name="F14b Manager", email="manager-f14b@example.test", password_hash="unused")
            member = User(user_name="f14b-member", nick_name="F14b Member", email="member-f14b@example.test", password_hash="unused")
            db.add_all([manager, member]); db.flush()
            tenant_a = Tenant(slug="f14b-alpha", name="F14b Tenant Alpha", status="active", settings_json="{}", membership_version=1)
            tenant_b = Tenant(slug="f14b-beta", name="F14b Tenant Beta", status="active", settings_json="{}", membership_version=1)
            db.add_all([tenant_a, tenant_b]); db.flush()
            a_id, b_id = tenant_a.tenant_id, tenant_b.tenant_id
            db.add_all([
                TenantMember(tenant_id=a_id, user_id=manager.user_id, status="active", tenant_role="owner", joined_at=now),
                TenantMember(tenant_id=b_id, user_id=manager.user_id, status="active", tenant_role="admin", joined_at=now),
                TenantMember(tenant_id=a_id, user_id=member.user_id, status="active", tenant_role="member", joined_at=now),
            ])
            db.flush()

            def dept(tenant_id, name, parent_id, order):
                ancestors = "0" if parent_id is None else None
                return TenantDepartment(tenant_id=tenant_id, parent_id=parent_id, ancestors=ancestors or "0", dept_name=name,
                                        order_num=order, leader=None, phone=None, email=None, status="0", del_flag=False,
                                        created_by=manager.user_id, updated_by=manager.user_id, created_at=now, updated_at=now)

            a_root = dept(a_id, "Alpha Root", None, 10)
            b_root = dept(b_id, "Beta Root", None, 10)
            db.add_all([a_root, b_root]); db.flush()
            a_sibling = dept(a_id, "Alpha Sibling", None, 20)
            a_child = dept(a_id, "Alpha Child", a_root.department_id, 10)
            b_child = dept(b_id, "Beta Child", b_root.department_id, 10)
            db.add_all([a_sibling, a_child, b_child]); db.commit()
            seed = {
                "tenant_a_id": str(a_id), "tenant_b_id": str(b_id),
                "manager_id": str(manager.user_id), "member_id": str(member.user_id),
                "manager_token": issue_token(manager.user_id, manager.token_version),
                "member_token": issue_token(member.user_id, member.token_version),
                "alpha_root_id": str(a_root.department_id), "alpha_sibling_id": str(a_sibling.department_id),
                "alpha_child_id": str(a_child.department_id), "beta_root_id": str(b_root.department_id),
                "beta_child_id": str(b_child.department_id),
            }

        api_port, web_port = free_port(), free_port()
        env = os.environ.copy()
        env.update({"SYNAPSE_DATABASE_URL": database_url, "SYNAPSE_JWT_SECRET": secret,
                    "SYNAPSE_API_PREFIX": "/api/v1", "VITE_API_PROXY_TARGET": f"http://127.0.0.1:{api_port}"})
        api_log = (temp / "api.log").open("w")
        web_log = (temp / "vite.log").open("w")
        api = subprocess.Popen([sys.executable, "-m", "uvicorn", "app.main:create_app", "--factory", "--host", "127.0.0.1", "--port", str(api_port)], cwd=API, env=env, stdout=api_log, stderr=api_log)
        web = subprocess.Popen([PNPM, "dev", "--host", "127.0.0.1", "--port", str(web_port), "--strictPort"], cwd=WEB, env=env, stdout=web_log, stderr=web_log)
        seed.update({"web": f"http://127.0.0.1:{web_port}", "api": f"http://127.0.0.1:{api_port}/api/v1"})
        seed_path = temp / "seed.json"
        seed_path.write_text(json.dumps(seed))
        try:
            try:
                wait_url(seed["api"] + "/health", api)
                wait_url(seed["web"], web)
            except Exception:
                print("API server log:\n", (temp / "api.log").read_text(errors="replace"), file=sys.stderr)
                print("Vite server log:\n", (temp / "vite.log").read_text(errors="replace"), file=sys.stderr)
                raise
            return subprocess.run(["node", str(FLOW.resolve()), str(seed_path)], cwd=WEB, env=env).returncode
        finally:
            terminate_process_tree(web)
            terminate_process_tree(api)
            api_log.close(); web_log.close()
            get_engine().dispose()
            get_session_factory.cache_clear()
            get_engine.cache_clear()


if __name__ == "__main__":
    raise SystemExit(main())
