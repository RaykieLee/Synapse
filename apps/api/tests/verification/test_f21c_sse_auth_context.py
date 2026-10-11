"""F21c live SSE request/gateway context verification with Redis-backed events."""
from __future__ import annotations

import os
import socket
import threading
import time
from datetime import datetime, timezone
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor

import httpx
import pytest

import uvicorn
from alembic import command
from alembic.config import Config
from fastapi import Depends, Request
from sqlalchemy import select

pytestmark = [
    pytest.mark.redis,
    pytest.mark.integration,
]

def _free_port() -> int:
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


def _json_code(response: httpx.Response) -> str | None:
    try:
        body = response.json()
        return body.get("code") or body.get("detail", {}).get("code")
    except Exception:
        return None


def _websocket_upgrade(port: int, path: str, headers: list[tuple[str, str]]) -> bytes:
    import base64
    key = base64.b64encode(b"0123456789abcdef").decode("ascii")
    request = "\r\n".join([
        f"GET {path} HTTP/1.1", f"Host: 127.0.0.1:{port}", "Upgrade: websocket",
        "Connection: Upgrade", f"Sec-WebSocket-Key: {key}", "Sec-WebSocket-Version: 13",
        *(f"{name}: {value}" for name, value in headers), "", "",
    ]).encode("ascii")
    with socket.create_connection(("127.0.0.1", port), timeout=4) as conn:
        conn.settimeout(4)
        conn.sendall(request)
        data = conn.recv(4096)
    return data


def test_f21c_sse_auth_context_live(tmp_path, monkeypatch):
    redis_host = os.environ.get("F21C_REDIS_HOST", "127.0.0.1")
    redis_port = int(os.environ.get("F21C_REDIS_PORT", "6380"))
    try:
        import redis
        redis.Redis(host=redis_host, port=redis_port, socket_connect_timeout=1).ping()
    except Exception as exc:
        pytest.fail(f"F21c requires a live Redis 7 endpoint at {redis_host}:{redis_port}: {exc}")

    db_path = tmp_path / "f21c-sse.sqlite"
    secret = "f21c-live-sse-verification-secret"
    monkeypatch.setenv("SYNAPSE_DATABASE_URL", f"sqlite:///{db_path}")
    monkeypatch.setenv("SYNAPSE_JWT_SECRET", secret)
    monkeypatch.setenv("SYNAPSE_AGENTSCOPE_REDIS_HOST", redis_host)
    monkeypatch.setenv("SYNAPSE_AGENTSCOPE_REDIS_PORT", str(redis_port))
    monkeypatch.setenv("SYNAPSE_AGENTSCOPE_STORAGE_REDIS_DB", "11")
    monkeypatch.setenv("SYNAPSE_AGENTSCOPE_BUS_REDIS_DB", "12")
    monkeypatch.setenv("SYNAPSE_AGENTSCOPE_WORKSPACE_PATH", str(tmp_path / "workspace-roots"))

    from app.core.config import get_settings
    from app.database.session import get_engine, get_session_factory
    get_settings.cache_clear(); get_engine.cache_clear(); get_session_factory.cache_clear()
    command.upgrade(Config("alembic.ini"), "head")

    from app.auth.security import issue_token
    from app.models.tenant import Tenant, TenantMember, Workspace, WorkspaceMember
    from app.models.user import User
    from app.tenancy.context import WorkspaceContext
    from app.integrations.agentscope_session_scope import current_agentscope_context
    import app.integrations.agentscope_gateway as gateway_module
    import app.main as main_module

    now = datetime.now(timezone.utc)
    factory = get_session_factory()
    with factory() as db:
        actor_a = User(user_name="f21c-actor-a", email="f21c-a@example.test", password_hash="unused", status="active", del_flag=False)
        actor_b = User(user_name="f21c-actor-b", email="f21c-b@example.test", password_hash="unused", status="active", del_flag=False)
        owner_a = User(user_name="f21c-owner-a", email="f21c-owner-a@example.test", password_hash="unused")
        owner_b = User(user_name="f21c-owner-b", email="f21c-owner-b@example.test", password_hash="unused")
        db.add_all([actor_a, actor_b, owner_a, owner_b]); db.flush()
        tenant_a = Tenant(slug="f21c-alpha", name="F21c Alpha", status="active", settings_json="{}", membership_version=7)
        tenant_b = Tenant(slug="f21c-beta", name="F21c Beta", status="active", settings_json="{}", membership_version=9)
        db.add_all([tenant_a, tenant_b]); db.flush()
        workspaces = [
            Workspace(tenant_id=tenant_a.tenant_id, slug="a-one", name="A One", status="active", settings_json="{}", created_by=owner_a.user_id),
            Workspace(tenant_id=tenant_a.tenant_id, slug="a-two", name="A Two", status="active", settings_json="{}", created_by=owner_a.user_id),
            Workspace(tenant_id=tenant_b.tenant_id, slug="b-one", name="B One", status="active", settings_json="{}", created_by=owner_b.user_id),
        ]
        db.add_all(workspaces); db.flush()
        wid_a1, wid_a2, wid_b1 = [row.workspace_id for row in workspaces]
        aid, bid = actor_a.user_id, actor_b.user_id
        db.add_all([
            TenantMember(tenant_id=tenant_a.tenant_id, user_id=aid, status="active", tenant_role="member", joined_at=now),
            TenantMember(tenant_id=tenant_a.tenant_id, user_id=owner_a.user_id, status="active", tenant_role="owner", joined_at=now),
            TenantMember(tenant_id=tenant_b.tenant_id, user_id=bid, status="active", tenant_role="member", joined_at=now),
            TenantMember(tenant_id=tenant_b.tenant_id, user_id=owner_b.user_id, status="active", tenant_role="owner", joined_at=now),
            WorkspaceMember(workspace_id=wid_a1, tenant_id=tenant_a.tenant_id, user_id=aid, status="active", workspace_role="member", joined_at=now),
            WorkspaceMember(workspace_id=wid_a2, tenant_id=tenant_a.tenant_id, user_id=aid, status="active", workspace_role="member", joined_at=now),
            WorkspaceMember(workspace_id=wid_b1, tenant_id=tenant_b.tenant_id, user_id=bid, status="active", workspace_role="member", joined_at=now),
            WorkspaceMember(workspace_id=wid_a1, tenant_id=tenant_a.tenant_id, user_id=owner_a.user_id, status="active", workspace_role="owner", joined_at=now),
            WorkspaceMember(workspace_id=wid_a2, tenant_id=tenant_a.tenant_id, user_id=owner_a.user_id, status="active", workspace_role="owner", joined_at=now),
            WorkspaceMember(workspace_id=wid_b1, tenant_id=tenant_b.tenant_id, user_id=owner_b.user_id, status="active", workspace_role="owner", joined_at=now),
        ])
        db.commit()
        a_version, b_version = actor_a.token_version, actor_b.token_version
    token_a, token_b = issue_token(aid, a_version), issue_token(bid, b_version)

    import app.integrations.agentscope_session_scope as scope_module
    from agentscope.app.deps import get_message_bus
    from agentscope.app.message_bus import MessageBusKeys, RedisMessageBus

    observations = {"log_contexts": [], "subscribe_contexts": [], "closed_contexts": [],
                    "reset_contexts": [], "subscriber_closed": threading.Event()}
    observed_lock = threading.Lock()
    original_log_read = RedisMessageBus.log_read
    original_subscribe = RedisMessageBus.subscribe
    original_reset = gateway_module.reset_agentscope_context

    async def observed_log_read(self, *args, **kwargs):
        with observed_lock:
            observations["log_contexts"].append(current_agentscope_context())
        return await original_log_read(self, *args, **kwargs)

    async def observed_subscribe(self, *args, **kwargs):
        with observed_lock:
            observations["subscribe_contexts"].append(current_agentscope_context())
        try:
            async for event in original_subscribe(self, *args, **kwargs):
                yield event
        finally:
            with observed_lock:
                observations["closed_contexts"].append(current_agentscope_context())
            observations["subscriber_closed"].set()

    def observed_reset(token):
        original_reset(token)
        with observed_lock:
            observations["reset_contexts"].append(current_agentscope_context())

    monkeypatch.setattr(RedisMessageBus, "log_read", observed_log_read)
    monkeypatch.setattr(RedisMessageBus, "subscribe", observed_subscribe)
    monkeypatch.setattr(gateway_module, "reset_agentscope_context", observed_reset)

    observed_child = {"app": None}
    original_child_factory = main_module.create_agentscope_app

    def add_test_event_route(settings):
        child = original_child_factory(settings)

        @child.post("/__f21c/publish/{session_id}")
        async def publish_event(session_id: str, request: Request, message_bus=Depends(get_message_bus)):
            context = request.state.synapse_context
            assert isinstance(context, WorkspaceContext)
            await message_bus.publish(
                MessageBusKeys.session_events(session_id),
                {"event": "f21c-controlled", "tenant_id": context.tenant_id, "workspace_id": context.workspace_id},
            )
            return {"published": True}

        observed_child["app"] = child
        return child

    main_module.create_agentscope_app = add_test_event_route
    app = main_module.create_app()
    child = observed_child["app"]
    assert child is not None

    port = _free_port()
    server = uvicorn.Server(uvicorn.Config(app, host="127.0.0.1", port=port, log_level="warning", lifespan="on"))
    server_thread = threading.Thread(target=server.run, name="f21c-sse-uvicorn", daemon=True)
    server_thread.start()
    base = f"http://127.0.0.1:{port}/api/v1/ai"
    headers_a1 = {"Authorization": f"Bearer {token_a}", "X-Workspace-ID": str(wid_a1)}
    headers_a2 = {"Authorization": f"Bearer {token_a}", "X-Workspace-ID": str(wid_a2)}
    headers_b1 = {"Authorization": f"Bearer {token_b}", "X-Workspace-ID": str(wid_b1)}
    session_ids: list[str] = []

    def _assert(response: httpx.Response, expected: int):
        assert response.status_code == expected, f"{response.request.method} {response.request.url}: {response.status_code} {response.text[:400]}"
        return response.json() if response.content else None

    try:
        deadline = time.monotonic() + 40
        with httpx.Client(timeout=10) as client:
            while time.monotonic() < deadline:
                if not server_thread.is_alive():
                    raise AssertionError("Uvicorn exited before startup")
                try:
                    if client.get(f"http://127.0.0.1:{port}/api/v1/health").status_code == 200:
                        break
                except httpx.HTTPError:
                    time.sleep(0.1)
            else:
                raise AssertionError("Synapse API did not become ready")

            # Agents and sessions are created through the actual AgentScope API,
            # so the session ID is a Redis-backed tenant/Workspace/actor key.
            agent_a = _assert(client.post(base + "/agent/", headers=headers_a1, json={"name": "F21c A agent"}), 201)["agent_id"]
            agent_a2 = _assert(client.post(base + "/agent/", headers=headers_a2, json={"name": "F21c A2 agent"}), 201)["agent_id"]
            agent_b = _assert(client.post(base + "/agent/", headers=headers_b1, json={"name": "F21c B agent"}), 201)["agent_id"]
            session_a = _assert(client.post(base + "/sessions/", headers=headers_a1, json={"agent_id": agent_a}), 201)["session_id"]
            session_a2 = _assert(client.post(base + "/sessions/", headers=headers_a2, json={"agent_id": agent_a2}), 201)["session_id"]
            session_b = _assert(client.post(base + "/sessions/", headers=headers_b1, json={"agent_id": agent_b}), 201)["session_id"]
            session_ids.extend((session_a, session_a2, session_b))

            # Confirm real WorkspaceSessionStorage produced distinct scope keys.
            assert session_a.startswith(f"synapse-s{1}-w{wid_a1}-u{aid}-")
            assert session_a2.startswith(f"synapse-s{1}-w{wid_a2}-u{aid}-")
            assert session_b.startswith(f"synapse-s{2}-w{wid_b1}-u{bid}-")

            # WebSocket stays closed before routing or resource access.
            ws_reply = _websocket_upgrade(port, "/api/v1/ai/sessions/foreign/stream", list(headers_a1.items()))
            assert b"403" in ws_reply.split(b"\r\n", 1)[0]

            # Missing JWT and forged identity/tenant selector headers are denied
            # by the actual gateway before any stream feeder can start.
            auth_reject_log_reads = len(observations["log_contexts"])
            auth_reject_subscribers = len(observations["subscribe_contexts"])
            no_auth = client.get(base + f"/sessions/{session_a}/stream", params={"agent_id": agent_a}, headers={"X-Workspace-ID": str(wid_a1)})
            assert no_auth.status_code == 401 and _json_code(no_auth) == "AUTHENTICATION_REQUIRED"
            forged_user = client.get(base + f"/sessions/{session_a}/stream", params={"agent_id": agent_a}, headers={**headers_a1, "X-User-ID": str(bid)})
            assert forged_user.status_code == 400 and _json_code(forged_user) == "IDENTITY_HEADER_FORBIDDEN"
            forged_tenant = client.get(base + f"/sessions/{session_a}/stream", params={"agent_id": agent_a}, headers={**headers_a1, "X-Tenant-ID": "2"})
            assert forged_tenant.status_code == 400 and _json_code(forged_tenant) == "TENANT_CONTEXT_FORBIDDEN"
            assert len(observations["log_contexts"]) == auth_reject_log_reads
            assert len(observations["subscribe_contexts"]) == auth_reject_subscribers

            # Foreign A1 session under A2 membership returns not-found without
            # starting the SSE subscriber. Use a real stream GET via gateway.
            before_subscriptions = len(observations["subscribe_contexts"])
            before_log_reads = len(observations["log_contexts"])
            foreign = client.get(base + f"/sessions/{session_a}/stream", params={"agent_id": agent_a}, headers=headers_a2)
            assert foreign.status_code == 404
            assert len(observations["subscribe_contexts"]) == before_subscriptions
            assert len(observations["log_contexts"]) == before_log_reads

            # Establish a real Redis bus subscriber, publish one controllable
            # event through a helper endpoint that itself traverses the gateway,
            # read one SSE frame, then disconnect the streaming client.
            streamed: dict[str, object] = {}
            stream_ready = threading.Event()

            def consume_one_event():
                with httpx.Client(timeout=None) as stream_client:
                    with stream_client.stream(
                        "GET", base + f"/sessions/{session_a}/stream",
                        params={"agent_id": agent_a}, headers=headers_a1,
                    ) as response:
                        streamed["status"] = response.status_code
                        streamed["content_type"] = response.headers.get("content-type")
                        stream_ready.set()
                        for line in response.iter_lines():
                            if line.startswith("data: ") and "f21c-controlled" in line:
                                streamed["event"] = line
                                break

            with ThreadPoolExecutor(max_workers=1) as pool:
                future = pool.submit(consume_one_event)
                assert stream_ready.wait(10), "SSE request did not connect"
                sub_deadline = time.monotonic() + 10
                expected_context = (aid, 1, wid_a1)
                matched_context = None
                while time.monotonic() < sub_deadline and matched_context is None:
                    with observed_lock:
                        snapshots = list(observations["subscribe_contexts"])
                    matched_context = next((ctx for ctx in snapshots if isinstance(ctx, WorkspaceContext) and
                                            (ctx.actor_user_id, ctx.tenant_id, ctx.workspace_id) == expected_context), None)
                    if matched_context is not None:
                        break
                    time.sleep(0.025)
                published = _assert(client.post(base + f"/__f21c/publish/{session_a}", headers=headers_a1), 200)
                assert published["published"] is True
                future.result(timeout=10)

            assert matched_context is not None, "SSE live Redis feeder never inherited the verified Workspace context"
            observed_context = matched_context
            assert streamed["status"] == 200
            assert str(streamed["content_type"]).startswith("text/event-stream")
            assert "f21c-controlled" in str(streamed.get("event"))
            assert f'"tenant_id": {observed_context.tenant_id}' in str(streamed["event"])
            assert f'"workspace_id": {observed_context.workspace_id}' in str(streamed["event"])
            assert observations["log_contexts"] and observations["log_contexts"][-1] == observed_context
            close_deadline = time.monotonic() + 5
            while time.monotonic() < close_deadline:
                with observed_lock:
                    if observed_context in observations["closed_contexts"]:
                        break
                time.sleep(0.025)
            assert observed_context in observations["closed_contexts"], "SSE feeder did not clean up after client disconnect"
            assert observations["reset_contexts"] and observations["reset_contexts"][-1] is None

            # Revoke membership after the valid stream; a new connection must
            # fail at gateway authorization before Redis replay or subscription.
            before_log_reads = len(observations["log_contexts"])
            before_subscriptions = len(observations["subscribe_contexts"])
            with factory() as db:
                member = db.scalar(select(WorkspaceMember).where(
                    WorkspaceMember.workspace_id == wid_a1, WorkspaceMember.user_id == aid,
                ))
                member.status = "removed"
                db.commit()
            revoked = client.get(base + f"/sessions/{session_a}/stream", params={"agent_id": agent_a}, headers=headers_a1)
            assert revoked.status_code == 403 and _json_code(revoked) == "WORKSPACE_MEMBERSHIP_REQUIRED"
            assert len(observations["log_contexts"]) == before_log_reads
            assert len(observations["subscribe_contexts"]) == before_subscriptions
    finally:
        server.should_exit = True
        server_thread.join(timeout=20)
        main_module.create_agentscope_app = original_child_factory
        get_engine().dispose()
        get_settings.cache_clear(); get_engine.cache_clear(); get_session_factory.cache_clear()

    assert not server_thread.is_alive(), "Uvicorn did not stop cleanly"
