"""B-level real Redis/SQLite acceptance; ChatService is a controlled fixture.

Run with -m redis. Every Redis key has a per-test prefix; no database flushes.
This proves dispatcher/context/storage behavior, not model/tool execution.
"""
from __future__ import annotations

import asyncio
import json
import os
import time
from datetime import datetime, timezone
from uuid import uuid4

import pytest
from redis.asyncio import Redis
from sqlalchemy import create_engine, event, select
from sqlalchemy.orm import sessionmaker

from agentscope.agent import ContextConfig, ReActConfig
from agentscope.app._manager import ChatRunRegistry
from agentscope.app.message_bus import MessageBusKeys, RedisMessageBus
from agentscope.app.storage import AgentData, AgentRecord, RedisStorage, SessionConfig
from agentscope.message import Msg

from app.database.base import Base
from app.database.session import _enable_sqlite_foreign_keys
from app.integrations import agentscope_wakeup as wakeup
from app.integrations.agentscope_session_scope import (
    WorkspaceSessionStorage, bind_agentscope_context,
    current_agentscope_context, reset_agentscope_context,
)
from app.models.tenant import Tenant, TenantMember, Workspace, WorkspaceMember
from app.models.user import User
from app.tenancy.context import WorkspaceContext, _ROLE_PERMISSIONS

pytestmark = pytest.mark.redis


class _TestNamespacedBus(RedisMessageBus):
    """Only renames transport keys; all transport and CAS operations are real."""

    def __init__(self, prefix: str, **kwargs):
        super().__init__(**kwargs)
        self.prefix = prefix

    async def queue_push(self, key, payload, **kwargs):
        return await super().queue_push(self.prefix + key, payload, **kwargs)

    async def queue_drain(self, key, **kwargs):
        return await super().queue_drain(self.prefix + key, **kwargs)

    async def publish(self, key, payload):
        return await super().publish(self.prefix + key, payload)

    def subscribe(self, key, **kwargs):
        return super().subscribe(self.prefix + key, **kwargs)

    async def is_locked(self, key):
        return await super().is_locked(self.prefix + key)


def test_real_redis_dispatch_retry_recovery_and_sql_revocation(tmp_path, monkeypatch):
    prefix = f"synapse-f26b-test:{uuid4().hex}:"
    monkeypatch.setattr(wakeup, "SCOPE_NAMESPACE_PREFIX", prefix + "scope:")
    monkeypatch.setattr(wakeup, "SCOPE_INDEX_NAMESPACE", prefix + "index")
    monkeypatch.setattr(wakeup, "CONSUMING_LEASE_SECONDS", 0.2)
    monkeypatch.setattr(wakeup, "HEARTBEAT_INTERVAL_SECONDS", 0.03)
    monkeypatch.setattr(wakeup, "RECOVERY_INTERVAL_SECONDS", 0.03)
    engine = create_engine(f"sqlite:///{tmp_path / 'wakeup.sqlite'}")
    event.listen(engine, "connect", _enable_sqlite_foreign_keys)
    Base.metadata.create_all(engine)
    factory = sessionmaker(engine, expire_on_commit=False)
    monkeypatch.setattr(wakeup, "get_session_factory", lambda: factory)
    now = datetime.now(timezone.utc)
    with factory() as db:
        user = User(user_name="f26b-probe", password_hash="fixture", status="active", del_flag=False)
        tenant = Tenant(slug="f26b-probe", name="F26b", status="active", membership_version=1)
        db.add_all([user, tenant])
        db.flush()
        spaces = [Workspace(tenant_id=tenant.tenant_id, slug=name, name=name, created_by=user.user_id, status="active") for name in ("a", "b")]
        db.add_all(spaces)
        db.flush()
        db.add(TenantMember(tenant_id=tenant.tenant_id, user_id=user.user_id, status="active", tenant_role="member", joined_at=now))
        for space in spaces:
            db.add(WorkspaceMember(tenant_id=tenant.tenant_id, workspace_id=space.workspace_id, user_id=user.user_id, status="active", workspace_role="member", joined_at=now))
        db.commit()
        contexts = [WorkspaceContext(user.user_id, tenant.tenant_id, space.workspace_id, "member", "member", _ROLE_PERMISSIONS["member"], 1) for space in spaces]

    async def scenario():
        host = os.environ.get("F26B_REDIS_HOST", "127.0.0.1")
        port = int(os.environ.get("F26B_REDIS_PORT", "16381"))
        redis_db = int(os.environ.get("F26B_REDIS_DB", "12"))
        client = Redis(host=host, port=port, db=redis_db, decode_responses=True, socket_connect_timeout=2)
        try:
            await client.ping()
        except Exception:
            await client.aclose()
            pytest.skip("F26b Redis acceptance requires a live Redis endpoint")
        keys = RedisStorage.KeyConfig(**{
            name: prefix + template for name, template in RedisStorage.KeyConfig().model_dump().items()
        })
        seen = []
        try:
            async with RedisStorage(host=host, port=port, db=redis_db, key_config=keys) as raw:
                storage = WorkspaceSessionStorage(raw)
                targets = []
                for context in contexts:
                    token = bind_agentscope_context(context)
                    try:
                        agent = AgentData(id=uuid4().hex, name="Fixture", context_config=ContextConfig(), react_config=ReActConfig())
                        agent_id = await storage.upsert_agent(str(context.actor_user_id), AgentRecord(id=agent.id, user_id=str(context.actor_user_id), data=agent))
                        session = await storage.upsert_session(str(context.actor_user_id), agent_id, SessionConfig(workspace_id="fixture-runtime"))
                        targets.append((context, agent_id, session.id))
                    finally:
                        reset_agentscope_context(token)

                class FixtureChat:
                    async def run(self, *, user_id, agent_id, session_id, input_msg):
                        context = current_agentscope_context()
                        assert context is not None
                        assert await storage.get_session(user_id, agent_id, session_id) is not None
                        seen.append((context.workspace_id, session_id))
                        await asyncio.sleep(0.25)
                        await storage.upsert_message(user_id, session_id, Msg(name="fixture", role="assistant", content=[{"type": "text", "text": "fixture-complete"}]))

                async with _TestNamespacedBus(prefix, host=host, port=port, db=redis_db) as bus:
                    async def enqueue(target):
                        context, agent_id, session_id = target
                        token = bind_agentscope_context(context)
                        try:
                            await wakeup.enqueue_scoped_trigger(bus, str(context.actor_user_id), session_id, agent_id)
                        finally:
                            reset_agentscope_context(token)
                        entries = await bus.queue_drain(MessageBusKeys.wakeup_queue(), max_count=64)
                        assert len(entries) == 1
                        return entries[0][1]

                    async def record(payload):
                        return json.loads(await bus.registry_get(wakeup._scope_namespace(payload["scope_ref"]), wakeup.SCOPE_FIELD))

                    async def wait_for_state(payload, state):
                        for _ in range(300):
                            current = await record(payload)
                            if current["state"] == state:
                                return current
                            await asyncio.sleep(0.01)
                        raise AssertionError(f"Trigger did not reach {state}: {current['state']}")

                    # Both original queue entries are gone: recover from the
                    # outbox and run concurrently in separate trusted contexts.
                    payloads = [await enqueue(target) for target in targets]
                    async with ChatRunRegistry() as registry:
                        async with wakeup.ScopedWakeupDispatcher(bus, storage, FixtureChat(), registry) as dispatcher:
                            for payload in payloads:
                                await wait_for_state(payload, "completed")
                            assert {workspace_id for workspace_id, _ in seen} == {context.workspace_id for context in contexts}
                            assert len(seen) == 2
                            await dispatcher._dispatch_payload(payloads[0])
                            assert len(seen) == 2

                    # Live Redis lock/backoff, followed by release, must really
                    # invoke the run rather than only update retry bookkeeping.
                    payload = await enqueue(targets[0])
                    lock_key = prefix + MessageBusKeys.session_lock(targets[0][2])
                    await client.set(lock_key, "fixture-lock", ex=5)
                    await bus.queue_push(MessageBusKeys.wakeup_queue(), payload)
                    async with ChatRunRegistry() as registry:
                        async with wakeup.ScopedWakeupDispatcher(bus, storage, FixtureChat(), registry):
                            await wait_for_state(payload, "retry_scheduled")
                            await client.delete(lock_key)
                            completed = await wait_for_state(payload, "completed")
                            assert completed["attempt"] >= 1
                    assert len(seen) == 3

                    # Crash after recording retry but before enqueue: real Lua
                    # CAS and persistent recovery dispatch its canonical input.
                    payload = await enqueue(targets[0])
                    saved = await record(payload)
                    retry = {**saved, "state": "retry_scheduled", "attempt": 1, "retry_due_at": time.time() - 1, "queued_payload": {**payload, "attempt": 1}}
                    await bus.registry_set(wakeup._scope_namespace(payload["scope_ref"]), wakeup.SCOPE_FIELD, json.dumps(retry, separators=(",", ":")))
                    async with ChatRunRegistry() as registry:
                        async with wakeup.ScopedWakeupDispatcher(bus, storage, FixtureChat(), registry):
                            await wait_for_state(payload, "completed")
                    assert len(seen) == 4

                    # A forged queue payload cannot poison the original scope.
                    payload = await enqueue(targets[0])
                    dispatcher = wakeup.ScopedWakeupDispatcher(bus, storage, FixtureChat(), None)
                    forged = {**payload, "scope": {**payload["scope"], "workspace_id": contexts[1].workspace_id}}
                    assert await dispatcher._verify_payload(forged) is None
                    assert (await record(payload))["state"] == "pending"

                    # SQL revocation happens after enqueue and before consume.
                    # Reject both pending scopes; no fixture run is invoked.
                    revoked = await enqueue(targets[1])
                    with factory() as db:
                        for context in contexts:
                            member = db.scalar(select(WorkspaceMember).where(
                                WorkspaceMember.workspace_id == context.workspace_id,
                                WorkspaceMember.user_id == context.actor_user_id,
                            ))
                            member.status = "removed"
                        db.commit()
                    async with ChatRunRegistry() as registry:
                        async with wakeup.ScopedWakeupDispatcher(bus, storage, FixtureChat(), registry):
                            for item in (payload, revoked):
                                result = await wait_for_state(item, "rejected")
                                assert result["last_reason"] == "workspace_membership_revoked"
                    assert len(seen) == 4
                    for context, agent_id, session_id in targets:
                        token = bind_agentscope_context(context)
                        try:
                            assert await storage.get_session(str(context.actor_user_id), agent_id, session_id) is not None
                            messages, _ = await storage.list_messages(str(context.actor_user_id), session_id)
                            assert messages
                        finally:
                            reset_agentscope_context(token)
                    assert current_agentscope_context() is None
        finally:
            owned_keys = [key async for key in client.scan_iter(match=prefix + "*")]
            if owned_keys:
                await client.delete(*owned_keys)
            assert [key async for key in client.scan_iter(match=prefix + "*")] == []
            await client.aclose()

    try:
        asyncio.run(scenario())
    finally:
        engine.dispose()
