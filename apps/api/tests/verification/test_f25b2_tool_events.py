"""F25b2 real FastAPI/AgentScope/Redis/Vite/Playwright SSE text acceptance."""
from __future__ import annotations

import asyncio
import json
import os
import re
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
PLAYWRIGHT = Path(__file__).with_name("f25b2_tool_events.mjs")
PNPM = shutil.which("pnpm") or ("pnpm.cmd" if os.name == "nt" else "pnpm")


def free_port():
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


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
    def __init__(self, api_base, bus_redis, session_id):
        self.api_base = api_base
        self.bus_redis = bus_redis
        self.session_id = session_id
        self.lock = threading.Lock()
        self.stream_counts = {}
        self.fail_next = set()
        self.revocations = {}


def create_proxy_handler(state, session_factory):
    class Handler(BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.1"

        def log_message(self, *_args):
            return

        def send_json(self, status, value):
            body = json.dumps(value).encode()
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
            if not parsed.path.startswith("/__f25b2/"):
                return self._proxy()
            size = int(self.headers.get("Content-Length", "0"))
            body = self.rfile.read(size) if size else b""
            if parsed.path == "/__f25b2/publish":
                data = json.loads(body or b"{}")
                session_id = data["session_id"]
                self.server.state.bus_redis.xadd(
                    f"agentscope:session:events:{session_id}",
                    {"payload": json.dumps(data["event"], ensure_ascii=False)},
                )
                return self.send_json(200, {"published": True})
            if parsed.path == "/__f25b2/fail-next":
                with self.server.state.lock:
                    self.server.state.fail_next.add(self.server.state.session_id)
                return self.send_json(200, {"scheduled": True})
            if parsed.path == "/__f25b2/revoke":
                data = json.loads(body or b"{}")
                from sqlalchemy import update
                from app.models.tenant import WorkspaceMember
                with session_factory() as db:
                    db.execute(update(WorkspaceMember).where(
                        WorkspaceMember.workspace_id == int(data["workspace_id"]),
                        WorkspaceMember.user_id == int(data["user_id"]),
                    ).values(status="removed"))
                    db.commit()
                return self.send_json(200, {"revoked": True})
            return self.send_json(404, {"detail": "unknown test control"})

        def _stream(self, path, body):
            self.close_connection = True
            match = re.search(r"/sessions/([^/]+)/stream(?:\?|$)", path)
            sid = match.group(1) if match else ""
            with self.server.state.lock:
                count = self.server.state.stream_counts.get(sid, 0) + 1
                self.server.state.stream_counts[sid] = count
                fail = sid in self.server.state.fail_next
                if fail:
                    self.server.state.fail_next.remove(sid)
            if fail:
                return self.send_json(503, {"detail": "F25b2 controlled transient stream failure"})

            headers = {key: value for key, value in self.headers.items()
                       if key.lower() not in {"host", "content-length", "connection", "accept-encoding"}}
            # A short read timeout makes the upstream live subscription close
            # predictably after replay. The first connection is additionally
            # cut immediately after the first visible text delta.
            timeout = httpx.Timeout(connect=10, read=1.5, write=10, pool=10)
            try:
                with httpx.Client(timeout=timeout) as client:
                    with client.stream(self.command, self.server.state.api_base + path,
                                       headers=headers, content=body or None) as response:
                        self.send_response(response.status_code)
                        for key, value in response.headers.items():
                            if key.lower() not in {"content-length", "transfer-encoding", "connection", "content-encoding"}:
                                self.send_header(key, value)
                        self.send_header("Connection", "close")
                        self.end_headers()
                        replay = bytearray()
                        try:
                            for chunk in response.iter_raw():
                                self.wfile.write(chunk)
                                self.wfile.flush()
                                # StrictMode replays mount effects in dev, so
                                # cut both initial connections; the explicit
                                # user retry is connection three.
                                if sid == self.server.state.session_id and count <= 2:
                                    replay.extend(chunk)
                                    if b'"delta": "F25b2 alpha "' in replay or b'"delta":"F25b2 alpha "' in replay:
                                        self.close_connection = True
                                        try:
                                            self.connection.shutdown(socket.SHUT_RDWR)
                                        except OSError:
                                            pass
                                        return
                        except (httpx.ReadTimeout, BrokenPipeError, ConnectionResetError, OSError):
                            try:
                                self.connection.shutdown(socket.SHUT_RDWR)
                            except OSError:
                                pass
                            return
            except (httpx.HTTPError, BrokenPipeError, ConnectionResetError, OSError):
                return

        def _proxy(self):
            parsed = urlsplit(self.path)
            if parsed.path.startswith("/__f25b2/"):
                return self.send_json(404, {"detail": "unknown test control"})
            size = int(self.headers.get("Content-Length", "0"))
            body = self.rfile.read(size) if size else b""
            if "/stream" in parsed.path:
                return self._stream(self.path, body)
            headers = {key: value for key, value in self.headers.items()
                       if key.lower() not in {"host", "content-length", "connection", "accept-encoding"}}
            try:
                with httpx.Client(timeout=30) as client:
                    response = client.request(self.command, self.server.state.api_base + self.path,
                                              headers=headers, content=body or None)
                self.send_response(response.status_code)
                for key, value in response.headers.items():
                    if key.lower() not in {"content-length", "transfer-encoding", "connection", "content-encoding"}:
                        self.send_header(key, value)
                self.send_header("Content-Length", str(len(response.content)))
                self.end_headers()
                self.wfile.write(response.content)
            except (BrokenPipeError, ConnectionAbortedError):
                # The browser intentionally closes the proxy connection after
                # exercising SSE retry/cleanup behavior.
                return
            except Exception as exc:
                self.send_json(502, {"detail": f"test proxy failed: {type(exc).__name__}"})

        do_GET = _proxy
        do_POST_PROXY = _proxy
        do_PUT = _proxy
        do_PATCH = _proxy
        do_DELETE = _proxy

    return Handler


def main():
    if os.environ.get("F25B2_SKIP_BUILD") == "1":
        print("F25B2_SKIP_BUILD=1: using the already verified frontend build for the browser run.")
    else:
        build = subprocess.run([PNPM, "build"], cwd=WEB, text=True)
        if build.returncode:
            return build.returncode

    import redis
    from agentscope.app.storage import RedisStorage
    redis_host = os.environ.get("F25B2_REDIS_HOST", "127.0.0.1")
    redis_port = int(os.environ.get("F25B2_REDIS_PORT", "6380"))
    storage_db, bus_db = 11, 12
    bus_redis = redis.Redis(host=redis_host, port=redis_port, db=bus_db)
    redis.Redis(host=redis_host, port=redis_port, db=storage_db, socket_connect_timeout=1).ping()

    async def clean_old_fixture_records():
        async with RedisStorage(host=redis_host, port=redis_port, db=storage_db) as raw:
            for user_id in ("1", "2", "3"):
                for row in await raw.list_agents(user_id):
                    name = row.data.name or ""
                    if not name.casefold().startswith(("f25b2 ", "f25b2-")):
                        continue
                    for session in await raw.list_sessions(user_id, row.id):
                        bus_redis.delete(
                            f"agentscope:session:lock:{session.id}",
                            f"agentscope:session:events:{session.id}",
                        )
                        await raw.delete_session(user_id, row.id, session.id)
                    await raw.delete_agent(user_id, row.id)

    asyncio.run(clean_old_fixture_records())

    with tempfile.TemporaryDirectory(prefix="synapse-f25b2-") as temp:
        temp_path = Path(temp)
        env = os.environ.copy()
        env.update({
            "SYNAPSE_DATABASE_URL": f"sqlite:///{temp_path / 'f25b2.sqlite'}",
            "SYNAPSE_JWT_SECRET": "f25b2-sse-frontend-verification-secret",
            "SYNAPSE_AGENTSCOPE_REDIS_HOST": redis_host,
            "SYNAPSE_AGENTSCOPE_REDIS_PORT": str(redis_port),
            "SYNAPSE_AGENTSCOPE_STORAGE_REDIS_DB": str(storage_db),
            "SYNAPSE_AGENTSCOPE_BUS_REDIS_DB": str(bus_db),
            "SYNAPSE_AGENTSCOPE_WORKSPACE_PATH": str(temp_path / "agent-workdirs"),
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
        get_settings.cache_clear(); get_engine.cache_clear(); get_session_factory.cache_clear()
        old_cwd = os.getcwd(); os.chdir(API)
        try:
            command.upgrade(Config("alembic.ini"), "head")
        finally:
            os.chdir(old_cwd)

        now = datetime.now(timezone.utc)
        with get_session_factory()() as db:
            actor = User(user_name="f25b2-actor", nick_name="F25b2 Actor", email="f25b2-actor@example.test", password_hash="unused", status="active", del_flag=False, token_version=1)
            peer = User(user_name="f25b2-peer", nick_name="F25b2 Peer", email="f25b2-peer@example.test", password_hash="unused", status="active", del_flag=False, token_version=1)
            db.add_all([actor, peer]); db.flush()
            tenant = Tenant(slug="f25b2-tenant", name="F25b2 Tenant", status="active", settings_json="{}", membership_version=1)
            db.add(tenant); db.flush()
            w1 = Workspace(tenant_id=tenant.tenant_id, slug="one", name="F25b2 Workspace One", status="active", settings_json="{}", created_by=actor.user_id)
            w2 = Workspace(tenant_id=tenant.tenant_id, slug="two", name="F25b2 Workspace Two", status="active", settings_json="{}", created_by=actor.user_id)
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
            }

        api_port, web_port, proxy_port = free_port(), free_port(), free_port()
        api_log = (temp_path / "api.log").open("w")
        web_log = (temp_path / "vite.log").open("w")
        api = subprocess.Popen([sys.executable, "-m", "uvicorn", "app.main:create_app", "--factory", "--host", "127.0.0.1", "--port", str(api_port)], cwd=API, env=env, stdout=api_log, stderr=api_log)
        try:
            try:
                wait_url(f"http://127.0.0.1:{api_port}/api/v1/health", api)
            except Exception:
                api_log.flush()
                print("API startup log:\n" + (temp_path / "api.log").read_text(), file=sys.stderr)
                raise
            api_base = f"http://127.0.0.1:{api_port}/api/v1"
            api_origin = f"http://127.0.0.1:{api_port}"
            proxy_state = ProxyState(api_origin, bus_redis, "")
            handler = create_proxy_handler(proxy_state, get_session_factory())
            proxy = ThreadingHTTPServer(("127.0.0.1", proxy_port), handler)
            proxy.state = proxy_state
            proxy_thread = threading.Thread(target=proxy.serve_forever, daemon=True); proxy_thread.start()
            env["VITE_API_PROXY_TARGET"] = f"http://127.0.0.1:{proxy_port}"
            web = subprocess.Popen([PNPM, "dev", "--host", "127.0.0.1", "--port", str(web_port), "--strictPort"], cwd=WEB, env=env, stdout=web_log, stderr=web_log)
            seed.update({"web": f"http://127.0.0.1:{web_port}", "api": api_base, "proxy": f"http://127.0.0.1:{proxy_port}"})
            wait_url(seed["web"], web)

            # Real AgentScope Agent/Session records are created through FastAPI.
            headers = {"Authorization": f"Bearer {seed['actor_token']}", "X-Workspace-ID": seed["workspace_one"]}
            with httpx.Client(timeout=20) as client:
                response = client.post(api_base + "/ai/agent/", headers=headers, json={"name": "F25b2 Agent One"}); response.raise_for_status()
                seed["agent_one"] = response.json()["agent_id"]
                response = client.post(api_base + "/ai/sessions/", headers=headers, json={"agent_id": seed["agent_one"], "name": "F25b2 Primary Session"}); response.raise_for_status()
                seed["session_one"] = response.json()["session_id"]
                response = client.post(api_base + "/ai/sessions/", headers=headers, json={"agent_id": seed["agent_one"], "name": "F25b2 Second Session"}); response.raise_for_status()
                seed["session_second"] = response.json()["session_id"]
                headers_two = {**headers, "X-Workspace-ID": seed["workspace_two"]}
                response = client.post(api_base + "/ai/agent/", headers=headers_two, json={"name": "F25b2 Agent Two"}); response.raise_for_status()
                seed["agent_two"] = response.json()["agent_id"]
                response = client.post(api_base + "/ai/sessions/", headers=headers_two, json={"agent_id": seed["agent_two"], "name": "F25b2 Workspace Two Session"}); response.raise_for_status()
                seed["session_two"] = response.json()["session_id"]

            from agentscope.message import Msg
            from app.integrations.agentscope_session_scope import WorkspaceSessionStorage, bind_agentscope_context, reset_agentscope_context
            from app.tenancy.context import WorkspaceContext
            async def add_committed_message():
                async with RedisStorage(host=redis_host, port=redis_port, db=storage_db) as raw:
                    scoped = WorkspaceSessionStorage(raw)
                    token = bind_agentscope_context(WorkspaceContext(
                        actor_user_id=int(seed["actor_id"]), tenant_id=int(seed["tenant_id"]),
                        workspace_id=int(seed["workspace_one"]), tenant_role="owner", workspace_role="owner",
                        permission_set=frozenset({"resource:read", "resource:create", "resource:update", "resource:delete"}), membership_version=1,
                    ))
                    try:
                        await scoped.upsert_message(seed["actor_id"], seed["session_one"], Msg(name="assistant", role="assistant", content=[
                            {"type": "text", "text": "F25b2 committed history sentinel"},
                            {"type": "tool_call", "id": "f25b2-history-tool", "name": "history_lookup", "input": '{"query":"safe","token":"history-secret"}', "state": "finished", "created_at": "2026-10-12T01:00:00Z"},
                            {"type": "tool_result", "id": "f25b2-history-tool", "name": "history_lookup", "output": "history result Bearer history-token", "state": "success", "finished_at": "2026-10-12T01:00:01Z"},
                        ]))
                        await scoped.upsert_message(seed["actor_id"], seed["session_second"], Msg(name="assistant", role="assistant", content=[{"type": "text", "text": "F25b2 second committed sentinel"}]))
                    finally:
                        reset_agentscope_context(token)
            asyncio.run(add_committed_message())

            def event(kind, sequence, **attrs):
                return {"type": kind, "reply_id": "f25b2-live-reply", "sequence": sequence, **attrs}
            replay = [
                event("REPLY_START", 1, id="f25b2-reply", name="F25b2 Agent"),
                event("TOOL_CALL_START", 2, tool_call_id="f25b2-live-success", tool_call_name="live_lookup", created_at="2026-10-12T01:01:00Z"),
                event("TOOL_CALL_DELTA", 3, tool_call_id="f25b2-live-success", delta='{"query":"live","token":"live-secret"}'),
                event("TOOL_CALL_END", 4, tool_call_id="f25b2-live-success", tool_call_name="live_lookup"),
                event("TOOL_RESULT_START", 5, tool_call_id="f25b2-live-success", tool_call_name="live_lookup", created_at="2026-10-12T01:01:01Z"),
                event("TOOL_RESULT_TEXT_DELTA", 6, tool_call_id="f25b2-live-success", delta="live result "),
                event("TOOL_RESULT_TEXT_DELTA", 7, tool_call_id="f25b2-live-success", delta="Bearer live-token"),
                event("TOOL_RESULT_DATA_DELTA", 8, tool_call_id="f25b2-live-success"),
                event("TOOL_RESULT_END", 9, tool_call_id="f25b2-live-success", tool_call_name="live_lookup", state="success", created_at="2026-10-12T01:01:02Z"),
                event("TOOL_CALL_START", 10, tool_call_id="f25b2-live-error", tool_call_name="failing_lookup", created_at="2026-10-12T01:02:00Z"),
                event("TOOL_CALL_END", 11, tool_call_id="f25b2-live-error", tool_call_name="failing_lookup"),
                event("TOOL_RESULT_START", 12, tool_call_id="f25b2-live-error", tool_call_name="failing_lookup"),
                event("TOOL_RESULT_TEXT_DELTA", 13, tool_call_id="f25b2-live-error", delta="tool failed: token=error-secret"),
                event("TOOL_RESULT_END", 14, tool_call_id="f25b2-live-error", tool_call_name="failing_lookup", state="error"),
            ]
            bus_redis.delete(f"agentscope:session:events:{seed['session_one']}")
            for payload in replay:
                bus_redis.xadd(f"agentscope:session:events:{seed['session_one']}", {"payload": json.dumps(payload, ensure_ascii=False)})
            proxy_state.session_id = seed["session_one"]
            seed_path = temp_path / "seed.json"; seed_path.write_text(json.dumps(seed))
            result = subprocess.run(["node", str(PLAYWRIGHT), str(seed_path)], cwd=WEB, env=env)
            if result.returncode:
                print("API log tail:\n" + (temp_path / "api.log").read_text()[-5000:], file=sys.stderr)
                return result.returncode
            return 0
        finally:
            for name in ("web",):
                proc = locals().get(name)
                if proc:
                    terminate_process_tree(proc)
            proxy_obj = locals().get("proxy")
            if proxy_obj:
                proxy_obj.shutdown(); proxy_obj.server_close()
            api.terminate(); api.wait(timeout=10)
            seed_data = locals().get("seed") or {}
            if seed_data.get("session_one"):
                bus_redis.delete(f"agentscope:session:events:{seed_data['session_one']}")
            asyncio.run(clean_old_fixture_records())
            get_engine().dispose()
            get_session_factory.cache_clear()
            get_engine.cache_clear()
            api_log.close(); web_log.close()


if __name__ == "__main__":
    raise SystemExit(main())
