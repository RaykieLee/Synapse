"""F26b real FastAPI/AgentScope/Redis/Vite/Chromium external-result acceptance."""
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
PLAYWRIGHT = Path(__file__).with_name("f26b_external_result.mjs")
PNPM = shutil.which("pnpm") or ("pnpm.cmd" if os.name == "nt" else "pnpm")
STORAGE_DB = 15
BUS_DB = 16


def free_port():
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


def terminate_process_tree(process):
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


class ProxyState:
    def __init__(self, api_base, bus_redis):
        self.api_base = api_base
        self.bus_redis = bus_redis
        self.chat_mode = "pass"
        self.chat_calls = []
        self.lock = threading.Lock()


def create_proxy_handler(state, session_factory):
    class Handler(BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.1"

        def log_message(self, *_args):
            return

        def send_json(self, status, value):
            body = json.dumps(value, ensure_ascii=False).encode()
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            self.wfile.write(body)

        def do_OPTIONS(self):
            self.send_response(204)
            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("Access-Control-Allow-Methods", "GET,POST,PATCH,PUT,DELETE,OPTIONS")
            self.send_header("Access-Control-Allow-Headers", "Authorization,Content-Type,X-Workspace-ID")
            self.send_header("Content-Length", "0")
            self.end_headers()

        def do_POST(self):
            parsed = urlsplit(self.path)
            size = int(self.headers.get("Content-Length", "0"))
            body = self.rfile.read(size) if size else b""
            if parsed.path == "/__f26b/chat-mode":
                with state.lock:
                    state.chat_mode = json.loads(body or b"{}").get("mode", "pass")
                return self.send_json(200, {"mode": state.chat_mode})
            if parsed.path == "/__f26b/chat-calls":
                with state.lock:
                    return self.send_json(200, {"calls": list(state.chat_calls)})
            if parsed.path == "/__f26b/revoke":
                from sqlalchemy import update
                from app.models.tenant import WorkspaceMember
                data = json.loads(body or b"{}")
                with session_factory() as db:
                    db.execute(
                        update(WorkspaceMember)
                        .where(
                            WorkspaceMember.workspace_id == int(data["workspace_id"]),
                            WorkspaceMember.user_id == int(data["user_id"]),
                        )
                        .values(status="removed")
                    )
                    db.commit()
                return self.send_json(200, {"revoked": True})
            return self._proxy(body)

        def _stream(self, body):
            headers = {
                key: value
                for key, value in self.headers.items()
                if key.lower() not in {"host", "content-length", "connection", "accept-encoding"}
            }
            try:
                timeout = httpx.Timeout(connect=10, read=1.5, write=10, pool=10)
                with httpx.Client(timeout=timeout) as client:
                    with client.stream("GET", state.api_base + self.path, headers=headers, content=body or None) as response:
                        self.send_response(response.status_code)
                        for key, value in response.headers.items():
                            if key.lower() not in {"content-length", "transfer-encoding", "connection", "content-encoding"}:
                                self.send_header(key, value)
                        self.send_header("Connection", "close")
                        self.end_headers()
                        for chunk in response.iter_raw():
                            self.wfile.write(chunk)
                            self.wfile.flush()
            except (httpx.HTTPError, BrokenPipeError, ConnectionResetError, OSError):
                return

        def _proxy(self, body=b""):
            parsed = urlsplit(self.path)
            if "/stream" in parsed.path:
                return self._stream(body)
            if parsed.path.endswith("/ai/chat/"):
                try:
                    payload = json.loads(body or b"{}")
                except json.JSONDecodeError:
                    payload = {}
                with state.lock:
                    state.chat_calls.append(payload)
                    mode = state.chat_mode
                if mode == "expired":
                    return self.send_json(409, {"detail": "F26b controlled expired request"})
                if mode == "fail":
                    return self.send_json(503, {"detail": "F26b controlled failure"})
            headers = {
                key: value
                for key, value in self.headers.items()
                if key.lower() not in {"host", "content-length", "connection", "accept-encoding"}
            }
            try:
                with httpx.Client(timeout=30) as client:
                    response = client.request(self.command, state.api_base + self.path, headers=headers, content=body or None)
                self.send_response(response.status_code)
                for key, value in response.headers.items():
                    if key.lower() not in {"content-length", "transfer-encoding", "connection", "content-encoding"}:
                        self.send_header(key, value)
                self.send_header("Content-Length", str(len(response.content)))
                self.end_headers()
                self.wfile.write(response.content)
            except (BrokenPipeError, ConnectionAbortedError):
                return

        do_GET = _proxy
        do_PUT = _proxy
        do_PATCH = _proxy
        do_DELETE = _proxy

    return Handler


def seed_message(raw_storage, seed, session_id, tool_id, reply_id, tool_name):
    from agentscope.message import Msg
    from agentscope.state import AgentState
    from app.integrations.agentscope_session_scope import (
        WorkspaceSessionStorage,
        bind_agentscope_context,
        reset_agentscope_context,
    )
    from app.tenancy.context import WorkspaceContext

    async def write():
        scoped = WorkspaceSessionStorage(raw_storage)
        token = bind_agentscope_context(
            WorkspaceContext(
                actor_user_id=int(seed["actor_id"]),
                tenant_id=int(seed["tenant_id"]),
                workspace_id=int(seed["workspace_one"] if session_id != seed["session_other_workspace"] else seed["workspace_two"]),
                tenant_role="owner",
                workspace_role="owner",
                permission_set=frozenset({"resource:read", "resource:create", "resource:update", "resource:delete"}),
                membership_version=1,
            )
        )
        try:
            pending = Msg(
                name="assistant",
                role="assistant",
                content=[
                    {
                        "type": "tool_call",
                        "id": tool_id,
                        "name": tool_name,
                        "input": '{"query":"external","token":"f26b-secret"}',
                        "state": "submitted",
                        "created_at": "2026-10-12T01:00:00Z",
                    }
                ],
            )
            await scoped.upsert_message(seed["actor_id"], session_id, pending)
            agent_id = seed["agent_two_id"] if session_id == seed["session_other_workspace"] else seed["agent_id"]
            await scoped.update_session_state(
                seed["actor_id"],
                agent_id,
                session_id,
                AgentState(context=[pending]),
            )
        finally:
            reset_agentscope_context(token)

    return write


def main():
    if os.environ.get("F26B_SKIP_BUILD") != "1":
        build = subprocess.run([PNPM, "build"], cwd=WEB, text=True)
        if build.returncode:
            return build.returncode
    else:
        print("F26B_SKIP_BUILD=1: using the previously successful frontend build.")

    import redis
    from agentscope.app.storage import RedisStorage
    from alembic import command
    from alembic.config import Config
    from app.auth.security import issue_token
    from app.core.config import get_settings
    from app.database.session import get_engine, get_session_factory
    from app.models.tenant import Tenant, TenantMember, Workspace, WorkspaceMember
    from app.models.user import User

    redis_host = os.environ.get("F26B_REDIS_HOST", "127.0.0.1")
    redis_port = int(os.environ.get("F26B_REDIS_PORT", "16381"))
    bus_redis = redis.Redis(host=redis_host, port=redis_port, db=BUS_DB)
    redis.Redis(host=redis_host, port=redis_port, db=STORAGE_DB, socket_connect_timeout=1).ping()

    with tempfile.TemporaryDirectory(prefix="synapse-f26b-") as temp:
        temp_path = Path(temp)
        env = os.environ.copy()
        env.update({
            "SYNAPSE_DATABASE_URL": f"sqlite:///{temp_path / 'f26b.sqlite'}",
            "SYNAPSE_JWT_SECRET": "f26b-external-result-verification-secret",
            "SYNAPSE_AGENTSCOPE_REDIS_HOST": redis_host,
            "SYNAPSE_AGENTSCOPE_REDIS_PORT": str(redis_port),
            "SYNAPSE_AGENTSCOPE_STORAGE_REDIS_DB": str(STORAGE_DB),
            "SYNAPSE_AGENTSCOPE_BUS_REDIS_DB": str(BUS_DB),
            "SYNAPSE_AGENTSCOPE_WORKSPACE_PATH": str(temp_path / "agent-workdirs"),
            "SYNAPSE_ATTACHMENTS_STORAGE_PATH": str(temp_path / "attachments"),
            "SYNAPSE_SCHEDULED_TASKS_ENABLED": "false",
            "SYNAPSE_API_PREFIX": "/api/v1",
        })
        os.environ.update(env)
        sys.path.insert(0, str(API))
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
            actor = User(user_name="f26b-actor", nick_name="F26b Actor", email="f26b-actor@example.test", password_hash="unused", status="active", del_flag=False, token_version=1)
            db.add(actor)
            db.flush()
            tenant = Tenant(slug="f26b-tenant", name="F26b Tenant", status="active", settings_json="{}", membership_version=1)
            db.add(tenant)
            db.flush()
            one = Workspace(tenant_id=tenant.tenant_id, slug="one", name="F26b Workspace One", status="active", settings_json="{}", created_by=actor.user_id)
            two = Workspace(tenant_id=tenant.tenant_id, slug="two", name="F26b Workspace Two", status="active", settings_json="{}", created_by=actor.user_id)
            db.add_all([one, two])
            db.flush()
            db.add_all([
                TenantMember(tenant_id=tenant.tenant_id, user_id=actor.user_id, status="active", tenant_role="owner", joined_at=now),
                WorkspaceMember(workspace_id=one.workspace_id, tenant_id=tenant.tenant_id, user_id=actor.user_id, status="active", workspace_role="owner", joined_at=now),
                WorkspaceMember(workspace_id=two.workspace_id, tenant_id=tenant.tenant_id, user_id=actor.user_id, status="active", workspace_role="owner", joined_at=now),
            ])
            db.commit()
            seed = {
                "actor_id": str(actor.user_id),
                "tenant_id": str(tenant.tenant_id),
                "workspace_one": str(one.workspace_id),
                "workspace_two": str(two.workspace_id),
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
        created_sessions = []
        created_agents = []
        try:
            try:
                wait_url(f"http://127.0.0.1:{api_port}/api/v1/health", api)
            except Exception:
                api_log.flush()
                print("F26b API startup log:\n" + (temp_path / "api.log").read_text(), file=sys.stderr)
                raise
            api_base = f"http://127.0.0.1:{api_port}/api/v1"
            proxy_state = ProxyState(f"http://127.0.0.1:{api_port}", bus_redis)
            proxy = ThreadingHTTPServer(("127.0.0.1", proxy_port), create_proxy_handler(proxy_state, get_session_factory()))
            proxy.server_state = proxy_state
            proxy_state.server = proxy
            # Handler accesses state through its server instance.
            proxy.RequestHandlerClass.server_state = proxy_state
            proxy_thread = threading.Thread(target=proxy.serve_forever, daemon=True)
            proxy_thread.start()
            env["VITE_API_PROXY_TARGET"] = f"http://127.0.0.1:{proxy_port}"
            web = subprocess.Popen(
                [PNPM, "dev", "--host", "127.0.0.1", "--port", str(web_port), "--strictPort"],
                cwd=WEB, env=env, stdout=web_log, stderr=web_log,
            )
            seed.update({"web": f"http://127.0.0.1:{web_port}", "proxy": f"http://127.0.0.1:{proxy_port}"})
            try:
                wait_url(seed["web"], web)
            except Exception:
                web_log.flush()
                print("F26b Vite startup log:\n" + (temp_path / "vite.log").read_text(), file=sys.stderr)
                raise

            headers = {"Authorization": f"Bearer {seed['actor_token']}", "X-Workspace-ID": seed["workspace_one"]}
            with httpx.Client(timeout=20) as client:
                response = client.post(api_base + "/ai/agent/", headers=headers, json={"name": "F26b Agent"})
                response.raise_for_status()
                seed["agent_id"] = response.json()["agent_id"]
                created_agents.append(seed["agent_id"])
                session_names = [
                    ("F26b Pending Success", "F26b external success", "f26b-tool-success", "f26b-reply-success"),
                    ("F26b Pending Cancel", "F26b external cancel", "f26b-tool-cancel", "f26b-reply-cancel"),
                    ("F26b Pending Stale", "F26b external stale", "f26b-tool-stale", "f26b-reply-stale"),
                    ("F26b Pending Fail", "F26b external fail", "f26b-tool-fail", "f26b-reply-fail"),
                ]
                for name, _tool, tool_id, reply_id in session_names:
                    response = client.post(api_base + "/ai/sessions/", headers=headers, json={"agent_id": seed["agent_id"], "name": name})
                    if response.status_code >= 400:
                        raise RuntimeError(f"F26b session create failed: {response.status_code} {response.text}")
                    session_id = response.json()["session_id"]
                    seed_key = name.removeprefix("F26b Pending ").lower()
                    seed[f"session_{seed_key}"] = session_id
                    seed[f"tool_{seed_key}"] = tool_id
                    seed[f"reply_{seed_key}"] = reply_id
                    created_sessions.append(session_id)
                headers_two = {**headers, "X-Workspace-ID": seed["workspace_two"]}
                response = client.post(api_base + "/ai/agent/", headers=headers_two, json={"name": "F26b Agent Two"})
                response.raise_for_status()
                seed["agent_two_id"] = response.json()["agent_id"]
                created_agents.append(seed["agent_two_id"])
                response = client.post(api_base + "/ai/sessions/", headers=headers_two, json={"agent_id": seed["agent_two_id"], "name": "F26b Workspace Two Pending"})
                response.raise_for_status()
                seed["session_other_workspace"] = response.json()["session_id"]
                seed["agent_other_workspace"] = seed["agent_two_id"]
                seed["tool_other"] = "f26b-tool-other"
                seed["reply_other"] = "f26b-reply-other"
                created_sessions.append(seed["session_other_workspace"])

            async def write_messages():
                async with RedisStorage(host=redis_host, port=redis_port, db=STORAGE_DB) as raw:
                    for key, tool, tool_id, reply in [
                        ("session_success", "F26b external success", "tool_success", "reply_success"),
                        ("session_cancel", "F26b external cancel", "tool_cancel", "reply_cancel"),
                        ("session_stale", "F26b external stale", "tool_stale", "reply_stale"),
                        ("session_fail", "F26b external fail", "tool_fail", "reply_fail"),
                        ("session_other_workspace", "F26b external workspace-two", "tool_other", "reply_other"),
                    ]:
                        await seed_message(raw, seed, seed[key], seed[tool_id], seed[reply], tool)()

            asyncio.run(write_messages())
            seed_path = temp_path / "seed.json"
            seed_path.write_text(json.dumps(seed), encoding="utf-8")
            result = subprocess.run(["node", str(PLAYWRIGHT), str(seed_path)], cwd=WEB, env=env)
            if result.returncode:
                print("API log tail:\n" + (temp_path / "api.log").read_text()[-8000:], file=sys.stderr)
            return result.returncode
        finally:
            if web:
                terminate_process_tree(web)
            if proxy:
                proxy.shutdown()
                proxy.server_close()
            api.terminate()
            api.wait(timeout=10)
            # Delete only the exact F26b session/agent records and their exact
            # event/lock keys. No Redis database-wide flush is used.
            async def cleanup():
                async with RedisStorage(host=redis_host, port=redis_port, db=STORAGE_DB) as raw:
                    for session_id in created_sessions:
                        bus_redis.delete(
                            f"agentscope:session:events:{session_id}",
                            f"agentscope:session:lock:{session_id}",
                        )
                        await raw.delete_session(seed["actor_id"], seed.get("agent_id", ""), session_id)
                    for agent_id in created_agents:
                        await raw.delete_agent(seed["actor_id"], agent_id)
            asyncio.run(cleanup())
            get_engine().dispose()
            get_session_factory.cache_clear()
            get_engine.cache_clear()
            api_log.close()
            web_log.close()


if __name__ == "__main__":
    raise SystemExit(main())
