"""Run F10 build + real-browser acceptance on disposable API data and local Vite/API servers."""
import json
import os
import socket
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[4]
API = ROOT / "apps" / "api"
WEB = ROOT / "apps" / "web"
PLAYWRIGHT = Path(__file__).with_name("f10_workspace_frontend.mjs")
PNPM = "pnpm.cmd" if os.name == "nt" else "pnpm"


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


def main():
    if os.environ.get("F10_SKIP_BUILD") != "1":
        build = subprocess.run([PNPM, "build"], cwd=WEB, text=True)
        if build.returncode:
            return build.returncode

    with tempfile.TemporaryDirectory(prefix="synapse-f10-", ignore_cleanup_errors=True) as temp:
        temp_path = Path(temp)
        db_url = f"sqlite:///{temp_path / 'f10.sqlite'}"
        env = os.environ.copy()
        env["SYNAPSE_DATABASE_URL"] = db_url
        env["SYNAPSE_JWT_SECRET"] = "f10-workspace-verification-only-secret"
        sys.path.insert(0, str(API))
        os.environ.update({"SYNAPSE_DATABASE_URL": db_url, "SYNAPSE_JWT_SECRET": env["SYNAPSE_JWT_SECRET"]})

        from alembic import command
        from alembic.config import Config
        from app.auth.security import issue_token
        from app.core.config import get_settings
        from app.database.session import get_engine, get_session_factory
        from app.models.tenant import Tenant, TenantMember, Workspace, WorkspaceMember
        from app.models.user import User

        get_settings.cache_clear(); get_engine.cache_clear(); get_session_factory.cache_clear()
        old_cwd = os.getcwd()
        os.chdir(API)
        try:
            command.upgrade(Config("alembic.ini"), "0016_tenant_validity")
        finally:
            os.chdir(old_cwd)

        factory = get_session_factory()
        with factory() as db:
            users = [
                User(user_name="f10-owner-a", nick_name="Alpha Owner", email="alpha-owner@example.test", password_hash="unused"),
                User(user_name="f10-actor", nick_name="Workspace Actor", email="actor@example.test", password_hash="unused"),
                User(user_name="f10-collab", nick_name="Collaborator", email="collab@example.test", password_hash="unused"),
                User(user_name="f10-owner-b", nick_name="Beta Owner", email="beta-owner@example.test", password_hash="unused"),
                User(user_name="f10-owner-c", nick_name="Gamma Owner", email="gamma-owner@example.test", password_hash="unused"),
            ]
            db.add_all(users); db.flush()
            u = {x.user_name: x for x in users}
            now = datetime.now(timezone.utc)
            tenants = [
                Tenant(slug="f10-alpha", name="Alpha Tenant", status="active", settings_json="{}", membership_version=1, created_at=now, updated_at=now),
                Tenant(slug="f10-beta", name="Beta Tenant", status="active", settings_json="{}", membership_version=1, created_at=now, updated_at=now),
                Tenant(slug="f10-gamma", name="Gamma Tenant", status="active", settings_json="{}", membership_version=1, created_at=now, updated_at=now),
            ]
            db.add_all(tenants); db.flush()
            alpha, beta, gamma = tenants
            for tenant, user, role in [(alpha,u["f10-owner-a"],"owner"),(alpha,u["f10-actor"],"admin"),(alpha,u["f10-collab"],"member"),
                                       (beta,u["f10-owner-b"],"owner"),(beta,u["f10-actor"],"admin"),(gamma,u["f10-owner-c"],"owner")]:
                db.add(TenantMember(tenant_id=tenant.tenant_id,user_id=user.user_id,status="active",tenant_role=role,joined_at=now,created_at=now,updated_at=now))
            spaces = [
                Workspace(tenant_id=alpha.tenant_id,slug="alpha-one",name="Alpha One",status="active",settings_json="{}",created_by=u["f10-owner-a"].user_id,created_at=now,updated_at=now),
                Workspace(tenant_id=alpha.tenant_id,slug="alpha-two",name="Alpha Two",status="active",settings_json="{}",created_by=u["f10-owner-a"].user_id,created_at=now,updated_at=now),
                Workspace(tenant_id=beta.tenant_id,slug="beta-one",name="Beta One",status="active",settings_json="{}",created_by=u["f10-owner-b"].user_id,created_at=now,updated_at=now),
                Workspace(tenant_id=gamma.tenant_id,slug="gamma-secret",name="Gamma Secret",status="active",settings_json="{}",created_by=u["f10-owner-c"].user_id,created_at=now,updated_at=now),
            ]
            db.add_all(spaces); db.flush()
            for space in spaces:
                tenant = next(t for t in tenants if t.tenant_id == space.tenant_id)
                owner = {alpha.tenant_id:"f10-owner-a",beta.tenant_id:"f10-owner-b",gamma.tenant_id:"f10-owner-c"}[tenant.tenant_id]
                db.add(WorkspaceMember(workspace_id=space.workspace_id,tenant_id=space.tenant_id,user_id=u[owner].user_id,status="active",workspace_role="owner",joined_at=now,created_at=now,updated_at=now))
                if tenant in (alpha,beta):
                    db.add(WorkspaceMember(workspace_id=space.workspace_id,tenant_id=space.tenant_id,user_id=u["f10-actor"].user_id,status="active",workspace_role="owner",joined_at=now,created_at=now,updated_at=now))
            db.commit()
            seed = {
                "web": "http://127.0.0.1:5173", "actor_id": str(u["f10-actor"].user_id),
                "collab_id": str(u["f10-collab"].user_id), "alpha_id": str(alpha.tenant_id),
                "alpha_one": str(spaces[0].workspace_id), "alpha_two": str(spaces[1].workspace_id),
                "beta_id": str(beta.tenant_id), "beta_one": str(spaces[2].workspace_id),
                "gamma_id": str(gamma.tenant_id), "gamma_secret": str(spaces[3].workspace_id),
                "actor_token": issue_token(u["f10-actor"].user_id, u["f10-actor"].token_version),
                "owner_token": issue_token(u["f10-owner-a"].user_id, u["f10-owner-a"].token_version),
            }
        seed_path = temp_path / "seed.json"
        seed_path.write_text(json.dumps(seed))

        api_port, web_port = free_port(), free_port()
        env["SYNAPSE_API_PREFIX"] = "/api/v1"
        api_log = (temp_path / "api.log").open("w")
        web_log = (temp_path / "vite.log").open("w")
        api = subprocess.Popen([sys.executable, "-m", "uvicorn", "app.main:create_app", "--factory", "--host", "127.0.0.1", "--port", str(api_port)], cwd=API, env=env, stdout=api_log, stderr=api_log)
        env["VITE_API_PROXY_TARGET"] = f"http://127.0.0.1:{api_port}"
        web = subprocess.Popen([PNPM, "dev", "--host", "127.0.0.1", "--port", str(web_port), "--strictPort"], cwd=WEB, env=env, stdout=web_log, stderr=web_log)
        seed["web"] = f"http://127.0.0.1:{web_port}"
        seed["api"] = f"http://127.0.0.1:{api_port}/api/v1"
        seed_path.write_text(json.dumps(seed))
        try:
            try:
                wait_url(seed["api"] + "/health", api)
                wait_url(seed["web"], web)
            except Exception:
                api_log.flush(); web_log.flush()
                print("API server log:\n" + (temp_path / "api.log").read_text(), file=sys.stderr)
                print("Vite server log:\n" + (temp_path / "vite.log").read_text(), file=sys.stderr)
                raise
            result = subprocess.run(["node", str(PLAYWRIGHT), str(seed_path)], cwd=WEB, env=env)
            return result.returncode
        finally:
            terminate_process_tree(web)
            terminate_process_tree(api)
            api_log.close(); web_log.close()


if __name__ == "__main__":
    raise SystemExit(main())
