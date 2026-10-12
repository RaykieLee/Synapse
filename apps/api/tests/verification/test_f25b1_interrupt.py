"""F25b1 real API/browser acceptance for chat generation interruption."""
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
BROWSER_SPEC = WEB / "tests" / "verification" / "f25b1_interrupt.spec.ts"
PNPM = shutil.which("pnpm") or "pnpm.cmd"
STORAGE_DB = 9
BUS_DB = 10


def free_port() -> int:
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return int(sock.getsockname()[1])


def terminate_tree(process: subprocess.Popen) -> None:
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


def wait_url(url: str, process: subprocess.Popen, timeout: float = 50) -> None:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if process.poll() is not None:
            raise RuntimeError(f"process exited with {process.returncode} before {url}")
        try:
            with urllib.request.urlopen(url, timeout=1):
                return
        except Exception:
            time.sleep(.25)
    raise RuntimeError(f"timed out waiting for {url}")


class ProxyState:
    def __init__(self, api_origin: str, bus_redis, session_id: str = ""):
        self.api_origin = api_origin
        self.bus_redis = bus_redis
        self.session_id = session_id
        self.locked = False
        self.delay_interrupt = True
        self.interrupt_calls = 0
        self.release_interrupt = threading.Event()
        self.status_hold_until = 0.0


def proxy_handler(state: ProxyState):
    class Handler(BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.1"

        def log_message(self, *_args):
            return

        def send_json(self, status: int, value: dict):
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
            self.send_header("Access-Control-Allow-Methods", "GET,POST,OPTIONS")
            self.send_header("Access-Control-Allow-Headers", "Authorization,Content-Type,X-Workspace-ID")
            self.send_header("Content-Length", "0")
            self.end_headers()

        def do_POST(self):
            parsed = urlsplit(self.path)
            size = int(self.headers.get("Content-Length", "0"))
            body = self.rfile.read(size) if size else b""
            if parsed.path == "/__f25b1/lock":
                state.bus_redis.set(f"agentscope:session:lock:{state.session_id}", "f25b1-running", ex=180)
                state.locked = True
                state.release_interrupt.clear()
                return self.send_json(200, {"locked": True})
            if parsed.path == "/__f25b1/unlock":
                state.release_interrupt.set()
                return self.send_json(200, {"locked": False})
            return self.proxy(body)

        def proxy(self, body: bytes | None = None):
            parsed = urlsplit(self.path)
            if body is None:
                size = int(self.headers.get("Content-Length", "0"))
                body = self.rfile.read(size) if size else b""
            if parsed.path.endswith(f"/sessions/{state.session_id}/interrupt"):
                state.interrupt_calls += 1
                if state.delay_interrupt:
                    state.release_interrupt.wait(timeout=10)
            headers = {
                key: value for key, value in self.headers.items()
                if key.lower() not in {"host", "content-length", "connection", "accept-encoding"}
            }
            try:
                is_status_refresh = (
                    parsed.path.endswith(f"/sessions/{state.session_id}/status")
                    or parsed.path.endswith("/ai/sessions/")
                )
                if is_status_refresh and time.monotonic() < state.status_hold_until:
                    time.sleep(state.status_hold_until - time.monotonic())
                with httpx.Client(timeout=30) as client:
                    response = client.request(
                        self.command, state.api_origin + self.path,
                        headers=headers, content=body or None,
                    )
                if parsed.path.endswith(f"/sessions/{state.session_id}/interrupt"):
                    state.bus_redis.delete(f"agentscope:session:lock:{state.session_id}")
                    state.locked = False
                    state.status_hold_until = time.monotonic() + 0.75
                self.send_response(response.status_code)
                for key, value in response.headers.items():
                    if key.lower() not in {"content-length", "transfer-encoding", "connection", "content-encoding"}:
                        self.send_header(key, value)
                self.send_header("Content-Length", str(len(response.content)))
                self.end_headers()
                self.wfile.write(response.content)
            except (BrokenPipeError, ConnectionAbortedError, ConnectionResetError, httpx.HTTPError, OSError):
                return

        do_GET = proxy
        do_PUT = proxy
        do_PATCH = proxy
        do_DELETE = proxy

    return Handler


def main() -> int:
    import redis
    from agentscope.app.storage import RedisStorage

    redis_host = os.environ.get("F25B1_REDIS_HOST", "127.0.0.1")
    redis_port = int(os.environ.get("F25B1_REDIS_PORT", "16381"))
    storage_redis = redis.Redis(host=redis_host, port=redis_port, db=STORAGE_DB, decode_responses=True)
    bus_redis = redis.Redis(host=redis_host, port=redis_port, db=BUS_DB, decode_responses=True)
    storage_redis.ping()
    bus_redis.ping()
    wakeup_baseline = {entry_id for entry_id, _ in bus_redis.xrevrange("agentscope:wakeups", count=1000)}

    with tempfile.TemporaryDirectory(prefix="synapse-f25b1-") as temp:
        temp_path = Path(temp)
        env = os.environ.copy()
        env.update({
            "SYNAPSE_DATABASE_URL": f"sqlite:///{temp_path / 'f25b1.sqlite'}",
            "SYNAPSE_JWT_SECRET": "f25b1-interrupt-verification-secret",
            "SYNAPSE_AGENTSCOPE_REDIS_HOST": redis_host,
            "SYNAPSE_AGENTSCOPE_REDIS_PORT": str(redis_port),
            "SYNAPSE_AGENTSCOPE_STORAGE_REDIS_DB": str(STORAGE_DB),
            "SYNAPSE_AGENTSCOPE_BUS_REDIS_DB": str(BUS_DB),
            "SYNAPSE_AGENTSCOPE_WORKSPACE_PATH": str(temp_path / "workdirs"),
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
            actor = User(user_name="f25b1-actor", email="f25b1-actor@example.test", password_hash="unused", status="active", del_flag=False, token_version=1)
            db.add(actor)
            db.flush()
            tenant = Tenant(slug="f25b1-tenant", name="F25b1 Tenant", status="active", settings_json="{}", membership_version=1)
            db.add(tenant)
            db.flush()
            workspace = Workspace(tenant_id=tenant.tenant_id, slug="one", name="F25b1 Workspace", status="active", settings_json="{}", created_by=actor.user_id)
            db.add(workspace)
            db.flush()
            db.add_all([
                TenantMember(tenant_id=tenant.tenant_id, user_id=actor.user_id, status="active", tenant_role="owner", joined_at=now),
                WorkspaceMember(workspace_id=workspace.workspace_id, tenant_id=tenant.tenant_id, user_id=actor.user_id, status="active", workspace_role="owner", joined_at=now),
            ])
            db.commit()
            seed = {
                "actor_token": issue_token(actor.user_id, actor.token_version),
                "workspace": str(workspace.workspace_id),
            }

        api_port, web_port, proxy_port = free_port(), free_port(), free_port()
        api_log = (temp_path / "api.log").open("w")
        web_log = (temp_path / "vite.log").open("w")
        api_process = subprocess.Popen(
            [sys.executable, "-m", "uvicorn", "app.main:create_app", "--factory", "--host", "127.0.0.1", "--port", str(api_port)],
            cwd=API, env=env, stdout=api_log, stderr=api_log,
        )
        proxy = None
        web_process = None
        created_agent = created_session = ""
        lock_key = ""
        try:
            try:
                wait_url(f"http://127.0.0.1:{api_port}/api/v1/health", api_process)
            except Exception:
                api_log.flush()
                print("API startup log:\n" + (temp_path / "api.log").read_text(encoding="utf-8"), file=sys.stderr)
                raise
            api_base = f"http://127.0.0.1:{api_port}/api/v1"
            headers = {"Authorization": f"Bearer {seed['actor_token']}", "X-Workspace-ID": seed["workspace"]}
            with httpx.Client(timeout=20) as client:
                response = client.post(api_base + "/ai/agent/", headers=headers, json={"name": "F25b1 Interrupt Agent"})
                assert response.status_code == 201, response.text
                created_agent = response.json()["agent_id"]
                response = client.post(api_base + "/ai/sessions/", headers=headers, json={"agent_id": created_agent, "name": "F25b1 Interrupt Session"})
                assert response.status_code == 201, response.text
                created_session = response.json()["session_id"]
                seed.update({"agent": created_agent, "session": created_session})

                status_url = f"{api_base}/ai/sessions/{created_session}/status?agent_id={created_agent}"
                idle = client.get(status_url, headers=headers)
                assert idle.status_code == 200 and idle.json()["status"] == "idle", idle.text
                idle_interrupt = client.post(
                    f"{api_base}/ai/sessions/{created_session}/interrupt?agent_id={created_agent}",
                    headers=headers,
                )
                assert idle_interrupt.status_code == 202, idle_interrupt.text
                idle_repeat = client.post(
                    f"{api_base}/ai/sessions/{created_session}/interrupt?agent_id={created_agent}",
                    headers=headers,
                )
                assert idle_repeat.status_code == 202, idle_repeat.text
                idle_after_interrupt = client.get(status_url, headers=headers)
                assert idle_after_interrupt.status_code == 200 and idle_after_interrupt.json()["status"] == "idle", idle_after_interrupt.text

                lock_key = f"agentscope:session:lock:{created_session}"
                bus_redis.set(lock_key, "f25b1-running", ex=180)
                running = client.get(status_url, headers=headers)
                assert running.status_code == 200 and running.json()["status"] == "running", running.text

                pubsub = bus_redis.pubsub()
                pubsub.subscribe("agentscope:session:interrupt")
                pubsub.get_message(timeout=1)
                running_interrupt = client.post(f"{api_base}/ai/sessions/{created_session}/interrupt?agent_id={created_agent}", headers=headers)
                assert running_interrupt.status_code == 202, running_interrupt.text
                message = None
                deadline = time.monotonic() + 2
                while time.monotonic() < deadline and not message:
                    candidate = pubsub.get_message(timeout=.2)
                    if candidate and candidate["type"] == "message":
                        message = candidate
                assert message and message["type"] == "message", message
                assert created_session in str(message["data"]), message
                pubsub.close()

                wrong_agent = client.post(
                    f"{api_base}/ai/sessions/{created_session}/interrupt?agent_id=wrong-agent",
                    headers=headers,
                )
                assert wrong_agent.status_code == 404, wrong_agent.text
                missing = client.post(
                    f"{api_base}/ai/sessions/missing-session/interrupt?agent_id={created_agent}",
                    headers=headers,
                )
                assert missing.status_code == 404, missing.text

            bus_redis.delete(lock_key)
            state = ProxyState(f"http://127.0.0.1:{api_port}", bus_redis, created_session)
            proxy = ThreadingHTTPServer(("127.0.0.1", proxy_port), proxy_handler(state))
            proxy.daemon_threads = True
            proxy.state = state
            threading.Thread(target=proxy.serve_forever, daemon=True).start()
            env["VITE_API_PROXY_TARGET"] = f"http://127.0.0.1:{proxy_port}"
            web_process = subprocess.Popen(
                [PNPM, "dev", "--host", "127.0.0.1", "--port", str(web_port), "--strictPort"],
                cwd=WEB, env=env, stdout=web_log, stderr=web_log,
            )
            wait_url(f"http://127.0.0.1:{web_port}", web_process)
            state.bus_redis.set(lock_key, "f25b1-running", ex=180)
            state.locked = True
            seed["web"] = f"http://127.0.0.1:{web_port}"
            seed["proxy"] = f"http://127.0.0.1:{proxy_port}"
            seed_path = temp_path / "seed.json"
            seed_path.write_text(json.dumps(seed), encoding="utf-8")
            browser = subprocess.run(
                ["node", "--experimental-strip-types", str(BROWSER_SPEC), str(seed_path)],
                cwd=WEB, env=env,
            )
            assert browser.returncode == 0, f"browser runner exited {browser.returncode}"
            print("F25b1 interrupt API/browser verification passed")
            return 0
        finally:
            if web_process is not None:
                terminate_tree(web_process)
            if proxy is not None:
                proxy.shutdown()
                proxy.server_close()
            terminate_tree(api_process)
            if lock_key:
                bus_redis.delete(lock_key)
            if created_session:
                bus_redis.delete(f"agentscope:session:events:{created_session}")
            new_wakeups = [
                entry_id for entry_id, _ in bus_redis.xrange("agentscope:wakeups")
                if entry_id not in wakeup_baseline
            ]
            if new_wakeups:
                bus_redis.xdel("agentscope:wakeups", *new_wakeups)
            if created_agent:
                async def cleanup():
                    async with RedisStorage(host=redis_host, port=redis_port, db=STORAGE_DB) as raw:
                        if created_session:
                            await raw.delete_session(str(actor.user_id), created_agent, created_session)
                        await raw.delete_agent(str(actor.user_id), created_agent)
                asyncio.run(cleanup())
            get_engine().dispose()
            get_session_factory.cache_clear()
            get_engine.cache_clear()
            api_log.close()
            web_log.close()


if __name__ == "__main__":
    raise SystemExit(main())
