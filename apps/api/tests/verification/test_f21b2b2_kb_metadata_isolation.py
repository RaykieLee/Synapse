"""F21b2b2 live Redis verification of KB/document metadata scope adapters."""
from __future__ import annotations

import asyncio
import os
from datetime import datetime, timedelta

import pytest
from alembic import command
from alembic.config import Config
from fastapi.testclient import TestClient

from app.integrations.agentscope_session_scope import WorkspaceSessionStorage, bind_agentscope_context, reset_agentscope_context
from app.tenancy.context import WorkspaceContext


def _ctx(tenant: int, workspace: int, actor: int) -> WorkspaceContext:
    return WorkspaceContext(actor, tenant, workspace, "member", "member", frozenset(), 1)


def _record_models():
    from agentscope.app.storage import (
        ChunkerConfig, EmbeddingModelConfig, KnowledgeBaseData, KnowledgeBaseRecord,
        KnowledgeDocumentData, KnowledgeDocumentRecord, SessionConfig, SessionKnowledgeConfig,
    )
    return (ChunkerConfig, EmbeddingModelConfig, KnowledgeBaseData, KnowledgeBaseRecord,
            KnowledgeDocumentData, KnowledgeDocumentRecord, SessionConfig, SessionKnowledgeConfig)


def test_f21b2b2_live_storage_proxy_isolates_kb_documents_and_sessions(tmp_path):
    import redis
    from agentscope.app.storage import RedisStorage

    host = os.environ.get("F21B2B2_REDIS_HOST", "127.0.0.1")
    port = int(os.environ.get("F21B2B2_REDIS_PORT", "6380"))
    db_index = int(os.environ.get("F21B2B2_REDIS_DB", "13"))
    try:
        redis.Redis(host=host, port=port, db=db_index, socket_connect_timeout=1).ping()
    except Exception as exc:
        pytest.skip(f"Live Redis unavailable at {host}:{port}: {exc}")

    contexts = [
        _ctx(9901, 9911, 9921),  # tenant A, Workspace 1, actor 1
        _ctx(9901, 9911, 9922),  # same Workspace, actor 2
        _ctx(9901, 9912, 9921),  # same actor, second Workspace
        _ctx(9902, 9921, 9923),  # tenant B
    ]
    prefixes = [f"synapse-kb-t{c.tenant_id}-w{c.workspace_id}-u{c.actor_user_id}-" for c in contexts]
    owners = {str(c.actor_user_id) for c in contexts}

    async def scenario():
        async with RedisStorage(host=host, port=port, db=db_index) as raw:
            (ChunkerConfig, EmbeddingModelConfig, KnowledgeBaseData, KnowledgeBaseRecord,
             KnowledgeDocumentData, KnowledgeDocumentRecord, SessionConfig, SessionKnowledgeConfig) = _record_models()
            # Deterministic cleanup of only these test actor/scope records; no DB flush.
            for owner in owners:
                for kb in await raw.list_knowledge_bases(owner):
                    if kb.id.startswith(tuple(prefixes)) or kb.id == "f21b2b2-legacy-kb":
                        for doc in await raw.list_knowledge_documents(owner, kb.id):
                            await raw.delete_knowledge_document(owner, kb.id, doc.id)
                        await raw.delete_knowledge_base(owner, kb.id)
            for owner in owners:
                legacy_data = KnowledgeBaseData(
                    name="legacy", description="", embedding_model_config=EmbeddingModelConfig(
                        type="test", credential_id="legacy-credential", model="test-embedding", dimensions=2,
                    ), chunker_config=ChunkerConfig(type="test", parameters={}), collection_name="legacy-collection",
                )
                if owner == "9921":
                    await raw.upsert_knowledge_base(owner, KnowledgeBaseRecord(id="f21b2b2-legacy-kb", user_id=owner, data=legacy_data))
                    legacy_doc = KnowledgeDocumentRecord(
                        id="f21b2b2-legacy-doc", user_id=owner, knowledge_base_id="f21b2b2-legacy-kb",
                        status="pending", data=KnowledgeDocumentData(filename="legacy.txt", size=1, blob_uri="local://legacy"),
                    )
                    await raw.upsert_knowledge_document(owner, legacy_doc)

            proxy = WorkspaceSessionStorage(raw)

            def kb_record(context, user_id, raw_id):
                return KnowledgeBaseRecord(
                    id=raw_id, user_id=user_id,
                    data=KnowledgeBaseData(
                        name=f"kb-{raw_id}", description="scope test",
                        embedding_model_config=EmbeddingModelConfig(type="test", credential_id="credential", model="embed", dimensions=2),
                        chunker_config=ChunkerConfig(type="test", parameters={}), collection_name=f"collection-{raw_id}",
                    ),
                )

            created = []
            for context in contexts:
                token = bind_agentscope_context(context)
                try:
                    user_id = str(context.actor_user_id)
                    record = await proxy.upsert_knowledge_base(user_id, kb_record(context, user_id, "f21b2b2-main"))
                    created.append(record.id)
                finally:
                    reset_agentscope_context(token)
            assert len(set(created)) == 4

            # Same raw IDs get separate owner+tenant+Workspace namespaces.
            for context, owned_id in zip(contexts, created):
                token = bind_agentscope_context(context)
                try:
                    uid = str(context.actor_user_id)
                    assert (await proxy.get_knowledge_base(uid, "f21b2b2-main")).id == owned_id
                    assert [r.id for r in await proxy.list_knowledge_bases(uid)] == [owned_id]
                    assert await proxy.get_knowledge_base(uid, created[0] if owned_id != created[0] else created[1]) is None
                    assert "f21b2b2-legacy-kb" not in [r.id for r in await proxy.list_knowledge_bases(uid)]
                    assert await proxy.get_knowledge_base(uid, "f21b2b2-legacy-kb") is None
                finally:
                    reset_agentscope_context(token)

            docs = []
            for index, (context, kb_id) in enumerate(zip(contexts, created)):
                token = bind_agentscope_context(context)
                try:
                    uid = str(context.actor_user_id)
                    document = KnowledgeDocumentRecord(
                        id="f21b2b2-doc", user_id=uid, knowledge_base_id="f21b2b2-main",
                        status="pending", data=KnowledgeDocumentData(filename=f"doc-{index}.txt", size=5, blob_uri=f"local://{index}"),
                    )
                    stored = await proxy.upsert_knowledge_document(uid, document)
                    docs.append(stored.id)
                    assert stored.knowledge_base_id == kb_id
                    assert (await proxy.get_knowledge_document(uid, "f21b2b2-main", "f21b2b2-doc")).id == stored.id
                    assert [row.id for row in await proxy.list_knowledge_documents(uid, "f21b2b2-main")] == [stored.id]
                finally:
                    reset_agentscope_context(token)
            assert len(set(docs)) == 4

            # Foreign KB/doc IDs do not resolve, mutate status, acquire leases, or delete.
            token = bind_agentscope_context(contexts[0])
            try:
                uid = str(contexts[0].actor_user_id)
                assert await proxy.get_knowledge_document(uid, created[1], docs[1]) is None
                assert await proxy.list_knowledge_documents(uid, created[1]) == []
                assert await proxy.delete_knowledge_document(uid, created[1], docs[1]) is False
                await proxy.update_knowledge_document_status(uid, created[1], docs[1], "error", error="foreign")
                assert await proxy.acquire_knowledge_document_lease(uid, created[1], docs[1], "node-x", timedelta(minutes=1)) is False
            finally:
                reset_agentscope_context(token)

            # Status transitions and compare-and-swap lease operations are scoped.
            now = datetime.now()
            token = bind_agentscope_context(contexts[0])
            try:
                uid = str(contexts[0].actor_user_id)
                await proxy.update_knowledge_document_status(uid, "f21b2b2-main", "f21b2b2-doc", "parsing", chunk_count=3)
                assert (await proxy.get_knowledge_document(uid, "f21b2b2-main", "f21b2b2-doc")).data.chunk_count == 3
                assert await proxy.acquire_knowledge_document_lease(uid, "f21b2b2-main", "f21b2b2-doc", "worker-a", timedelta(minutes=3), now=now)
                assert not await proxy.acquire_knowledge_document_lease(uid, "f21b2b2-main", "f21b2b2-doc", "worker-b", timedelta(minutes=3), now=now)
                assert not await proxy.renew_knowledge_document_lease(uid, "f21b2b2-main", "f21b2b2-doc", "worker-b", timedelta(minutes=4), now=now)
                assert await proxy.renew_knowledge_document_lease(uid, "f21b2b2-main", "f21b2b2-doc", "worker-a", timedelta(minutes=4), now=now)
                await proxy.release_knowledge_document_lease(uid, "f21b2b2-main", "f21b2b2-doc", "worker-a")
                assert (await proxy.get_knowledge_document(uid, "f21b2b2-main", "f21b2b2-doc")).processing_node is None
            finally:
                reset_agentscope_context(token)

            # Global sweep queries are filtered back to the current tenant/Workspace/actor prefix.
            stale_time = datetime.now() - timedelta(hours=2)
            for context, index in ((contexts[0], 0), (contexts[1], 1)):
                token = bind_agentscope_context(context)
                try:
                    uid = str(context.actor_user_id)
                    stale = KnowledgeDocumentRecord(
                        id="f21b2b2-stale", user_id=uid, knowledge_base_id="f21b2b2-main",
                        status="pending", processing_node=f"worker-{index}", lease_expires_at=stale_time,
                        data=KnowledgeDocumentData(filename="stale.txt", size=1, blob_uri=f"local://stale-{index}"),
                    )
                    await proxy.upsert_knowledge_document(uid, stale)
                finally:
                    reset_agentscope_context(token)
            token = bind_agentscope_context(contexts[0])
            try:
                uid = str(contexts[0].actor_user_id)
                expired = await proxy.list_knowledge_documents_with_expired_lease(now=datetime.now())
                assert any(r.knowledge_base_id == created[0] and r.id.endswith("f21b2b2-stale") for r in expired)
                assert all(r.knowledge_base_id != created[1] for r in expired)
                pending = await proxy.list_knowledge_documents_pending_since(datetime.now() + timedelta(minutes=1))
                assert all(r.knowledge_base_id.startswith(prefixes[0]) for r in pending)
            finally:
                reset_agentscope_context(token)

            # Session write rewrites own KB refs and rejects a foreign scoped KB reference.
            token = bind_agentscope_context(contexts[0])
            try:
                uid = str(contexts[0].actor_user_id)
                config = SessionConfig(workspace_id="runtime-ws", knowledge_config=SessionKnowledgeConfig(knowledge_base_ids=["f21b2b2-main"]))
                session = await proxy.upsert_session(uid, "agent-raw", config)
                assert session.config.knowledge_config.knowledge_base_ids == [created[0]]
                saved = await proxy.get_session(uid, "agent-raw", session.id)
                assert saved.config.knowledge_config.knowledge_base_ids == [created[0]]
                foreign_config = SessionConfig(workspace_id="runtime-ws", knowledge_config=SessionKnowledgeConfig(knowledge_base_ids=[created[1]]))
                with pytest.raises(ValueError):
                    await proxy.upsert_session(uid, "agent-raw", foreign_config)
            finally:
                reset_agentscope_context(token)

            # Delete is confined; sibling scope records remain intact.
            token = bind_agentscope_context(contexts[0])
            try:
                uid = str(contexts[0].actor_user_id)
                assert await proxy.delete_knowledge_document(uid, "f21b2b2-main", "f21b2b2-doc")
                assert await proxy.get_knowledge_document(uid, "f21b2b2-main", "f21b2b2-doc") is None
                assert await proxy.delete_knowledge_base(uid, "f21b2b2-main")
                assert await proxy.get_knowledge_base(uid, "f21b2b2-main") is None
            finally:
                reset_agentscope_context(token)
            token = bind_agentscope_context(contexts[1])
            try:
                uid = str(contexts[1].actor_user_id)
                assert await proxy.get_knowledge_base(uid, "f21b2b2-main") is not None
                assert await proxy.get_knowledge_document(uid, "f21b2b2-main", "f21b2b2-doc") is not None
            finally:
                reset_agentscope_context(token)

            # Direct raw legacy records stay invisible to the proxy.
            token = bind_agentscope_context(contexts[0])
            try:
                uid = str(contexts[0].actor_user_id)
                assert "f21b2b2-legacy-kb" not in [r.id for r in await proxy.list_knowledge_bases(uid)]
                assert await proxy.get_knowledge_base(uid, "f21b2b2-legacy-kb") is None
                assert await proxy.list_knowledge_documents(uid, "f21b2b2-legacy-kb") == []
                assert await proxy.get_knowledge_document(uid, "f21b2b2-legacy-kb", "f21b2b2-legacy-doc") is None
            finally:
                reset_agentscope_context(token)

            # Tear down all tagged proxy records and legacy seed from this isolated DB.
            for owner in owners:
                for kb in await raw.list_knowledge_bases(owner):
                    if kb.id.startswith(tuple(prefixes)) or kb.id == "f21b2b2-legacy-kb":
                        for doc in await raw.list_knowledge_documents(owner, kb.id):
                            await raw.delete_knowledge_document(owner, kb.id, doc.id)
                        await raw.delete_knowledge_base(owner, kb.id)
    asyncio.run(scenario())


def test_f21b2b2_knowledge_base_routes_are_disabled_without_manager(tmp_path, monkeypatch):
    """Verify the actual mounted gateway reports 503 when KB manager isn't configured."""
    import redis
    host = os.environ.get("F21B2B2_REDIS_HOST", "127.0.0.1")
    port = int(os.environ.get("F21B2B2_REDIS_PORT", "6380"))
    try:
        redis.Redis(host=host, port=port, socket_connect_timeout=1).ping()
    except Exception as exc:
        pytest.skip(f"Live Redis unavailable at {host}:{port}: {exc}")

    db_path = tmp_path / "f21b2b2-routes.sqlite"
    monkeypatch.setenv("SYNAPSE_DATABASE_URL", f"sqlite:///{db_path}")
    monkeypatch.setenv("SYNAPSE_JWT_SECRET", "f21b2b2-route-jwt-secret")
    monkeypatch.setenv("SYNAPSE_AGENTSCOPE_REDIS_HOST", host)
    monkeypatch.setenv("SYNAPSE_AGENTSCOPE_REDIS_PORT", str(port))
    monkeypatch.setenv("SYNAPSE_AGENTSCOPE_STORAGE_REDIS_DB", "13")
    monkeypatch.setenv("SYNAPSE_AGENTSCOPE_BUS_REDIS_DB", "12")
    monkeypatch.setenv("SYNAPSE_AGENTSCOPE_WORKSPACE_PATH", str(tmp_path / "routes-workdirs"))
    monkeypatch.setenv("SYNAPSE_SCHEDULED_TASKS_ENABLED", "false")
    from app.core.config import get_settings
    from app.database.session import get_engine, get_session_factory
    get_settings.cache_clear(); get_engine.cache_clear(); get_session_factory.cache_clear()
    command.upgrade(Config("alembic.ini"), "head")
    from app.auth.security import issue_token
    from app.models.tenant import Tenant, TenantMember, Workspace, WorkspaceMember
    from app.models.user import User
    now = datetime.now()
    with get_session_factory()() as db:
        user = User(user_name="f21b2b2-route-user", email="f21b2b2-route@example.test", password_hash="unused", status="active", del_flag=False, token_version=0)
        db.add(user); db.flush()
        tenant = Tenant(slug="f21b2b2-route-tenant", name="F21b2b2 Route", status="active", settings_json="{}", membership_version=1)
        db.add(tenant); db.flush()
        workspace = Workspace(tenant_id=tenant.tenant_id, slug="default", name="Route Workspace", status="active", settings_json="{}", created_by=user.user_id)
        db.add(workspace); db.flush()
        db.add(TenantMember(tenant_id=tenant.tenant_id, user_id=user.user_id, status="active", tenant_role="owner", joined_at=now))
        db.add(WorkspaceMember(workspace_id=workspace.workspace_id, tenant_id=tenant.tenant_id, user_id=user.user_id, status="active", workspace_role="owner", joined_at=now)); db.commit()
        user_id, workspace_id, version = user.user_id, workspace.workspace_id, user.token_version
    from app.main import create_app
    app = create_app()
    with TestClient(app) as client:
        headers = {"Authorization": f"Bearer {issue_token(user_id, version)}", "X-Workspace-ID": str(workspace_id)}
        response = client.get("/api/v1/ai/knowledge_bases/", headers=headers)
        assert response.status_code == 503, response.text
        assert "disabled" in response.text.lower() or "service_unavailable" in response.text.lower()
