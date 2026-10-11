"""F23a1 live AgentScope agent-definition isolation via Synapse ASGI + Redis."""
from __future__ import annotations

import asyncio
from datetime import datetime, timezone

import pytest

from alembic import command
from alembic.config import Config
from fastapi.testclient import TestClient

pytestmark = [
    pytest.mark.redis,
]

def test_f23a1_agent_definitions_and_session_references(tmp_path, monkeypatch, request):
    import os
    import redis

    redis_host = os.environ.get("F23A1_REDIS_HOST", "127.0.0.1")
    redis_port = int(os.environ.get("F23A1_REDIS_PORT", "6380"))
    try:
        redis.Redis(host=redis_host, port=redis_port, socket_connect_timeout=1).ping()
    except Exception as exc:
        pytest.skip(f"Live AgentScope Redis unavailable at {redis_host}:{redis_port}: {exc}")

    db_path = tmp_path / "f23a1.sqlite"
    secret = "f23a1-agent-resource-isolation-test-secret"
    monkeypatch.setenv("SYNAPSE_DATABASE_URL", f"sqlite:///{db_path}")
    monkeypatch.setenv("SYNAPSE_JWT_SECRET", secret)
    monkeypatch.setenv("SYNAPSE_AGENTSCOPE_REDIS_HOST", redis_host)
    monkeypatch.setenv("SYNAPSE_AGENTSCOPE_REDIS_PORT", str(redis_port))
    # Dedicated, isolated Redis databases; no flush is performed.
    monkeypatch.setenv("SYNAPSE_AGENTSCOPE_STORAGE_REDIS_DB", "15")
    monkeypatch.setenv("SYNAPSE_AGENTSCOPE_BUS_REDIS_DB", "14")
    monkeypatch.setenv("SYNAPSE_AGENTSCOPE_WORKSPACE_PATH", str(tmp_path / "workdirs"))
    monkeypatch.setenv("SYNAPSE_SCHEDULED_TASKS_ENABLED", "false")

    from agentscope.app.storage import RedisStorage
    async def clean_fixture_records():
        async with RedisStorage(host=redis_host, port=redis_port, db=15) as raw:
            for user_id in ("1", "2", "3"):
                for record in await raw.list_agents(user_id):
                    if record.id.startswith("synapse-agent-t") or record.id == "f23a1-legacy-agent":
                        await raw.delete_agent(user_id, record.id)
                await raw.delete_credential(user_id, "f23a1-secret")
    asyncio.run(clean_fixture_records())
    request.addfinalizer(lambda: asyncio.run(clean_fixture_records()))

    from app.core.config import get_settings
    from app.database.session import get_engine, get_session_factory
    get_settings.cache_clear(); get_engine.cache_clear(); get_session_factory.cache_clear()
    command.upgrade(Config("alembic.ini"), "head")

    from app.auth.security import issue_token
    from app.models.tenant import Tenant, TenantMember, Workspace, WorkspaceMember
    from app.models.user import User

    now = datetime.now(timezone.utc)
    with get_session_factory()() as db:
        a1 = User(user_name="f23a1-a1", email="f23a1-a1@example.test", password_hash="unused", status="active", del_flag=False, token_version=1)
        a2 = User(user_name="f23a1-a2", email="f23a1-a2@example.test", password_hash="unused", status="active", del_flag=False, token_version=2)
        b1 = User(user_name="f23a1-b1", email="f23a1-b1@example.test", password_hash="unused", status="active", del_flag=False, token_version=3)
        db.add_all([a1, a2, b1]); db.flush()
        t1 = Tenant(slug="f23a1-alpha", name="F23a1 Alpha", status="active", settings_json="{}", membership_version=1)
        t2 = Tenant(slug="f23a1-beta", name="F23a1 Beta", status="active", settings_json="{}", membership_version=1)
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
        ids = {"a1": a1.user_id, "a2": a2.user_id, "b1": b1.user_id, "w11": w11.workspace_id, "w12": w12.workspace_id, "w21": w21.workspace_id}
        versions = {"a1": a1.token_version, "a2": a2.token_version, "b1": b1.token_version}

    tokens = {name: issue_token(uid, versions[name]) for name, uid in (("a1", ids["a1"]), ("a2", ids["a2"]), ("b1", ids["b1"]))}
    import app.main as main_module
    from app.integrations.agentscope import create_agentscope_app as real_factory

    observed = {}
    def capture_child(settings):
        child = real_factory(settings)
        observed["child"] = child
        return child
    monkeypatch.setattr(main_module, "create_agentscope_app", capture_child)
    app = main_module.create_app()

    async def seed_legacy():
        from agentscope.agent import ContextConfig, ReActConfig
        from agentscope.app.storage import AgentData, AgentRecord, RedisStorage
        from agentscope.credential import OpenAICredential
        async with RedisStorage(host=redis_host, port=redis_port, db=15) as raw:
            data = AgentData(id="f23a1-legacy-agent", name="legacy", context_config=ContextConfig(), react_config=ReActConfig())
            await raw.upsert_agent(str(ids["a1"]), AgentRecord(id="f23a1-legacy-agent", user_id=str(ids["a1"]), data=data))
            await raw.upsert_credential(str(ids["a1"]), OpenAICredential(id="f23a1-secret", name="f23a1-secret", api_key="F23A1_SENTINEL_SECRET"))
    asyncio.run(seed_legacy())

    def client_for(client, who, workspace):
        return {"Authorization": f"Bearer {tokens[who]}", "X-Workspace-ID": str(ids[workspace])}

    made = []
    session_id = None
    with TestClient(app) as client:
        path = "/api/v1/ai/agent/"
        a1w11 = client_for(client, "a1", "w11")
        a1w12 = client_for(client, "a1", "w12")
        a2w11 = client_for(client, "a2", "w11")
        b1w21 = client_for(client, "b1", "w21")

        def create(headers, label):
            response = client.post(path, headers=headers, json={"name": label})
            assert response.status_code == 201, response.text
            agent_id = response.json()["agent_id"]
            made.append((headers, agent_id))
            return agent_id

        ids_a11 = create(a1w11, "actor-a-ws-one")
        ids_a12 = create(a1w12, "actor-a-ws-two")
        ids_a2 = create(a2w11, "actor-b-same-workspace")
        ids_b = create(b1w21, "tenant-b-agent")
        assert len({ids_a11, ids_a12, ids_a2, ids_b}) == 4
        assert ids_a11.startswith("synapse-agent-t")

        def listed(headers):
            response = client.get(path, headers=headers)
            assert response.status_code == 200, response.text
            return {row["id"] for row in response.json()["agents"]}

        assert ids_a11 in listed(a1w11) and ids_a12 not in listed(a1w11) and ids_a2 not in listed(a1w11)
        assert ids_a12 in listed(a1w12) and ids_a11 not in listed(a1w12)
        assert ids_a2 in listed(a2w11) and ids_a11 not in listed(a2w11)
        assert ids_b in listed(b1w21) and ids_a11 not in listed(b1w21)
        assert "f23a1-legacy-agent" not in listed(a1w11)

        # Owner can read the new detail route, but no credential material is
        # represented in the AgentView even when storage has a secret.
        detail = client.get(path + ids_a11, headers=a1w11)
        assert detail.status_code == 200, detail.text
        assert detail.json()["id"] == ids_a11
        assert detail.json()["editable"] is True
        assert "F23A1_SENTINEL_SECRET" not in detail.text
        assert "credential" not in detail.json()
        for headers, foreign in ((a1w12, ids_a11), (a2w11, ids_a11), (b1w21, ids_a11), (a1w11, ids_a2)):
            response = client.get(path + foreign, headers=headers)
            assert response.status_code == 404, (headers, foreign, response.status_code, response.text)
        for bad_id in ("f23a1-legacy-agent", "no-such-agent"):
            response = client.get(path + bad_id, headers=a1w11)
            assert response.status_code == 404, (bad_id, response.status_code, response.text)
        no_auth = client.get(path + ids_a11, headers={"X-Workspace-ID": str(ids["w11"]), "X-User-ID": str(ids["a1"])})
        assert no_auth.status_code in (400, 401), no_auth.text
        forged = client.get(path + ids_a11, headers={"Authorization": "Bearer not-a-jwt", "X-Workspace-ID": str(ids["w11"])})
        assert forged.status_code == 401, forged.text
        forged_selector = client.get(path + ids_a11, headers={**a1w11, "X-Workspace-ID": "99999999"})
        assert forged_selector.status_code in (403, 404), forged_selector.text
        for headers, foreign in ((a1w12, ids_a11), (a2w11, ids_a11), (b1w21, ids_a11), (a1w11, ids_a2)):
            for method, body in (("patch", {"name": "hijacked"}), ("delete", None)):
                response = getattr(client, method)(path + foreign, headers=headers, json=body) if body is not None else getattr(client, method)(path + foreign, headers=headers)
                assert response.status_code == 404, (method, foreign, response.status_code, response.text)

        updated = client.patch(path + ids_a11, headers=a1w11, json={"name": "actor-a-updated"})
        assert updated.status_code == 200 and updated.json()["data"]["name"] == "actor-a-updated"

        # The actual session API resolves the public agent ID in its current scope,
        # and the storage adapter persists a scoped session-to-agent reference.
        session_create = client.post("/api/v1/ai/sessions/", headers=a1w11, json={"agent_id": ids_a11, "name": "scope-linked-session"})
        assert session_create.status_code == 201, session_create.text
        session_id = session_create.json()["session_id"]
        sessions = client.get("/api/v1/ai/sessions/", headers=a1w11, params={"agent_id": ids_a11})
        assert sessions.status_code == 200 and any(row["session"]["id"] == session_id for row in sessions.json()["sessions"])
        assert session_id.startswith("synapse-s")
        cross_session = client.post("/api/v1/ai/sessions/", headers=a1w12, json={"agent_id": ids_a11})
        assert cross_session.status_code == 404, cross_session.text

        deleted = client.delete(path + ids_a11, headers=a1w11)
        assert deleted.status_code == 204
        after = client.get("/api/v1/ai/sessions/", headers=a1w11, params={"agent_id": ids_a11})
        assert after.status_code == 404  # Agent is gone; session reference was cascaded.

        # Remove the isolated fixture records before returning; no Redis DB flush.
        for headers, agent_id in made[1:]:
            response = client.delete(path + agent_id, headers=headers)
            assert response.status_code in (204, 404), response.text

    assert observed["child"] is not None
    async def verify_session_cascade():
        async with RedisStorage(host=redis_host, port=redis_port, db=15) as raw:
            assert await raw.get_session(str(ids["a1"]), ids_a11, session_id) is None
    asyncio.run(verify_session_cascade())
    # Remove the deliberately inserted legacy key through the unscoped backend.
    async def cleanup_legacy():
        from agentscope.app.storage import RedisStorage
        async with RedisStorage(host=redis_host, port=redis_port, db=15) as raw:
            await raw.delete_agent(str(ids["a1"]), "f23a1-legacy-agent")
            await raw.delete_credential(str(ids["a1"]), "f23a1-secret")
    asyncio.run(cleanup_legacy())
