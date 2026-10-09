"""F21b2b3 MCP metadata scope and workspace connection authorization checks."""
from __future__ import annotations

import asyncio
import os
from datetime import datetime, timezone

import pytest
from alembic import command
from alembic.config import Config
from fastapi.testclient import TestClient

from app.integrations.agentscope_session_scope import WorkspaceSessionStorage, bind_agentscope_context, reset_agentscope_context
from app.integrations.agentscope_workspace_scope import ScopedWorkspace
from app.tenancy.context import WorkspaceContext


def context(tenant: int, workspace: int, actor: int) -> WorkspaceContext:
    return WorkspaceContext(actor, tenant, workspace, "member", "member", frozenset(), 1)


def client(name: str, url: str = "http://127.0.0.1:9/mcp"):
    from agentscope.mcp import HttpMCPConfig, MCPClient
    return MCPClient(name=name, is_stateful=False, mcp_config=HttpMCPConfig(url=url, timeout=0.2))


def test_f21b2b3_live_redis_proxy_and_cached_client_guard():
    import redis
    from agentscope.app.storage import MCPRecord, RedisStorage

    host = os.environ.get("F21B2B3_REDIS_HOST", "127.0.0.1")
    port = int(os.environ.get("F21B2B3_REDIS_PORT", "6380"))
    db_index = int(os.environ.get("F21B2B3_REDIS_DB", "11"))
    try:
        redis.Redis(host=host, port=port, db=db_index, socket_connect_timeout=1).ping()
    except Exception as exc:
        pytest.skip(f"Live Redis unavailable at {host}:{port}: {exc}")

    scopes = [context(8801, 8811, 8821), context(8801, 8811, 8822), context(8801, 8812, 8821), context(8802, 8821, 8823)]
    owners = {f"synapse-mcp-owner-t{x.tenant_id}-w{x.workspace_id}-u{x.actor_user_id}" for x in scopes}

    async def scenario():
        async with RedisStorage(host=host, port=port, db=db_index) as raw:
            proxy = WorkspaceSessionStorage(raw)
            # No DB-wide flush: remove only this verification's prefixed records.
            for owner in owners:
                for record in await raw.list_mcps(owner):
                    if record.id.endswith("f21b2b3-main") or record.id == "f21b2b3-legacy":
                        await raw.delete_mcp(owner, record.id)
            await raw.delete_mcp("8821", "f21b2b3-legacy")

            created = []
            for index, scope in enumerate(scopes):
                token = bind_agentscope_context(scope)
                try:
                    uid = str(scope.actor_user_id)
                    record = MCPRecord(id="f21b2b3-main", user_id=uid, client=client(f"f21b2b3_{index}"))
                    created.append(await proxy.upsert_mcp(uid, record))
                finally:
                    reset_agentscope_context(token)
            assert len(set(created)) == 4

            for scope, owned_id in zip(scopes, created):
                token = bind_agentscope_context(scope)
                try:
                    uid = str(scope.actor_user_id)
                    own = await proxy.get_mcp(uid, owned_id)
                    assert own.id == owned_id
                    assert own.user_id.startswith("synapse-mcp-owner-")
                    assert [r.id for r in await proxy.list_mcps(uid)] == [owned_id]
                    assert await proxy.get_mcp(uid, "f21b2b3-legacy") is None
                    foreign = created[0] if owned_id != created[0] else created[1]
                    assert await proxy.get_mcp(uid, foreign) is None
                    assert not await proxy.delete_mcp(uid, foreign)
                finally:
                    reset_agentscope_context(token)

            # Legacy records under the old account owner are not adopted by scoped lookups.
            await raw.upsert_mcp("8821", MCPRecord(id="f21b2b3-legacy", user_id="8821", client=client("f21b2b3_legacy")))
            token = bind_agentscope_context(scopes[0])
            try:
                assert "f21b2b3-legacy" not in [r.id for r in await proxy.list_mcps("8821")]
                assert await proxy.get_mcp("8821", "f21b2b3-legacy") is None
            finally:
                reset_agentscope_context(token)

            class FakeLive:
                def __init__(self, name):
                    self.name = name
                    self.is_connected = True
                    self.closed = 0
                async def close(self):
                    self.closed += 1
                    self.is_connected = False

            class FakeWorkspace:
                def __init__(self):
                    self._mcp_lock = asyncio.Lock()
                    self._mcp_instances = {}
                    self.specs = []
                    self.added = []
                    self.closed = []
                def _declared_specs(self, agent_id, session_id):
                    return self.specs
                async def _close_mcp_instance(self, instance):
                    await instance.close()
                    self.closed.append(instance.name)
                async def list_mcps(self, *, agent_id=None, session_id=None):
                    return self._declared_specs(agent_id or "", session_id or "")
                async def add_mcp(self, item, *, agent_id=None, session_id=None):
                    self.added.append(item.name)
                    self.specs.append(item)
                    return item

            token = bind_agentscope_context(scopes[0])
            try:
                uid = str(scopes[0].actor_user_id)
                upstream = FakeWorkspace()
                guarded = ScopedWorkspace(upstream, proxy, uid)
                active = await proxy.get_mcp(uid, created[0])
                upstream.specs = [active.client]
                key = ("agent-one", "session-one")
                live = FakeLive(active.client.name)
                upstream._mcp_instances[key] = {live.name: live}
                assert [m.name for m in await guarded.list_mcps(agent_id=key[0], session_id=key[1])] == [live.name]
                assert not upstream.closed

                disabled = active.model_copy(update={"enabled": False})
                await proxy.upsert_mcp(uid, disabled)
                assert await guarded.list_mcps(agent_id=key[0], session_id=key[1]) == []
                assert live.closed == 1 and live.name in upstream.closed
                assert key in upstream._mcp_instances and live.name not in upstream._mcp_instances[key]
                with pytest.raises(ValueError, match="not enabled"):
                    await guarded.add_mcp(active.client, agent_id="agent-two", session_id="session-two")

                # Re-enable, seed another cached live instance, then remove the library record.
                await proxy.upsert_mcp(uid, active.model_copy(update={"enabled": True}))
                live_removed = FakeLive(active.client.name)
                upstream._mcp_instances[key] = {live_removed.name: live_removed}
                await proxy.delete_mcp(uid, created[0])
                assert await guarded.list_mcps(agent_id=key[0], session_id=key[1]) == []
                assert live_removed.closed == 1

                # Hand-entered/manual config is written into scoped library before delegation.
                manual = client("f21b2b3_manual")
                await guarded.add_mcp(manual, agent_id="agent-manual", session_id="session-manual")
                saved = await proxy.get_mcp_by_name(uid, "f21b2b3_manual")
                assert saved is not None and saved.client.model_dump(mode="json") == manual.model_dump(mode="json")
                assert "f21b2b3_manual" in upstream.added
                # A forged config with the same name cannot overwrite the library entry.
                with pytest.raises(ValueError, match="does not match"):
                    await guarded.add_mcp(client("f21b2b3_manual", "http://127.0.0.1:10/other"), agent_id="agent-manual", session_id="session-manual")
            finally:
                reset_agentscope_context(token)

            # Clean all created scoped records and old-namespace fixture.
            for scope in scopes:
                token = bind_agentscope_context(scope)
                try:
                    uid = str(scope.actor_user_id)
                    for record in await proxy.list_mcps(uid):
                        await proxy.delete_mcp(uid, record.id)
                finally:
                    reset_agentscope_context(token)
            await raw.delete_mcp("8821", "f21b2b3-legacy")
    asyncio.run(scenario())


def test_f21b2b3_live_gateway_mcp_library_and_connection_gating(tmp_path, monkeypatch):
    import redis
    host = os.environ.get("F21B2B3_REDIS_HOST", "127.0.0.1")
    port = int(os.environ.get("F21B2B3_REDIS_PORT", "6380"))
    try:
        redis.Redis(host=host, port=port, socket_connect_timeout=1).ping()
    except Exception as exc:
        pytest.skip(f"Live Redis unavailable at {host}:{port}: {exc}")

    db_path = tmp_path / "f21b2b3.sqlite"
    monkeypatch.setenv("SYNAPSE_DATABASE_URL", f"sqlite:///{db_path}")
    monkeypatch.setenv("SYNAPSE_JWT_SECRET", "f21b2b3-live-gateway-test-secret")
    monkeypatch.setenv("SYNAPSE_AGENTSCOPE_REDIS_HOST", host)
    monkeypatch.setenv("SYNAPSE_AGENTSCOPE_REDIS_PORT", str(port))
    monkeypatch.setenv("SYNAPSE_AGENTSCOPE_STORAGE_REDIS_DB", "11")
    monkeypatch.setenv("SYNAPSE_AGENTSCOPE_BUS_REDIS_DB", "10")
    monkeypatch.setenv("SYNAPSE_AGENTSCOPE_WORKSPACE_PATH", str(tmp_path / "workdirs"))
    monkeypatch.setenv("SYNAPSE_SCHEDULED_TASKS_ENABLED", "false")
    from app.core.config import get_settings
    from app.database.session import get_engine, get_session_factory
    get_settings.cache_clear(); get_engine.cache_clear(); get_session_factory.cache_clear()
    command.upgrade(Config("alembic.ini"), "head")
    from app.auth.security import issue_token
    from app.models.tenant import Tenant, TenantMember, Workspace, WorkspaceMember
    from app.models.user import User
    now = datetime.now(timezone.utc)
    with get_session_factory()() as db:
        a1 = User(user_name="f21b2b3-a1", email="f21b2b3-a1@example.test", password_hash="unused", status="active", del_flag=False, token_version=1)
        a2 = User(user_name="f21b2b3-a2", email="f21b2b3-a2@example.test", password_hash="unused", status="active", del_flag=False, token_version=2)
        b1 = User(user_name="f21b2b3-b1", email="f21b2b3-b1@example.test", password_hash="unused", status="active", del_flag=False, token_version=3)
        db.add_all([a1, a2, b1]); db.flush()
        t1 = Tenant(slug="f21b2b3-alpha", name="F21b2b3 Alpha", status="active", settings_json="{}", membership_version=1)
        t2 = Tenant(slug="f21b2b3-beta", name="F21b2b3 Beta", status="active", settings_json="{}", membership_version=1)
        db.add_all([t1, t2]); db.flush()
        w11 = Workspace(tenant_id=t1.tenant_id, slug="one", name="Alpha One", status="active", settings_json="{}", created_by=a1.user_id)
        w12 = Workspace(tenant_id=t1.tenant_id, slug="two", name="Alpha Two", status="active", settings_json="{}", created_by=a1.user_id)
        w21 = Workspace(tenant_id=t2.tenant_id, slug="one", name="Beta One", status="active", settings_json="{}", created_by=b1.user_id)
        db.add_all([w11, w12, w21]); db.flush()
        db.add_all([
            TenantMember(tenant_id=t1.tenant_id, user_id=a1.user_id, status="active", tenant_role="member", joined_at=now),
            TenantMember(tenant_id=t1.tenant_id, user_id=a2.user_id, status="active", tenant_role="member", joined_at=now),
            TenantMember(tenant_id=t2.tenant_id, user_id=b1.user_id, status="active", tenant_role="member", joined_at=now),
            WorkspaceMember(workspace_id=w11.workspace_id, tenant_id=t1.tenant_id, user_id=a1.user_id, status="active", workspace_role="member", joined_at=now),
            WorkspaceMember(workspace_id=w11.workspace_id, tenant_id=t1.tenant_id, user_id=a2.user_id, status="active", workspace_role="member", joined_at=now),
            WorkspaceMember(workspace_id=w12.workspace_id, tenant_id=t1.tenant_id, user_id=a1.user_id, status="active", workspace_role="member", joined_at=now),
            WorkspaceMember(workspace_id=w21.workspace_id, tenant_id=t2.tenant_id, user_id=b1.user_id, status="active", workspace_role="member", joined_at=now),
        ]); db.commit()
        uids = {"a1": a1.user_id, "a2": a2.user_id, "b1": b1.user_id}
        versions = {"a1": a1.token_version, "a2": a2.token_version, "b1": b1.token_version}
        wids = {"w11": w11.workspace_id, "w12": w12.workspace_id, "w21": w21.workspace_id}
    tokens = {who: issue_token(uids[who], versions[who]) for who in uids}
    from app.main import create_app
    app = create_app()
    with TestClient(app) as http:
        def headers(who, wid):
            return {"Authorization": f"Bearer {tokens[who]}", "X-Workspace-ID": str(wids[wid])}
        a11, a12, a2, b21 = headers("a1", "w11"), headers("a1", "w12"), headers("a2", "w11"), headers("b1", "w21")
        # Create agent + session to exercise real WorkspaceService and its scoped workspace manager.
        agent_response = http.post("/api/v1/ai/agent/", headers=a11, json={"name": "mcp-scope-agent"})
        assert agent_response.status_code == 201, agent_response.text
        agent_id = agent_response.json()["agent_id"]
        session_response = http.post("/api/v1/ai/sessions/", headers=a11, json={"agent_id": agent_id, "name": "mcp-scope-session"})
        assert session_response.status_code == 201, session_response.text
        session_id = session_response.json()["session_id"]
        params = {"agent_id": agent_id, "session_id": session_id}

        mcp_config = {"name": "f21b2b3manual", "is_stateful": False,
                      "mcp_config": {"type": "http_mcp", "url": "http://127.0.0.1:9/mcp", "timeout": 0.2}}
        added = http.post("/api/v1/ai/workspace/mcp", headers=a11, params=params, json=mcp_config)
        assert added.status_code == 201, added.text
        library = http.get("/api/v1/ai/mcp", headers=a11)
        assert library.status_code == 200, library.text
        records = library.json()
        own = next(row for row in records if row["name"] == "f21b2b3manual")
        mcp_id = own["id"]
        assert mcp_id.startswith("synapse-mcp-t") and "mcp_config" not in own

        # Current authorization scopes cannot list, update, or delete the foreign library id.
        assert all(row["id"] != mcp_id for row in http.get("/api/v1/ai/mcp", headers=a12).json())
        assert all(row["id"] != mcp_id for row in http.get("/api/v1/ai/mcp", headers=a2).json())
        assert all(row["id"] != mcp_id for row in http.get("/api/v1/ai/mcp", headers=b21).json())
        # A library ID from another Workspace/actor cannot be installed through the library route.
        for foreign_headers in (a12, a2):
            foreign_agent = http.post("/api/v1/ai/agent/", headers=foreign_headers, json={"name": "foreign-mcp-reader"})
            assert foreign_agent.status_code == 201, foreign_agent.text
            foreign_session = http.post("/api/v1/ai/sessions/", headers=foreign_headers,
                                        json={"agent_id": foreign_agent.json()["agent_id"], "name": "foreign-mcp-session"})
            assert foreign_session.status_code == 201, foreign_session.text
            failed_install = http.post("/api/v1/ai/workspace/mcp/from-library", headers=foreign_headers,
                                       params={"agent_id": foreign_agent.json()["agent_id"], "session_id": foreign_session.json()["session_id"]},
                                       json={"mcp_ids": [mcp_id]})
            assert failed_install.status_code == 201 and mcp_id in failed_install.json()["failed"]
        assert http.patch(f"/api/v1/ai/mcp/{mcp_id}", headers=a12, json={"enabled": False}).status_code == 404
        assert http.delete(f"/api/v1/ai/mcp/{mcp_id}", headers=a2).status_code == 404
        # The API only has GET /mcp list, not GET /mcp/{id} detail.
        assert http.get(f"/api/v1/ai/mcp/{mcp_id}", headers=a11).status_code == 405

        # Workspace materializes a stateless client but cannot reach the test endpoint.
        workspace_list = http.get("/api/v1/ai/workspace/mcp", headers=a11, params=params)
        assert workspace_list.status_code == 200, workspace_list.text
        assert any(row["name"] == "f21b2b3manual" and row["is_healthy"] is False for row in workspace_list.json())
        disabled = http.patch(f"/api/v1/ai/mcp/{mcp_id}", headers=a11, json={"enabled": False})
        assert disabled.status_code == 200 and disabled.json()["enabled"] is False
        after_disable = http.get("/api/v1/ai/workspace/mcp", headers=a11, params=params)
        assert after_disable.status_code == 200 and after_disable.json() == []
        removed = http.delete(f"/api/v1/ai/mcp/{mcp_id}", headers=a11)
        assert removed.status_code == 204
        assert http.get("/api/v1/ai/mcp", headers=a11).json() == []
        assert http.get("/api/v1/ai/workspace/mcp", headers=a11, params=params).json() == []
