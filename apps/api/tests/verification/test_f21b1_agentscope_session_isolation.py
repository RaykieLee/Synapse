"""Live F21b1 AgentScope session/message scope verification through mounted API."""
from __future__ import annotations

import socket
import threading
import time
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from concurrent.futures import ThreadPoolExecutor

import httpx
import pytest
import uvicorn
from alembic import command
from alembic.config import Config
from fastapi import Depends, Request


def _free_port() -> int:
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


def _assert_ok(response: httpx.Response, status: int = 200):
    assert response.status_code == status, f"{response.request.method} {response.request.url}: {response.status_code} {response.text[:500]}"
    return response.json() if response.content else None


def test_f21b1_agentscope_session_message_isolation_live(tmp_path, monkeypatch):
    redis_host = __import__("os").environ.get("F21B1_REDIS_HOST", "127.0.0.1")
    redis_port = int(__import__("os").environ.get("F21B1_REDIS_PORT", "16379"))
    try:
        import redis
        redis.Redis(host=redis_host, port=redis_port, socket_connect_timeout=1).ping()
    except Exception as exc:
        pytest.fail(f"F21b1 requires a live Redis 7 endpoint at {redis_host}:{redis_port}: {exc}")

    db_path = tmp_path / "f21b1-session-isolation.sqlite"
    secret = "f21b1-live-session-verification-secret"
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
        actor_a = User(user_name="f21b1-actor-a", nick_name="Actor A", email="f21b1-a@example.test", password_hash="unused", status="active", del_flag=False)
        actor_b = User(user_name="f21b1-actor-b", nick_name="Actor B", email="f21b1-b@example.test", password_hash="unused", status="active", del_flag=False)
        owner_a = User(user_name="f21b1-owner-a", email="f21b1-owner-a@example.test", password_hash="unused")
        owner_b = User(user_name="f21b1-owner-b", email="f21b1-owner-b@example.test", password_hash="unused")
        db.add_all([actor_a, actor_b, owner_a, owner_b]); db.flush()
        tenant_a = Tenant(slug="f21b1-alpha", name="F21b1 Alpha", status="active", settings_json="{}", membership_version=31)
        tenant_b = Tenant(slug="f21b1-beta", name="F21b1 Beta", status="active", settings_json="{}", membership_version=42)
        db.add_all([tenant_a, tenant_b]); db.flush()
        workspace_rows = [
            Workspace(tenant_id=tenant_a.tenant_id, slug="a-one", name="A One", status="active", settings_json="{}", created_by=owner_a.user_id),
            Workspace(tenant_id=tenant_a.tenant_id, slug="a-two", name="A Two", status="active", settings_json="{}", created_by=owner_a.user_id),
            Workspace(tenant_id=tenant_b.tenant_id, slug="b-one", name="B One", status="active", settings_json="{}", created_by=owner_b.user_id),
        ]
        db.add_all(workspace_rows); db.flush()
        wid_a1, wid_a2, wid_b1 = [row.workspace_id for row in workspace_rows]
        aid, bid = actor_a.user_id, actor_b.user_id
        db.add_all([
            TenantMember(tenant_id=tenant_a.tenant_id, user_id=aid, status="active", tenant_role="member", joined_at=now),
            TenantMember(tenant_id=tenant_a.tenant_id, user_id=bid, status="active", tenant_role="member", joined_at=now),
            TenantMember(tenant_id=tenant_a.tenant_id, user_id=owner_a.user_id, status="active", tenant_role="owner", joined_at=now),
            TenantMember(tenant_id=tenant_b.tenant_id, user_id=bid, status="active", tenant_role="member", joined_at=now),
            TenantMember(tenant_id=tenant_b.tenant_id, user_id=owner_b.user_id, status="active", tenant_role="owner", joined_at=now),
            WorkspaceMember(workspace_id=wid_a1, tenant_id=tenant_a.tenant_id, user_id=aid, status="active", workspace_role="member", joined_at=now),
            WorkspaceMember(workspace_id=wid_a1, tenant_id=tenant_a.tenant_id, user_id=bid, status="active", workspace_role="member", joined_at=now),
            WorkspaceMember(workspace_id=wid_a1, tenant_id=tenant_a.tenant_id, user_id=owner_a.user_id, status="active", workspace_role="owner", joined_at=now),
            WorkspaceMember(workspace_id=wid_a2, tenant_id=tenant_a.tenant_id, user_id=aid, status="active", workspace_role="member", joined_at=now),
            WorkspaceMember(workspace_id=wid_a2, tenant_id=tenant_a.tenant_id, user_id=owner_a.user_id, status="active", workspace_role="owner", joined_at=now),
            WorkspaceMember(workspace_id=wid_b1, tenant_id=tenant_b.tenant_id, user_id=bid, status="active", workspace_role="member", joined_at=now),
            WorkspaceMember(workspace_id=wid_b1, tenant_id=tenant_b.tenant_id, user_id=owner_b.user_id, status="active", workspace_role="owner", joined_at=now),
        ]); db.commit()
        taid, tbid = tenant_a.tenant_id, tenant_b.tenant_id
        aversion, bversion = actor_a.token_version, actor_b.token_version

    token_a, token_b = issue_token(aid, aversion), issue_token(bid, bversion)
    import app.main as main_module
    from app.integrations.agentscope_session_scope import WorkspaceSessionStorage
    from agentscope.app.deps import get_storage
    from agentscope.app.storage import SessionConfig
    from agentscope.state import AgentState
    from agentscope.message import UserMsg

    original_factory = main_module.create_agentscope_app
    observed = {"child": None, "entered": 0, "exited": 0}

    def instrumented_factory(settings):
        child = original_factory(settings)
        observed["child"] = child
        old_lifespan = child.router.lifespan_context

        @asynccontextmanager
        async def counted_lifespan(app):
            observed["entered"] += 1
            try:
                async with old_lifespan(app):
                    yield
            finally:
                observed["exited"] += 1

        child.router.lifespan_context = counted_lifespan

        @child.post("/__f21b1/message-write/{session_id}")
        async def write_message(session_id: str, request: Request, storage=Depends(get_storage)):
            context = request.state.synapse_context
            assert isinstance(storage, WorkspaceSessionStorage)
            msg = UserMsg(name="actor", content="message-v1", id="f21b1-stable-message")
            await storage.upsert_message(str(context.actor_user_id), session_id, msg)
            # Re-upsert of the same tail ID is the upstream storage merge/update behavior.
            edited = UserMsg(name="actor", content="message-v2", id="f21b1-stable-message")
            await storage.upsert_message(str(context.actor_user_id), session_id, edited)
            raw = storage._storage
            key = raw._message_key(str(context.actor_user_id), session_id)
            return {"storage_class": type(storage).__name__, "message_id": edited.id,
                    "redis_message_key": key, "stored_messages": await raw._client.llen(key)}

        @child.post("/__f21b1/attack/{session_id}")
        async def attack_foreign_session(session_id: str, request: Request, agent_id: str, message_id: str,
                                         raw_session_key: str,
                                         storage=Depends(get_storage)):
            context = request.state.synapse_context
            user_id = str(context.actor_user_id)
            assert isinstance(storage, WorkspaceSessionStorage)
            session = await storage.get_session(user_id, agent_id, session_id)
            message = await storage.get_message(user_id, session_id, message_id)
            messages, more = await storage.list_messages(user_id, session_id)
            raw_key_session = await storage.get_session(user_id, agent_id, raw_session_key)
            raw_key_message, raw_key_more = await storage.list_messages(user_id, raw_session_key)
            raw_key_deleted = await storage.delete_session(user_id, agent_id, raw_session_key)
            deleted = await storage.delete_session(user_id, agent_id, session_id)
            try:
                await storage.update_session_state(user_id, agent_id, session_id, AgentState())
                update_state = "unexpected-success"
            except KeyError:
                update_state = "not-found"
            try:
                await storage.upsert_session(user_id, agent_id, SessionConfig(workspace_id="attack"), session_id=session_id)
                update_session = "unexpected-success"
            except ValueError:
                update_session = "rejected"
            try:
                await storage.upsert_message(user_id, session_id, UserMsg(name="attacker", content="tampered", id="f21b1-injected"))
                update_message = "unexpected-success"
            except ValueError:
                update_message = "rejected"
            await storage.set_session_team_id(user_id, session_id, "foreign-team")
            sessions = await storage.list_sessions(user_id, agent_id)
            return {"session_visible": session is not None, "message_visible": message is not None,
                    "messages": len(messages), "has_more": more, "delete_result": deleted,
                    "raw_key_session_visible": raw_key_session is not None,
                    "raw_key_messages": len(raw_key_message), "raw_key_more": raw_key_more,
                    "raw_key_delete_result": raw_key_deleted,
                    "state_update": update_state, "session_update": update_session,
                    "message_update": update_message,
                    "session_ids": [row.id for row in sessions]}

        @child.post("/__f21b1/seed-legacy/{agent_id}")
        async def seed_legacy_session(agent_id: str, request: Request, storage=Depends(get_storage)):
            context = request.state.synapse_context
            raw = storage._storage
            record = await raw.upsert_session(
                user_id=str(context.actor_user_id), agent_id=agent_id,
                config=SessionConfig(workspace_id="legacy-unscoped-workdir", name="legacy session"),
                session_id="legacy-unscoped-f21b1-session",
            )
            return {"session_id": record.id}

        @child.get("/__f21b1/raw-key-state/{session_id}")
        async def raw_key_state(session_id: str, request: Request, storage=Depends(get_storage)):
            context = request.state.synapse_context
            raw = storage._storage
            session_key = raw._key(raw.key_config.session, user_id=str(context.actor_user_id), session_id=session_id)
            message_key = raw._message_key(str(context.actor_user_id), session_id)
            return {"session_exists": bool(await raw._client.exists(session_key)),
                    "message_exists": bool(await raw._client.exists(message_key)),
                    "session_key": session_key, "message_key": message_key}

        return child

    main_module.create_agentscope_app = instrumented_factory
    app = main_module.create_app()
    child = observed["child"]
    assert child is not None
    assert any(getattr(route, "name", None) == "agentscope" and getattr(route, "path", None) == "/api/v1/ai" for route in app.routes)

    # Verify every upstream session route's dependency chain is storage-wrapper based
    # either directly (get_storage) or through lifespan services built from that storage.
    from agentscope.app._router._session import session_router
    from agentscope.app.deps import get_chat_service, get_session_service
    from agentscope.app._router._chat import chat_router
    dependency_functions = {
        route.endpoint.__name__: {dep.call for dep in route.dependant.dependencies}
        for route in session_router.routes if getattr(route, "dependant", None) is not None
    }
    expected_dependencies = {
        "list_sessions": get_storage,
        "create_session": get_storage,
        "delete_session": get_session_service,
        "interrupt_session": get_chat_service,
        "update_session": get_storage,
        "list_messages": get_storage,
        "get_session_status": get_session_service,
        "stream_session_events": get_storage,
    }
    for endpoint, dependency in expected_dependencies.items():
        assert dependency in dependency_functions.get(endpoint, set()), f"{endpoint} does not depend on {dependency.__name__}"
    chat_dependencies = {
        route.endpoint.__name__: {dep.call for dep in route.dependant.dependencies}
        for route in chat_router.routes if getattr(route, "dependant", None) is not None
    }
    assert any(get_chat_service in dependencies for dependencies in chat_dependencies.values()), \
        "AgentScope chat/message creation routes do not depend on the shared ChatService"

    port = _free_port()
    server = uvicorn.Server(uvicorn.Config(app, host="127.0.0.1", port=port, log_level="warning", lifespan="on"))
    thread = threading.Thread(target=server.run, name="f21b1-uvicorn", daemon=True)
    thread.start()
    base = f"http://127.0.0.1:{port}/api/v1/ai"

    def headers(token: str, workspace_id: int):
        return {"Authorization": f"Bearer {token}", "X-Workspace-ID": str(workspace_id)}

    def create_agent(client: httpx.Client, token: str, workspace_id: int, name: str):
        result = _assert_ok(client.post(base + "/agent/", headers=headers(token, workspace_id), json={"name": name}), 201)
        assert result.get("agent_id")
        return result["agent_id"]

    def create_session(client: httpx.Client, token: str, workspace_id: int, agent_id: str, name: str):
        result = _assert_ok(client.post(base + "/sessions/", headers=headers(token, workspace_id),
                                        json={"agent_id": agent_id, "name": name}), 201)
        assert result.get("session_id")
        return result["session_id"]

    tested_routes = []
    try:
        deadline = time.monotonic() + 40
        with httpx.Client(timeout=8) as client:
            while time.monotonic() < deadline:
                if not thread.is_alive():
                    raise AssertionError("Uvicorn exited before startup")
                try:
                    root_health = client.get(f"http://127.0.0.1:{port}/api/v1/health")
                    if root_health.status_code == 200:
                        break
                except httpx.HTTPError:
                    time.sleep(.1)
            else:
                raise AssertionError("Root API did not become ready")

            assert isinstance(child.state.storage, WorkspaceSessionStorage)
            assert child.state.session_service._storage is child.state.storage
            assert child.state.chat_service._storage is child.state.storage

            # Create three independent agents/sessions through AgentScope's real API:
            # actor A in two Workspaces of tenant A, actor B in both tenants.
            agent_a1 = create_agent(client, token_a, wid_a1, "A1 agent")
            session_a1 = create_session(client, token_a, wid_a1, agent_a1, "A1 session")
            agent_a2 = create_agent(client, token_a, wid_a2, "A2 agent")
            session_a2 = create_session(client, token_a, wid_a2, agent_a2, "A2 session")
            agent_ba1 = create_agent(client, token_b, wid_a1, "B in A1 agent")
            session_ba1 = create_session(client, token_b, wid_a1, agent_ba1, "B in A1 session")
            agent_bb1 = create_agent(client, token_b, wid_b1, "B1 agent")
            session_bb1 = create_session(client, token_b, wid_b1, agent_bb1, "B1 session")
            tested_routes.extend(["POST /agent/", "POST /sessions/"])

            expected_prefix_a1 = f"synapse-s{taid}-w{wid_a1}-u{aid}-"
            expected_prefix_a2 = f"synapse-s{taid}-w{wid_a2}-u{aid}-"
            expected_prefix_ba1 = f"synapse-s{taid}-w{wid_a1}-u{bid}-"
            expected_prefix_bb1 = f"synapse-s{tbid}-w{wid_b1}-u{bid}-"
            assert session_a1.startswith(expected_prefix_a1), session_a1
            assert session_a2.startswith(expected_prefix_a2), session_a2
            assert session_ba1.startswith(expected_prefix_ba1), session_ba1
            assert session_bb1.startswith(expected_prefix_bb1), session_bb1
            assert len({session_a1, session_a2, session_ba1, session_bb1}) == 4

            # Actual upstream list/status/read routes use the same wrapper. Seed one
            # old unscoped record beneath the real raw backend to prove it is hidden.
            legacy = _assert_ok(client.post(base + f"/__f21b1/seed-legacy/{agent_a1}", headers=headers(token_a, wid_a1)))
            legacy_id = legacy["session_id"]
            listing_a1 = _assert_ok(client.get(base + "/sessions/", headers=headers(token_a, wid_a1), params={"agent_id": agent_a1}))
            ids_a1 = [item["session"]["id"] for item in listing_a1["sessions"]]
            assert session_a1 in ids_a1 and legacy_id not in ids_a1
            assert all(item.startswith(expected_prefix_a1) for item in ids_a1)
            listing_a2 = _assert_ok(client.get(base + "/sessions/", headers=headers(token_a, wid_a2), params={"agent_id": agent_a2}))
            assert [item["session"]["id"] for item in listing_a2["sessions"]] == [session_a2]
            listing_ba1 = _assert_ok(client.get(base + "/sessions/", headers=headers(token_b, wid_a1), params={"agent_id": agent_ba1}))
            assert [item["session"]["id"] for item in listing_ba1["sessions"]] == [session_ba1]
            assert _assert_ok(client.get(base + f"/sessions/{session_a1}/status", headers=headers(token_a, wid_a1), params={"agent_id": agent_a1}))["status"] == "idle"
            assert client.get(base + f"/sessions/{legacy_id}/messages", headers=headers(token_a, wid_a1), params={"agent_id": agent_a1}).status_code == 404
            tested_routes.extend(["GET /sessions/", "GET /sessions/{id}/status", "GET /sessions/{id}/messages legacy"])

            # Test helper writes and updates a real message through the same injected
            # storage wrapper. Read it via upstream GET /sessions/{id}/messages.
            write_result = _assert_ok(client.post(base + f"/__f21b1/message-write/{session_a1}", headers=headers(token_a, wid_a1)))
            assert write_result["storage_class"] == "WorkspaceSessionStorage" and write_result["stored_messages"] == 1
            raw_keys = _assert_ok(client.get(base + f"/__f21b1/raw-key-state/{session_a1}", headers=headers(token_a, wid_a1)))
            assert raw_keys["session_exists"] and raw_keys["message_exists"]
            message_list = _assert_ok(client.get(base + f"/sessions/{session_a1}/messages", headers=headers(token_a, wid_a1), params={"agent_id": agent_a1}))
            assert len(message_list["messages"]) == 1
            msg = message_list["messages"][0]
            assert msg["id"] == "f21b1-stable-message" and msg["content"][0]["text"] == "message-v2"
            message_id = msg["id"]
            tested_routes.append("GET /sessions/{id}/messages; wrapper upsert create/update")

            # Real PATCH mutates session configuration. Verify persisted values by both
            # route response and subsequent GET session listing.
            patched = _assert_ok(client.patch(base + f"/sessions/{session_a1}", headers=headers(token_a, wid_a1),
                                               params={"agent_id": agent_a1}, json={"name": "A1 session updated"}))
            assert patched["config"]["name"] == "A1 session updated"
            updated_list = _assert_ok(client.get(base + "/sessions/", headers=headers(token_a, wid_a1), params={"agent_id": agent_a1}))
            assert next(row["session"] for row in updated_list["sessions"] if row["session"]["id"] == session_a1)["config"]["name"] == "A1 session updated"
            tested_routes.extend(["PATCH /sessions/{id}", "GET /sessions/ updated state"])

            # Test direct cross-scope ID use under actor A/Workspace A2, actor B in
            # the same Workspace A1, and actor B/tenant B. Every wrapper operation
            # must fail closed or return an empty result.
            attack_a2 = _assert_ok(client.post(base + f"/__f21b1/attack/{session_a1}", headers=headers(token_a, wid_a2),
                                               params={"agent_id": agent_a1, "message_id": message_id,
                                                       "raw_session_key": raw_keys["session_key"]}))
            assert attack_a2["session_visible"] is False and attack_a2["message_visible"] is False
            assert attack_a2["messages"] == 0 and attack_a2["delete_result"] is False
            assert not attack_a2["raw_key_session_visible"] and attack_a2["raw_key_messages"] == 0 and not attack_a2["raw_key_delete_result"]
            assert attack_a2["state_update"] == "not-found" and attack_a2["session_update"] == "rejected" and attack_a2["message_update"] == "rejected"
            assert attack_a2["session_ids"] == []
            attack_actor = _assert_ok(client.post(base + f"/__f21b1/attack/{session_a1}", headers=headers(token_b, wid_a1),
                                                  params={"agent_id": agent_a1, "message_id": message_id,
                                                          "raw_session_key": raw_keys["session_key"]}))
            assert not attack_actor["session_visible"] and not attack_actor["message_visible"]
            assert attack_actor["messages"] == 0 and not attack_actor["delete_result"]
            assert not attack_actor["raw_key_session_visible"] and attack_actor["raw_key_messages"] == 0 and not attack_actor["raw_key_delete_result"]
            assert attack_actor["state_update"] == "not-found" and attack_actor["session_update"] == "rejected" and attack_actor["message_update"] == "rejected"
            attack_tenant = _assert_ok(client.post(base + f"/__f21b1/attack/{session_a1}", headers=headers(token_b, wid_b1),
                                                   params={"agent_id": agent_a1, "message_id": message_id,
                                                           "raw_session_key": raw_keys["session_key"]}))
            assert not attack_tenant["session_visible"] and not attack_tenant["message_visible"]
            assert attack_tenant["messages"] == 0 and not attack_tenant["delete_result"]
            assert not attack_tenant["raw_key_session_visible"] and attack_tenant["raw_key_messages"] == 0 and not attack_tenant["raw_key_delete_result"]
            assert attack_tenant["state_update"] == "not-found" and attack_tenant["session_update"] == "rejected" and attack_tenant["message_update"] == "rejected"

            # Public API attempts to read/update/delete another scope's session also
            # return not-found. The original actor still sees the unchanged record.
            for token, workspace_id, agent_id in ((token_a, wid_a2, agent_a2), (token_b, wid_a1, agent_ba1), (token_b, wid_b1, agent_bb1)):
                assert client.get(base + f"/sessions/{session_a1}/messages", headers=headers(token, workspace_id), params={"agent_id": agent_id}).status_code == 404
                assert client.patch(base + f"/sessions/{session_a1}", headers=headers(token, workspace_id), params={"agent_id": agent_id}, json={"name": "tampered"}).status_code == 404
                assert client.delete(base + f"/sessions/{session_a1}", headers=headers(token, workspace_id), params={"agent_id": agent_id}).status_code == 404
            intact = _assert_ok(client.get(base + f"/sessions/{session_a1}/messages", headers=headers(token_a, wid_a1), params={"agent_id": agent_a1}))
            assert len(intact["messages"]) == 1 and intact["messages"][0]["content"][0]["text"] == "message-v2"
            assert _assert_ok(client.get(base + f"/__f21b1/raw-key-state/{session_a1}", headers=headers(token_a, wid_a1))) == raw_keys
            tested_routes.extend(["cross-scope wrapper ID/key read/update/delete attacks", "GET/PATCH/DELETE cross-scope session routes"])

            # ContextVars remain request-local during parallel calls that switch
            # tenant/Workspace/actor. Each upstream list sees only its own session.
            def concurrent_list(token, workspace, agent):
                response = client.get(base + "/sessions/", headers=headers(token, workspace), params={"agent_id": agent})
                data = _assert_ok(response)
                return [item["session"]["id"] for item in data["sessions"]]
            with ThreadPoolExecutor(max_workers=4) as pool:
                futures = [
                    pool.submit(concurrent_list, token_a, wid_a1, agent_a1),
                    pool.submit(concurrent_list, token_a, wid_a2, agent_a2),
                    pool.submit(concurrent_list, token_b, wid_a1, agent_ba1),
                    pool.submit(concurrent_list, token_b, wid_b1, agent_bb1),
                ]
                results = [future.result(timeout=10) for future in futures]
            assert results == [[session_a1], [session_a2], [session_ba1], [session_bb1]], results
            tested_routes.append("parallel context switch / isolated session listing")

            # DELETE uses the actual upstream SessionService backed by wrapper and
            # must cascade message keys without affecting another actor's records.
            underlying = child.state.storage._storage
            key_state = _assert_ok(client.get(base + f"/__f21b1/raw-key-state/{session_a1}", headers=headers(token_a, wid_a1)))
            assert key_state["session_exists"] and key_state["message_exists"]
            deleted = client.delete(base + f"/sessions/{session_a1}", headers=headers(token_a, wid_a1), params={"agent_id": agent_a1})
            assert deleted.status_code == 204, deleted.text
            keys_after_delete = _assert_ok(client.get(base + f"/__f21b1/raw-key-state/{session_a1}", headers=headers(token_a, wid_a1)))
            assert not keys_after_delete["session_exists"] and not keys_after_delete["message_exists"]
            assert client.get(base + f"/sessions/{session_a1}/messages", headers=headers(token_a, wid_a1), params={"agent_id": agent_a1}).status_code == 404
            assert _assert_ok(client.get(base + "/sessions/", headers=headers(token_b, wid_a1), params={"agent_id": agent_ba1}))["total"] == 1
            tested_routes.append("DELETE /sessions/{id} with Redis session/message cascade")
    finally:
        server.should_exit = True
        thread.join(timeout=20)
        main_module.create_agentscope_app = original_factory

    assert not thread.is_alive(), "Uvicorn did not stop cleanly"
    assert observed["entered"] == 1 and observed["exited"] == 1
    assert isinstance(child.state.storage, WorkspaceSessionStorage)
    assert child.state.storage.get_client() is None and child.state.storage._owned_pool is None
    assert child.state.message_bus.get_client() is None and child.state.message_bus._owned_pool is None
