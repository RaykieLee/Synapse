"""F27a real FastAPI/AgentScope/Redis/Vite/Playwright acceptance runner."""
from __future__ import annotations

import asyncio
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
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import httpx

ROOT = Path(__file__).resolve().parents[4]
API = ROOT / "apps" / "api"
WEB = ROOT / "apps" / "web"
PLAYWRIGHT = Path(__file__).with_name("f27a_team_panel.mjs")
PNPM = shutil.which("pnpm") or ("pnpm.cmd" if os.name == "nt" else "pnpm")


def free_port() -> int:
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


def terminate_process_tree(process: subprocess.Popen[bytes]) -> None:
    if process.poll() is None:
        if os.name == "nt":
            subprocess.run(["taskkill", "/PID", str(process.pid), "/T", "/F"], capture_output=True)
        else:
            process.terminate()
    try:
        process.wait(timeout=10)
    except subprocess.TimeoutExpired:
        process.kill()
        process.wait(timeout=10)


def wait_url(url: str, process: subprocess.Popen[bytes], timeout: int = 50) -> None:
    deadline = time.time() + timeout
    while time.time() < deadline:
        if process.poll() is not None:
            raise RuntimeError(f"server exited ({process.returncode}): {url}")
        try:
            with urllib.request.urlopen(url, timeout=1) as response:
                if response.status < 500:
                    return
        except Exception:
            time.sleep(0.25)
    raise RuntimeError(f"timed out waiting for {url}")


async def cleanup_fixture(redis_host: str, redis_port: int, storage_db: int, bus_redis) -> None:
    from agentscope.app.storage import RedisStorage

    async with RedisStorage(host=redis_host, port=redis_port, db=storage_db) as raw:
        for user_id in ("1", "2", "3"):
            for team in await raw.list_teams(user_id):
                if (team.data.name or "").casefold().startswith(("f27a ", "f27a-")):
                    await raw.delete_team(user_id, team.id)
            for agent in await raw.list_agents(user_id):
                if not (agent.data.name or "").casefold().startswith(("f27a ", "f27a-")):
                    continue
                for session in await raw.list_sessions(user_id, agent.id):
                    bus_redis.delete(
                        f"agentscope:session:lock:{session.id}",
                        f"agentscope:session:events:{session.id}",
                    )
                    await raw.delete_session(user_id, agent.id, session.id)
                await raw.delete_agent(user_id, agent.id)


def make_control_server(seed: dict, redis_host: str, redis_port: int, storage_db: int, bus_redis, session_factory):
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_args):
            return

        def send_json(self, status: int, value: dict) -> None:
            body = json.dumps(value).encode()
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def do_OPTIONS(self):
            self.send_response(204)
            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("Access-Control-Allow-Methods", "POST,OPTIONS")
            self.send_header("Access-Control-Allow-Headers", "Content-Type")
            self.send_header("Content-Length", "0")
            self.end_headers()

        def do_POST(self):
            size = int(self.headers.get("Content-Length", "0"))
            data = json.loads(self.rfile.read(size) or b"{}")
            if self.path == "/__f27a/update-tasks":
                from agentscope.app.storage import RedisStorage
                from agentscope.state import Task, TaskContext
                from app.integrations.agentscope_session_scope import (
                    WorkspaceSessionStorage,
                    bind_agentscope_context,
                    reset_agentscope_context,
                )
                from app.tenancy.context import WorkspaceContext

                async def update():
                    async with RedisStorage(host=redis_host, port=redis_port, db=storage_db) as raw:
                        scoped = WorkspaceSessionStorage(raw)
                        token = bind_agentscope_context(WorkspaceContext(
                            actor_user_id=int(seed["actor_id"]),
                            tenant_id=int(seed["tenant_id"]),
                            workspace_id=int(seed["workspace_one"]),
                            tenant_role="owner",
                            workspace_role="owner",
                            permission_set=frozenset({"resource:read", "resource:create", "resource:update", "resource:delete"}),
                            membership_version=1,
                        ))
                        try:
                            record = await scoped.get_session(
                                seed["actor_id"], seed["leader_agent"], seed["leader_session"],
                            )
                            if record is None:
                                raise RuntimeError("leader session disappeared")
                            tasks = [
                                Task(subject="Discover scope", description="", metadata={}, state="completed", owner="worker-one"),
                                Task(subject="Review evidence", description="", metadata={}, state="completed", owner="worker-two"),
                                Task(subject="Publish report", description="", metadata={}, state="pending", owner="leader"),
                            ]
                            state = record.state.model_copy(update={"tasks_context": TaskContext(tasks=tasks)})
                            await scoped.update_session_state(
                                seed["actor_id"], seed["leader_agent"], seed["leader_session"], state,
                            )
                        finally:
                            reset_agentscope_context(token)

                asyncio.run(update())
                return self.send_json(200, {"updated": True})
            if self.path == "/__f27a/publish":
                bus_redis.xadd(
                    f"agentscope:session:events:{seed['leader_session']}",
                    {"payload": json.dumps({"type": "REPLY_START", "reply_id": "f27a-refresh", "sequence": 99})},
                )
                return self.send_json(200, {"published": True})
            if self.path == "/__f27a/revoke":
                from sqlalchemy import update
                from app.models.tenant import WorkspaceMember
                with session_factory() as db:
                    db.execute(update(WorkspaceMember).where(
                        WorkspaceMember.workspace_id == int(seed["workspace_one"]),
                        WorkspaceMember.user_id == int(seed["actor_id"]),
                    ).values(status="removed"))
                    db.commit()
                return self.send_json(200, {"revoked": True})
            return self.send_json(404, {"detail": "unknown control"})

    return Handler


def main() -> int:
    if os.environ.get("F27A_SKIP_BUILD") == "1":
        print("F27A_SKIP_BUILD=1: reusing the previously verified web build.")
    else:
        build = subprocess.run([PNPM, "build"], cwd=WEB, text=True)
        if build.returncode:
            return build.returncode

    import redis
    from alembic import command
    from alembic.config import Config
    from app.auth.security import issue_token
    from app.core.config import get_settings
    from app.database.session import get_engine, get_session_factory
    from app.models.tenant import Tenant, TenantMember, Workspace, WorkspaceMember
    from app.models.user import User
    from agentscope.app.storage import RedisStorage
    from agentscope.state import Task, TaskContext
    from app.integrations.agentscope_session_scope import (
        WorkspaceSessionStorage,
        bind_agentscope_context,
        reset_agentscope_context,
    )
    from app.tenancy.context import WorkspaceContext
    from agentscope.app.storage import TeamData, TeamMember, TeamRecord

    redis_host = os.environ.get("F27A_REDIS_HOST", "127.0.0.1")
    redis_port = int(os.environ.get("F27A_REDIS_PORT", "16381"))
    storage_db, bus_db = 17, 18
    bus_redis = redis.Redis(host=redis_host, port=redis_port, db=bus_db)
    redis.Redis(host=redis_host, port=redis_port, db=storage_db, socket_connect_timeout=1).ping()
    asyncio.run(cleanup_fixture(redis_host, redis_port, storage_db, bus_redis))

    with tempfile.TemporaryDirectory(prefix="synapse-f27a-") as temp:
        temp_path = Path(temp)
        env = os.environ.copy()
        env.update({
            "SYNAPSE_DATABASE_URL": f"sqlite:///{temp_path / 'f27a.sqlite'}",
            "SYNAPSE_JWT_SECRET": "f27a-team-panel-verification-secret",
            "SYNAPSE_AGENTSCOPE_REDIS_HOST": redis_host,
            "SYNAPSE_AGENTSCOPE_REDIS_PORT": str(redis_port),
            "SYNAPSE_AGENTSCOPE_STORAGE_REDIS_DB": str(storage_db),
            "SYNAPSE_AGENTSCOPE_BUS_REDIS_DB": str(bus_db),
            "SYNAPSE_AGENTSCOPE_WORKSPACE_PATH": str(temp_path / "agent-workdirs"),
            "SYNAPSE_SCHEDULED_TASKS_ENABLED": "false",
            "SYNAPSE_API_PREFIX": "/api/v1",
        })
        os.environ.update(env)
        get_settings.cache_clear()
        get_engine.cache_clear()
        get_session_factory.cache_clear()
        old_cwd = os.getcwd()
        os.chdir(API)
        try:
            command.upgrade(Config("alembic.ini"), "head")
        finally:
            os.chdir(old_cwd)

        now = datetime.now(timezone.utc)
        with get_session_factory()() as db:
            actor = User(user_name="f27a-actor", nick_name="F27a Actor", email="f27a-actor@example.test", password_hash="unused", status="active", del_flag=False, token_version=1)
            peer = User(user_name="f27a-peer", nick_name="F27a Peer", email="f27a-peer@example.test", password_hash="unused", status="active", del_flag=False, token_version=1)
            db.add_all([actor, peer]); db.flush()
            tenant = Tenant(slug="f27a-tenant", name="F27a Tenant", status="active", settings_json="{}", membership_version=1)
            db.add(tenant); db.flush()
            w1 = Workspace(tenant_id=tenant.tenant_id, slug="one", name="F27a Workspace One", status="active", settings_json="{}", created_by=actor.user_id)
            w2 = Workspace(tenant_id=tenant.tenant_id, slug="two", name="F27a Workspace Two", status="active", settings_json="{}", created_by=actor.user_id)
            db.add_all([w1, w2]); db.flush()
            db.add_all([
                TenantMember(tenant_id=tenant.tenant_id, user_id=actor.user_id, status="active", tenant_role="owner", joined_at=now),
                TenantMember(tenant_id=tenant.tenant_id, user_id=peer.user_id, status="active", tenant_role="member", joined_at=now),
                WorkspaceMember(workspace_id=w1.workspace_id, tenant_id=tenant.tenant_id, user_id=actor.user_id, status="active", workspace_role="owner", joined_at=now),
                WorkspaceMember(workspace_id=w1.workspace_id, tenant_id=tenant.tenant_id, user_id=peer.user_id, status="active", workspace_role="member", joined_at=now),
                WorkspaceMember(workspace_id=w2.workspace_id, tenant_id=tenant.tenant_id, user_id=actor.user_id, status="active", workspace_role="owner", joined_at=now),
            ]); db.commit()
            seed = {
                "actor_id": str(actor.user_id), "peer_id": str(peer.user_id), "tenant_id": str(tenant.tenant_id),
                "workspace_one": str(w1.workspace_id), "workspace_two": str(w2.workspace_id),
                "actor_token": issue_token(actor.user_id, actor.token_version),
                "peer_token": issue_token(peer.user_id, peer.token_version),
            }

        api_port, web_port, control_port = free_port(), free_port(), free_port()
        api_log = (temp_path / "api.log").open("w")
        web_log = (temp_path / "vite.log").open("w")
        api = subprocess.Popen([sys.executable, "-m", "uvicorn", "app.main:create_app", "--factory", "--host", "127.0.0.1", "--port", str(api_port)], cwd=API, env=env, stdout=api_log, stderr=api_log)
        web = None
        control_server = None
        try:
            wait_url(f"http://127.0.0.1:{api_port}/api/v1/health", api)
            api_base = f"http://127.0.0.1:{api_port}/api/v1"
            headers = {"Authorization": f"Bearer {seed['actor_token']}", "X-Workspace-ID": seed["workspace_one"]}
            with httpx.Client(timeout=20) as client:
                def post(path: str, body: dict, request_headers: dict | None = None) -> str:
                    response = client.post(api_base + path, headers=request_headers or headers, json=body)
                    response.raise_for_status()
                    return response.json()["agent_id" if path.endswith("/agent/") else "session_id"]

                seed["leader_agent"] = post("/ai/agent/", {"name": "F27a Leader"})
                seed["worker_one_agent"] = post("/ai/agent/", {"name": "F27a Worker One"})
                seed["worker_two_agent"] = post("/ai/agent/", {"name": "F27a Worker Two"})
                seed["empty_agent"] = post("/ai/agent/", {"name": "F27a Empty Leader"})
                seed["leader_session"] = client.post(api_base + "/ai/sessions/", headers=headers, json={"agent_id": seed["leader_agent"], "name": "F27a Full Team"}).json()["session_id"]
                seed["worker_one_session"] = client.post(api_base + "/ai/sessions/", headers=headers, json={"agent_id": seed["worker_one_agent"], "name": "F27a Worker One Session"}).json()["session_id"]
                seed["worker_two_session"] = client.post(api_base + "/ai/sessions/", headers=headers, json={"agent_id": seed["worker_two_agent"], "name": "F27a Worker Two Session"}).json()["session_id"]
                seed["empty_session"] = client.post(api_base + "/ai/sessions/", headers=headers, json={"agent_id": seed["empty_agent"], "name": "F27a Empty Team"}).json()["session_id"]
                headers_two = {**headers, "X-Workspace-ID": seed["workspace_two"]}
                seed["workspace_two_agent"] = post("/ai/agent/", {"name": "F27a Workspace Two Agent"}, headers_two)
                seed["workspace_two_session"] = client.post(api_base + "/ai/sessions/", headers=headers_two, json={"agent_id": seed["workspace_two_agent"], "name": "F27a Workspace Two Session"}).json()["session_id"]

            async def seed_agentscope_records():
                async with RedisStorage(host=redis_host, port=redis_port, db=storage_db) as raw:
                    scoped = WorkspaceSessionStorage(raw)
                    token = bind_agentscope_context(WorkspaceContext(
                        actor_user_id=int(seed["actor_id"]), tenant_id=int(seed["tenant_id"]),
                        workspace_id=int(seed["workspace_one"]), tenant_role="owner", workspace_role="owner",
                        permission_set=frozenset({"resource:read", "resource:create", "resource:update", "resource:delete"}),
                        membership_version=1,
                    ))
                    try:
                        leader = await scoped.get_session(seed["actor_id"], seed["leader_agent"], seed["leader_session"])
                        if leader is None:
                            raise RuntimeError("leader session fixture missing")
                        state = leader.state.model_copy(update={"tasks_context": TaskContext(tasks=[
                            Task(subject="Discover scope", description="", metadata={}, state="completed", owner="worker-one"),
                            Task(subject="Review evidence", description="", metadata={}, state="in_progress", owner="worker-two"),
                            Task(subject="Publish report", description="", metadata={}, state="pending", owner="leader"),
                        ])})
                        await scoped.update_session_state(seed["actor_id"], seed["leader_agent"], seed["leader_session"], state)
                        await scoped.set_session_team_id(seed["actor_id"], seed["leader_session"], "f27a-team-full")
                        await scoped.set_session_team_id(seed["actor_id"], seed["worker_one_session"], "f27a-team-full")
                        await scoped.set_session_team_id(seed["actor_id"], seed["worker_two_session"], "f27a-team-full")
                        await scoped.set_session_team_id(seed["actor_id"], seed["empty_session"], "f27a-team-empty")
                        await raw.upsert_team(seed["actor_id"], TeamRecord(
                            id="f27a-team-full", user_id=seed["actor_id"], session_id=seed["leader_session"],
                            leader_agent_id=seed["leader_agent"], data=TeamData(
                                name="F27a Research Team", description="真实团队只读概览",
                                members=[
                                    TeamMember(owner_id=seed["actor_id"], agent_id=seed["worker_one_agent"], session_id=seed["worker_one_session"], role="created"),
                                    TeamMember(owner_id=seed["actor_id"], agent_id=seed["worker_two_agent"], session_id=seed["worker_two_session"], role="created"),
                                ],
                            ),
                        ))
                        await raw.upsert_team(seed["actor_id"], TeamRecord(
                            id="f27a-team-empty", user_id=seed["actor_id"], session_id=seed["empty_session"],
                            leader_agent_id=seed["empty_agent"], data=TeamData(name="F27a Empty Team", description=""),
                        ))
                    finally:
                        reset_agentscope_context(token)

            asyncio.run(seed_agentscope_records())
            control_server = ThreadingHTTPServer(("127.0.0.1", control_port), make_control_server(seed, redis_host, redis_port, storage_db, bus_redis, get_session_factory()))
            control_server.seed = seed
            control_thread = threading.Thread(target=control_server.serve_forever, daemon=True)
            control_thread.start()
            env["VITE_API_PROXY_TARGET"] = f"http://127.0.0.1:{api_port}"
            web = subprocess.Popen([PNPM, "dev", "--host", "127.0.0.1", "--port", str(web_port), "--strictPort"], cwd=WEB, env=env, stdout=web_log, stderr=web_log)
            seed.update({"web": f"http://127.0.0.1:{web_port}", "control": f"http://127.0.0.1:{control_port}"})
            seed_path = temp_path / "seed.json"
            seed_path.write_text(json.dumps(seed))
            wait_url(seed["web"], web)
            return subprocess.run(["node", str(PLAYWRIGHT), str(seed_path)], cwd=WEB, env=env).returncode
        finally:
            if web:
                terminate_process_tree(web)
            if control_server:
                control_server.shutdown()
                control_server.server_close()
            api.terminate()
            api.wait(timeout=10)
            asyncio.run(cleanup_fixture(redis_host, redis_port, storage_db, bus_redis))
            get_engine().dispose()
            get_session_factory.cache_clear()
            get_engine.cache_clear()
            api_log.close()
            web_log.close()


if __name__ == "__main__":
    raise SystemExit(main())
