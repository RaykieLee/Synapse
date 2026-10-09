"""Build and run F13b tenant-menu UI acceptance against disposable API data."""
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
FLOW = Path(__file__).with_name("f13b_tenant_menu_frontend.mjs")


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
    build = subprocess.run(["pnpm", "build"], cwd=WEB)
    if build.returncode:
        return build.returncode

    with tempfile.TemporaryDirectory(prefix="synapse-f13b-") as temporary:
        temp = Path(temporary)
        database_url = f"sqlite:///{temp / 'f13b.sqlite'}"
        secret = "f13b-verification-only-jwt-secret"
        os.environ.update({"SYNAPSE_DATABASE_URL": database_url, "SYNAPSE_JWT_SECRET": secret})
        sys.path.insert(0, str(API))
        from alembic import command
        from alembic.config import Config
        from app.auth.security import issue_token
        from app.core.config import get_settings
        from app.database.session import get_engine, get_session_factory
        from app.models.tenant import Tenant, TenantMember
        from app.models.tenant_menu import TenantMenu
        from app.models.user import User

        get_settings.cache_clear(); get_engine.cache_clear(); get_session_factory.cache_clear()
        previous = os.getcwd(); os.chdir(API)
        try:
            command.upgrade(Config("alembic.ini"), "head")
        finally:
            os.chdir(previous)

        factory = get_session_factory()
        with factory() as db:
            actor = User(user_name="f13b-manager", nick_name="F13b Menu Manager", email="f13b-manager@example.com", password_hash="unused")
            member = User(user_name="f13b-member", nick_name="F13b Ordinary Member", email="f13b-member@example.com", password_hash="unused")
            owner_b = User(user_name="f13b-owner-b", nick_name="F13b Beta Owner", email="f13b-owner-b@example.com", password_hash="unused")
            db.add_all([actor, member, owner_b]); db.flush()
            tenant_a = Tenant(slug="f13b-alpha", name="F13b Tenant Alpha", status="active", settings_json="{}", membership_version=1)
            tenant_b = Tenant(slug="f13b-beta", name="F13b Tenant Beta", status="active", settings_json="{}", membership_version=1)
            db.add_all([tenant_a, tenant_b]); db.flush()
            now = datetime.now(timezone.utc)
            db.add_all([
                TenantMember(tenant_id=tenant_a.tenant_id, user_id=actor.user_id, status="active", tenant_role="owner", joined_at=now),
                TenantMember(tenant_id=tenant_a.tenant_id, user_id=member.user_id, status="active", tenant_role="member", joined_at=now),
                TenantMember(tenant_id=tenant_b.tenant_id, user_id=actor.user_id, status="active", tenant_role="admin", joined_at=now),
                TenantMember(tenant_id=tenant_b.tenant_id, user_id=owner_b.user_id, status="active", tenant_role="owner", joined_at=now),
            ])
            db.flush()
            alpha_root_one = TenantMenu(tenant_id=tenant_a.tenant_id, parent_id=None, menu_name="Alpha Root One", order_num=10, path="/alpha-one", is_frame=1, is_cache=0, menu_type="M", visible="0", status="0", icon="#", created_by=actor.user_id, updated_by=actor.user_id, created_at=now, updated_at=now)
            alpha_root_two = TenantMenu(tenant_id=tenant_a.tenant_id, parent_id=None, menu_name="Alpha Root Two", order_num=20, path="/alpha-two", is_frame=1, is_cache=0, menu_type="M", visible="0", status="0", icon="#", created_by=actor.user_id, updated_by=actor.user_id, created_at=now, updated_at=now)
            beta_root = TenantMenu(tenant_id=tenant_b.tenant_id, parent_id=None, menu_name="Beta Private Root", order_num=10, path="/beta-private", is_frame=1, is_cache=0, menu_type="M", visible="0", status="0", icon="#", created_by=owner_b.user_id, updated_by=owner_b.user_id, created_at=now, updated_at=now)
            db.add_all([alpha_root_one, alpha_root_two, beta_root]); db.flush()
            alpha_child = TenantMenu(tenant_id=tenant_a.tenant_id, parent_id=alpha_root_one.menu_id, menu_name="Alpha Leaf", order_num=10, path="/alpha-leaf", is_frame=1, is_cache=0, menu_type="C", visible="0", status="0", icon="#", created_by=actor.user_id, updated_by=actor.user_id, created_at=now, updated_at=now)
            db.add(alpha_child); db.commit()
            seed = {
                "tenant_a_id": str(tenant_a.tenant_id), "tenant_b_id": str(tenant_b.tenant_id),
                "actor_token": issue_token(actor.user_id, actor.token_version),
                "member_token": issue_token(member.user_id, member.token_version),
                "alpha_root_one_id": str(alpha_root_one.menu_id), "alpha_root_two_id": str(alpha_root_two.menu_id),
                "alpha_leaf_id": str(alpha_child.menu_id), "beta_root_id": str(beta_root.menu_id),
            }

        seed_path = temp / "seed.json"
        seed_path.write_text(json.dumps(seed))
        env = os.environ.copy()
        api_port, web_port = free_port(), free_port()
        env.update({"SYNAPSE_DATABASE_URL": database_url, "SYNAPSE_JWT_SECRET": secret, "SYNAPSE_API_PREFIX": "/api/v1", "VITE_API_PROXY_TARGET": f"http://127.0.0.1:{api_port}"})
        api_log = (temp / "api.log").open("w")
        web_log = (temp / "vite.log").open("w")
        api = subprocess.Popen([sys.executable, "-m", "uvicorn", "app.main:create_app", "--factory", "--host", "127.0.0.1", "--port", str(api_port)], cwd=API, env=env, stdout=api_log, stderr=api_log)
        web = subprocess.Popen(["pnpm", "dev", "--host", "127.0.0.1", "--port", str(web_port), "--strictPort"], cwd=WEB, env=env, stdout=web_log, stderr=web_log)
        seed.update({"web": f"http://127.0.0.1:{web_port}", "api": f"http://127.0.0.1:{api_port}/api/v1"})
        seed_path.write_text(json.dumps(seed))
        try:
            wait_url(seed["api"] + "/health", api)
            wait_url(seed["web"], web)
            return subprocess.run(["node", str(FLOW), str(seed_path)], cwd=WEB, env=env).returncode
        finally:
            web.terminate(); api.terminate()
            web.wait(timeout=10); api.wait(timeout=10)
            api_log.close(); web_log.close()


if __name__ == "__main__":
    raise SystemExit(main())
