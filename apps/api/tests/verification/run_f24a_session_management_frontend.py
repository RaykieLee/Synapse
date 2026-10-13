"""F24a real API + Vite + Playwright acceptance for Workspace Sessions UI."""
from __future__ import annotations

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
PLAYWRIGHT = Path(__file__).with_name("f24a_session_management_frontend.mjs")
PNPM = shutil.which("pnpm") or ("pnpm.cmd" if os.name == "nt" else "pnpm")


def free_port():
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


def wait_url(url, process, timeout=40):
    deadline = time.time() + timeout
    while time.time() < deadline:
        if process.poll() is not None:
            raise RuntimeError(f"server exited ({process.returncode}): {url}")
        try:
            with urllib.request.urlopen(url, timeout=1) as response:
                if response.status < 500:
                    return
        except Exception:
            time.sleep(.25)
    raise RuntimeError(f"timed out waiting for {url}")


def terminate_process_tree(process):
    if process is None:
        return
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
    build = subprocess.run([PNPM, "build"], cwd=WEB, text=True)
    if build.returncode:
        return build.returncode

    import redis
    redis_host = os.environ.get("F24A_REDIS_HOST", "127.0.0.1")
    redis_port = int(os.environ.get("F24A_REDIS_PORT", "6380"))
    storage_db, bus_db = 5, 4
    bus_redis = redis.Redis(host=redis_host, port=redis_port, db=bus_db)
    try:
        redis.Redis(host=redis_host, port=redis_port, db=storage_db, socket_connect_timeout=1).ping()
    except Exception as exc:
        raise RuntimeError(f"F24a requires live Redis at {redis_host}:{redis_port}: {exc}") from exc

    with tempfile.TemporaryDirectory(prefix="synapse-f24a-") as temp:
        temp_path = Path(temp)
        db_url = f"sqlite:///{temp_path / 'f24a.sqlite'}"
        env = os.environ.copy()
        env.update({
            "SYNAPSE_DATABASE_URL": db_url,
            "SYNAPSE_JWT_SECRET": "f24a-agent-frontend-verification-secret",
            "SYNAPSE_AGENTSCOPE_REDIS_HOST": redis_host,
            "SYNAPSE_AGENTSCOPE_REDIS_PORT": str(redis_port),
            "SYNAPSE_AGENTSCOPE_STORAGE_REDIS_DB": str(storage_db),
            "SYNAPSE_AGENTSCOPE_BUS_REDIS_DB": str(bus_db),
            "SYNAPSE_AGENTSCOPE_WORKSPACE_PATH": str(temp_path / "agent-workdirs"),
            "SYNAPSE_SCHEDULED_TASKS_ENABLED": "false",
        })
        sys.path.insert(0, str(API))
        os.environ.update(env)
        from agentscope.app.storage import RedisStorage
        async def clean_old_fixture_records():
            async with RedisStorage(host=redis_host, port=redis_port, db=storage_db) as raw:
                for user_id in ("1", "2", "3"):
                    for row in await raw.list_agents(user_id):
                        if row.data.name.casefold().startswith("f24a ") or row.data.name.casefold().startswith("f24a-"):
                            for session in await raw.list_sessions(user_id, row.id):
                                bus_redis.delete(f"agentscope:session:lock:{session.id}")
                                await raw.delete_session(user_id, row.id, session.id)
                            await raw.delete_agent(user_id, row.id)
        import asyncio
        asyncio.run(clean_old_fixture_records())

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
            command.upgrade(Config("alembic.ini"), "head")
        finally:
            os.chdir(old_cwd)

        now = datetime.now(timezone.utc)
        with get_session_factory()() as db:
            actor = User(user_name="f24a-actor", nick_name="Agent Actor", email="f24a-actor@example.test", password_hash="unused", status="active", del_flag=False, token_version=1)
            peer = User(user_name="f24a-peer", nick_name="Agent Peer", email="f24a-peer@example.test", password_hash="unused", status="active", del_flag=False, token_version=1)
            beta_owner = User(user_name="f24a-beta-owner", nick_name="Beta Owner", email="f24a-beta@example.test", password_hash="unused", status="active", del_flag=False, token_version=1)
            db.add_all([actor, peer, beta_owner]); db.flush()
            alpha = Tenant(slug="f24a-alpha", name="F24a Alpha", status="active", settings_json="{}", membership_version=1)
            beta = Tenant(slug="f24a-beta", name="F24a Beta", status="active", settings_json="{}", membership_version=1)
            db.add_all([alpha, beta]); db.flush()
            w1 = Workspace(tenant_id=alpha.tenant_id, slug="one", name="Alpha One", status="active", settings_json="{}", created_by=actor.user_id)
            w2 = Workspace(tenant_id=alpha.tenant_id, slug="two", name="Alpha Two", status="active", settings_json="{}", created_by=actor.user_id)
            wb = Workspace(tenant_id=beta.tenant_id, slug="one", name="Beta One", status="active", settings_json="{}", created_by=beta_owner.user_id)
            db.add_all([w1, w2, wb]); db.flush()
            db.add_all([
                TenantMember(tenant_id=alpha.tenant_id, user_id=actor.user_id, status="active", tenant_role="owner", joined_at=now),
                TenantMember(tenant_id=alpha.tenant_id, user_id=peer.user_id, status="active", tenant_role="member", joined_at=now),
                TenantMember(tenant_id=beta.tenant_id, user_id=actor.user_id, status="active", tenant_role="admin", joined_at=now),
                TenantMember(tenant_id=beta.tenant_id, user_id=beta_owner.user_id, status="active", tenant_role="owner", joined_at=now),
                WorkspaceMember(workspace_id=w1.workspace_id, tenant_id=alpha.tenant_id, user_id=actor.user_id, status="active", workspace_role="owner", joined_at=now),
                WorkspaceMember(workspace_id=w1.workspace_id, tenant_id=alpha.tenant_id, user_id=peer.user_id, status="active", workspace_role="member", joined_at=now),
                WorkspaceMember(workspace_id=w2.workspace_id, tenant_id=alpha.tenant_id, user_id=actor.user_id, status="active", workspace_role="owner", joined_at=now),
                WorkspaceMember(workspace_id=wb.workspace_id, tenant_id=beta.tenant_id, user_id=actor.user_id, status="active", workspace_role="admin", joined_at=now),
                WorkspaceMember(workspace_id=wb.workspace_id, tenant_id=beta.tenant_id, user_id=beta_owner.user_id, status="active", workspace_role="owner", joined_at=now),
            ]); db.commit()
            seed = {
                "actor_id": str(actor.user_id), "peer_id": str(peer.user_id),
                "alpha_one": str(w1.workspace_id), "alpha_two": str(w2.workspace_id),
                "beta_one": str(wb.workspace_id), "alpha_tenant": str(alpha.tenant_id), "beta_tenant": str(beta.tenant_id),
                "actor_token": issue_token(actor.user_id, actor.token_version),
                "peer_token": issue_token(peer.user_id, peer.token_version),
                "beta_owner_token": issue_token(beta_owner.user_id, beta_owner.token_version),
            }

        seed_path = temp_path / "seed.json"
        api_port, web_port = free_port(), free_port()
        env["SYNAPSE_API_PREFIX"] = "/api/v1"
        api_log = (temp_path / "api.log").open("w")
        web_log = (temp_path / "vite.log").open("w")
        api = subprocess.Popen([sys.executable, "-m", "uvicorn", "app.main:create_app", "--factory", "--host", "127.0.0.1", "--port", str(api_port)], cwd=API, env=env, stdout=api_log, stderr=api_log)
        env["VITE_API_PROXY_TARGET"] = f"http://127.0.0.1:{api_port}"
        web = subprocess.Popen([PNPM, "dev", "--host", "127.0.0.1", "--port", str(web_port), "--strictPort"], cwd=WEB, env=env, stdout=web_log, stderr=web_log)
        seed.update({"web": f"http://127.0.0.1:{web_port}", "api": f"http://127.0.0.1:{api_port}/api/v1"})
        seed_path.write_text(json.dumps(seed))
        try:
            try:
                wait_url(seed["api"] + "/health", api)
                wait_url(seed["web"], web)
            except Exception:
                api_log.flush(); web_log.flush()
                print("API log:\n" + (temp_path / "api.log").read_text(), file=sys.stderr)
                print("Vite log:\n" + (temp_path / "vite.log").read_text(), file=sys.stderr)
                raise
            import httpx
            headers_a = {"Authorization": f"Bearer {seed['actor_token']}", "X-Workspace-ID": seed["alpha_one"]}
            headers_b = {"Authorization": f"Bearer {seed['actor_token']}", "X-Workspace-ID": seed["beta_one"]}
            with httpx.Client(timeout=15) as client:
                response = client.post(seed["api"] + "/ai/agent/", headers=headers_a, json={"name": "F24a Alpha Agent"})
                response.raise_for_status(); seed["alpha_agent_id"] = response.json()["agent_id"]
                response = client.post(seed["api"] + "/ai/agent/", headers=headers_b, json={"name": "F24a Beta Agent"})
                response.raise_for_status(); seed["beta_agent_id"] = response.json()["agent_id"]
                response = client.post(seed["api"] + "/ai/sessions/", headers=headers_b, json={"agent_id": seed["beta_agent_id"], "name": "F24a Foreign Beta Session"})
                response.raise_for_status(); seed["beta_session_id"] = response.json()["session_id"]
                response = client.post(seed["api"] + "/ai/sessions/", headers=headers_a, json={"agent_id": seed["alpha_agent_id"], "name": "F24a Team Read Only Session"})
                response.raise_for_status(); seed["team_session_id"] = response.json()["session_id"]
                response = client.post(seed["api"] + "/ai/sessions/", headers=headers_a, json={"agent_id": seed["alpha_agent_id"], "name": "F24a Running Session"})
                response.raise_for_status(); seed["running_session_id"] = response.json()["session_id"]

            bus_redis.set(f"agentscope:session:lock:{seed['running_session_id']}", "f24a-verification-lock", ex=600)

            from app.integrations.agentscope_session_scope import WorkspaceSessionStorage, bind_agentscope_context, reset_agentscope_context
            from app.tenancy.context import WorkspaceContext
            from agentscope.app.storage import TeamOrigin
            async def mark_team_session_read_only():
                async with RedisStorage(host=redis_host, port=redis_port, db=storage_db) as raw:
                    scoped = WorkspaceSessionStorage(raw)
                    scope_token = bind_agentscope_context(WorkspaceContext(
                        actor_user_id=int(seed["actor_id"]), tenant_id=int(seed["alpha_tenant"]),
                        workspace_id=int(seed["alpha_one"]), tenant_role="owner", workspace_role="owner",
                        permission_set=frozenset({"resource:read", "resource:create", "resource:update", "resource:delete"}),
                        membership_version=1,
                    ))
                    try:
                        record = await scoped.get_session(seed["actor_id"], seed["alpha_agent_id"], seed["team_session_id"])
                        if record is None:
                            raise RuntimeError("could not load team-session fixture")
                        await scoped.upsert_session(
                            user_id=seed["actor_id"], agent_id=seed["alpha_agent_id"], config=record.config,
                            state=record.state, session_id=record.id, origin=TeamOrigin(),
                        )
                        await scoped.set_session_team_id(seed["actor_id"], record.id, "f24a-fixture-team")
                    finally:
                        reset_agentscope_context(scope_token)
            asyncio.run(mark_team_session_read_only())
            seed_path.write_text(json.dumps(seed))
            return subprocess.run(["node", str(PLAYWRIGHT), str(seed_path)], cwd=WEB, env=env).returncode
        finally:
            terminate_process_tree(web); terminate_process_tree(api)
            api_log.close(); web_log.close()
            if seed.get("running_session_id"):
                bus_redis.delete(f"agentscope:session:lock:{seed['running_session_id']}")
            get_engine().dispose()
            get_session_factory.cache_clear()
            get_engine.cache_clear()
            asyncio.run(clean_old_fixture_records())


if __name__ == "__main__":
    raise SystemExit(main())
