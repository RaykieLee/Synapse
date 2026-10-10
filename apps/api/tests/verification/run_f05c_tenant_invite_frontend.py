"""Build and run F05c invitation frontend flows on a disposable API database."""
import json
import os
import socket
import subprocess
import sys
import tempfile
import time
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[4]
API = ROOT / "apps" / "api"
WEB = ROOT / "apps" / "web"
FLOW = Path(__file__).with_name("f05c_tenant_invite_frontend.mjs")


def port():
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


def wait(url, process):
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
    with tempfile.TemporaryDirectory(prefix="synapse-f05c-") as temp:
        temp_path = Path(temp)
        db_url = f"sqlite:///{temp_path / 'f05c.sqlite'}"
        secret = "f05c-verification-only-jwt-secret"
        os.environ.update({"SYNAPSE_DATABASE_URL": db_url, "SYNAPSE_JWT_SECRET": secret})
        sys.path.insert(0, str(API))
        from alembic import command
        from alembic.config import Config
        from app.auth.security import issue_token, password_hash
        from app.core.config import get_settings
        from app.database.session import get_engine, get_session_factory
        from app.models.tenant import Tenant, TenantInvitation, TenantMember, Workspace, WorkspaceMember
        from app.models.user import User

        get_settings.cache_clear(); get_engine.cache_clear(); get_session_factory.cache_clear()
        previous = os.getcwd(); os.chdir(API)
        try:
            command.upgrade(Config("alembic.ini"), "0016_tenant_validity")
        finally:
            os.chdir(previous)
        factory = get_session_factory()
        password = "F05c-Test-Password-2026!"
        with factory() as db:
            users = [
                User(user_name="f05c-platform",nick_name="Platform Admin",email="platform@example.test",password_hash=password_hash(password),platform_role="platform_admin"),
                User(user_name="f05c-owner",nick_name="Tenant Owner",email="owner@example.test",password_hash=password_hash(password)),
                User(user_name="f05c-admin",nick_name="Tenant Admin",email="admin@example.test",password_hash=password_hash(password)),
                User(user_name="f05c-member",nick_name="Tenant Member",email="member@example.test",password_hash=password_hash(password)),
                User(user_name="f05c-target",nick_name="Invite Target",email="target@example.test",password_hash=password_hash(password)),
                User(user_name="f05c-wrong",nick_name="Wrong Account",email="wrong@example.test",password_hash=password_hash(password)),
                User(user_name="f05c-later",nick_name="Later Account",email="later@example.test",password_hash=password_hash(password)),
                User(user_name="f05c-suspended",nick_name="Suspended Target",email="suspended@example.test",password_hash=password_hash(password)),
            ]
            db.add_all(users); db.flush(); by_name = {u.user_name: u for u in users}
            now = datetime.now(timezone.utc)
            tenant = Tenant(slug="f05c-tenant",name="Invite Test Tenant",status="active",settings_json="{}",membership_version=1,created_at=now,updated_at=now)
            db.add(tenant); db.flush()
            for username, role in [("f05c-owner","owner"),("f05c-admin","admin"),("f05c-member","member")]:
                user = by_name[username]
                db.add(TenantMember(tenant_id=tenant.tenant_id,user_id=user.user_id,status="active",tenant_role=role,joined_at=now,created_at=now,updated_at=now))
            workspace = Workspace(tenant_id=tenant.tenant_id,slug="private-space",name="Private Workspace",status="active",settings_json="{}",created_by=by_name["f05c-owner"].user_id,created_at=now,updated_at=now)
            db.add(workspace); db.flush()
            db.add(WorkspaceMember(workspace_id=workspace.workspace_id,tenant_id=tenant.tenant_id,user_id=by_name["f05c-owner"].user_id,status="active",workspace_role="owner",joined_at=now,created_at=now,updated_at=now))
            expired_raw = "expired-f05c-token-" + ("x" * 48)
            import hashlib
            expired = TenantInvitation(tenant_id=tenant.tenant_id,email="expired@example.test",target_user_id=None,tenant_role="member",token_hash=hashlib.sha256(expired_raw.encode()).hexdigest(),status="pending",expires_at=now-timedelta(minutes=1),invited_by=by_name["f05c-owner"].user_id,created_at=now)
            db.add(expired); db.commit()
            seed = {
                "tenant_id": str(tenant.tenant_id), "workspace_id": str(workspace.workspace_id),
                "owner_id": str(by_name["f05c-owner"].user_id), "admin_id": str(by_name["f05c-admin"].user_id),
                "member_id": str(by_name["f05c-member"].user_id), "target_id": str(by_name["f05c-target"].user_id),
                "password": password, "expired_token": expired_raw,
                "owner_token": issue_token(by_name["f05c-owner"].user_id,0),
                "admin_token": issue_token(by_name["f05c-admin"].user_id,0),
                "member_token": issue_token(by_name["f05c-member"].user_id,0),
                "wrong_token": issue_token(by_name["f05c-wrong"].user_id,0),
                "platform_token": issue_token(by_name["f05c-platform"].user_id,0),
            }
        seed_file = temp_path / "seed.json"
        seed_file.write_text(json.dumps(seed))
        env = os.environ.copy()
        api_port, web_port = port(), port()
        env.update({"SYNAPSE_DATABASE_URL":db_url,"SYNAPSE_JWT_SECRET":secret,"VITE_API_PROXY_TARGET":f"http://127.0.0.1:{api_port}"})
        api_log = (temp_path / "api.log").open("w"); web_log = (temp_path / "vite.log").open("w")
        api = subprocess.Popen([sys.executable,"-m","uvicorn","app.main:create_app","--factory","--host","127.0.0.1","--port",str(api_port)],cwd=API,env=env,stdout=api_log,stderr=api_log)
        web = subprocess.Popen(["pnpm","dev","--host","127.0.0.1","--port",str(web_port),"--strictPort"],cwd=WEB,env=env,stdout=web_log,stderr=web_log)
        seed.update({"web":f"http://127.0.0.1:{web_port}","api":f"http://127.0.0.1:{api_port}/api/v1"})
        seed_file.write_text(json.dumps(seed))
        try:
            wait(seed["api"]+"/health",api); wait(seed["web"],web)
            return subprocess.run(["node",str(FLOW),str(seed_file)],cwd=WEB,env=env).returncode
        finally:
            web.terminate(); api.terminate(); web.wait(timeout=10); api.wait(timeout=10)
            api_log.close(); web_log.close()


if __name__ == "__main__":
    raise SystemExit(main())
