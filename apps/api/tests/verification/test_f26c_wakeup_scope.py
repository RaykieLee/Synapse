"""Contract tests for the Synapse-owned AgentScope wakeup seam."""
from __future__ import annotations

import asyncio
import json
import time
from types import SimpleNamespace

import pytest

from app.integrations import agentscope_wakeup as wakeup
from app.integrations.agentscope_session_scope import (
    bind_agentscope_context,
    current_agentscope_context,
    reset_agentscope_context,
)
from app.integrations.agentscope_wakeup import (
    MAX_ATTEMPTS,
    RETRY_BACKOFF_BASE_SECONDS,
    SCOPE_FIELD,
    OUTCOME_FIELD,
    SCOPE_NAMESPACE_PREFIX,
    _scope_namespace,
    enqueue_scoped_trigger,
    ScopedWakeupDispatcher,
)
from app.tenancy.context import WorkspaceContext


class _Bus:
    def __init__(self, *, locked: bool = False) -> None:
        self.registries: dict[tuple[str, str], str] = {}
        self.queue: list[dict] = []
        self.queue_pushes = 0
        self.signal = asyncio.Event()
        self.locked = locked

    async def registry_set(self, namespace, field, value, *, ttl_secs=None):
        self.registries[(namespace, field)] = value

    async def registry_get(self, namespace, field):
        return self.registries.get((namespace, field))

    async def registry_getall(self, namespace):
        return {field: value for (key, field), value in self.registries.items() if key == namespace}

    async def registry_del(self, namespace, field):
        self.registries.pop((namespace, field), None)

    async def registry_set_if(self, namespace, field, value, *, expected, ttl_secs=None):
        key = (namespace, field)
        if self.registries.get(key) != expected:
            return False
        self.registries[key] = value
        return True

    async def queue_push(self, _key, payload):
        self.queue.append(payload)
        self.queue_pushes += 1
        return "1-0"

    async def publish(self, _key, _payload):
        self.signal.set()

    async def queue_drain(self, _key, *, max_count):
        entries = self.queue[:max_count]
        del self.queue[:len(entries)]
        return [(str(index), payload) for index, payload in enumerate(entries)]

    async def subscribe(self, _key, *, on_ready=None):
        if on_ready is not None:
            on_ready()
        while True:
            await self.signal.wait()
            self.signal.clear()
            yield None

    async def is_locked(self, _key):
        return self.locked


class _Db:
    def __init__(self, tenant, workspace, user, tenant_member, workspace_member):
        self.rows = {
            "tenant": tenant,
            "workspace": workspace,
            "user": user,
        }
        self.members = [tenant_member, workspace_member]
        self.scalar_calls = 0

    def get(self, model, _id):
        name = model.__name__.lower()
        return self.rows.get(name)

    def scalar(self, _query):
        member = self.members[self.scalar_calls % len(self.members)]
        self.scalar_calls += 1
        return member

    def close(self):
        pass


class _Storage:
    def __init__(self, session, agent):
        self.session = session
        self.agent = agent
        self.calls = 0

    async def get_session(self, *_args):
        assert current_agentscope_context() is not None
        self.calls += 1
        return self.session

    async def get_agent(self, *_args):
        assert current_agentscope_context() is not None
        return self.agent


def _context() -> WorkspaceContext:
    return WorkspaceContext(
        7,
        11,
        13,
        "member",
        "member",
        frozenset({"resource:read", "resource:create", "resource:update"}),
        4,
    )


async def _enqueue(bus: _Bus) -> dict:
    token = bind_agentscope_context(_context())
    try:
        await enqueue_scoped_trigger(bus, "7", "session", "agent")
    finally:
        reset_agentscope_context(token)
    return bus.queue[0]


def _record(bus: _Bus, payload: dict) -> dict:
    return json.loads(bus.registries[(_scope_namespace(payload["scope_ref"]), SCOPE_FIELD)])


def _db(monkeypatch, *, tenant_status="active", workspace_status="active",
        tenant_member_status="active", workspace_member_status="active",
        membership_version=4):
    db = _Db(
        SimpleNamespace(tenant_id=11, status=tenant_status, membership_version=membership_version),
        SimpleNamespace(workspace_id=13, tenant_id=11, status=workspace_status),
        SimpleNamespace(user_id=7, status="active", del_flag=False),
        SimpleNamespace(status=tenant_member_status, tenant_role="member"),
        SimpleNamespace(status=workspace_member_status, workspace_role="member"),
    )
    monkeypatch.setattr(
        "app.integrations.agentscope_wakeup.get_session_factory",
        lambda: lambda: db,
    )
    return db


def test_enqueue_writes_server_scope_before_schema_two_payload():
    async def scenario():
        bus = _Bus()
        token = bind_agentscope_context(_context())
        try:
            await enqueue_scoped_trigger(
                bus, "7", "synapse-session", "synapse-agent", kind="wake",
            )
        finally:
            reset_agentscope_context(token)
        assert len(bus.queue) == 1
        payload = bus.queue[0]
        assert payload["schema"] == 2
        assert payload["scope"]["workspace_id"] == 13
        assert bus.registries[(_scope_namespace(payload["scope_ref"]), SCOPE_FIELD)]
        record = json.loads(bus.registries[(_scope_namespace(payload["scope_ref"]), SCOPE_FIELD)])
        assert record["trigger_id"] == payload["trigger_id"]
        assert record["state"] == "pending"

    asyncio.run(scenario())


def test_dispatch_rejects_revoked_membership_before_storage_access(monkeypatch):
    async def scenario():
        bus = _Bus()
        payload = await _enqueue(bus)
        _db(monkeypatch, tenant_member_status="inactive")
        storage = _Storage(None, None)
        dispatcher = ScopedWakeupDispatcher(bus, storage, None, None)
        assert await dispatcher._verify_payload(payload) is None
        assert storage.calls == 0
        assert _record(bus, payload)["last_reason"] == "membership_revoked"

    asyncio.run(scenario())


def test_dispatch_binds_and_resets_verified_context(monkeypatch):
    async def scenario():
        bus = _Bus()
        payload = await _enqueue(bus)
        _db(monkeypatch)
        storage = _Storage(
            SimpleNamespace(id="session", agent_id="agent"),
            SimpleNamespace(id="agent", user_id="7"),
        )
        seen = []

        class Registry:
            def spawn(self, coro, **_kwargs):
                return asyncio.create_task(coro)

        class Chat:
            async def run(self, **_kwargs):
                seen.append(current_agentscope_context())

        dispatcher = ScopedWakeupDispatcher(bus, storage, Chat(), Registry())
        await dispatcher._dispatch_payload(payload)
        await asyncio.sleep(0)
        assert seen == [_context()]
        assert current_agentscope_context() is None

    asyncio.run(scenario())


def test_forged_scope_does_not_poison_original_trigger(monkeypatch):
    async def scenario():
        bus = _Bus()
        payload = await _enqueue(bus)
        forged = {**payload, "scope": {**payload["scope"], "workspace_id": 999}}
        _db(monkeypatch)
        dispatcher = ScopedWakeupDispatcher(bus, _Storage(None, None), None, None)
        assert await dispatcher._verify_payload(forged) is None
        assert _record(bus, payload)["state"] == "pending"
        outcomes = [
            json.loads(value)
            for (namespace, field), value in bus.registries.items()
            if namespace.startswith(f"{SCOPE_NAMESPACE_PREFIX}outcome:") and field == OUTCOME_FIELD
        ]
        assert any(outcome["reason"] == "scope_mismatch" for outcome in outcomes)

    asyncio.run(scenario())


def test_cross_workspace_replay_is_rejected_without_mutating_target(monkeypatch):
    async def scenario():
        bus = _Bus()
        first = await _enqueue(bus)
        second_bus = _Bus()
        second = await _enqueue(second_bus)
        replay = {**first, "scope_ref": second["scope_ref"]}
        dispatcher = ScopedWakeupDispatcher(bus, _Storage(None, None), None, None)
        assert await dispatcher._verify_payload(replay) is None
        assert _record(second_bus, second)["state"] == "pending"

    asyncio.run(scenario())


def test_session_agent_mismatch_is_recorded_before_spawn(monkeypatch):
    async def scenario():
        bus = _Bus()
        payload = await _enqueue(bus)
        _db(monkeypatch)
        storage = _Storage(
            SimpleNamespace(id="session", agent_id="other-agent"),
            SimpleNamespace(id="agent", user_id="7"),
        )
        dispatcher = ScopedWakeupDispatcher(bus, storage, None, None)
        assert await dispatcher._verify_payload(payload) is None
        assert _record(bus, payload)["last_reason"] == "session_agent_mismatch"

    asyncio.run(scenario())


def test_duplicate_trigger_is_terminal_noop(monkeypatch):
    async def scenario():
        bus = _Bus()
        payload = await _enqueue(bus)
        _db(monkeypatch)
        storage = _Storage(
            SimpleNamespace(id="session", agent_id="agent"),
            SimpleNamespace(id="agent", user_id="7"),
        )
        seen = []

        class Registry:
            def spawn(self, coro, **_kwargs):
                seen.append(coro)
                return asyncio.create_task(coro)

        class Chat:
            async def run(self, **_kwargs):
                return None

        dispatcher = ScopedWakeupDispatcher(bus, storage, Chat(), Registry())
        await dispatcher._dispatch_payload(payload)
        await asyncio.sleep(0)
        await dispatcher._dispatch_payload(payload)
        await asyncio.sleep(0)
        assert len(seen) == 1
        assert _record(bus, payload)["last_reason"] == "duplicate_trigger"

    asyncio.run(scenario())


def test_non_runtime_spawn_failure_restores_retryable_pending(monkeypatch):
    async def scenario():
        bus = _Bus()
        payload = await _enqueue(bus)
        _db(monkeypatch)
        storage = _Storage(
            SimpleNamespace(id="session", agent_id="agent"),
            SimpleNamespace(id="agent", user_id="7"),
        )

        class Registry:
            def spawn(self, _coro, **_kwargs):
                raise ValueError("registry unavailable")

        dispatcher = ScopedWakeupDispatcher(bus, storage, None, Registry())
        await dispatcher._dispatch_payload(payload)

        record = _record(bus, payload)
        assert record["state"] == "retry_scheduled"
        assert record["attempt"] == 1
        assert record["last_reason"] == "spawn_failure"
        assert record["retry_due_at"] <= time.time() + RETRY_BACKOFF_BASE_SECONDS
        assert record["queued_payload"]["attempt"] == 1
        assert "consuming_lease_id" not in record
        assert "consuming_lease_until" not in record
        for task in list(dispatcher._retry_tasks):
            task.cancel()
        await asyncio.gather(*dispatcher._retry_tasks, return_exceptions=True)

    asyncio.run(scenario())


def test_expired_consuming_lease_is_recovered_with_attempt_safe_cas(monkeypatch):
    async def scenario():
        bus = _Bus()
        payload = await _enqueue(bus)
        original = _record(bus, payload)
        consuming = {
            **original,
            "state": "consuming",
            "consuming_lease_id": "lease-1",
            "consuming_lease_until": time.time() - 1,
        }
        bus.registries[(_scope_namespace(payload["scope_ref"]), SCOPE_FIELD)] = json.dumps(
            consuming,
            separators=(",", ":"),
        )
        _db(monkeypatch)
        storage = _Storage(
            SimpleNamespace(id="session", agent_id="agent"),
            SimpleNamespace(id="agent", user_id="7"),
        )
        seen = []
        running = []

        class Registry:
            def spawn(self, coro, **_kwargs):
                task = asyncio.create_task(coro)
                running.append(task)
                return task

        class Chat:
            async def run(self, **_kwargs):
                seen.append(current_agentscope_context())

        dispatcher = ScopedWakeupDispatcher(bus, storage, Chat(), Registry())
        await dispatcher._dispatch_payload(payload)
        await running[0]

        assert seen == [_context()]
        assert _record(bus, payload)["state"] == "completed"
        assert _record(bus, payload)["attempt"] == original["attempt"]

    asyncio.run(scenario())


def test_startup_recovers_expired_consuming_after_queue_entry_is_gone(monkeypatch):
    async def scenario():
        bus = _Bus()
        payload = await _enqueue(bus)
        original = _record(bus, payload)
        bus.registries[(_scope_namespace(payload["scope_ref"]), SCOPE_FIELD)] = json.dumps(
            {
                **original,
                "state": "consuming",
                "consuming_lease_id": "lease-startup",
                "consuming_lease_until": time.time() - 1,
            },
            separators=(",", ":"),
        )
        # Simulate a crash after queue drain: neither the queue entry nor the
        # wakeup signal survives, while the durable scope index does.
        bus.queue.clear()
        bus.queue_pushes = 0
        bus.signal.clear()
        _db(monkeypatch)
        storage = _Storage(
            SimpleNamespace(id="session", agent_id="agent"),
            SimpleNamespace(id="agent", user_id="7"),
        )
        seen = []

        class Registry:
            def spawn(self, coro, **_kwargs):
                return asyncio.create_task(coro)

        class Chat:
            async def run(self, **_kwargs):
                seen.append(current_agentscope_context())

        async with ScopedWakeupDispatcher(bus, storage, Chat(), Registry()):
            for _ in range(100):
                if seen and _record(bus, payload)["state"] == "completed":
                    break
                await asyncio.sleep(0.01)

        assert bus.queue_pushes == 1
        assert bus.queue == []
        assert seen == [_context()]
        assert _record(bus, payload)["trigger_id"] == payload["trigger_id"]
        assert _record(bus, payload)["state"] == "completed"

    asyncio.run(scenario())


def test_stale_worker_cannot_overwrite_newer_consuming_claim():
    async def scenario():
        bus = _Bus()
        payload = await _enqueue(bus)
        original = _record(bus, payload)
        bus.registries[(_scope_namespace(payload["scope_ref"]), SCOPE_FIELD)] = json.dumps(
            {
                **original,
                "state": "consuming",
                "attempt": 1,
                "consuming_lease_id": "new-lease",
                "consuming_lease_until": time.time() + 30,
            },
            separators=(",", ":"),
        )
        dispatcher = ScopedWakeupDispatcher(bus, _Storage(None, None), None, None)

        await dispatcher._mark_terminal(
            {
                **original,
                "state": "consuming",
                "attempt": 0,
                "consuming_lease_id": "old-lease",
            },
            "completed",
        )

        current = _record(bus, payload)
        assert current["state"] == "consuming"
        assert current["attempt"] == 1
        assert current["consuming_lease_id"] == "new-lease"

    asyncio.run(scenario())


def test_startup_recovers_due_retry_after_crash_before_enqueue(monkeypatch):
    async def scenario():
        bus = _Bus()
        payload = await _enqueue(bus)
        original = _record(bus, payload)
        bus.registries[(_scope_namespace(payload["scope_ref"]), SCOPE_FIELD)] = json.dumps(
            {
                **original,
                "state": "retry_scheduled",
                "attempt": 1,
                "retry_due_at": time.time() - 1,
                "queued_payload": {**payload, "attempt": 1},
            },
            separators=(",", ":"),
        )
        bus.queue.clear()
        bus.queue_pushes = 0
        bus.signal.clear()
        _db(monkeypatch)
        storage = _Storage(
            SimpleNamespace(id="session", agent_id="agent"),
            SimpleNamespace(id="agent", user_id="7"),
        )
        seen = []

        class Registry:
            def spawn(self, coro, **_kwargs):
                return asyncio.create_task(coro)

        class Chat:
            async def run(self, **_kwargs):
                seen.append(current_agentscope_context())

        async with ScopedWakeupDispatcher(bus, storage, Chat(), Registry()):
            for _ in range(100):
                if seen and _record(bus, payload)["state"] == "completed":
                    break
                await asyncio.sleep(0.01)

        assert bus.queue_pushes == 1
        assert seen == [_context()]
        assert _record(bus, payload)["attempt"] == 1
        assert _record(bus, payload)["state"] == "completed"

    asyncio.run(scenario())


def test_retry_increments_attempt_preserves_identity_and_exhausts(monkeypatch):
    async def scenario():
        bus = _Bus(locked=True)
        payload = await _enqueue(bus)
        dispatcher = ScopedWakeupDispatcher(bus, _Storage(None, None), None, None)
        for _ in range(MAX_ATTEMPTS):
            await dispatcher._schedule_retry(payload, "session_locked")
            record = _record(bus, payload)
            if record["state"] == "retry_exhausted":
                break
            assert record["state"] == "retry_scheduled"
            assert record["queued_payload"]["attempt"] == record["attempt"]
            # Crash before enqueue, then restore the exact persisted payload.
            bus.registries[(_scope_namespace(payload["scope_ref"]), SCOPE_FIELD)] = json.dumps(
                {
                    **record,
                    "state": "pending",
                    "attempt": record["attempt"],
                    "queued_payload": record["queued_payload"],
                },
                separators=(",", ":"),
            )
            payload = record["queued_payload"]
        await asyncio.sleep(0)
        record = _record(bus, payload)
        assert record["state"] == "retry_exhausted"
        assert record["last_reason"] == "retry_exhausted"
        assert record["attempt"] == MAX_ATTEMPTS - 1
        assert payload["trigger_id"] == record["trigger_id"]
        assert payload["scope_ref"] == record["scope_ref"]
        for task in list(dispatcher._retry_tasks):
            task.cancel()
        await asyncio.gather(*dispatcher._retry_tasks, return_exceptions=True)

    asyncio.run(scenario())


def test_real_agentscope_registry_spy_completes_and_resets_context(monkeypatch):
    async def scenario():
        from agentscope.app._manager import ChatRunRegistry

        bus = _Bus()
        payload = await _enqueue(bus)
        _db(monkeypatch)
        storage = _Storage(
            SimpleNamespace(id="session", agent_id="agent"),
            SimpleNamespace(id="agent", user_id="7"),
        )
        seen = []

        class Chat:
            async def run(self, **_kwargs):
                seen.append(current_agentscope_context())

        registry = ChatRunRegistry()
        dispatcher = ScopedWakeupDispatcher(bus, storage, Chat(), registry)
        await dispatcher._dispatch_payload(payload)
        task = registry.get("session")
        assert task is not None
        await task
        assert seen == [_context()]
        assert current_agentscope_context() is None
        assert _record(bus, payload)["state"] == "completed"

    asyncio.run(scenario())


@pytest.mark.parametrize("lost_state", ["pending", "consuming"])
def test_running_dispatcher_recovers_lost_delivery_when_it_becomes_due(monkeypatch, lost_state):
    async def scenario():
        from agentscope.app._manager import ChatRunRegistry

        monkeypatch.setattr(wakeup, "RECOVERY_INTERVAL_SECONDS", 0.01, raising=False)
        bus = _Bus()
        payload = await _enqueue(bus)
        if lost_state == "consuming":
            record = {
                **_record(bus, payload), "state": "consuming",
                "consuming_lease_id": "crashed-worker", "consuming_lease_until": time.time() + 0.03,
            }
            await bus.registry_set(_scope_namespace(payload["scope_ref"]), SCOPE_FIELD, json.dumps(record))
        bus.queue.clear()
        bus.signal.clear()
        _db(monkeypatch)
        seen = []

        class Chat:
            async def run(self, **_kwargs):
                seen.append(current_agentscope_context())

        storage = _Storage(SimpleNamespace(id="session", agent_id="agent"), SimpleNamespace(id="agent", user_id="7"))
        async with ChatRunRegistry() as registry:
            async with ScopedWakeupDispatcher(bus, storage, Chat(), registry):
                for _ in range(100):
                    if _record(bus, payload)["state"] == "completed":
                        break
                    await asyncio.sleep(0.01)
                assert _record(bus, payload)["state"] == "completed"
                assert seen == [_context()]
        assert current_agentscope_context() is None

    asyncio.run(scenario())


def test_live_session_lock_retry_completes_after_lock_release(monkeypatch):
    async def scenario():
        from agentscope.app._manager import ChatRunRegistry

        bus = _Bus(locked=True)
        payload = await _enqueue(bus)
        _db(monkeypatch)
        seen = []

        class Chat:
            async def run(self, **_kwargs):
                seen.append(current_agentscope_context())

        storage = _Storage(SimpleNamespace(id="session", agent_id="agent"), SimpleNamespace(id="agent", user_id="7"))
        async with ChatRunRegistry() as registry:
            async with ScopedWakeupDispatcher(bus, storage, Chat(), registry):
                assert _record(bus, payload)["state"] == "retry_scheduled"
                bus.locked = False
                for _ in range(100):
                    if _record(bus, payload)["state"] == "completed":
                        break
                    await asyncio.sleep(0.01)
                assert _record(bus, payload)["state"] == "completed"
                assert _record(bus, payload)["attempt"] == 1
                assert seen == [_context()]

    asyncio.run(scenario())


def test_recovery_index_keeps_every_unexpired_trigger():
    async def scenario():
        bus = _Bus()
        payloads = [await _enqueue(bus) for _ in range(520)]
        indexed = await bus.registry_getall(wakeup.SCOPE_INDEX_NAMESPACE)
        assert len(indexed) == 520
        assert payloads[0]["scope_ref"] in indexed

    asyncio.run(scenario())


def test_long_run_renews_claim_and_prevents_another_dispatcher_replay(monkeypatch):
    async def scenario():
        from agentscope.app._manager import ChatRunRegistry

        monkeypatch.setattr(wakeup, "CONSUMING_LEASE_SECONDS", 0.03)
        monkeypatch.setattr(wakeup, "HEARTBEAT_INTERVAL_SECONDS", 0.005, raising=False)
        bus = _Bus()
        payload = await _enqueue(bus)
        _db(monkeypatch)
        started = asyncio.Event()
        release = asyncio.Event()
        seen = []

        class Chat:
            async def run(self, **_kwargs):
                seen.append(current_agentscope_context())
                started.set()
                await release.wait()

        storage = _Storage(SimpleNamespace(id="session", agent_id="agent"), SimpleNamespace(id="agent", user_id="7"))
        async with ChatRunRegistry() as first_registry, ChatRunRegistry() as second_registry:
            first = ScopedWakeupDispatcher(bus, storage, Chat(), first_registry)
            second = ScopedWakeupDispatcher(bus, storage, Chat(), second_registry)
            await first._dispatch_payload(payload)
            await asyncio.wait_for(started.wait(), 1)
            await asyncio.sleep(0.06)
            await second._dispatch_payload(payload)
            await asyncio.sleep(0)
            release.set()
            await first_registry.get("session")
            if second_registry.get("session") is not None:
                await second_registry.get("session")
            assert seen == [_context()]
            assert _record(bus, payload)["state"] == "completed"

    asyncio.run(scenario())


def test_queue_cannot_replace_server_owned_kind_or_input(monkeypatch):
    async def scenario():
        from agentscope.message import Msg

        bus = _Bus()
        payload = await _enqueue(bus)
        _db(monkeypatch)
        storage = _Storage(SimpleNamespace(id="session", agent_id="agent"), SimpleNamespace(id="agent", user_id="7"))
        dispatcher = ScopedWakeupDispatcher(bus, storage, None, None)
        forged = {
            **payload, "kind": "message",
            "input": Msg(name="forged", role="user", content=[{"type": "text", "text": "different input"}]).model_dump(mode="json"),
        }
        assert await dispatcher._verify_payload(forged) is None
        assert storage.calls == 0
        assert _record(bus, payload)["state"] == "pending"

    asyncio.run(scenario())


@pytest.mark.parametrize("fail_with", [ValueError, asyncio.CancelledError])
def test_failed_and_cancelled_run_finalize_and_reset_context(monkeypatch, fail_with):
    async def scenario():
        from agentscope.app._manager import ChatRunRegistry

        bus = _Bus()
        payload = await _enqueue(bus)
        _db(monkeypatch)
        seen = []

        class Chat:
            async def run(self, **_kwargs):
                seen.append(current_agentscope_context())
                raise fail_with("controlled failure")

        storage = _Storage(SimpleNamespace(id="session", agent_id="agent"), SimpleNamespace(id="agent", user_id="7"))
        registry = ChatRunRegistry()
        dispatcher = ScopedWakeupDispatcher(bus, storage, Chat(), registry)
        await dispatcher._dispatch_payload(payload)
        with pytest.raises(fail_with):
            await registry.get("session")
        assert _record(bus, payload)["state"] == "run_failed"
        assert seen == [_context()]
        assert current_agentscope_context() is None

    asyncio.run(scenario())


def test_pinned_agentscope_wakeup_hooks_are_installed(monkeypatch):
    import agentscope.app._bus_ops as bus_ops
    import agentscope.app._lifespan as lifespan
    import agentscope.app._service._chat as chat_module

    monkeypatch.setattr(bus_ops, "enqueue_run_trigger", bus_ops.enqueue_run_trigger)
    monkeypatch.setattr(chat_module, "enqueue_run_trigger", chat_module.enqueue_run_trigger)
    monkeypatch.setattr(lifespan, "WakeupDispatcher", lifespan.WakeupDispatcher)
    wakeup.install_scoped_wakeup_runtime()
    assert bus_ops.enqueue_run_trigger is wakeup.enqueue_scoped_trigger
    assert chat_module.enqueue_run_trigger is wakeup.enqueue_scoped_trigger
    assert lifespan.WakeupDispatcher is wakeup.ScopedWakeupDispatcher


@pytest.mark.parametrize("replacement", [{"schema": 1}, {"scope": []}, {"kind": 3}, {"attempt": True}])
def test_malformed_transport_does_not_reject_genuine_scope(replacement):
    async def scenario():
        bus = _Bus()
        payload = await _enqueue(bus)
        dispatcher = ScopedWakeupDispatcher(bus, _Storage(None, None), None, None)
        assert await dispatcher._verify_payload({**payload, **replacement}) is None
        assert _record(bus, payload)["state"] == "pending"

    asyncio.run(scenario())
