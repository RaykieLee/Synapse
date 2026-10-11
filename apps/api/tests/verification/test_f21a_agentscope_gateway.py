"""Live F21a AgentScope gateway verification against same-process Synapse ASGI."""
from __future__ import annotations

import base64
import os
import re
import socket
import threading
import time
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path

import httpx
import pytest

import uvicorn
from alembic import command
from alembic.config import Config
from fastapi import Request
from sqlalchemy import select

pytestmark = [
    pytest.mark.redis,
]

def _free_port() -> int:
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


def _json_code(response: httpx.Response) -> str | None:
    try:
        return response.json().get("code")
    except Exception:
        return None


def _path_example(path: str) -> str:
    return re.sub(r"\{[^}/]+\}", "1", path)


def _flatten_routes(routes):
    """Resolve FastAPI's lazy included routers to concrete registered routes."""
    flattened = []
    for route in routes:
        nested = getattr(route, "original_router", None)
        if nested is not None:
            flattened.extend(_flatten_routes(nested.routes))
        else:
            flattened.append(route)
    return flattened


def _websocket_upgrade(port: int, path: str, headers: list[tuple[str, str]]) -> bytes:
    key = base64.b64encode(b"f21a-test-websocket-key").decode("ascii")
    lines = [
        f"GET {path} HTTP/1.1",
        f"Host: 127.0.0.1:{port}",
        "Upgrade: websocket",
        "Connection: Upgrade",
        f"Sec-WebSocket-Key: {key}",
        "Sec-WebSocket-Version: 13",
    ]
    lines.extend(f"{name}: {value}" for name, value in headers)
    raw = ("\r\n".join(lines) + "\r\n\r\n").encode("ascii")
    with socket.create_connection(("127.0.0.1", port), timeout=4) as sock:
        sock.settimeout(4)
        sock.sendall(raw)
        chunks = []
        while True:
            try:
                chunk = sock.recv(4096)
            except socket.timeout:
                break
            if not chunk:
                break
            chunks.append(chunk)
            if b"\r\n\r\n" in b"".join(chunks):
                # An early websocket.close should deny the handshake with HTTP 403.
                break
    return b"".join(chunks)


def test_f21a_agentscope_gateway_live(tmp_path, monkeypatch):
    redis_host = os.environ.get("F21A_REDIS_HOST", "127.0.0.1")
    redis_port = int(os.environ.get("F21A_REDIS_PORT", "16379"))
    try:
        import redis
        redis.Redis(host=redis_host, port=redis_port, socket_connect_timeout=1).ping()
    except Exception as exc:
        pytest.fail(f"F21a requires live Redis at {redis_host}:{redis_port}: {exc}")

    db_path = tmp_path / "f21a-gateway.sqlite"
    secret = "f21a-live-gateway-verification-secret"
    monkeypatch.setenv("SYNAPSE_DATABASE_URL", f"sqlite:///{db_path}")
    monkeypatch.setenv("SYNAPSE_JWT_SECRET", secret)
    monkeypatch.setenv("SYNAPSE_AGENTSCOPE_REDIS_HOST", redis_host)
    monkeypatch.setenv("SYNAPSE_AGENTSCOPE_REDIS_PORT", str(redis_port))
    monkeypatch.setenv("SYNAPSE_AGENTSCOPE_WORKSPACE_PATH", str(tmp_path / "runtime-workspaces"))

    from app.core.config import get_settings
    from app.database.session import get_engine, get_session_factory
    get_settings.cache_clear(); get_engine.cache_clear(); get_session_factory.cache_clear()
    command.upgrade(Config("alembic.ini"), "head")

    from app.auth.security import issue_token
    from app.models.tenant import Tenant, TenantMember, Workspace, WorkspaceMember
    from app.models.user import User

    now = datetime.now(timezone.utc)
    factory = get_session_factory()
    with factory() as db:
        actor = User(user_name="f21a-platform-admin", nick_name="F21a Actor", email="f21a-actor@example.test",
                     password_hash="unused", status="active", del_flag=False, platform_role="platform_admin", token_version=3)
        owner_a = User(user_name="f21a-owner-a", email="f21a-owner-a@example.test", password_hash="unused")
        owner_b = User(user_name="f21a-owner-b", email="f21a-owner-b@example.test", password_hash="unused")
        db.add_all([actor, owner_a, owner_b]); db.flush()
        tenant_a = Tenant(slug="f21a-alpha", name="F21a Alpha", status="active", settings_json="{}", membership_version=11)
        tenant_b = Tenant(slug="f21a-beta", name="F21a Beta", status="active", settings_json="{}", membership_version=22)
        db.add_all([tenant_a, tenant_b]); db.flush()
        workspaces = [
            Workspace(tenant_id=tenant_a.tenant_id, slug="a-one", name="A One", status="active", settings_json="{}", created_by=owner_a.user_id),
            Workspace(tenant_id=tenant_a.tenant_id, slug="a-two", name="A Two", status="active", settings_json="{}", created_by=owner_a.user_id),
            Workspace(tenant_id=tenant_b.tenant_id, slug="b-one", name="B One", status="active", settings_json="{}", created_by=owner_b.user_id),
        ]
        db.add_all(workspaces); db.flush()
        wid_a1, wid_a2, wid_b1 = [row.workspace_id for row in workspaces]
        db.add_all([
            TenantMember(tenant_id=tenant_a.tenant_id, user_id=actor.user_id, status="active", tenant_role="member", joined_at=now),
            TenantMember(tenant_id=tenant_a.tenant_id, user_id=owner_a.user_id, status="active", tenant_role="owner", joined_at=now),
            TenantMember(tenant_id=tenant_b.tenant_id, user_id=owner_b.user_id, status="active", tenant_role="owner", joined_at=now),
            WorkspaceMember(workspace_id=wid_a1, tenant_id=tenant_a.tenant_id, user_id=actor.user_id, status="active", workspace_role="member", joined_at=now),
            WorkspaceMember(workspace_id=wid_a1, tenant_id=tenant_a.tenant_id, user_id=owner_a.user_id, status="active", workspace_role="owner", joined_at=now),
            WorkspaceMember(workspace_id=wid_a2, tenant_id=tenant_a.tenant_id, user_id=actor.user_id, status="active", workspace_role="viewer", joined_at=now),
            WorkspaceMember(workspace_id=wid_a2, tenant_id=tenant_a.tenant_id, user_id=owner_a.user_id, status="active", workspace_role="owner", joined_at=now),
            WorkspaceMember(workspace_id=wid_b1, tenant_id=tenant_b.tenant_id, user_id=owner_b.user_id, status="active", workspace_role="owner", joined_at=now),
        ]); db.commit()
        actor_id, owner_a_id = actor.user_id, owner_a.user_id
        actor_token_version = actor.token_version
        tenant_a_id, tenant_b_id = tenant_a.tenant_id, tenant_b.tenant_id

    actor_token = issue_token(actor_id, actor_token_version)
    import app.main as main_module
    original_factory = main_module.create_agentscope_app
    observed = {"child": None, "entered": 0, "exited": 0, "probe_hits": 0}

    def instrumented_factory(settings):
        child = original_factory(settings)
        observed["child"] = child
        original_lifespan = child.router.lifespan_context

        @asynccontextmanager
        async def counted_lifespan(app):
            observed["entered"] += 1
            try:
                async with original_lifespan(app):
                    yield
            finally:
                observed["exited"] += 1

        child.router.lifespan_context = counted_lifespan

        @child.get("/__f21a/context")
        async def context_probe(request: Request):
            observed["probe_hits"] += 1
            context = request.state.synapse_context
            try:
                context.workspace_id = -1
                frozen = False
            except Exception:
                frozen = True
            return {
                "actor_user_id": str(context.actor_user_id), "tenant_id": str(context.tenant_id),
                "workspace_id": str(context.workspace_id), "tenant_role": context.tenant_role,
                "workspace_role": context.workspace_role, "permission_set": sorted(context.permission_set),
                "membership_version": context.membership_version, "frozen": frozen,
            }

        return child

    main_module.create_agentscope_app = instrumented_factory
    app = main_module.create_app()
    child = observed["child"]
    assert child is not None
    assert any(getattr(route, "name", None) == "agentscope" and getattr(route, "path", None) == "/api/v1/ai" for route in app.routes)

    # Enumerate concrete registered routes, not only documented OpenAPI paths, so
    # hidden utility endpoints cannot silently escape the gateway sweep.
    concrete_routes = _flatten_routes(child.routes)
    allowed_methods = {"GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"}
    ai_operations = sorted({(method.upper(), route.path) for route in concrete_routes
                            for method in (getattr(route, "methods", None) or set())
                            if method.upper() in allowed_methods and getattr(route, "path", None)})
    assert ai_operations, "No concrete AgentScope HTTP operations discovered from mounted child"
    sse_routes = [route for route in concrete_routes if getattr(route, "path", "").rstrip("/").endswith("/stream")]
    assert len(sse_routes) == 1, f"Expected one SSE route, found {[getattr(route, 'path', None) for route in sse_routes]}"
    downstream = {"sse_handler_hits": 0}
    original_sse_app = sse_routes[0].app

    async def counted_sse_app(scope, receive, send):
        downstream["sse_handler_hits"] += 1
        await original_sse_app(scope, receive, send)

    sse_routes[0].app = counted_sse_app
    websocket_routes = [route for route in concrete_routes if "websocket" in type(route).__name__.lower()]
    assert not websocket_routes, f"AgentScope registers WebSocket routes that require dedicated validation: {websocket_routes}"

    port = _free_port()
    server = uvicorn.Server(uvicorn.Config(app, host="127.0.0.1", port=port, log_level="warning", lifespan="on"))
    thread = threading.Thread(target=server.run, name="f21a-uvicorn", daemon=True)
    thread.start()
    base = f"http://127.0.0.1:{port}"
    tested = []
    try:
        deadline = time.monotonic() + 40
        with httpx.Client(timeout=5) as client:
            while time.monotonic() < deadline:
                if not thread.is_alive():
                    raise AssertionError("Uvicorn exited before startup completed")
                try:
                    root_health = client.get(base + "/api/v1/health")
                    if root_health.status_code == 200:
                        break
                except httpx.HTTPError:
                    time.sleep(.1)
            else:
                raise AssertionError("Synapse root health did not become available")

            # Every actual child HTTP operation must be rejected before route execution
            # without Synapse credentials. X-User-ID cannot act as an identity source.
            for method, template in ai_operations:
                url = base + "/api/v1/ai" + _path_example(template)
                no_auth = client.request(method, url)
                assert no_auth.status_code == 401, f"{method} {template} bypassed gateway: {no_auth.status_code} {no_auth.text[:300]}"
                forged_user = client.request(method, url, headers={"X-User-ID": str(owner_a_id)})
                assert forged_user.status_code == 400 and (method == "HEAD" or _json_code(forged_user) == "IDENTITY_HEADER_FORBIDDEN"), \
                    f"{method} {template} accepted identity header: {forged_user.status_code} {forged_user.text[:300]}"
                forged_tenant = client.request(method, url, headers={"X-Tenant-ID": str(tenant_b_id)})
                assert forged_tenant.status_code == 400 and (method == "HEAD" or _json_code(forged_tenant) == "TENANT_CONTEXT_FORBIDDEN"), \
                    f"{method} {template} accepted tenant selector: {forged_tenant.status_code} {forged_tenant.text[:300]}"
                duplicate_workspace = client.request(method, url, headers=[
                    ("X-Workspace-ID", str(wid_a1)), ("X-Workspace-ID", str(wid_a2))])
                assert duplicate_workspace.status_code == 400 and (method == "HEAD" or _json_code(duplicate_workspace) == "CONTEXT_MISMATCH"), \
                    f"{method} {template} accepted duplicate Workspace selectors: {duplicate_workspace.status_code} {duplicate_workspace.text[:300]}"
                tested.append(f"{method} {template}")
            assert observed["probe_hits"] == 0, "unauthenticated/forged route sweep executed the probe route"

            # Real identity cannot be overwritten by either client selector header.
            identity_headers = {"Authorization": f"Bearer {actor_token}", "X-Workspace-ID": str(wid_a1)}
            fake_user = client.get(base + "/api/v1/ai/__f21a/context", headers={**identity_headers, "X-User-ID": str(owner_a_id)})
            assert fake_user.status_code == 400 and _json_code(fake_user) == "IDENTITY_HEADER_FORBIDDEN"
            fake_tenant = client.get(base + "/api/v1/ai/__f21a/context", headers={**identity_headers, "X-Tenant-ID": str(tenant_b_id)})
            assert fake_tenant.status_code == 400 and _json_code(fake_tenant) == "TENANT_CONTEXT_FORBIDDEN"
            duplicate_selector = client.get(base + "/api/v1/ai/__f21a/context", headers=[
                ("Authorization", f"Bearer {actor_token}"), ("X-Workspace-ID", str(wid_a1)), ("X-Workspace-ID", str(wid_a1))])
            assert duplicate_selector.status_code == 400 and _json_code(duplicate_selector) == "CONTEXT_MISMATCH"
            no_workspace = client.get(base + "/api/v1/ai/__f21a/context", headers={"Authorization": f"Bearer {actor_token}"})
            assert no_workspace.status_code == 400 and _json_code(no_workspace) == "WORKSPACE_CONTEXT_REQUIRED"

            valid = client.get(base + "/api/v1/ai/__f21a/context", headers=identity_headers)
            assert valid.status_code == 200, valid.text
            assert valid.json() == {
                "actor_user_id": str(actor_id), "tenant_id": str(tenant_a_id), "workspace_id": str(wid_a1),
                "tenant_role": "member", "workspace_role": "member",
                "permission_set": ["resource:create", "resource:read", "resource:update"],
                "membership_version": 11, "frozen": True,
            }
            second = client.get(base + "/api/v1/ai/__f21a/context", headers={"Authorization": f"Bearer {actor_token}", "X-Workspace-ID": str(wid_a2)})
            assert second.status_code == 200 and second.json()["workspace_id"] == str(wid_a2)
            assert second.json()["tenant_id"] == str(tenant_a_id) and second.json()["workspace_role"] == "viewer"
            # Platform admin has no implicit business membership in Tenant B.
            platform_cross_tenant = client.get(base + "/api/v1/ai/__f21a/context", headers={"Authorization": f"Bearer {actor_token}", "X-Workspace-ID": str(wid_b1)})
            assert platform_cross_tenant.status_code == 403 and _json_code(platform_cross_tenant) == "MEMBERSHIP_INACTIVE"

            # Membership revocation and state changes are checked live on every request.
            with factory() as db:
                member = db.scalar(select(WorkspaceMember).where(WorkspaceMember.workspace_id == wid_a1, WorkspaceMember.user_id == actor_id))
                member.status = "removed"; db.commit()
            revoked = client.get(base + "/api/v1/ai/__f21a/context", headers=identity_headers)
            assert revoked.status_code == 403 and _json_code(revoked) == "WORKSPACE_MEMBERSHIP_REQUIRED"
            with factory() as db:
                member = db.scalar(select(WorkspaceMember).where(WorkspaceMember.workspace_id == wid_a1, WorkspaceMember.user_id == actor_id))
                member.status = "active"; tenant_member = db.scalar(select(TenantMember).where(TenantMember.tenant_id == tenant_a_id, TenantMember.user_id == actor_id))
                tenant_member.status = "suspended"; db.commit()
            tenant_revoked = client.get(base + "/api/v1/ai/__f21a/context", headers=identity_headers)
            assert tenant_revoked.status_code == 403 and _json_code(tenant_revoked) == "MEMBERSHIP_INACTIVE"
            with factory() as db:
                tenant_member = db.scalar(select(TenantMember).where(TenantMember.tenant_id == tenant_a_id, TenantMember.user_id == actor_id))
                tenant_member.status = "active"
                tenant = db.get(Tenant, tenant_a_id); tenant.status = "suspended"; db.commit()
            tenant_inactive = client.get(base + "/api/v1/ai/__f21a/context", headers=identity_headers)
            assert tenant_inactive.status_code == 409 and _json_code(tenant_inactive) == "TENANT_INACTIVE"
            with factory() as db:
                tenant = db.get(Tenant, tenant_a_id); tenant.status = "active"
                workspace = db.get(Workspace, wid_a1); workspace.status = "archived"; db.commit()
            workspace_archived = client.get(base + "/api/v1/ai/__f21a/context", headers=identity_headers)
            assert workspace_archived.status_code == 409 and _json_code(workspace_archived) == "WORKSPACE_INACTIVE"
            with factory() as db:
                workspace = db.get(Workspace, wid_a1); workspace.status = "active"
                actor = db.get(User, actor_id); actor.status = "disabled"; db.commit()
            disabled_user = client.get(base + "/api/v1/ai/__f21a/context", headers=identity_headers)
            assert disabled_user.status_code == 401
            with factory() as db:
                actor = db.get(User, actor_id); actor.status = "active"; db.commit()

            # SSE cannot begin after ordinary context validation; WebSocket is denied
            # during handshake even if the caller presents valid credentials/context.
            sse = client.get(base + "/api/v1/ai/sessions/999999/stream", headers=identity_headers)
            assert sse.status_code == 503 and _json_code(sse) == "AI_STREAM_CONTEXT_REVALIDATION_REQUIRED"
            assert downstream["sse_handler_hits"] == 0, "SSE rejection reached AgentScope stream handler"
            ws = _websocket_upgrade(port, "/api/v1/ai/__f21a/ws", [
                ("Authorization", f"Bearer {actor_token}"), ("X-Workspace-ID", str(wid_a1))])
            assert ws.startswith(b"HTTP/1.1 403") or ws.startswith(b"HTTP/1.1 400"), ws[:500]
            assert b"101 Switching Protocols" not in ws
    finally:
        server.should_exit = True
        thread.join(timeout=20)
        main_module.create_agentscope_app = original_factory

    assert not thread.is_alive(), "Uvicorn did not stop cleanly"
    assert observed["entered"] == 1 and observed["exited"] == 1
    assert observed["probe_hits"] == 2, "rejected requests reached AgentScope route code"
    assert len(tested) == len(ai_operations)
    storage, bus = child.state.storage, child.state.message_bus
    assert storage.get_client() is None and storage._owned_pool is None
    assert bus.get_client() is None and bus._owned_pool is None
