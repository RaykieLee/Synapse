"""F24c end-to-end regression check for session status agent binding."""
from __future__ import annotations

import json
import os
import socket
import subprocess
import sys
import tempfile
import threading
import time
import urllib.request
from datetime import datetime, timezone
from pathlib import Path


ROOT = Path(__file__).resolve().parents[4]
API = ROOT / "apps" / "api"


def _free_port() -> int:
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


def _wait_url(url: str, process: subprocess.Popen, timeout: float = 45) -> None:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if process.poll() is not None:
            raise RuntimeError(f"API process exited with {process.returncode} before {url}")
        try:
            with urllib.request.urlopen(url, timeout=1):
                return
        except Exception:
            time.sleep(.2)
    raise RuntimeError(f"Timed out waiting for {url}")


def _monitored_status(redis_client, client, url: str, headers: dict[str, str], session_id: str):
    monitor = redis_client.monitor()
    monitor.__enter__()
    ready = threading.Event()
    commands: list[str] = []

    def consume():
        ready.set()
        try:
            for item in monitor.listen():
                commands.append(str(item.get("command", "")))
        except Exception:
            return

    thread = threading.Thread(target=consume, daemon=True)
    thread.start()
    if not ready.wait(timeout=2):
        monitor.__exit__(None, None, None)
        raise RuntimeError("Redis MONITOR listener failed to start")
    try:
        response = client.get(url, headers=headers)
        # Let commands emitted by the request reach MONITOR before closing it.
        time.sleep(.08)
        lock_key = f"agentscope:session:lock:{session_id}"
        return response, [line for line in commands if lock_key in line]
    finally:
        monitor.__exit__(None, None, None)
        thread.join(timeout=2)


def _make_entity(client, api: str, headers: dict[str, str], route: str, body: dict, id_key: str) -> str:
    response = client.post(api + route, headers=headers, json=body)
    assert response.status_code in (200, 201), f"{route}: {response.status_code} {response.text}"
    return str(response.json()[id_key])


def main() -> int:
    import redis

    redis_host = os.environ.get("F24C_REDIS_HOST", "127.0.0.1")
    redis_port = int(os.environ.get("F24C_REDIS_PORT", "6380"))
    storage_db, bus_db = 6, 7
    storage_redis = redis.Redis(host=redis_host, port=redis_port, db=storage_db, decode_responses=True)
    bus_redis = redis.Redis(host=redis_host, port=redis_port, db=bus_db, decode_responses=True)
    try:
        storage_redis.ping(); bus_redis.ping()
    except Exception as exc:
        raise RuntimeError(f"F24c requires real Redis at {redis_host}:{redis_port}: {exc}") from exc

    with tempfile.TemporaryDirectory(prefix="synapse-f24c-") as temp:
        temp_dir = Path(temp)
        env = os.environ.copy()
        env.update({
            "SYNAPSE_DATABASE_URL": f"sqlite:///{temp_dir / 'f24c.sqlite'}",
            "SYNAPSE_JWT_SECRET": "f24c-session-status-verification-secret",
            "SYNAPSE_AGENTSCOPE_REDIS_HOST": redis_host,
            "SYNAPSE_AGENTSCOPE_REDIS_PORT": str(redis_port),
            "SYNAPSE_AGENTSCOPE_STORAGE_REDIS_DB": str(storage_db),
            "SYNAPSE_AGENTSCOPE_BUS_REDIS_DB": str(bus_db),
            "SYNAPSE_AGENTSCOPE_WORKSPACE_PATH": str(temp_dir / "workdirs"),
            "SYNAPSE_SCHEDULED_TASKS_ENABLED": "false",
            "SYNAPSE_API_PREFIX": "/api/v1",
        })
        sys.path.insert(0, str(API))
        os.environ.update(env)

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
            actor = User(user_name="f24c-actor", email="f24c-actor@example.test", password_hash="unused", status="active", del_flag=False, token_version=1)
            peer = User(user_name="f24c-peer", email="f24c-peer@example.test", password_hash="unused", status="active", del_flag=False, token_version=1)
            beta_owner = User(user_name="f24c-beta-owner", email="f24c-beta-owner@example.test", password_hash="unused", status="active", del_flag=False, token_version=1)
            db.add_all([actor, peer, beta_owner]); db.flush()
            alpha = Tenant(slug="f24c-alpha", name="F24c Alpha", status="active", settings_json="{}", membership_version=1)
            beta = Tenant(slug="f24c-beta", name="F24c Beta", status="active", settings_json="{}", membership_version=1)
            db.add_all([alpha, beta]); db.flush()
            alpha_one = Workspace(tenant_id=alpha.tenant_id, slug="one", name="Alpha One", status="active", settings_json="{}", created_by=actor.user_id)
            alpha_two = Workspace(tenant_id=alpha.tenant_id, slug="two", name="Alpha Two", status="active", settings_json="{}", created_by=actor.user_id)
            beta_one = Workspace(tenant_id=beta.tenant_id, slug="one", name="Beta One", status="active", settings_json="{}", created_by=beta_owner.user_id)
            db.add_all([alpha_one, alpha_two, beta_one]); db.flush()
            db.add_all([
                TenantMember(tenant_id=alpha.tenant_id, user_id=actor.user_id, status="active", tenant_role="owner", joined_at=now),
                TenantMember(tenant_id=alpha.tenant_id, user_id=peer.user_id, status="active", tenant_role="member", joined_at=now),
                TenantMember(tenant_id=beta.tenant_id, user_id=actor.user_id, status="active", tenant_role="admin", joined_at=now),
                TenantMember(tenant_id=beta.tenant_id, user_id=beta_owner.user_id, status="active", tenant_role="owner", joined_at=now),
                WorkspaceMember(workspace_id=alpha_one.workspace_id, tenant_id=alpha.tenant_id, user_id=actor.user_id, status="active", workspace_role="owner", joined_at=now),
                WorkspaceMember(workspace_id=alpha_one.workspace_id, tenant_id=alpha.tenant_id, user_id=peer.user_id, status="active", workspace_role="member", joined_at=now),
                WorkspaceMember(workspace_id=alpha_two.workspace_id, tenant_id=alpha.tenant_id, user_id=actor.user_id, status="active", workspace_role="owner", joined_at=now),
                WorkspaceMember(workspace_id=beta_one.workspace_id, tenant_id=beta.tenant_id, user_id=actor.user_id, status="active", workspace_role="admin", joined_at=now),
                WorkspaceMember(workspace_id=beta_one.workspace_id, tenant_id=beta.tenant_id, user_id=beta_owner.user_id, status="active", workspace_role="owner", joined_at=now),
            ]); db.commit()
            seed = {
                "actor_id": str(actor.user_id), "peer_id": str(peer.user_id),
                "alpha_tenant": int(alpha.tenant_id), "beta_tenant": int(beta.tenant_id),
                "alpha_one": str(alpha_one.workspace_id), "alpha_two": str(alpha_two.workspace_id),
                "beta_one": str(beta_one.workspace_id),
                "actor_token": issue_token(actor.user_id, actor.token_version),
                "peer_token": issue_token(peer.user_id, peer.token_version),
            }

        api_port = _free_port()
        api = f"http://127.0.0.1:{api_port}/api/v1"
        api_log_path = temp_dir / "api.log"
        api_log = api_log_path.open("w")
        process = subprocess.Popen(
            [sys.executable, "-m", "uvicorn", "app.main:create_app", "--factory", "--host", "127.0.0.1", "--port", str(api_port)],
            cwd=API, env=env, stdout=api_log, stderr=subprocess.STDOUT,
        )
        created: list[tuple[str, str, str]] = []
        locked_sessions: list[str] = []
        try:
            _wait_url(api + "/health", process)
            import httpx

            with httpx.Client(timeout=12) as client:
                headers = {"Authorization": f"Bearer {seed['actor_token']}", "X-Workspace-ID": seed["alpha_one"]}
                alpha_agent_1 = _make_entity(client, api, headers, "/ai/agent/", {"name": "F24c Alpha Agent One"}, "agent_id")
                alpha_agent_2 = _make_entity(client, api, headers, "/ai/agent/", {"name": "F24c Alpha Agent Two"}, "agent_id")
                created.extend([(seed["actor_id"], alpha_agent_1, ""), (seed["actor_id"], alpha_agent_2, "")])
                session_a1 = _make_entity(client, api, headers, "/ai/sessions/", {"agent_id": alpha_agent_1, "name": "F24c Valid Session One"}, "session_id")
                session_a2 = _make_entity(client, api, headers, "/ai/sessions/", {"agent_id": alpha_agent_2, "name": "F24c Valid Session Two"}, "session_id")
                created.extend([(seed["actor_id"], alpha_agent_1, session_a1), (seed["actor_id"], alpha_agent_2, session_a2)])

                headers_a2 = {"Authorization": f"Bearer {seed['actor_token']}", "X-Workspace-ID": seed["alpha_two"]}
                alpha2_agent = _make_entity(client, api, headers_a2, "/ai/agent/", {"name": "F24c Other Workspace Agent"}, "agent_id")
                alpha2_session = _make_entity(client, api, headers_a2, "/ai/sessions/", {"agent_id": alpha2_agent, "name": "F24c Other Workspace Session"}, "session_id")
                created.append((seed["actor_id"], alpha2_agent, alpha2_session))

                headers_b = {"Authorization": f"Bearer {seed['actor_token']}", "X-Workspace-ID": seed["beta_one"]}
                beta_agent = _make_entity(client, api, headers_b, "/ai/agent/", {"name": "F24c Other Tenant Agent"}, "agent_id")
                beta_session = _make_entity(client, api, headers_b, "/ai/sessions/", {"agent_id": beta_agent, "name": "F24c Other Tenant Session"}, "session_id")
                created.append((seed["actor_id"], beta_agent, beta_session))

                headers_peer = {"Authorization": f"Bearer {seed['peer_token']}", "X-Workspace-ID": seed["alpha_one"]}
                peer_agent = _make_entity(client, api, headers_peer, "/ai/agent/", {"name": "F24c Other Actor Agent"}, "agent_id")
                peer_session = _make_entity(client, api, headers_peer, "/ai/sessions/", {"agent_id": peer_agent, "name": "F24c Other Actor Session"}, "session_id")
                created.append((seed["peer_id"], peer_agent, peer_session))

                all_sessions = [session_a1, session_a2, alpha2_session, beta_session, peer_session]
                for session_id in all_sessions:
                    lock_key = f"agentscope:session:lock:{session_id}"
                    bus_redis.set(lock_key, "f24c-running", ex=180)
                    locked_sessions.append(session_id)

                def status(url_workspace, agent_id, session_id, token=seed["actor_token"]):
                    request_headers = {"Authorization": f"Bearer {token}", "X-Workspace-ID": url_workspace}
                    url = f"{api}/ai/sessions/{session_id}/status?agent_id={agent_id}"
                    return _monitored_status(bus_redis, client, url, request_headers, session_id)

                # Valid agent/session bindings reach AgentScope and probe the real Redis lock.
                for agent_id, session_id in ((alpha_agent_1, session_a1), (alpha_agent_2, session_a2)):
                    response, commands = status(seed["alpha_one"], agent_id, session_id)
                    assert response.status_code == 200, response.text
                    assert response.json()["status"] == "running", response.text
                    assert any("EXISTS" in command.upper() for command in commands), commands

                # Same-workspace agent mismatch and sessions from every outside scope are
                # hidden uniformly before the upstream bus status probe.
                invalids = [
                    (seed["alpha_one"], alpha_agent_2, session_a1, seed["actor_token"]),
                    (seed["alpha_one"], alpha2_agent, alpha2_session, seed["actor_token"]),
                    (seed["alpha_one"], beta_agent, beta_session, seed["actor_token"]),
                    (seed["alpha_one"], peer_agent, peer_session, seed["actor_token"]),
                ]
                for workspace_id, agent_id, session_id, token in invalids:
                    response, commands = status(workspace_id, agent_id, session_id, token)
                    assert response.status_code == 404, f"unexpected status={response.status_code}: {response.text}"
                    assert response.json().get("code") == "RESOURCE_NOT_FOUND", response.text
                    assert not commands, f"wrong binding reached Redis run-lock probe: {commands}"

                # Existing list/session and SSE routes are unaffected by the status-only guard.
                listing = client.get(api + f"/ai/sessions/?agent_id={alpha_agent_1}", headers={"Authorization": f"Bearer {seed['actor_token']}", "X-Workspace-ID": seed["alpha_one"]})
                assert listing.status_code == 200, listing.text
                assert session_a1 in listing.text
                with client.stream("GET", api + f"/ai/sessions/{session_a1}/stream?agent_id={alpha_agent_1}", headers={"Authorization": f"Bearer {seed['actor_token']}", "X-Workspace-ID": seed["alpha_one"]}, timeout=4) as stream:
                    assert stream.status_code == 200, stream.text
                    assert "text/event-stream" in stream.headers.get("content-type", "")

            print("F24c session status/agent binding assertions passed")
            return 0
        finally:
            process.terminate()
            try:
                process.wait(timeout=10)
            except subprocess.TimeoutExpired:
                process.kill(); process.wait(timeout=5)
            api_log.close()
            for session_id in locked_sessions:
                bus_redis.delete(f"agentscope:session:lock:{session_id}")
            try:
                from agentscope.app.storage import RedisStorage
                import asyncio
                async def clean():
                    async with RedisStorage(host=redis_host, port=redis_port, db=storage_db) as raw:
                        grouped = {}
                        for user_id, agent_id, session_id in created:
                            grouped.setdefault((user_id, agent_id), []).append(session_id)
                        for (user_id, agent_id), sessions in grouped.items():
                            for session_id in sessions:
                                if session_id:
                                    await raw.delete_session(user_id, agent_id, session_id)
                            if any(sessions):
                                await raw.delete_agent(user_id, agent_id)
                asyncio.run(clean())
            except Exception as exc:
                print(f"fixture cleanup warning: {exc}", file=sys.stderr)


if __name__ == "__main__":
    raise SystemExit(main())
