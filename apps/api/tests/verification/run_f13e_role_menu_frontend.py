"""Build and browser-verify tenant role-menu grants against disposable real API data."""
import json
import os
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
FLOW = Path(__file__).with_name("f13e_role_menu_frontend.mjs")


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


def main():
    build = subprocess.run(["pnpm", "build"], cwd=WEB)
    if build.returncode:
        print(f"F13e build failed with exit code {build.returncode}; continuing dev-server/browser checks to collect independent evidence.")

    with tempfile.TemporaryDirectory(prefix="synapse-f13e-") as temporary:
        temp = Path(temporary)
        database_url = f"sqlite:///{temp / 'f13e.sqlite'}"
        secret = "f13e-verification-only-secret"
        os.environ.update({"SYNAPSE_DATABASE_URL": database_url, "SYNAPSE_JWT_SECRET": secret})
        sys.path.insert(0, str(API))
        from alembic import command
        from alembic.config import Config
        from app.auth.security import issue_token
        from app.core.config import get_settings
        from app.database.session import get_engine, get_session_factory
        from app.models.tenant import Tenant, TenantMember
        from app.models.tenant_menu import TenantMenu
        from app.models.tenant_role import TenantRole
        from app.models.tenant_role_menu import TenantRoleMenu
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
            manager = User(user_name="f13e-manager", nick_name="F13e Manager", email="manager-f13e@example.test", password_hash="unused")
            member = User(user_name="f13e-member", nick_name="F13e Member", email="member-f13e@example.test", password_hash="unused")
            db.add_all([manager, member]); db.flush()
            tenant_a = Tenant(slug="f13e-alpha", name="F13e Tenant Alpha", status="active", settings_json="{}", membership_version=1)
            tenant_b = Tenant(slug="f13e-beta", name="F13e Tenant Beta", status="active", settings_json="{}", membership_version=1)
            db.add_all([tenant_a, tenant_b]); db.flush()
            tenant_a_id, tenant_b_id = tenant_a.tenant_id, tenant_b.tenant_id
            db.add_all([
                TenantMember(tenant_id=tenant_a_id, user_id=manager.user_id, status="active", tenant_role="owner", joined_at=now),
                TenantMember(tenant_id=tenant_b_id, user_id=manager.user_id, status="active", tenant_role="admin", joined_at=now),
                TenantMember(tenant_id=tenant_a_id, user_id=member.user_id, status="active", tenant_role="member", joined_at=now),
            ])
            db.flush()
            role_a = TenantRole(tenant_id=tenant_a_id, role_name="Alpha Menu Role", role_key="alpha_menu_role", role_sort=1, status="active", permissions_json='["tenant:read"]', created_by=manager.user_id, updated_by=manager.user_id, created_at=now, updated_at=now)
            role_a2 = TenantRole(tenant_id=tenant_a_id, role_name="Alpha Second Role", role_key="alpha_second_role", role_sort=2, status="active", permissions_json='["tenant:update"]', created_by=manager.user_id, updated_by=manager.user_id, created_at=now, updated_at=now)
            role_b = TenantRole(tenant_id=tenant_b_id, role_name="Beta Menu Role", role_key="beta_menu_role", role_sort=1, status="active", permissions_json='["tenant:read"]', created_by=manager.user_id, updated_by=manager.user_id, created_at=now, updated_at=now)
            db.add_all([role_a, role_a2, role_b]); db.flush()

            def menu(tenant_id, name, parent_id, status="0", deleted=False, menu_type="C", order=0):
                return TenantMenu(tenant_id=tenant_id, parent_id=parent_id, menu_name=name, order_num=order,
                                  path="/" + name.lower().replace(" ", "-"), component=None, query=None,
                                  is_frame=1, is_cache=0, menu_type=menu_type, visible="0", status=status,
                                  perms=None, icon="#", remark=None, del_flag=deleted, created_by=manager.user_id,
                                  updated_by=manager.user_id, created_at=now, updated_at=now)

            a_root = menu(tenant_a_id, "Alpha Directory", None, menu_type="M", order=0)
            db.add(a_root); db.flush()
            a_one = menu(tenant_a_id, "Alpha Enabled One", a_root.menu_id, order=1)
            a_two = menu(tenant_a_id, "Alpha Enabled Two", a_root.menu_id, order=2)
            a_disabled = menu(tenant_a_id, "Alpha Disabled Menu", a_root.menu_id, status="1", order=3)
            a_deleted = menu(tenant_a_id, "Alpha Deleted Menu", None, deleted=True, order=4)
            a_stale = menu(tenant_a_id, "Alpha Stale Menu", None, order=5)
            b_root = menu(tenant_b_id, "Beta Directory", None, menu_type="M", order=0)
            db.add_all([a_one, a_two, a_disabled, a_deleted, a_stale, b_root]); db.flush()
            b_one = menu(tenant_b_id, "Beta Enabled One", b_root.menu_id, order=1)
            b_two = menu(tenant_b_id, "Beta Enabled Two", b_root.menu_id, order=2)
            db.add_all([b_one, b_two]); db.flush()
            ids = {
                "role_a": role_a.role_id, "role_a2": role_a2.role_id, "role_b": role_b.role_id,
                "a_one": a_one.menu_id, "a_two": a_two.menu_id, "a_disabled": a_disabled.menu_id,
                "a_deleted": a_deleted.menu_id, "a_stale": a_stale.menu_id,
                "b_one": b_one.menu_id, "b_two": b_two.menu_id,
            }
            db.add_all([
                TenantRoleMenu(tenant_id=tenant_a_id, role_id=role_a.role_id, menu_id=a_one.menu_id, created_by=manager.user_id, created_at=now),
                TenantRoleMenu(tenant_id=tenant_a_id, role_id=role_a.role_id, menu_id=a_disabled.menu_id, created_by=manager.user_id, created_at=now),
                TenantRoleMenu(tenant_id=tenant_a_id, role_id=role_a.role_id, menu_id=a_deleted.menu_id, created_by=manager.user_id, created_at=now),
                TenantRoleMenu(tenant_id=tenant_a_id, role_id=role_a2.role_id, menu_id=a_one.menu_id, created_by=manager.user_id, created_at=now),
                TenantRoleMenu(tenant_id=tenant_b_id, role_id=role_b.role_id, menu_id=b_one.menu_id, created_by=manager.user_id, created_at=now),
            ])
            db.commit()
            seed = {
                "tenant_a_id": str(tenant_a_id), "tenant_b_id": str(tenant_b_id),
                "manager_token": issue_token(manager.user_id, manager.token_version),
                "member_token": issue_token(member.user_id, member.token_version),
                **{key: str(value) for key, value in ids.items()},
            }

        api_port, web_port = free_port(), free_port()
        env = os.environ.copy()
        env.update({"SYNAPSE_DATABASE_URL": database_url, "SYNAPSE_JWT_SECRET": secret,
                    "SYNAPSE_API_PREFIX": "/api/v1", "VITE_API_PROXY_TARGET": f"http://127.0.0.1:{api_port}"})
        api_log = (temp / "api.log").open("w")
        web_log = (temp / "vite.log").open("w")
        api = subprocess.Popen([sys.executable, "-m", "uvicorn", "app.main:create_app", "--factory", "--host", "127.0.0.1", "--port", str(api_port)], cwd=API, env=env, stdout=api_log, stderr=api_log)
        web = subprocess.Popen(["pnpm", "dev", "--host", "127.0.0.1", "--port", str(web_port), "--strictPort"], cwd=WEB, env=env, stdout=web_log, stderr=web_log)
        seed.update({"web": f"http://127.0.0.1:{web_port}", "api": f"http://127.0.0.1:{api_port}/api/v1"})
        seed_path = temp / "seed.json"
        seed_path.write_text(json.dumps(seed))
        try:
            wait_url(seed["api"] + "/health", api)
            wait_url(seed["web"], web)
            browser_result = subprocess.run(["node", str(FLOW), str(seed_path)], cwd=WEB, env=env).returncode
            return browser_result if browser_result else build.returncode
        finally:
            web.terminate(); api.terminate()
            web.wait(timeout=10); api.wait(timeout=10)
            api_log.close(); web_log.close()


if __name__ == "__main__":
    raise SystemExit(main())
