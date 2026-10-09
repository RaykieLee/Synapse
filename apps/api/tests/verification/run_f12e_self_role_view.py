"""F12e API and browser verification for ordinary-member custom-role self reads."""
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
FLOW = Path(__file__).with_name("f12e_self_role_view.mjs")


def free_port():
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


def wait_url(url, process):
    until = time.time() + 40
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

    with tempfile.TemporaryDirectory(prefix="synapse-f12e-") as temp:
        temp_path = Path(temp)
        db_url = f"sqlite:///{temp_path / 'f12e.sqlite'}"
        secret = "f12e-verification-only-jwt-secret"
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
        now = datetime.now(timezone.utc)
        with factory() as db:
            users = [
                User(user_name="f12e-member", nick_name="F12e Member", email="f12e-member@example.test", password_hash=password_hash("unused-password-long")),
                User(user_name="f12e-owner-a", nick_name="F12e Owner A", email="f12e-owner-a@example.test", password_hash=password_hash("unused-password-long")),
                User(user_name="f12e-admin-a", nick_name="F12e Admin A", email="f12e-admin-a@example.test", password_hash=password_hash("unused-password-long")),
                User(user_name="f12e-other-a", nick_name="F12e Other A", email="f12e-other-a@example.test", password_hash=password_hash("unused-password-long")),
                User(user_name="f12e-owner-b", nick_name="F12e Owner B", email="f12e-owner-b@example.test", password_hash=password_hash("unused-password-long")),
                User(user_name="f12e-other-b", nick_name="F12e Other B", email="f12e-other-b@example.test", password_hash=password_hash("unused-password-long")),
            ]
            db.add_all(users); db.flush()
            user_ids = {user.user_name: user.user_id for user in users}
            tenant_a = Tenant(slug="f12e-alpha", name="F12e Tenant Alpha", status="active", settings_json="{}", membership_version=1)
            tenant_b = Tenant(slug="f12e-beta", name="F12e Tenant Beta", status="active", settings_json="{}", membership_version=1)
            db.add_all([tenant_a, tenant_b]); db.flush()
            db.add_all([
                TenantMember(tenant_id=tenant_a.tenant_id, user_id=user_ids["f12e-member"], status="active", tenant_role="member", joined_at=now),
                TenantMember(tenant_id=tenant_a.tenant_id, user_id=user_ids["f12e-owner-a"], status="active", tenant_role="owner", joined_at=now),
                TenantMember(tenant_id=tenant_a.tenant_id, user_id=user_ids["f12e-admin-a"], status="active", tenant_role="admin", joined_at=now),
                TenantMember(tenant_id=tenant_a.tenant_id, user_id=user_ids["f12e-other-a"], status="active", tenant_role="member", joined_at=now),
                TenantMember(tenant_id=tenant_b.tenant_id, user_id=user_ids["f12e-member"], status="active", tenant_role="member", joined_at=now),
                TenantMember(tenant_id=tenant_b.tenant_id, user_id=user_ids["f12e-owner-b"], status="active", tenant_role="owner", joined_at=now),
                TenantMember(tenant_id=tenant_b.tenant_id, user_id=user_ids["f12e-other-b"], status="active", tenant_role="member", joined_at=now),
            ])
            db.flush()
            role_a = TenantRole(tenant_id=tenant_a.tenant_id, role_name="Alpha Auditor", role_key="alpha_auditor", status="active", permissions_json='["tenant:read"]', created_by=user_ids["f12e-owner-a"], updated_by=user_ids["f12e-owner-a"], created_at=now, updated_at=now)
            disabled_a = TenantRole(tenant_id=tenant_a.tenant_id, role_name="Alpha Disabled", role_key="alpha_disabled", status="disabled", permissions_json='["tenant:update"]', created_by=user_ids["f12e-owner-a"], updated_by=user_ids["f12e-owner-a"], created_at=now, updated_at=now)
            deleted_a = TenantRole(tenant_id=tenant_a.tenant_id, role_name="Alpha Deleted", role_key="alpha_deleted", status="active", permissions_json='["tenant:update"]', del_flag=True, created_by=user_ids["f12e-owner-a"], updated_by=user_ids["f12e-owner-a"], created_at=now, updated_at=now)
            role_b = TenantRole(tenant_id=tenant_b.tenant_id, role_name="Beta Analyst", role_key="beta_analyst", status="active", permissions_json='["tenant:read"]', created_by=user_ids["f12e-owner-b"], updated_by=user_ids["f12e-owner-b"], created_at=now, updated_at=now)
            db.add_all([role_a, disabled_a, deleted_a, role_b]); db.flush()
            assignments = [
                TenantMemberRole(tenant_id=tenant_a.tenant_id, user_id=user_ids["f12e-member"], role_id=role_a.role_id, assigned_by=user_ids["f12e-owner-a"], assigned_at=now),
                TenantMemberRole(tenant_id=tenant_a.tenant_id, user_id=user_ids["f12e-other-a"], role_id=role_a.role_id, assigned_by=user_ids["f12e-owner-a"], assigned_at=now),
                TenantMemberRole(tenant_id=tenant_b.tenant_id, user_id=user_ids["f12e-member"], role_id=role_b.role_id, assigned_by=user_ids["f12e-owner-b"], assigned_at=now),
            ]
            db.add_all(assignments); db.commit()
            tenant_a_id, tenant_b_id = tenant_a.tenant_id, tenant_b.tenant_id
            role_a_id, disabled_a_id, deleted_a_id, role_b_id = role_a.role_id, disabled_a.role_id, deleted_a.role_id, role_b.role_id

        from app.auth.security import issue_token
        from app.main import create_app
        tokens = {name: issue_token(user_id, 0) for name, user_id in user_ids.items()}
        app = create_app()
        with TestClient(app) as client:
            def api(method, path, actor, **kwargs):
                headers = kwargs.pop("headers", {})
                headers["Authorization"] = f"Bearer {tokens[actor]}"
                return getattr(client, method)(path, headers=headers, **kwargs)

            path_a = f"/api/v1/tenants/{tenant_a_id}/members/{user_ids['f12e-member']}/custom-role"
            path_b = f"/api/v1/tenants/{tenant_b_id}/members/{user_ids['f12e-member']}/custom-role"
            self_a = api("get", path_a, "f12e-member")
            self_b = api("get", path_b, "f12e-member")
            assert self_a.status_code == 200 and self_a.json()["role"]["role_id"] == str(role_a_id), self_a.text
            assert self_b.status_code == 200 and self_b.json()["role"]["role_id"] == str(role_b_id), self_b.text
            assert self_a.json()["role"]["role_name"] != self_b.json()["role"]["role_name"]
            other = api("get", f"/api/v1/tenants/{tenant_a_id}/members/{user_ids['f12e-other-a']}/custom-role", "f12e-member")
            assert other.status_code == 403 and other.json()["code"] == "FORBIDDEN", other.text
            foreign = api("get", f"/api/v1/tenants/{tenant_a_id}/members/{user_ids['f12e-other-b']}/custom-role", "f12e-member")
            assert foreign.status_code == 403 and foreign.json()["code"] == "FORBIDDEN", foreign.text
            for method in ("put", "delete"):
                response = api(method, path_a, "f12e-member", **({"json": {"role_id": str(role_a_id)}} if method == "put" else {}))
                assert response.status_code == 403 and response.json()["code"] == "FORBIDDEN", response.text
            for manager in ("f12e-owner-a", "f12e-admin-a"):
                manager_read = api("get", path_a, manager)
                assert manager_read.status_code == 200 and manager_read.json()["role"]["role_id"] == str(role_a_id), manager_read.text

            # Revoked, disabled, and soft-deleted assignments all render as unassigned for the active member.
            revoked = api("delete", path_a, "f12e-owner-a")
            assert revoked.status_code == 204
            assert api("get", path_a, "f12e-member").json()["role"] is None
            with factory() as db:
                db.add(TenantMemberRole(tenant_id=tenant_a_id, user_id=user_ids["f12e-member"], role_id=disabled_a_id, assigned_by=user_ids["f12e-owner-a"], assigned_at=now))
                db.commit()
            assert api("get", path_a, "f12e-member").json()["role"] is None
            with factory() as db:
                assignment = db.scalar(select(TenantMemberRole).where(TenantMemberRole.tenant_id == tenant_a_id, TenantMemberRole.user_id == user_ids["f12e-member"]))
                assignment.role_id = deleted_a_id
                db.commit()
            assert api("get", path_a, "f12e-member").json()["role"] is None
            with factory() as db:
                assignment = db.scalar(select(TenantMemberRole).where(TenantMemberRole.tenant_id == tenant_a_id, TenantMemberRole.user_id == user_ids["f12e-member"]))
                assignment.role_id = role_a_id
                db.commit()

        seed = {
            "actor_id": str(user_ids["f12e-member"]), "other_a_id": str(user_ids["f12e-other-a"]),
            "tenant_a_id": str(tenant_a_id), "tenant_b_id": str(tenant_b_id),
            "tenant_a_name": "F12e Tenant Alpha", "tenant_b_name": "F12e Tenant Beta",
            "role_a_name": "Alpha Auditor", "role_b_name": "Beta Analyst",
            "actor_token": tokens["f12e-member"],
            "owner_a_token": tokens["f12e-owner-a"], "role_a_id": str(role_a_id),
        }
        seed_path = temp_path / "seed.json"
        seed_path.write_text(json.dumps(seed))
        env = os.environ.copy()
        api_port, web_port = free_port(), free_port()
        env.update({"SYNAPSE_DATABASE_URL": db_url, "SYNAPSE_JWT_SECRET": secret, "SYNAPSE_API_PREFIX": "/api/v1", "VITE_API_PROXY_TARGET": f"http://127.0.0.1:{api_port}"})
        api_log = (temp_path / "api.log").open("w")
        web_log = (temp_path / "vite.log").open("w")
        api_server = subprocess.Popen([sys.executable, "-m", "uvicorn", "app.main:create_app", "--factory", "--host", "127.0.0.1", "--port", str(api_port)], cwd=API, env=env, stdout=api_log, stderr=api_log)
        web_server = subprocess.Popen(["pnpm", "dev", "--host", "127.0.0.1", "--port", str(web_port), "--strictPort"], cwd=WEB, env=env, stdout=web_log, stderr=web_log)
        seed.update({"web": f"http://127.0.0.1:{web_port}", "api": f"http://127.0.0.1:{api_port}/api/v1"})
        seed_path.write_text(json.dumps(seed))
        try:
            wait_url(seed["api"] + "/health", api_server)
            wait_url(seed["web"], web_server)
            return subprocess.run(["node", str(FLOW), str(seed_path)], cwd=WEB, env=env).returncode
        finally:
            web_server.terminate(); api_server.terminate()
            web_server.wait(timeout=10); api_server.wait(timeout=10)
            api_log.close(); web_log.close()


if __name__ == "__main__":
    from fastapi.testclient import TestClient
    from sqlalchemy import select
    from sqlalchemy.exc import IntegrityError
    raise SystemExit(main())
