"""F27b ownership loop/scoping regression, without model or worker execution.

Default tests use a loop-bound memory fixture. ``-m redis`` uses the actual
AgentScope RedisStorage at 127.0.0.1:16381, DB13, with random per-test keys.
"""

from __future__ import annotations

import asyncio
from concurrent.futures import ThreadPoolExecutor
from contextlib import asynccontextmanager
from threading import get_ident
from uuid import uuid4

import pytest
from fastapi import FastAPI
from fastapi.responses import JSONResponse
from fastapi.testclient import TestClient
from redis.asyncio.retry import Retry
from redis.backoff import NoBackoff

from agentscope.agent import ContextConfig, ReActConfig
from agentscope.app.storage import AgentData, AgentRecord, RedisStorage

from app.integrations.agentscope_session_scope import (
    WorkspaceSessionStorage,
    bind_agentscope_context,
    current_agentscope_context,
    reset_agentscope_context,
)
from app.integrations.team_agent_authorization import AgentScopeAgentAuthorization
from app.services.team_orchestration import AgentAuthorizationUnavailable
from app.tenancy.context import WorkspaceContext


def _context(tenant_id=1, workspace_id=2, actor_user_id=3):
    return WorkspaceContext(
        actor_user_id=actor_user_id,
        tenant_id=tenant_id,
        workspace_id=workspace_id,
        tenant_role="member",
        workspace_role="member",
        permission_set=frozenset(),
        membership_version=0,
    )


class _LoopBoundMemoryStorage:
    """Test fixture that enforces async resource ownership like Redis streams."""

    def __init__(self):
        self.agents = {}
        self.owner_loop = None
        self.lookups = []
        self.failure = None

    async def __aenter__(self):
        self.owner_loop = asyncio.get_running_loop()
        return self

    async def __aexit__(self, *_args):
        self.owner_loop = None

    async def upsert_agent(self, user_id, record):
        self.agents[(user_id, record.id)] = record
        return record.id

    async def list_agents(self, user_id):
        loop = asyncio.get_running_loop()
        if loop is not self.owner_loop:
            raise RuntimeError("Ownership lookup used a different event loop")
        self.lookups.append((loop, current_agentscope_context(), user_id))
        if self.failure is not None:
            raise self.failure
        return [record for (owner, _), record in self.agents.items() if owner == user_id]


def _app(raw_storage, prefix=None):
    storage = WorkspaceSessionStorage(raw_storage)
    adapter = AgentScopeAgentAuthorization(storage)
    contexts = (
        _context(),
        _context(workspace_id=4),
        _context(tenant_id=5, workspace_id=6),
        _context(actor_user_id=7),
    )
    ids = {}
    threads = {}

    @asynccontextmanager
    async def child_lifespan(_application):
        async with storage:
            threads["owner"] = get_ident()
            try:
                for context in contexts:
                    token = bind_agentscope_context(context)
                    try:
                        data = AgentData(
                            id=uuid4().hex,
                            name="Ownership fixture (no model/worker)",
                            context_config=ContextConfig(),
                            react_config=ReActConfig(),
                        )
                        ids[context] = await storage.upsert_agent(
                            str(context.actor_user_id),
                            AgentRecord(
                                id=data.id, user_id=str(context.actor_user_id), data=data,
                            ),
                        )
                    finally:
                        reset_agentscope_context(token)
                yield
            finally:
                if prefix is not None:
                    # Only this random namespace is removed, on the owning loop.
                    keys = [key async for key in raw_storage._client.scan_iter(match=prefix + "*")]
                    if keys:
                        await raw_storage._client.delete(*keys)

    child = FastAPI(lifespan=child_lifespan)

    @asynccontextmanager
    async def parent_lifespan(_application):
        async with child.router.lifespan_context(child):
            yield

    app = FastAPI(lifespan=parent_lifespan)
    app.mount("/ai", child)

    @app.get("/context")
    async def owner_context():
        assert current_agentscope_context() is None
        return {"context_restored": True}

    @app.post("/validate")
    def validate(body: dict):
        # Fixture inputs stand in for the already-verified service context.
        context = contexts[body.get("context_index", 0)]
        sentinel = _context(tenant_id=91, workspace_id=92, actor_user_id=93)
        token = bind_agentscope_context(sentinel)
        threads["route"] = get_ident()
        try:
            try:
                adapter.validate(
                    tenant_id=context.tenant_id,
                    workspace_id=context.workspace_id,
                    actor_user_id=context.actor_user_id,
                    agent_ids=set(body["agent_ids"]),
                )
            except AgentAuthorizationUnavailable as exc:
                # Cause is exposed only by this fixture to make red evidence precise.
                return JSONResponse(
                    status_code=403,
                    content={"code": exc.code, "cause": str(exc.__cause__)},
                )
            return {"authorized": True}
        finally:
            assert current_agentscope_context() == sentinel
            reset_agentscope_context(token)
            assert current_agentscope_context() is None

    return app, ids, contexts, threads


def _exercise_scoped_sync_route(raw_storage, prefix=None):
    app, ids, contexts, threads = _app(raw_storage, prefix)
    with TestClient(app) as client:
        owned = ids[contexts[0]]
        for _ in range(3):
            response = client.post("/validate", json={"agent_ids": [owned]})
            assert response.status_code == 200, response.text
            assert response.json() == {"authorized": True}
        assert threads["owner"] != threads["route"]

        for foreign_context in contexts[1:]:
            response = client.post(
                "/validate", json={"agent_ids": [owned, ids[foreign_context]]},
            )
            assert response.status_code == 403
            assert response.json()["code"] == "AGENT_AUTHORIZATION_UNAVAILABLE"

        for agent_id in ("agent-missing", "synapse-agent-t1-w2-u3-missing"):
            response = client.post("/validate", json={"agent_ids": [agent_id]})
            assert response.status_code == 403

        for index, context in enumerate(contexts):
            response = client.post(
                "/validate",
                json={"context_index": index, "agent_ids": [ids[context]]},
            )
            assert response.status_code == 200, response.text

        def validate_actor(index):
            response = client.post(
                "/validate",
                json={"context_index": index, "agent_ids": [ids[contexts[index]]]},
            )
            assert response.status_code == 200, response.text
            response = client.post(
                "/validate", json={"agent_ids": [ids[contexts[index]]]},
            )
            assert response.status_code == (200 if index == 0 else 403), response.text

        with ThreadPoolExecutor(max_workers=4) as pool:
            list(pool.map(validate_actor, range(len(contexts))))
        assert client.get("/context").json() == {"context_restored": True}


def test_sync_route_uses_storage_owner_loop_and_preserves_actor_scoping():
    raw = _LoopBoundMemoryStorage()
    _exercise_scoped_sync_route(raw)
    assert raw.lookups
    assert len({id(loop) for loop, _, _ in raw.lookups}) == 1
    assert all(context is not None and user_id == str(context.actor_user_id)
               for _, context, user_id in raw.lookups)


def test_lookup_failure_resets_context_and_next_request_recovers():
    raw = _LoopBoundMemoryStorage()
    app, ids, contexts, _ = _app(raw)
    with TestClient(app) as client:
        raw.failure = RuntimeError("Storage lookup unavailable")
        response = client.post("/validate", json={"agent_ids": [ids[contexts[0]]]})
        assert response.status_code == 403
        assert response.json()["code"] == "AGENT_AUTHORIZATION_UNAVAILABLE"
        assert response.json()["cause"] == "Storage lookup unavailable"
        raw.failure = None
        response = client.post("/validate", json={"agent_ids": [ids[contexts[0]]]})
        assert response.status_code == 200, response.text
        assert client.get("/context").json() == {"context_restored": True}


def test_plain_sync_caller_without_application_loop_fails_closed():
    raw = _LoopBoundMemoryStorage()
    adapter = AgentScopeAgentAuthorization(WorkspaceSessionStorage(raw))
    sentinel = _context(tenant_id=91, workspace_id=92, actor_user_id=93)
    token = bind_agentscope_context(sentinel)
    try:
        with pytest.raises(AgentAuthorizationUnavailable, match="lookup is unavailable"):
            adapter.validate(
                tenant_id=1, workspace_id=2, actor_user_id=3,
                agent_ids={"synapse-agent-t1-w2-u3-existing"},
            )
        assert current_agentscope_context() == sentinel
        assert raw.lookups == []
    finally:
        reset_agentscope_context(token)


@pytest.mark.redis
def test_real_redis_sync_route_uses_lifespan_loop_and_scoped_storage():
    prefix = f"synapse-f27b-auth-loop:{uuid4().hex}:"
    print(f"Redis ownership regression namespace: DB13/{prefix}")
    keys = RedisStorage.KeyConfig(**{
        name: prefix + template
        for name, template in RedisStorage.KeyConfig().model_dump().items()
    })
    raw = RedisStorage(
        host="127.0.0.1", port=16381, db=13, key_config=keys,
        socket_connect_timeout=2, socket_timeout=2, retry=Retry(NoBackoff(), 0),
    )
    _exercise_scoped_sync_route(raw, prefix)
