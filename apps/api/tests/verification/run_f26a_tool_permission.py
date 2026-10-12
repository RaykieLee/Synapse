"""F26a real FastAPI/AgentScope/Redis/Vite/Playwright acceptance."""
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
from urllib.parse import urlsplit

import httpx

ROOT = Path(__file__).resolve().parents[4]
API = ROOT / "apps" / "api"
WEB = ROOT / "apps" / "web"
SPEC = WEB / "tests" / "verification" / "f26a_tool_permission.spec.ts"
PNPM = shutil.which("pnpm") or "pnpm.cmd"


def free_port():
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


def wait_url(url, process, timeout=50):
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


def terminate_tree(process):
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


def main():
    import redis
    from agentscope.app.storage import RedisStorage

    host = os.environ.get("F26A_REDIS_HOST", "127.0.0.1")
    port = int(os.environ.get("F26A_REDIS_PORT", "16381"))
    storage_db, bus_db = 13, 14
    bus = redis.Redis(host=host, port=port, db=bus_db)
    redis.Redis(host=host, port=port, db=storage_db, socket_connect_timeout=2).ping()

    async def clean_fixture():
        async with RedisStorage(host=host, port=port, db=storage_db) as raw:
            for user_id in ("1", "2", "3"):
                for agent in await raw.list_agents(user_id):
                    if not (agent.data.name or "").casefold().startswith(("f26a ", "f26a-")):
                        continue
                    for session in await raw.list_sessions(user_id, agent.id):
                        for key in (
                            f"agentscope:session:lock:{session.id}",
                            f"agentscope:session:events:{session.id}",
                        ):
                            bus.delete(key)
                        await raw.delete_session(user_id, agent.id, session.id)
                    await raw.delete_agent(user_id, agent.id)

    asyncio.run(clean_fixture())
    with tempfile.TemporaryDirectory(prefix="synapse-f26a-") as temp:
        temp_path = Path(temp)
        env = os.environ.copy()
        env.update({
            "SYNAPSE_DATABASE_URL": f"sqlite:///{temp_path / 'f26a.sqlite'}",
            "SYNAPSE_JWT_SECRET": "f26a-tool-permission-verification-secret",
            "SYNAPSE_AGENTSCOPE_REDIS_HOST": host,
            "SYNAPSE_AGENTSCOPE_REDIS_PORT": str(port),
            "SYNAPSE_AGENTSCOPE_STORAGE_REDIS_DB": str(storage_db),
            "SYNAPSE_AGENTSCOPE_BUS_REDIS_DB": str(bus_db),
            "SYNAPSE_AGENTSCOPE_WORKSPACE_PATH": str(temp_path / "workdirs"),
            "SYNAPSE_ATTACHMENTS_STORAGE_PATH": str(temp_path / "attachments"),
            "SYNAPSE_SCHEDULED_TASKS_ENABLED": "false",
            "SYNAPSE_API_PREFIX": "/api/v1",
        })
        os.environ.update(env)
        sys.path.insert(0, str(API))
        from alembic import command
        from alembic.config import Config
        from app.auth.security import issue_token
        from app.core.config import get_settings
        from app.database.session import get_engine, get_session_factory
        from app.models.tenant import Tenant, TenantMember, Workspace, WorkspaceMember
        from app.models.user import User

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
            actor = User(
                user_name="f26a-actor", nick_name="F26a Actor",
                email="f26a-actor@example.test", password_hash="unused",
                status="active", del_flag=False, token_version=1,
            )
            db.add(actor)
            db.flush()
            tenant = Tenant(slug="f26a-tenant", name="F26a Tenant", status="active", settings_json="{}", membership_version=1)
            db.add(tenant)
            db.flush()
            workspace = Workspace(
                tenant_id=tenant.tenant_id, slug="f26a", name="F26a Workspace",
                status="active", settings_json="{}", created_by=actor.user_id,
            )
            db.add(workspace)
            db.flush()
            db.add_all([
                TenantMember(tenant_id=tenant.tenant_id, user_id=actor.user_id, status="active", tenant_role="owner", joined_at=now),
                WorkspaceMember(workspace_id=workspace.workspace_id, tenant_id=tenant.tenant_id, user_id=actor.user_id, status="active", workspace_role="owner", joined_at=now),
            ])
            db.commit()
            seed = {
                "actor_id": str(actor.user_id),
                "tenant_id": str(tenant.tenant_id),
                "workspace_id": str(workspace.workspace_id),
                "actor_token": issue_token(actor.user_id, actor.token_version),
            }

        api_port, web_port, proxy_port = free_port(), free_port(), free_port()
        api_log = (temp_path / "api.log").open("w")
        web_log = (temp_path / "vite.log").open("w")
        api = subprocess.Popen(
            [sys.executable, "-m", "uvicorn", "app.main:create_app", "--factory", "--host", "127.0.0.1", "--port", str(api_port)],
            cwd=API, env=env, stdout=api_log, stderr=api_log,
        )
        proxy = None
        web = None
        try:
            wait_url(f"http://127.0.0.1:{api_port}/api/v1/health", api)
            api_origin = f"http://127.0.0.1:{api_port}"
            api_base = f"{api_origin}/api/v1"
            headers = {
                "Authorization": f"Bearer {seed['actor_token']}",
                "X-Workspace-ID": seed["workspace_id"],
            }
            with httpx.Client(timeout=20) as client:
                response = client.post(api_base + "/ai/agent/", headers=headers, json={"name": "F26a Agent"})
                response.raise_for_status()
                seed["agent_id"] = response.json()["agent_id"]
                response = client.post(
                    api_base + "/ai/sessions/", headers=headers,
                    json={"agent_id": seed["agent_id"], "name": "F26a Permission Session"},
                )
                response.raise_for_status()
                seed["session_id"] = response.json()["session_id"]

            from agentscope.message import Msg, ToolCallBlock, ToolCallState, ToolResultBlock, ToolResultState
            from agentscope.state import AgentState
            from app.integrations.agentscope_session_scope import (
                WorkspaceSessionStorage,
                bind_agentscope_context,
                reset_agentscope_context,
            )
            from app.tenancy.context import WorkspaceContext

            seed["reply_id"] = "f26a-reply"
            seed["tool_call_id"] = "f26a-tool"

            async def seed_state():
                async with RedisStorage(host=host, port=port, db=storage_db) as raw:
                    scoped = WorkspaceSessionStorage(raw)
                    token = bind_agentscope_context(WorkspaceContext(
                        actor_user_id=int(seed["actor_id"]), tenant_id=int(seed["tenant_id"]),
                        workspace_id=int(seed["workspace_id"]), tenant_role="owner",
                        workspace_role="owner",
                        permission_set=frozenset({"resource:read", "resource:create", "resource:update", "resource:delete"}),
                        membership_version=1,
                    ))
                    try:
                        session = await scoped.get_session(seed["actor_id"], seed["agent_id"], seed["session_id"])
                        asking = Msg(
                            id=seed["reply_id"], name="F26a Agent", role="assistant",
                            content=[ToolCallBlock(
                                id=seed["tool_call_id"], name="F26a sensitive_tool",
                                input='{"token":"F26a should-not-leak-token","path":"/tmp/f26a"}',
                                state=ToolCallState.ASKING,
                            )],
                        )
                        state = session.state.model_copy(update={
                            "context": [asking],
                            "reply_context": session.state.reply_context.model_copy(update={"reply_id": seed["reply_id"]}),
                        })
                        await scoped.update_session_state(seed["actor_id"], seed["agent_id"], seed["session_id"], state)
                        await scoped.upsert_message(seed["actor_id"], seed["session_id"], asking)
                    finally:
                        reset_agentscope_context(token)

            asyncio.run(seed_state())

            class Handler(BaseHTTPRequestHandler):
                protocol_version = "HTTP/1.1"

                def log_message(self, *_args):
                    return

                def _json(self, status, data):
                    body = json.dumps(data, ensure_ascii=False).encode()
                    self.send_response(status)
                    self.send_header("Content-Type", "application/json")
                    self.send_header("Content-Length", str(len(body)))
                    self.send_header("Access-Control-Allow-Origin", "*")
                    self.end_headers()
                    self.wfile.write(body)

                def do_OPTIONS(self):
                    self.send_response(204)
                    self.send_header("Access-Control-Allow-Origin", "*")
                    self.send_header("Access-Control-Allow-Methods", "GET,POST,PATCH,DELETE,OPTIONS")
                    self.send_header("Access-Control-Allow-Headers", "Authorization,Content-Type,X-Workspace-ID")
                    self.send_header("Content-Length", "0")
                    self.end_headers()

                def do_POST(self):
                    parsed = urlsplit(self.path)
                    size = int(self.headers.get("Content-Length", "0"))
                    body = json.loads(self.rfile.read(size) or b"{}")
                    if parsed.path == "/__f26a/publish":
                        event = body["event"]
                        key = f"agentscope:session:events:{seed['session_id']}"
                        bus.xadd(key, {"payload": json.dumps(event)})
                        bus.publish(key, json.dumps(event))
                        return self._json(200, {"published": True})
                    if parsed.path == "/__f26a/resolve":
                        confirmed = bool(body.get("confirmed"))
                        async def resolve():
                            async with RedisStorage(host=host, port=port, db=storage_db) as raw:
                                scoped = WorkspaceSessionStorage(raw)
                                token = bind_agentscope_context(WorkspaceContext(
                                    actor_user_id=int(seed["actor_id"]), tenant_id=int(seed["tenant_id"]),
                                    workspace_id=int(seed["workspace_id"]), tenant_role="owner",
                                    workspace_role="owner", permission_set=frozenset({"resource:read"}),
                                    membership_version=1,
                                ))
                                try:
                                    session = await scoped.get_session(seed["actor_id"], seed["agent_id"], seed["session_id"])
                                    current = session.state.context[-1]
                                    block = current.content[0]
                                    block = block.model_copy(update={"state": ToolCallState.ALLOWED if confirmed else ToolCallState.FINISHED})
                                    result = ToolResultBlock(
                                        id=seed["tool_call_id"],
                                        name="F26a sensitive_tool",
                                        output="F26a tool completed" if confirmed else "F26a tool denied",
                                        state=ToolResultState.SUCCESS if confirmed else ToolResultState.DENIED,
                                    )
                                    resolved = current.model_copy(update={"content": [block, result]})
                                    state = session.state.model_copy(update={"context": [resolved]})
                                    await scoped.update_session_state(seed["actor_id"], seed["agent_id"], seed["session_id"], state)
                                    await scoped.upsert_message(seed["actor_id"], seed["session_id"], resolved)
                                finally:
                                    reset_agentscope_context(token)
                        asyncio.run(resolve())
                        key = f"agentscope:session:events:{seed['session_id']}"
                        result_event = {
                            "id": f"f26a-result-{int(confirmed)}", "type": "USER_CONFIRM_RESULT",
                            "reply_id": seed["reply_id"], "confirm_results": [{
                                "confirmed": confirmed, "tool_call": {"id": seed["tool_call_id"]},
                            }],
                        }
                        bus.xadd(key, {"payload": json.dumps(result_event)})
                        bus.publish(key, json.dumps(result_event))
                        tool_end_event = {
                            "id": f"f26a-tool-end-{int(confirmed)}", "type": "TOOL_RESULT_END",
                            "reply_id": seed["reply_id"], "tool_call_id": seed["tool_call_id"],
                            "tool_call_name": "F26a sensitive_tool",
                            "state": "success" if confirmed else "denied",
                            "created_at": datetime.now(timezone.utc).isoformat(),
                        }
                        bus.xadd(key, {"payload": json.dumps(tool_end_event)})
                        bus.publish(key, json.dumps(tool_end_event))
                        return self._json(200, {"resolved": True})
                    if parsed.path == "/__f26a/reset-asking":
                        body["confirmed"] = None
                        return self._reset_asking()
                    return self._proxy()

                def _reset_asking(self):
                    async def reset():
                        async with RedisStorage(host=host, port=port, db=storage_db) as raw:
                            scoped = WorkspaceSessionStorage(raw)
                            token = bind_agentscope_context(WorkspaceContext(
                                actor_user_id=int(seed["actor_id"]), tenant_id=int(seed["tenant_id"]),
                                workspace_id=int(seed["workspace_id"]), tenant_role="owner",
                                workspace_role="owner", permission_set=frozenset({"resource:read"}),
                                membership_version=1,
                            ))
                            try:
                                session = await scoped.get_session(seed["actor_id"], seed["agent_id"], seed["session_id"])
                                current = session.state.context[-1]
                                block = current.content[0].model_copy(update={"state": ToolCallState.ASKING})
                                asking = current.model_copy(update={"content": [block]})
                                await scoped.update_session_state(seed["actor_id"], seed["agent_id"], seed["session_id"], session.state.model_copy(update={"context": [asking]}))
                                await scoped.upsert_message(seed["actor_id"], seed["session_id"], asking)
                            finally:
                                reset_agentscope_context(token)
                    asyncio.run(reset())
                    return self._json(200, {"reset": True})

                def _proxy(self):
                    size = int(self.headers.get("Content-Length", "0"))
                    content = self.rfile.read(size) if size else None
                    request_headers = {k: v for k, v in self.headers.items() if k.lower() not in {"host", "content-length", "connection"}}
                    try:
                        with httpx.Client(timeout=60) as client:
                            response = client.request(self.command, api_origin + self.path, headers=request_headers, content=content)
                        self.send_response(response.status_code)
                        for key, value in response.headers.items():
                            if key.lower() not in {"content-length", "transfer-encoding", "connection"}:
                                self.send_header(key, value)
                        self.send_header("Content-Length", str(len(response.content)))
                        self.end_headers()
                        self.wfile.write(response.content)
                    except (BrokenPipeError, ConnectionAbortedError, ConnectionResetError, httpx.ReadError):
                        # Browsers close SSE/proxy requests during page replacement and shutdown.
                        return
                    except Exception as exc:
                        try:
                            self._json(502, {"detail": type(exc).__name__})
                        except (BrokenPipeError, ConnectionAbortedError, ConnectionResetError):
                            return

                do_GET = _proxy
                do_PATCH = _proxy
                do_DELETE = _proxy

            proxy = ThreadingHTTPServer(("127.0.0.1", proxy_port), Handler)
            threading.Thread(target=proxy.serve_forever, daemon=True).start()
            env["VITE_API_PROXY_TARGET"] = f"http://127.0.0.1:{proxy_port}"
            web = subprocess.Popen(
                [PNPM, "dev", "--host", "127.0.0.1", "--port", str(web_port), "--strictPort"],
                cwd=WEB, env=env, stdout=web_log, stderr=web_log,
            )
            seed.update({"web": f"http://127.0.0.1:{web_port}", "proxy": f"http://127.0.0.1:{proxy_port}"})
            seed_path = temp_path / "seed.json"
            seed_path.write_text(json.dumps(seed), encoding="utf-8")
            wait_url(seed["web"], web)
            result = subprocess.run(
                ["node", "--experimental-strip-types", str(SPEC), str(seed_path)],
                cwd=WEB, env=env,
            )
            return result.returncode
        finally:
            if web:
                terminate_tree(web)
            if proxy:
                proxy.shutdown()
                proxy.server_close()
            terminate_tree(api)
            api_log.close()
            web_log.close()
            asyncio.run(clean_fixture())
            get_engine().dispose()
            get_session_factory.cache_clear()
            get_engine.cache_clear()


if __name__ == "__main__":
    raise SystemExit(main())
