"""Build and browser-verify the Workspace attachment UI on disposable services."""
from __future__ import annotations

import json
import os
import shutil
import socket
import subprocess
import sys
import tempfile
import threading
import time
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

import uvicorn
import redis

ROOT = Path(__file__).resolve().parents[4]
API = ROOT / "apps" / "api"
WEB = ROOT / "apps" / "web"
FLOW = Path(__file__).with_name("f17b_attachments_frontend.mjs")
PNPM = shutil.which("pnpm") or ("pnpm.cmd" if os.name == "nt" else "pnpm")


def free_port():
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


def wait_url(url, process=None):
    deadline = time.time() + 45
    while time.time() < deadline:
        if process is not None and process.poll() is not None:
            raise RuntimeError(f"Server exited ({process.returncode}) before {url}")
        try:
            with urllib.request.urlopen(url, timeout=1) as response:
                if response.status < 500:
                    return
        except Exception:
            time.sleep(.2)
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
    build = subprocess.run([PNPM, "build"], cwd=WEB)
    if build.returncode:
        return build.returncode

    with tempfile.TemporaryDirectory(prefix="synapse-f17b-") as temporary:
        temp = Path(temporary)
        db_url = f"sqlite:///{temp / 'f17b.sqlite'}"
        secret = "f17b-verification-only-secret"
        redis_host = os.environ.get("F17B_REDIS_HOST", "127.0.0.1")
        redis_port = int(os.environ.get("F17B_REDIS_PORT", "6380"))
        redis_client = redis.Redis(host=redis_host, port=redis_port, db=13, socket_connect_timeout=5)
        redis_version = str(redis_client.info("server").get("redis_version", "0"))
        if int(redis_version.split(".")[0]) < 7:
            raise RuntimeError(f"F17b requires Redis 7+, got {redis_version}")
        redis_client.flushdb()
        redis.Redis(host=redis_host, port=redis_port, db=14).flushdb()
        os.environ.update({
            "SYNAPSE_DATABASE_URL": db_url,
            "SYNAPSE_JWT_SECRET": secret,
            "SYNAPSE_AGENTSCOPE_REDIS_HOST": redis_host,
            "SYNAPSE_AGENTSCOPE_REDIS_PORT": str(redis_port),
            "SYNAPSE_AGENTSCOPE_STORAGE_REDIS_DB": "13",
            "SYNAPSE_AGENTSCOPE_BUS_REDIS_DB": "14",
            "SYNAPSE_AGENTSCOPE_WORKSPACE_PATH": str(temp / "agentscope-workspaces"),
            "SYNAPSE_ATTACHMENTS_STORAGE_PATH": str(temp / "attachments"),
            "SYNAPSE_SCHEDULED_TASKS_ENABLED": "false",
        })
        sys.path.insert(0, str(API))
        from alembic import command
        from alembic.config import Config
        from app.auth.security import issue_token
        from app.core.config import get_settings
        from app.database.session import get_engine, get_session_factory
        from app.models.tenant import Tenant, TenantMember, Workspace, WorkspaceMember
        from app.models.user import User
        from sqlalchemy import update

        get_settings.cache_clear(); get_engine.cache_clear(); get_session_factory.cache_clear()
        old_cwd = os.getcwd()
        os.chdir(API)
        try:
            command.upgrade(Config("alembic.ini"), "head")
        finally:
            os.chdir(old_cwd)

        now = datetime.now(timezone.utc)
        factory = get_session_factory()
        with factory() as db:
            actor_a = User(user_name="f17b-actor-a", nick_name="F17b Owner", email="f17b-a@example.test", password_hash="unused")
            actor_b = User(user_name="f17b-actor-b", nick_name="F17b Member", email="f17b-b@example.test", password_hash="unused")
            db.add_all([actor_a, actor_b]); db.flush()
            tenant_a = Tenant(slug="f17b-alpha", name="F17b Tenant Alpha", status="active", settings_json="{}", membership_version=31)
            tenant_b = Tenant(slug="f17b-beta", name="F17b Tenant Beta", status="active", settings_json="{}", membership_version=42)
            db.add_all([tenant_a, tenant_b]); db.flush()
            a1 = Workspace(tenant_id=tenant_a.tenant_id, slug="alpha-one", name="Alpha One", status="active", settings_json="{}", created_by=actor_a.user_id)
            a2 = Workspace(tenant_id=tenant_a.tenant_id, slug="alpha-two", name="Alpha Two", status="active", settings_json="{}", created_by=actor_a.user_id)
            b1 = Workspace(tenant_id=tenant_b.tenant_id, slug="beta-one", name="Beta One", status="active", settings_json="{}", created_by=actor_b.user_id)
            db.add_all([a1, a2, b1]); db.flush()
            db.add_all([
                TenantMember(tenant_id=tenant_a.tenant_id, user_id=actor_a.user_id, status="active", tenant_role="owner", joined_at=now),
                TenantMember(tenant_id=tenant_a.tenant_id, user_id=actor_b.user_id, status="active", tenant_role="member", joined_at=now),
                TenantMember(tenant_id=tenant_b.tenant_id, user_id=actor_a.user_id, status="active", tenant_role="admin", joined_at=now),
                TenantMember(tenant_id=tenant_b.tenant_id, user_id=actor_b.user_id, status="active", tenant_role="owner", joined_at=now),
                WorkspaceMember(workspace_id=a1.workspace_id, tenant_id=tenant_a.tenant_id, user_id=actor_a.user_id, status="active", workspace_role="owner", joined_at=now),
                WorkspaceMember(workspace_id=a1.workspace_id, tenant_id=tenant_a.tenant_id, user_id=actor_b.user_id, status="active", workspace_role="member", joined_at=now),
                WorkspaceMember(workspace_id=a2.workspace_id, tenant_id=tenant_a.tenant_id, user_id=actor_a.user_id, status="active", workspace_role="member", joined_at=now),
                WorkspaceMember(workspace_id=b1.workspace_id, tenant_id=tenant_b.tenant_id, user_id=actor_a.user_id, status="active", workspace_role="admin", joined_at=now),
                WorkspaceMember(workspace_id=b1.workspace_id, tenant_id=tenant_b.tenant_id, user_id=actor_b.user_id, status="active", workspace_role="owner", joined_at=now),
            ])
            db.commit()
            seed = {
                "tenant_a_id": str(tenant_a.tenant_id), "tenant_b_id": str(tenant_b.tenant_id),
                "workspace_a1": str(a1.workspace_id), "workspace_a2": str(a2.workspace_id),
                "workspace_b1": str(b1.workspace_id),
                "actor_a_id": str(actor_a.user_id), "actor_b_id": str(actor_b.user_id),
                "actor_a_token": issue_token(actor_a.user_id, actor_a.token_version),
                "actor_b_token": issue_token(actor_b.user_id, actor_b.token_version),
            }

        api_port, web_port = free_port(), free_port()
        import app.main as main_module
        from fastapi import HTTPException
        from app.models.tenant import WorkspaceMember
        original_factory = main_module.create_agentscope_app
        app = main_module.create_app()

        # A loopback-only test control enables an actual WorkspaceMember revoke
        # while a browser page is open. It is not part of product API/router code.
        @app.post("/__verification/f17b/revoke-member")
        def revoke_member(body: dict):
            if body.get("secret") != secret:
                raise HTTPException(status_code=403, detail="verification secret required")
            with get_session_factory()() as db:
                result = db.execute(update(WorkspaceMember).where(
                    WorkspaceMember.workspace_id == int(body["workspace_id"]),
                    WorkspaceMember.user_id == int(body["user_id"]),
                ).values(status="removed"))
                db.commit()
                return {"updated": result.rowcount}

        config = uvicorn.Config(app, host="127.0.0.1", port=api_port, log_level="warning", lifespan="on")
        server = uvicorn.Server(config)
        api_thread = threading.Thread(target=server.run, name="f17b-api", daemon=True)
        api_thread.start()
        env = os.environ.copy()
        env.update({"VITE_API_PROXY_TARGET": f"http://127.0.0.1:{api_port}"})
        api_log_path = temp / "api.log"
        web_log_path = temp / "vite.log"
        api_log = api_log_path.open("w")
        web_log = web_log_path.open("w")
        web = subprocess.Popen([PNPM, "dev", "--host", "127.0.0.1", "--port", str(web_port), "--strictPort"], cwd=WEB, env=env, stdout=web_log, stderr=web_log)
        seed.update({"web": f"http://127.0.0.1:{web_port}", "api": f"http://127.0.0.1:{api_port}/api/v1", "control_secret": secret})
        seed_path = temp / "seed.json"
        seed_path.write_text(json.dumps(seed))
        try:
            wait_url(seed["api"] + "/health")
            wait_url(seed["web"], web)
            return subprocess.run(["node", str(FLOW), str(seed_path)], cwd=WEB, env=env).returncode
        except Exception:
            print("API log:\n", api_log_path.read_text(errors="replace") if api_log_path.exists() else "", file=sys.stderr)
            print("Vite log:\n", web_log_path.read_text(errors="replace") if web_log_path.exists() else "", file=sys.stderr)
            raise
        finally:
            terminate_process_tree(web)
            server.should_exit = True
            api_thread.join(timeout=15)
            api_log.close(); web_log.close()
            main_module.create_agentscope_app = original_factory
            get_engine().dispose()
            get_session_factory.cache_clear()
            get_engine.cache_clear()
            redis_client.flushdb()
            redis.Redis(host=redis_host, port=redis_port, db=14).flushdb()
            if api_thread.is_alive():
                print("Warning: API server thread did not stop cleanly", file=sys.stderr)


if __name__ == "__main__":
    raise SystemExit(main())
