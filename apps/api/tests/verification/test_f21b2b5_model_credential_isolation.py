"""F21b2b5 live credential scope, encryption, and runtime resolution checks."""
from __future__ import annotations

import asyncio
from datetime import datetime, timezone

import pytest

from alembic import command
from alembic.config import Config
from fastapi.testclient import TestClient
from app.tenancy.context import WorkspaceContext

pytestmark = [
    pytest.mark.redis,
]

def test_f21b2b5_credentials_encrypted_scoped_and_runtime_resolved(tmp_path, monkeypatch, request, caplog):
    import os
    import redis

    redis_host = os.environ.get("F21B2B5_REDIS_HOST", "127.0.0.1")
    redis_port = int(os.environ.get("F21B2B5_REDIS_PORT", "6380"))
    try:
        redis.Redis(host=redis_host, port=redis_port, socket_connect_timeout=1).ping()
    except Exception as exc:
        pytest.skip(f"Live AgentScope Redis unavailable at {redis_host}:{redis_port}: {exc}")

    db_path = tmp_path / "f21b2b5.sqlite"
    secret = "f21b2b5-agent-resource-isolation-test-secret"
    monkeypatch.setenv("SYNAPSE_DATABASE_URL", f"sqlite:///{db_path}")
    monkeypatch.setenv("SYNAPSE_JWT_SECRET", secret)
    monkeypatch.setenv("SYNAPSE_AGENTSCOPE_REDIS_HOST", redis_host)
    monkeypatch.setenv("SYNAPSE_AGENTSCOPE_REDIS_PORT", str(redis_port))
    # Dedicated, isolated Redis databases; no flush is performed.
    monkeypatch.setenv("SYNAPSE_AGENTSCOPE_STORAGE_REDIS_DB", "7")
    monkeypatch.setenv("SYNAPSE_AGENTSCOPE_BUS_REDIS_DB", "6")
    from cryptography.fernet import Fernet
    fernet_key = Fernet.generate_key().decode("ascii")
    monkeypatch.setenv("SYNAPSE_AGENTSCOPE_CREDENTIAL_ENCRYPTION_KEY", fernet_key)
    monkeypatch.setenv("SYNAPSE_AGENTSCOPE_WORKSPACE_PATH", str(tmp_path / "workdirs"))
    monkeypatch.setenv("SYNAPSE_SCHEDULED_TASKS_ENABLED", "false")

    from agentscope.app.storage import RedisStorage
    async def clean_fixture_records():
        async with RedisStorage(host=redis_host, port=redis_port, db=7) as raw:
            for user_id in ("1", "2", "3"):
                for record in await raw.list_agents(user_id):
                    if record.id.startswith("synapse-agent-t") or record.id == "f21b2b5-legacy-agent":
                        await raw.delete_agent(user_id, record.id)
                await raw.delete_credential(user_id, "f21b2b5-legacy-credential")
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
        a1 = User(user_name="f21b2b5-a1", email="f21b2b5-a1@example.test", password_hash="unused", status="active", del_flag=False, token_version=1)
        a2 = User(user_name="f21b2b5-a2", email="f21b2b5-a2@example.test", password_hash="unused", status="active", del_flag=False, token_version=2)
        b1 = User(user_name="f21b2b5-b1", email="f21b2b5-b1@example.test", password_hash="unused", status="active", del_flag=False, token_version=3)
        db.add_all([a1, a2, b1]); db.flush()
        t1 = Tenant(slug="f21b2b5-alpha", name="F21b2b5 Alpha", status="active", settings_json="{}", membership_version=1)
        t2 = Tenant(slug="f21b2b5-beta", name="F21b2b5 Beta", status="active", settings_json="{}", membership_version=1)
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
        ids = {"a1": a1.user_id, "a2": a2.user_id, "b1": b1.user_id, "w11": w11.workspace_id, "w12": w12.workspace_id, "w21": w21.workspace_id, "t1": t1.tenant_id, "t2": t2.tenant_id}
        versions = {"a1": a1.token_version, "a2": a2.token_version, "b1": b1.token_version}

    tokens = {name: issue_token(uid, versions[name]) for name, uid in (("a1", ids["a1"]), ("a2", ids["a2"]), ("b1", ids["b1"]))}

    async def clean_scoped_credentials():
        async with RedisStorage(host=redis_host, port=redis_port, db=7) as raw:
            scopes = [(ids["t1"], ids["w11"], ids["a1"]), (ids["t1"], ids["w12"], ids["a1"]),
                      (ids["t1"], ids["w11"], ids["a2"]), (ids["t2"], ids["w21"], ids["b1"])]
            for tenant, workspace, actor in scopes:
                owner = f"synapse-credential-owner-t{tenant}-w{workspace}-u{actor}"
                for record in await raw.list_credentials(owner):
                    if record.data.get("name", "").startswith("f21b2b5") or record.data.get("name") == "updated":
                        await raw.delete_credential(owner, record.id)
    asyncio.run(clean_scoped_credentials())
    request.addfinalizer(lambda: asyncio.run(clean_scoped_credentials()))
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
        async with RedisStorage(host=redis_host, port=redis_port, db=7) as raw:
            data = AgentData(id="f21b2b5-legacy-agent", name="legacy", context_config=ContextConfig(), react_config=ReActConfig())
            await raw.upsert_agent(str(ids["a1"]), AgentRecord(id="f21b2b5-legacy-agent", user_id=str(ids["a1"]), data=data))
            await raw.upsert_credential(str(ids["a1"]), OpenAICredential(id="f21b2b5-legacy-credential", name="f21b2b5-legacy", api_key="F21B2B5_LEGACY_SECRET"))
    asyncio.run(seed_legacy())

    def client_for(client, who, workspace):
        return {"Authorization": f"Bearer {tokens[who]}", "X-Workspace-ID": str(ids[workspace])}

    made = []
    session_id = None
    with TestClient(app) as client:
        credential_url = "/api/v1/ai/credential/"
        credential_scopes = [("a1", "w11"), ("a1", "w12"), ("a2", "w11"), ("b1", "w21")]
        credentials = {}
        sentinels = {}
        for index, (who, workspace) in enumerate(credential_scopes):
            key_value = f"F21B2B5_SECRET_{index}_DO_NOT_LEAK"
            sentinels[(who, workspace)] = key_value
            created = client.post(credential_url, headers=client_for(client, who, workspace),
                                  json={"data": {"type": "openai_credential", "name": f"f21b2b5-{index}", "api_key": key_value}})
            assert created.status_code == 201, created.text
            credential_id = created.json()["credential_id"]
            assert credential_id.startswith("synapse-credential-t")
            assert key_value not in created.text
            credentials[(who, workspace)] = credential_id

        # List and update responses disclose labels/type only; foreign and
        # raw legacy ids stay invisible and cannot be mutated.
        for (who, workspace), own_id in credentials.items():
            headers = client_for(client, who, workspace)
            listed = client.get(credential_url, headers=headers)
            assert listed.status_code == 200, listed.text
            body = listed.json()
            assert body["total"] == 1, body
            row = body["credentials"][0]
            assert row["id"] == own_id
            assert row["data"] == {"type": "openai_credential", "name": row["data"]["name"]}, row
            for scope, foreign_id in credentials.items():
                if scope != (who, workspace):
                    foreign_read = client.patch(f"{credential_url}{foreign_id}", headers=headers,
                                                json={"data": {"type": "openai_credential", "api_key": "attacker"}})
                    assert foreign_read.status_code == 404, (scope, foreign_read.status_code, foreign_read.text)
                    foreign_delete = client.delete(f"{credential_url}{foreign_id}", headers=headers)
                    assert foreign_delete.status_code == 404, (scope, foreign_delete.status_code, foreign_delete.text)

        # Update is also masked and does not echo the newly supplied secret.
        a1_headers = client_for(client, "a1", "w11")
        own_a1 = credentials[("a1", "w11")]
        updated_secret = "F21B2B5_UPDATED_SECRET_DO_NOT_LEAK"
        updated = client.patch(f"{credential_url}{own_a1}", headers=a1_headers,
                               json={"data": {"type": "openai_credential", "name": "updated", "api_key": updated_secret}})
        assert updated.status_code == 200, updated.text
        assert updated_secret not in updated.text
        assert updated.json()["data"] == {"type": "openai_credential", "name": "updated"}

        # Seed a raw legacy credential under the old global user owner; the
        # scoped API must not adopt it.
        legacy_list = client.get(credential_url, headers=a1_headers)
        assert legacy_list.status_code == 200 and all(row["id"] != "f21b2b5-legacy-credential" for row in legacy_list.json()["credentials"])
        legacy_update = client.patch(f"{credential_url}f21b2b5-legacy-credential", headers=a1_headers,
                                     json={"data": {"type": "openai_credential", "api_key": "attacker"}})
        assert legacy_update.status_code == 404, legacy_update.text

        # Raw Redis decoded rows expose only the authenticated ciphertext and
        # safe labels, never provider plaintext.
        async def inspect_raw_values():
            from agentscope.app.storage import RedisStorage
            async with RedisStorage(host=redis_host, port=redis_port, db=7) as raw:
                for index, (who, workspace) in enumerate(credential_scopes):
                    actor = ids[who]
                    tenant = ids["t1"] if workspace in {"w11", "w12"} else ids["t2"]
                    workspace_id = ids[workspace]
                    owner = f"synapse-credential-owner-t{tenant}-w{workspace_id}-u{actor}"
                    stored = await raw.get_credential(owner, credentials[(who, workspace)])
                    assert stored is not None
                    serialized = str(stored.model_dump(mode="json"))
                    assert "synapse_ciphertext_v1" in serialized
                    assert sentinels[(who, workspace)] not in serialized
                    assert updated_secret not in serialized
                legacy = await raw.get_credential(str(ids["a1"]), "f21b2b5-legacy-credential")
                assert legacy is not None
                # This represents pre-scope legacy storage, intentionally
                # proving that API invisibility does not rewrite old bytes.
                assert "F21B2B5_LEGACY_SECRET" in str(legacy.model_dump(mode="json"))
        asyncio.run(inspect_raw_values())

        # Current-scope runtime resolver decrypts the saved credential. A
        # foreign credential reference resolves as not found.
        async def resolve_runtime():
            from app.integrations.agentscope_session_scope import bind_agentscope_context, reset_agentscope_context
            context = WorkspaceContext(ids["a1"], ids["t1"], ids["w11"], "member", "member", frozenset(), 1)
            token = bind_agentscope_context(context)
            try:
                service = observed["child"].state.resource_access_service
                value = await service.resolve_credential(str(ids["a1"]), own_a1)
                assert value.data["api_key"] == updated_secret
                with pytest.raises(Exception) as exc:
                    await service.resolve_credential(str(ids["a1"]), credentials[("a1", "w12")])
                assert getattr(exc.value, "status_code", None) == 404
            finally:
                reset_agentscope_context(token)
        client.portal.call(resolve_runtime)

        # Session primary/fallback/TTS refs are scoped on write. Valid own
        # references persist with this scope's credential IDs; foreign/raw
        # references fail closed in every config slot.
        agent_resp = client.post("/api/v1/ai/agent/", headers=a1_headers, json={"name": "f21b2b5-session-agent"})
        assert agent_resp.status_code == 201, agent_resp.text
        agent_id = agent_resp.json()["agent_id"]
        config = lambda credential: {"type": "openai_chat", "credential_id": credential, "model": "not-called", "parameters": {}}
        tts_config = lambda credential: {"type": "openai_tts", "credential_id": credential, "model": "not-called", "parameters": {}}
        own_session = client.post("/api/v1/ai/sessions/", headers=a1_headers, json={
            "agent_id": agent_id, "chat_model_config": config(own_a1),
            "fallback_chat_model_config": config(own_a1), "tts_model_config": tts_config(own_a1),
        })
        assert own_session.status_code == 201, own_session.text
        session_id = own_session.json()["session_id"]
        for field, value in (("chat_model_config", config(credentials[("a1", "w12")])),
                             ("fallback_chat_model_config", config(credentials[("a2", "w11")])),
                             ("tts_model_config", tts_config(credentials[("b1", "w21")])),
                             ("chat_model_config", config("f21b2b5-legacy-credential"))):
            denied = client.post("/api/v1/ai/sessions/", headers=a1_headers, json={"agent_id": agent_id, field: value})
            assert denied.status_code == 404, (field, denied.status_code, denied.text)
        async def verify_saved_session():
            from agentscope.app.storage import RedisStorage
            async with RedisStorage(host=redis_host, port=redis_port, db=7) as raw:
                stored = await raw.get_session(str(ids["a1"]), agent_id, session_id)
                assert stored is not None
                assert stored.config.chat_model_config.credential_id == own_a1
                assert stored.config.fallback_chat_model_config.credential_id == own_a1
                assert stored.config.tts_model_config.credential_id == own_a1
        asyncio.run(verify_saved_session())

        for scope, credential_id in credentials.items():
            who, workspace = scope
            deleted_credential = client.delete(f"{credential_url}{credential_id}", headers=client_for(client, who, workspace))
            assert deleted_credential.status_code == 204, deleted_credential.text
            after_delete = client.get(credential_url, headers=client_for(client, who, workspace))
            assert after_delete.status_code == 200 and after_delete.json()["total"] == 0, after_delete.text

        # Request/error logging must not emit payload secrets.
        assert all(secret not in caplog.text for secret in [*sentinels.values(), updated_secret, "F21B2B5_LEGACY_SECRET"])

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
        assert "f21b2b5-legacy-agent" not in listed(a1w11)

        # Owner can read the new detail route, but no credential material is
        # represented in the AgentView even when storage has a secret.
        detail = client.get(path + ids_a11, headers=a1w11)
        assert detail.status_code == 200, detail.text
        assert detail.json()["id"] == ids_a11
        assert detail.json()["editable"] is True
        assert "F21B2B5_LEGACY_SECRET" not in detail.text
        assert "credential" not in detail.json()
        for headers, foreign in ((a1w12, ids_a11), (a2w11, ids_a11), (b1w21, ids_a11), (a1w11, ids_a2)):
            response = client.get(path + foreign, headers=headers)
            assert response.status_code == 404, (headers, foreign, response.status_code, response.text)
        for bad_id in ("f21b2b5-legacy-agent", "no-such-agent"):
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
        async with RedisStorage(host=redis_host, port=redis_port, db=7) as raw:
            assert await raw.get_session(str(ids["a1"]), ids_a11, session_id) is None
    asyncio.run(verify_session_cascade())
    # Remove the deliberately inserted legacy key through the unscoped backend.
    async def cleanup_legacy():
        from agentscope.app.storage import RedisStorage
        async with RedisStorage(host=redis_host, port=redis_port, db=7) as raw:
            await raw.delete_agent(str(ids["a1"]), "f21b2b5-legacy-agent")
            await raw.delete_credential(str(ids["a1"]), "f21b2b5-legacy-credential")
    asyncio.run(cleanup_legacy())

    # Missing and malformed Fernet keys fail with stable controlled 503s at
    # the real credential endpoint; restore the valid test key afterward.
    from app.core.config import get_settings
    for invalid_key in (None, "not-a-fernet-key"):
        if invalid_key is None:
            monkeypatch.delenv("SYNAPSE_AGENTSCOPE_CREDENTIAL_ENCRYPTION_KEY", raising=False)
        else:
            monkeypatch.setenv("SYNAPSE_AGENTSCOPE_CREDENTIAL_ENCRYPTION_KEY", invalid_key)
        get_settings.cache_clear()
        broken_app = main_module.create_app()
        with TestClient(broken_app) as broken_client:
            response = broken_client.post("/api/v1/ai/credential/", headers=client_for(broken_client, "a1", "w11"),
                json={"data": {"type": "openai_credential", "name": "f21b2b5-invalid-key", "api_key": "INVALID_KEY_SECRET"}})
            assert response.status_code == 503, response.text
            assert "MODEL_CREDENTIAL_ENCRYPTION" in response.text, response.text
    monkeypatch.setenv("SYNAPSE_AGENTSCOPE_CREDENTIAL_ENCRYPTION_KEY", fernet_key)
    get_settings.cache_clear()
