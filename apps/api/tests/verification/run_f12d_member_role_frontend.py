"""Run F12d member-role UI checks against a disposable migrated API and Vite app."""
import json
import os
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
FLOW = Path(__file__).with_name("f12d_member_role_frontend.mjs")


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

    with tempfile.TemporaryDirectory(prefix="synapse-f12d-") as temp:
        temp_path = Path(temp)
        db_url = f"sqlite:///{temp_path / 'f12d.sqlite'}"
        secret = "f12d-verification-only-jwt-secret"
        os.environ.update({"SYNAPSE_DATABASE_URL": db_url, "SYNAPSE_JWT_SECRET": secret})
        sys.path.insert(0, str(API))
        from alembic import command
        from alembic.config import Config
        from app.auth.security import issue_token, password_hash
        from app.core.config import get_settings
        from app.database.session import get_engine, get_session_factory
        from app.models.tenant import Tenant, TenantMember
        from app.models.tenant_member_role import TenantMemberRole
        from app.models.tenant_role import TenantRole
        from app.models.user import User

        get_settings.cache_clear(); get_engine.cache_clear(); get_session_factory.cache_clear()
        previous = os.getcwd(); os.chdir(API)
        try:
            command.upgrade(Config("alembic.ini"), "head")
        finally:
            os.chdir(previous)

        factory = get_session_factory()
        with factory() as db:
            users = [
                User(user_name="f12d-manager", nick_name="F12d Manager", email="f12d-manager@example.com", password_hash=password_hash("unused-password-long")),
                User(user_name="f12d-member", nick_name="F12d Member", email="f12d-member@example.com", password_hash=password_hash("unused-password-long")),
                User(user_name="f12d-owner-b", nick_name="F12d Tenant B Owner", email="f12d-owner-b@example.com", password_hash=password_hash("unused-password-long")),
            ]
            db.add_all(users); db.flush()
            actor, member, owner_b = users
            tenant_a = Tenant(slug="f12d-alpha", name="F12d Tenant Alpha", status="active", settings_json="{}", membership_version=1)
            tenant_b = Tenant(slug="f12d-beta", name="F12d Tenant Beta", status="active", settings_json="{}", membership_version=1)
            db.add_all([tenant_a, tenant_b]); db.flush()
            from datetime import datetime, timezone
            now = datetime.now(timezone.utc)
            db.add_all([
                TenantMember(tenant_id=tenant_a.tenant_id, user_id=actor.user_id, status="active", tenant_role="owner", joined_at=now),
                TenantMember(tenant_id=tenant_a.tenant_id, user_id=member.user_id, status="active", tenant_role="member", joined_at=now),
                TenantMember(tenant_id=tenant_b.tenant_id, user_id=actor.user_id, status="active", tenant_role="admin", joined_at=now),
                TenantMember(tenant_id=tenant_b.tenant_id, user_id=owner_b.user_id, status="active", tenant_role="owner", joined_at=now),
                TenantMember(tenant_id=tenant_b.tenant_id, user_id=member.user_id, status="active", tenant_role="member", joined_at=now),
            ])
            db.flush()
            roles_a = [
                TenantRole(tenant_id=tenant_a.tenant_id, role_name="Alpha Reviewer", role_key="alpha_reviewer", role_sort=1, status="active", permissions_json='["tenant:read"]', created_by=actor.user_id, updated_by=actor.user_id, created_at=now, updated_at=now),
                TenantRole(tenant_id=tenant_a.tenant_id, role_name="Alpha Editor", role_key="alpha_editor", role_sort=2, status="active", permissions_json='["tenant:update"]', created_by=actor.user_id, updated_by=actor.user_id, created_at=now, updated_at=now),
                TenantRole(tenant_id=tenant_a.tenant_id, role_name="Alpha Disabled", role_key="alpha_disabled", role_sort=3, status="disabled", permissions_json='["tenant:archive"]', created_by=actor.user_id, updated_by=actor.user_id, created_at=now, updated_at=now),
            ]
            roles_b = [
                TenantRole(tenant_id=tenant_b.tenant_id, role_name="Beta Auditor", role_key="beta_auditor", role_sort=1, status="active", permissions_json='["tenant:read"]', created_by=actor.user_id, updated_by=actor.user_id, created_at=now, updated_at=now),
                TenantRole(tenant_id=tenant_b.tenant_id, role_name="Beta Editor", role_key="beta_editor", role_sort=2, status="active", permissions_json='["tenant:update"]', created_by=actor.user_id, updated_by=actor.user_id, created_at=now, updated_at=now),
            ]
            db.add_all(roles_a + roles_b); db.flush()
            db.add_all([
                TenantMemberRole(tenant_id=tenant_a.tenant_id, user_id=member.user_id, role_id=roles_a[0].role_id, assigned_by=actor.user_id, assigned_at=now),
                TenantMemberRole(tenant_id=tenant_b.tenant_id, user_id=member.user_id, role_id=roles_b[0].role_id, assigned_by=actor.user_id, assigned_at=now),
            ])
            db.commit()
            seed = {
                "actor_id": str(actor.user_id), "member_id": str(member.user_id),
                "tenant_a_id": str(tenant_a.tenant_id), "tenant_b_id": str(tenant_b.tenant_id),
                "alpha_reviewer_id": str(roles_a[0].role_id), "alpha_editor_id": str(roles_a[1].role_id),
                "alpha_disabled_id": str(roles_a[2].role_id), "beta_auditor_id": str(roles_b[0].role_id),
                "beta_editor_id": str(roles_b[1].role_id),
                "actor_token": issue_token(actor.user_id, actor.token_version),
                "member_token": issue_token(member.user_id, member.token_version),
            }

        seed_path = temp_path / "seed.json"
        seed_path.write_text(json.dumps(seed))
        env = os.environ.copy()
        api_port, web_port = free_port(), free_port()
        env.update({"SYNAPSE_DATABASE_URL": db_url, "SYNAPSE_JWT_SECRET": secret, "SYNAPSE_API_PREFIX": "/api/v1", "VITE_API_PROXY_TARGET": f"http://127.0.0.1:{api_port}"})
        api_log = (temp_path / "api.log").open("w")
        web_log = (temp_path / "vite.log").open("w")
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
