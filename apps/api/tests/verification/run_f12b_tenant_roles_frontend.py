"""Run F12b frontend build and browser acceptance against disposable API data."""
import json
import os
import shutil
import socket
import subprocess
import sys
import tempfile
import time
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[4]
API = ROOT / "apps" / "api"
WEB = ROOT / "apps" / "web"
PLAYWRIGHT = Path(__file__).with_name("f12b_tenant_roles_frontend.mjs")
PNPM = shutil.which("pnpm") or shutil.which("pnpm.cmd") or "pnpm.cmd"
NODE = shutil.which("node") or "node"


def terminate_tree(process):
    if process.poll() is None:
        if os.name == "nt":
            subprocess.run(["taskkill", "/PID", str(process.pid), "/T", "/F"], capture_output=True)
        else:
            process.terminate()
    try:
        process.wait(timeout=8)
    except subprocess.TimeoutExpired:
        process.kill()
        process.wait(timeout=5)


def free_port():
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


def wait_url(url, process, timeout=30):
    end = time.time() + timeout
    while time.time() < end:
        if process.poll() is not None:
            raise RuntimeError(f"Server exited early ({process.returncode}): {url}")
        try:
            with urllib.request.urlopen(url, timeout=1) as response:
                if response.status < 500:
                    return
        except Exception:
            time.sleep(.25)
    raise RuntimeError(f"Timed out waiting for {url}")


def main():
    build = subprocess.run([PNPM, "build"], cwd=WEB, text=True)
    if build.returncode:
        return build.returncode

    with tempfile.TemporaryDirectory(prefix="synapse-f12b-") as temporary:
        temporary_path = Path(temporary)
        database_url = f"sqlite:///{temporary_path / 'f12b.sqlite'}"
        env = os.environ.copy()
        env.update({
            "SYNAPSE_DATABASE_URL": database_url,
            "SYNAPSE_JWT_SECRET": "f12b-verification-only-secret",
            "SYNAPSE_AGENTSCOPE_ENABLED": "false",
            "SYNAPSE_SCHEDULED_TASKS_ENABLED": "false",
        })
        sys.path.insert(0, str(API))
        os.environ.update({
            key: env[key]
            for key in (
                "SYNAPSE_DATABASE_URL",
                "SYNAPSE_JWT_SECRET",
                "SYNAPSE_AGENTSCOPE_ENABLED",
                "SYNAPSE_SCHEDULED_TASKS_ENABLED",
            )
        })

        from alembic import command
        from alembic.config import Config
        from app.auth.security import issue_token
        from app.core.config import get_settings
        from app.database.session import get_engine, get_session_factory
        from app.models.tenant import Tenant, TenantMember
        from app.models.tenant_role import TenantRole
        from app.models.user import User

        get_settings.cache_clear()
        get_engine.cache_clear()
        get_session_factory.cache_clear()
        old_cwd = os.getcwd()
        os.chdir(API)
        try:
            # F12c's member-role migration is stable; use current head for the integrated UI.
            command.upgrade(Config("alembic.ini"), "head")
        finally:
            os.chdir(old_cwd)

        factory = get_session_factory()
        with factory() as db:
            manager = User(user_name="f12b-manager", nick_name="Role Manager",
                           email="f12b-manager@example.test", password_hash="unused")
            member = User(user_name="f12b-member", nick_name="Tenant Member",
                          email="f12b-member@example.test", password_hash="unused")
            db.add_all([manager, member])
            db.flush()
            tenant_a = Tenant(slug="f12b-alpha", name="F12b Tenant A", status="active",
                              settings_json="{}", membership_version=1)
            tenant_b = Tenant(slug="f12b-beta", name="F12b Tenant B", status="active",
                              settings_json="{}", membership_version=1)
            db.add_all([tenant_a, tenant_b])
            db.flush()
            now = datetime_now()
            db.add_all([
                TenantMember(tenant_id=tenant_a.tenant_id, user_id=manager.user_id,
                             status="active", tenant_role="owner", joined_at=now),
                TenantMember(tenant_id=tenant_b.tenant_id, user_id=manager.user_id,
                             status="active", tenant_role="admin", joined_at=now),
                TenantMember(tenant_id=tenant_a.tenant_id, user_id=member.user_id,
                             status="active", tenant_role="member", joined_at=now),
            ])
            for index in range(20):
                db.add(TenantRole(
                    tenant_id=tenant_a.tenant_id,
                    role_name=f"Seed alpha {index:02d}",
                    role_key=f"seed_alpha_{index:02d}",
                    role_sort=10 + index,
                    status="active",
                    permissions_json='["tenant:read"]',
                    created_by=manager.user_id,
                    updated_by=manager.user_id,
                    created_at=now,
                    updated_at=now,
                ))
            db.add_all([
                TenantRole(tenant_id=tenant_a.tenant_id, role_name="Alpha only sentinel",
                           role_key="alpha_only_sentinel", role_sort=0, status="active",
                           permissions_json='["tenant:read"]', created_by=manager.user_id,
                           updated_by=manager.user_id, created_at=now, updated_at=now),
                TenantRole(tenant_id=tenant_a.tenant_id, role_name="Needle search target",
                           role_key="needle_search_target", role_sort=1, status="active",
                           permissions_json='["tenant:read"]', created_by=manager.user_id,
                           updated_by=manager.user_id, created_at=now, updated_at=now),
                TenantRole(tenant_id=tenant_b.tenant_id, role_name="Beta only sentinel",
                           role_key="beta_only_sentinel", role_sort=0, status="active",
                           permissions_json='["tenant:read"]', created_by=manager.user_id,
                           updated_by=manager.user_id, created_at=now, updated_at=now),
            ])
            db.commit()
            seed = {
                "tenant_a_id": str(tenant_a.tenant_id),
                "tenant_b_id": str(tenant_b.tenant_id),
                "manager_token": issue_token(manager.user_id, manager.token_version),
                "member_token": issue_token(member.user_id, member.token_version),
            }

        api_port, web_port = free_port(), free_port()
        env["SYNAPSE_API_PREFIX"] = "/api/v1"
        api_log = (temporary_path / "api.log").open("w")
        web_log = (temporary_path / "vite.log").open("w")
        api = subprocess.Popen(
            [sys.executable, "-m", "uvicorn", "app.main:create_app", "--factory",
             "--host", "127.0.0.1", "--port", str(api_port)],
            cwd=API, env=env, stdout=api_log, stderr=api_log,
        )
        env["VITE_API_PROXY_TARGET"] = f"http://127.0.0.1:{api_port}"
        web = subprocess.Popen(
            [NODE, str(WEB / "node_modules" / "vite" / "bin" / "vite.js"),
             "--host", "127.0.0.1", "--port", str(web_port), "--strictPort"],
            cwd=WEB, env=env, stdout=web_log, stderr=web_log,
        )
        seed["web"] = f"http://127.0.0.1:{web_port}"
        seed_path = temporary_path / "seed.json"
        seed_path.write_text(json.dumps(seed))
        try:
            api_base = f"http://127.0.0.1:{api_port}/api/v1"
            try:
                wait_url(api_base + "/health", api)
                wait_url(seed["web"], web)
            except Exception:
                api_log.flush()
                web_log.flush()
                print("API server log:\n" + (temporary_path / "api.log").read_text(encoding="utf-8", errors="replace"), file=sys.stderr)
                print("Vite server log:\n" + (temporary_path / "vite.log").read_text(encoding="utf-8", errors="replace"), file=sys.stderr)
                raise
            result = subprocess.run(["node", str(PLAYWRIGHT), str(seed_path)], cwd=WEB, env=env)
            return result.returncode
        finally:
            terminate_tree(web)
            terminate_tree(api)
            api_log.close()
            web_log.close()
            get_engine().dispose()
            get_session_factory.cache_clear()
            get_engine.cache_clear()


def datetime_now():
    from datetime import datetime, timezone
    return datetime.now(timezone.utc)


if __name__ == "__main__":
    raise SystemExit(main())
