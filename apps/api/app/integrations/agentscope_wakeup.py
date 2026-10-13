"""Workspace-scoped AgentScope wakeup adapter.

AgentScope 2.0.10.dev0 does not expose a dispatcher context hook.  This
module keeps the compatibility boundary in Synapse instead of editing the
installed package: enqueue writes a server-owned scope record first, and the
replacement dispatcher verifies that record and current SQL authorization
before creating the run task.
"""
from __future__ import annotations

import asyncio
import hashlib
import json
import logging
from datetime import datetime, timezone
from inspect import signature
from typing import Any, Literal
from uuid import uuid4

from pydantic import TypeAdapter
from sqlalchemy import select

from app.database.session import get_session_factory
from app.integrations.agentscope_session_scope import (
    bind_agentscope_context,
    current_agentscope_context,
    reset_agentscope_context,
)
from app.models.tenant import Tenant, TenantMember, Workspace, WorkspaceMember
from app.models.user import User
from app.tenancy.context import WorkspaceContext, _ROLE_PERMISSIONS


SCHEMA_VERSION = 2
SCOPE_TTL_SECONDS = 300
MAX_ATTEMPTS = 5
CONSUMING_LEASE_SECONDS = 30
HEARTBEAT_INTERVAL_SECONDS = 5
RECOVERY_INTERVAL_SECONDS = 0.5
DELIVERY_LEASE_SECONDS = 1
RETRY_BACKOFF_BASE_SECONDS = 0.1
RETRY_BACKOFF_MAX_SECONDS = 2.0
SCOPE_FIELD = "record"
OUTCOME_FIELD = "outcome"
SCOPE_NAMESPACE_PREFIX = "synapse:agentscope:wakeup-scope:"
SCOPE_INDEX_NAMESPACE = "synapse:agentscope:wakeup-scope-index"
TERMINAL_STATES = {"completed", "run_failed", "retry_exhausted", "scope_expired", "rejected"}
_logger = logging.getLogger(__name__)


def _scope_namespace(scope_ref: str) -> str:
    return f"{SCOPE_NAMESPACE_PREFIX}{scope_ref}"


def _now() -> datetime:
    return datetime.now(timezone.utc)


async def enqueue_scoped_trigger(
    bus: Any,
    user_id: str,
    session_id: str,
    agent_id: str,
    *,
    kind: Literal["wake", "resume", "message"] = "wake",
    inputs: Any = None,
) -> None:
    """Enqueue a trigger with a server-derived, revocable scope reference."""
    context = current_agentscope_context()
    if context is None or str(context.actor_user_id) != str(user_id):
        raise RuntimeError("AgentScope wakeup requires a verified Workspace context")

    trigger_id = f"wtr_{uuid4().hex}"
    scope_ref = f"wscope_{uuid4().hex}"
    created_at = _now()
    expires_at = created_at.timestamp() + SCOPE_TTL_SECONDS
    payload = {
        "schema": SCHEMA_VERSION,
        "trigger_id": trigger_id,
        "scope_ref": scope_ref,
        "kind": kind,
        "user_id": str(user_id),
        "session_id": session_id,
        "agent_id": agent_id,
        "scope": {
            "actor_user_id": str(context.actor_user_id),
            "tenant_id": context.tenant_id,
            "workspace_id": context.workspace_id,
            "membership_version": context.membership_version,
        },
        "input": inputs.model_dump(mode="json") if inputs is not None else None,
        "created_at": created_at.isoformat(),
        "expires_at": expires_at,
        "attempt": 0,
    }
    record = {
        "trigger_id": trigger_id,
        "scope_ref": scope_ref,
        "actor_user_id": str(context.actor_user_id),
        "tenant_id": context.tenant_id,
        "workspace_id": context.workspace_id,
        "membership_version": context.membership_version,
        "session_id": session_id,
        "agent_id": agent_id,
        "created_at": created_at.isoformat(),
        "expires_at": expires_at,
        "state": "pending",
        "attempt": 0,
        # A dispatcher restart can recover only if the durable scope keeps the
        # server-owned payload after the original queue entry was drained.
        "queued_payload": payload,
    }
    # The scope record is written before the queue entry. A queue entry without
    # a record is therefore always rejected by the consumer.
    await bus.registry_set(
        _scope_namespace(scope_ref),
        SCOPE_FIELD,
        json.dumps(record, separators=(",", ":")),
        ttl_secs=SCOPE_TTL_SECONDS,
    )
    from agentscope.app.message_bus import MessageBusKeys

    await _append_scope_index(bus, scope_ref)
    await bus.queue_push(MessageBusKeys.wakeup_queue(), payload)
    await bus.publish(MessageBusKeys.wakeup_signal(), {})


async def _append_scope_index(bus: Any, scope_ref: str) -> None:
    """Index each live trigger; cleanup never evicts an unexpired entry."""
    await bus.registry_set(
        SCOPE_INDEX_NAMESPACE, scope_ref, "1", ttl_secs=SCOPE_TTL_SECONDS,
    )


def install_scoped_wakeup_runtime() -> None:
    """Install Synapse's adapter before AgentScope builds its lifespan."""
    import agentscope.app._bus_ops as bus_ops
    import agentscope.app._lifespan as lifespan
    import agentscope.app._service._chat as chat_module
    from agentscope.app._manager import ChatRunRegistry

    if not {"user_id", "session_id", "agent_id", "input_msg"}.issubset(
        signature(chat_module.ChatService.run).parameters
    ) or not {"coro", "session_id"}.issubset(signature(ChatRunRegistry.spawn).parameters):
        raise RuntimeError("Pinned AgentScope wakeup API is incompatible with Synapse")

    bus_ops.enqueue_run_trigger = enqueue_scoped_trigger
    chat_module.enqueue_run_trigger = enqueue_scoped_trigger
    lifespan.WakeupDispatcher = ScopedWakeupDispatcher


class ScopedWakeupDispatcher:
    """Compatibility dispatcher with consume-time scope authorization."""

    def __init__(self, message_bus: Any, storage: Any, chat_service: Any, chat_run_registry: Any) -> None:
        self._bus = message_bus
        self._storage = storage
        self._chat_service = chat_service
        self._registry = chat_run_registry
        self._task: asyncio.Task | None = None
        self._recovery_task: asyncio.Task | None = None
        self._retry_tasks: set[asyncio.Task] = set()

    async def __aenter__(self) -> "ScopedWakeupDispatcher":
        ready = asyncio.Event()
        self._task = asyncio.create_task(self._loop(ready), name="synapse-scoped-wakeup-dispatcher")
        await ready.wait()
        await self._drain_and_dispatch()
        await self._recover_expired_consuming_records()
        self._recovery_task = asyncio.create_task(
            self._recovery_loop(), name="synapse-wakeup-recovery",
        )
        return self

    async def __aexit__(self, *exc: object) -> None:
        if self._recovery_task is not None:
            self._recovery_task.cancel()
            await asyncio.gather(self._recovery_task, return_exceptions=True)
            self._recovery_task = None
        for task in list(self._retry_tasks):
            task.cancel()
        if self._retry_tasks:
            await asyncio.gather(*self._retry_tasks, return_exceptions=True)
        self._retry_tasks.clear()
        if self._task is not None:
            self._task.cancel()
            await asyncio.gather(self._task, return_exceptions=True)
            self._task = None

    async def _recovery_loop(self) -> None:
        while True:
            await asyncio.sleep(RECOVERY_INTERVAL_SECONDS)
            try:
                await self._recover_expired_consuming_records()
                await self._drain_and_dispatch()
            except asyncio.CancelledError:
                raise
            except Exception:
                _logger.exception("AgentScope wakeup recovery failed")

    async def _loop(self, ready: asyncio.Event) -> None:
        from agentscope.app.message_bus import MessageBusKeys

        while True:
            try:
                async for _ in self._bus.subscribe(
                    MessageBusKeys.wakeup_signal(), on_ready=ready.set,
                ):
                    try:
                        await self._drain_and_dispatch()
                    except asyncio.CancelledError:
                        raise
                    except Exception:
                        _logger.exception("AgentScope wakeup batch failed")
            except asyncio.CancelledError:
                raise
            except Exception:
                _logger.exception("AgentScope wakeup subscription failed")
                if not ready.is_set():
                    ready.set()
                await asyncio.sleep(RETRY_BACKOFF_BASE_SECONDS)

    async def _drain_and_dispatch(self) -> None:
        from agentscope.app.message_bus import MessageBusKeys

        try:
            entries = await self._bus.queue_drain(MessageBusKeys.wakeup_queue(), max_count=64)
        except Exception:
            _logger.exception("AgentScope wakeup queue drain failed")
            return
        for _, payload in entries:
            try:
                await self._dispatch_payload(payload)
            except asyncio.CancelledError:
                raise
            except Exception:
                # A malformed or transiently broken entry must not prevent
                # later entries in the same batch from being consumed.
                _logger.exception("AgentScope wakeup entry failed")

    async def _dispatch_payload(self, payload: Any) -> None:
        try:
            await self._dispatch_payload_inner(payload)
        except asyncio.CancelledError:
            raise
        except Exception:
            _logger.exception("AgentScope wakeup dispatch failed")
            if isinstance(payload, dict):
                await self._safe_schedule_retry(payload, "dispatch_error")

    async def _dispatch_payload_inner(self, payload: Any) -> None:
        try:
            verified = await self._verify_payload(payload)
        except Exception:
            # Verification failures are retryable only when the payload has
            # enough identity to apply the same bounded retry policy.
            _logger.exception("AgentScope wakeup verification failed")
            if isinstance(payload, dict):
                await self._safe_schedule_retry(payload, "verification_error")
            return
        if verified is None:
            return
        context, kind, input_msg, scope_record = verified
        from agentscope.app.message_bus import MessageBusKeys

        if await self._bus.is_locked(MessageBusKeys.session_lock(scope_record["session_id"])):
            await self._schedule_retry(payload, "session_locked")
            return

        consuming_lease_id = uuid4().hex
        consuming_lease_until = _now().timestamp() + CONSUMING_LEASE_SECONDS
        consuming_record = {
            **scope_record,
            "state": "consuming",
            "consuming_lease_id": consuming_lease_id,
            "consuming_lease_until": consuming_lease_until,
        }
        claimed = await self._bus.registry_set_if(
            _scope_namespace(scope_record["scope_ref"]),
            SCOPE_FIELD,
            json.dumps(consuming_record, separators=(",", ":")),
            expected=json.dumps(scope_record, separators=(",", ":")),
            ttl_secs=SCOPE_TTL_SECONDS,
        )
        if not claimed:
            await self._record_outcome(
                scope_record,
                state="duplicate",
                reason="duplicate_trigger",
                preserve_terminal=True,
            )
            return

        async def run_in_scope() -> None:
            token = bind_agentscope_context(context)
            run_task = asyncio.current_task()
            heartbeat = asyncio.create_task(self._heartbeat(consuming_record, run_task))
            terminal_state = "run_failed"
            try:
                await self._chat_service.run(
                    user_id=str(context.actor_user_id),
                    session_id=scope_record["session_id"],
                    agent_id=scope_record["agent_id"],
                    input_msg=input_msg,
                )
                terminal_state = "completed"
            finally:
                heartbeat.cancel()
                try:
                    await asyncio.gather(heartbeat, return_exceptions=True)
                    await self._mark_terminal(consuming_record, terminal_state)
                finally:
                    reset_agentscope_context(token)

        run_coro = run_in_scope()
        try:
            self._registry.spawn(
                run_coro,
                session_id=scope_record["session_id"],
                name=f"{kind}-run:{scope_record['session_id']}",
            )
        except (Exception, asyncio.CancelledError) as exc:
            run_coro.close()
            recovered = await self._restore_consuming_for_retry(
                consuming_record,
                reason="spawn_failure",
            )
            if recovered:
                await self._schedule_retry(payload, "spawn_failure")
            if isinstance(exc, asyncio.CancelledError):
                raise

    async def _heartbeat(self, record: dict[str, Any], run_task: asyncio.Task) -> None:
        """Fence a running task if its lease is lost or cannot be renewed."""
        while True:
            await asyncio.sleep(HEARTBEAT_INTERVAL_SECONDS)
            try:
                raw = await self._bus.registry_get(_scope_namespace(record["scope_ref"]), SCOPE_FIELD)
                current = json.loads(raw) if raw is not None else None
                if not self._owns_claim(record, current):
                    run_task.cancel()
                    return
                renewed = {**current, "consuming_lease_until": _now().timestamp() + CONSUMING_LEASE_SECONDS}
                if not await self._bus.registry_set_if(
                    _scope_namespace(record["scope_ref"]), SCOPE_FIELD,
                    json.dumps(renewed, separators=(",", ":")), expected=raw,
                    ttl_secs=SCOPE_TTL_SECONDS,
                ):
                    # A duplicate outcome may update diagnostics concurrently;
                    # retry only while this task still owns the lease.
                    continue
                await _append_scope_index(self._bus, record["scope_ref"])
            except asyncio.CancelledError:
                raise
            except Exception:
                _logger.exception("AgentScope wakeup lease renewal failed")
                run_task.cancel()
                return

    @staticmethod
    def _owns_claim(record: dict[str, Any], current: Any) -> bool:
        return (
            isinstance(current, dict) and current.get("state") == "consuming"
            and all(current.get(key) == record.get(key) for key in (
                "trigger_id", "attempt", "consuming_lease_id",
            ))
        )

    async def _safe_schedule_retry(self, payload: dict[str, Any], reason: str) -> None:
        try:
            await self._schedule_retry(payload, reason)
        except asyncio.CancelledError:
            raise
        except Exception:
            # Retry bookkeeping is best effort; never let it kill the
            # process-wide dispatcher when Redis is unavailable.
            _logger.exception("AgentScope wakeup retry bookkeeping failed")

    async def _verify_payload(
        self,
        payload: Any,
    ) -> tuple[WorkspaceContext, str, Any, dict[str, Any]] | None:
        if not isinstance(payload, dict) or payload.get("schema") != SCHEMA_VERSION:
            await self._reject_payload(payload, "malformed")
            return None
        required = ("trigger_id", "scope_ref", "kind", "user_id", "session_id", "agent_id")
        if any(not isinstance(payload.get(key), str) for key in required) or not isinstance(payload.get("scope"), dict):
            await self._reject_payload(payload, "malformed")
            return None
        scope_ref = payload["scope_ref"]
        if (
            not isinstance(payload.get("attempt"), int)
            or isinstance(payload.get("attempt"), bool)
        ):
            await self._reject_payload(payload, "malformed", scope_ref=scope_ref)
            return None
        raw_record = await self._bus.registry_get(_scope_namespace(scope_ref), SCOPE_FIELD)
        if raw_record is None:
            await self._reject_payload(payload, "scope_missing")
            return None
        try:
            record = json.loads(raw_record)
        except (TypeError, ValueError):
            await self._reject_payload(payload, "malformed", scope_ref=scope_ref)
            return None
        if not isinstance(record, dict):
            await self._reject_payload(payload, "malformed", scope_ref=scope_ref)
            return None
        canonical = record.get("queued_payload")
        if (
            record.get("trigger_id") != payload["trigger_id"]
            or record.get("scope_ref") != scope_ref
            or not isinstance(canonical, dict)
            or any(canonical.get(key) != payload.get(key) for key in (
                "user_id", "session_id", "agent_id", "scope", "kind", "input",
            ))
        ):
            await self._write_outcome(scope_ref, payload["trigger_id"], "rejected", "scope_mismatch")
            return None
        if payload["attempt"] != record.get("attempt"):
            await self._write_outcome(scope_ref, payload["trigger_id"], "rejected", "attempt_mismatch")
            return None
        if record.get("state") == "consuming":
            if record.get("trigger_id") == payload.get("trigger_id"):
                recovered = await self._recover_expired_consuming(record)
                if recovered is not None:
                    record = recovered
                else:
                    await self._record_outcome(
                        record,
                        state="duplicate",
                        reason="duplicate_trigger",
                        preserve_terminal=True,
                    )
                    return None
            else:
                await self._reject_payload(payload, "duplicate_trigger", scope_ref=scope_ref)
                return None
        if record.get("state") == "retry_scheduled":
            if record.get("trigger_id") != payload.get("trigger_id"):
                await self._reject_payload(payload, "duplicate_trigger", scope_ref=scope_ref)
                return None
            retry_due_at = record.get("retry_due_at")
            if (
                not isinstance(retry_due_at, (int, float))
                or retry_due_at > _now().timestamp()
            ):
                await self._write_outcome(
                    scope_ref,
                    payload.get("trigger_id"),
                    "rejected",
                    "retry_not_due",
                )
                return None
        if record.get("state") not in {"pending", "retry_scheduled"}:
            if record.get("trigger_id") == payload.get("trigger_id"):
                await self._record_outcome(
                    record,
                    state="duplicate",
                    reason="duplicate_trigger",
                    preserve_terminal=True,
                )
            else:
                await self._reject_payload(payload, "duplicate_trigger", scope_ref=scope_ref)
            return None
        if record.get("trigger_id") != payload["trigger_id"] or record.get("scope_ref") != scope_ref:
            await self._reject_payload(payload, "scope_mismatch", scope_ref=scope_ref)
            return None
        for key in ("user_id", "session_id", "agent_id"):
            if str(record.get({"user_id": "actor_user_id", "session_id": "session_id", "agent_id": "agent_id"}[key])) != str(
                payload[key],
            ):
                await self._write_outcome(
                    scope_ref,
                    payload.get("trigger_id"),
                    "rejected",
                    "scope_mismatch",
                )
                return None
        if float(record.get("expires_at", 0)) <= _now().timestamp():
            await self._record_outcome(record, state="scope_expired", reason="scope_expired")
            return None
        declared = payload["scope"]
        if any(declared.get(key) != record.get(key) for key in (
            "actor_user_id", "tenant_id", "workspace_id", "membership_version",
        )):
            await self._write_outcome(
                scope_ref,
                payload.get("trigger_id"),
                "rejected",
                "scope_mismatch",
            )
            return None

        if int(payload.get("attempt", 0)) != int(record.get("attempt", 0)):
            await self._write_outcome(
                scope_ref,
                payload.get("trigger_id"),
                "rejected",
                "attempt_mismatch",
            )
            return None

        db = get_session_factory()()
        try:
            tenant = db.get(Tenant, int(record["tenant_id"]))
            workspace = db.get(Workspace, int(record["workspace_id"]))
            user = db.get(User, int(record["actor_user_id"]))
            tenant_member = db.scalar(select(TenantMember).where(
                TenantMember.tenant_id == int(record["tenant_id"]),
                TenantMember.user_id == int(record["actor_user_id"]),
            ))
            member = db.scalar(select(WorkspaceMember).where(
                WorkspaceMember.tenant_id == int(record["tenant_id"]),
                WorkspaceMember.workspace_id == int(record["workspace_id"]),
                WorkspaceMember.user_id == int(record["actor_user_id"]),
            ))
            if (
                tenant is None or workspace is None or user is None
                or workspace.tenant_id != tenant.tenant_id
                or tenant.status != "active" or workspace.status != "active"
                or user.status != "active" or user.del_flag
                or tenant_member is None or tenant_member.status != "active"
                or member is None or member.status != "active"
                or tenant.membership_version != int(record["membership_version"])
            ):
                reason = "membership_revoked"
                if tenant is None or tenant.status != "active":
                    reason = "tenant_inactive"
                elif workspace is None or workspace.status != "active":
                    reason = "workspace_inactive"
                elif user is None or user.status != "active" or user.del_flag:
                    reason = "actor_inactive"
                elif tenant_member is None or tenant_member.status != "active":
                    reason = "membership_revoked"
                elif member is None or member.status != "active":
                    reason = "workspace_membership_revoked"
                elif tenant.membership_version != int(record["membership_version"]):
                    reason = "membership_version_stale"
                await self._record_outcome(record, state="rejected", reason=reason)
                return None
            context = WorkspaceContext(
                actor_user_id=user.user_id,
                tenant_id=tenant.tenant_id,
                workspace_id=workspace.workspace_id,
                tenant_role=tenant_member.tenant_role,
                workspace_role=member.workspace_role,
                permission_set=_ROLE_PERMISSIONS.get(member.workspace_role, frozenset()),
                membership_version=tenant.membership_version,
            )
        finally:
            db.close()

        # WorkspaceSessionStorage is deliberately fail-closed. Bind only for
        # these verification reads; the dispatcher task itself stays unbound.
        storage_token = bind_agentscope_context(context)
        try:
            session = await self._storage.get_session(
                str(record["actor_user_id"]),
                str(record["agent_id"]),
                str(record["session_id"]),
            )
            agent = await self._storage.get_agent(
                str(record["actor_user_id"]),
                str(record["agent_id"]),
            )
        finally:
            reset_agentscope_context(storage_token)
        if (
            session is None or agent is None
            or session.id != record["session_id"]
            or session.agent_id != record["agent_id"]
            or agent.id != record["agent_id"]
            or str(agent.user_id) != str(record["actor_user_id"])
        ):
            await self._record_outcome(record, state="rejected", reason="session_agent_mismatch")
            return None

        kind = payload["kind"]
        if kind not in {"wake", "resume", "message"}:
            await self._write_outcome(
                scope_ref,
                payload.get("trigger_id"),
                "rejected",
                "malformed_kind",
            )
            return None
        input_msg = None
        if kind in {"resume", "message"}:
            raw_input = payload.get("input")
            if not isinstance(raw_input, dict):
                await self._write_outcome(
                    scope_ref,
                    payload.get("trigger_id"),
                    "rejected",
                    "malformed_input",
                )
                return None
            if kind == "message":
                from agentscope.message import Msg

                input_msg = Msg.model_validate(raw_input)
            else:
                from agentscope.event import ExternalExecutionResultEvent, UserConfirmResultEvent, UserInterruptEvent

                try:
                    input_msg = TypeAdapter(
                        UserConfirmResultEvent | ExternalExecutionResultEvent | UserInterruptEvent,
                    ).validate_python(raw_input)
                except Exception:
                    await self._write_outcome(
                        scope_ref,
                        payload.get("trigger_id"),
                        "rejected",
                        "malformed_input",
                    )
                    return None
        return context, kind, input_msg, record

    async def _schedule_retry(self, payload: dict[str, Any], reason: str) -> None:
        try:
            scope_ref = payload["scope_ref"]
            trigger_id = payload["trigger_id"]
        except (KeyError, TypeError):
            await self._reject_payload(payload, "malformed")
            return
        raw_record = await self._bus.registry_get(_scope_namespace(scope_ref), SCOPE_FIELD)
        if raw_record is None:
            await self._reject_payload(payload, "scope_missing", scope_ref=scope_ref)
            return
        try:
            record = json.loads(raw_record)
        except (TypeError, ValueError):
            await self._reject_payload(payload, "malformed", scope_ref=scope_ref)
            return
        if not isinstance(record, dict) or record.get("trigger_id") != trigger_id:
            await self._reject_payload(payload, "scope_mismatch", scope_ref=scope_ref)
            return
        if record.get("state") == "consuming":
            if record.get("trigger_id") == trigger_id:
                record = await self._recover_expired_consuming(record)
                if record is None:
                    return
            else:
                await self._reject_payload(payload, "duplicate_trigger", scope_ref=scope_ref)
                return
        if record.get("state") != "pending":
            await self._record_outcome(
                record,
                state="duplicate",
                reason="duplicate_trigger",
                preserve_terminal=True,
            )
            return
        expires_at = float(record.get("expires_at", 0))
        current_attempt = int(record.get("attempt", 0))
        if expires_at <= _now().timestamp():
            await self._record_outcome(record, state="scope_expired", reason="scope_expired")
            return
        if current_attempt >= MAX_ATTEMPTS - 1:
            await self._record_outcome(record, state="retry_exhausted", reason="retry_exhausted")
            return
        next_attempt = current_attempt + 1
        delay = min(
            RETRY_BACKOFF_BASE_SECONDS * (2 ** current_attempt),
            RETRY_BACKOFF_MAX_SECONDS,
        )
        retry_payload_base = record.get("queued_payload")
        if not isinstance(retry_payload_base, dict):
            retry_payload_base = payload
        updated = {
            **record,
            "attempt": next_attempt,
            "state": "retry_scheduled",
            "retry_due_at": _now().timestamp() + delay,
            "last_outcome": "retry",
            "last_reason": reason,
            "queued_payload": {**retry_payload_base, "attempt": next_attempt},
        }
        updated_json = json.dumps(updated, separators=(",", ":"))
        claimed = await self._bus.registry_set_if(
            _scope_namespace(scope_ref),
            SCOPE_FIELD,
            updated_json,
            expected=raw_record,
            ttl_secs=self._remaining_ttl(expires_at),
        )
        if not claimed:
            return
        self._spawn_retry_enqueue(updated["queued_payload"], delay)

    def _spawn_retry_enqueue(self, retry_payload: dict[str, Any], delay: float) -> None:
        async def retry() -> None:
            try:
                await asyncio.sleep(delay)
                raw = await self._bus.registry_get(_scope_namespace(retry_payload["scope_ref"]), SCOPE_FIELD)
                record = json.loads(raw) if raw is not None else None
                if isinstance(record, dict) and record.get("attempt") == retry_payload["attempt"]:
                    await self._redeliver(record)
            except asyncio.CancelledError:
                pass
            except Exception:
                _logger.exception("AgentScope wakeup retry enqueue failed")

        task = asyncio.create_task(retry())
        self._retry_tasks.add(task)
        task.add_done_callback(self._retry_tasks.discard)

    @staticmethod
    def _remaining_ttl(expires_at: float) -> int:
        return max(1, int(expires_at - _now().timestamp()))

    async def _reject_payload(
        self,
        payload: Any,
        reason: str,
        *,
        scope_ref: str | None = None,
    ) -> None:
        """Record a safe rejection without poisoning another valid trigger."""
        if not isinstance(payload, dict):
            return
        ref = scope_ref or payload.get("scope_ref")
        if not isinstance(ref, str):
            return
        # Invalid transport is not authority to change the server-owned scope.
        await self._write_outcome(ref, payload.get("trigger_id"), "rejected", reason)

    async def _write_outcome(
        self,
        scope_ref: str,
        trigger_id: Any,
        state: str,
        reason: str,
    ) -> None:
        safe_trigger = str(trigger_id) if isinstance(trigger_id, str) else "unknown"
        digest = hashlib.sha256(f"{safe_trigger}:{scope_ref}".encode()).hexdigest()[:24]
        value = json.dumps(
            {"state": state, "reason": reason, "scope_ref_hash": digest},
            separators=(",", ":"),
        )
        await self._bus.registry_set(
            f"{SCOPE_NAMESPACE_PREFIX}outcome:{digest}",
            OUTCOME_FIELD,
            value,
            ttl_secs=SCOPE_TTL_SECONDS,
        )

    async def _restore_consuming_for_retry(
        self,
        record: dict[str, Any],
        *,
        reason: str,
    ) -> bool:
        """Release this dispatcher's claim without clobbering a newer claim."""
        if record.get("state") != "consuming":
            return False
        scope_ref = record.get("scope_ref")
        lease_id = record.get("consuming_lease_id")
        if not isinstance(scope_ref, str) or not isinstance(lease_id, str):
            return False
        raw_record = await self._bus.registry_get(
            _scope_namespace(scope_ref),
            SCOPE_FIELD,
        )
        if raw_record is None:
            return False
        try:
            current = json.loads(raw_record)
        except (TypeError, ValueError):
            return False
        if (
            not isinstance(current, dict)
            or current.get("state") != "consuming"
            or current.get("trigger_id") != record.get("trigger_id")
            or current.get("attempt") != record.get("attempt")
            or current.get("consuming_lease_id") != lease_id
        ):
            return False
        pending = {
            **current,
            "state": "pending",
            "last_outcome": "retry",
            "last_reason": reason,
        }
        pending.pop("retry_due_at", None)
        pending.pop("delivery_lease_until", None)
        pending.pop("consuming_lease_id", None)
        pending.pop("consuming_lease_until", None)
        return await self._bus.registry_set_if(
            _scope_namespace(scope_ref),
            SCOPE_FIELD,
            json.dumps(pending, separators=(",", ":")),
            expected=raw_record,
            ttl_secs=self._remaining_ttl(float(current.get("expires_at", 0))),
        )

    async def _recover_expired_consuming(
        self,
        record: dict[str, Any],
    ) -> dict[str, Any] | None:
        """Recover a stale claim with a CAS guarded by lease and attempt."""
        lease_until = record.get("consuming_lease_until")
        if not isinstance(lease_until, (int, float)) or lease_until > _now().timestamp():
            return None
        from agentscope.app.message_bus import MessageBusKeys

        if await self._bus.is_locked(MessageBusKeys.session_lock(record["session_id"])):
            return None
        scope_ref = record.get("scope_ref")
        lease_id = record.get("consuming_lease_id")
        if not isinstance(scope_ref, str) or not isinstance(lease_id, str):
            return None
        raw_record = await self._bus.registry_get(
            _scope_namespace(scope_ref),
            SCOPE_FIELD,
        )
        if raw_record is None:
            return None
        try:
            current = json.loads(raw_record)
        except (TypeError, ValueError):
            return None
        if (
            not isinstance(current, dict)
            or current.get("state") != "consuming"
            or current.get("trigger_id") != record.get("trigger_id")
            or current.get("attempt") != record.get("attempt")
            or current.get("consuming_lease_id") != lease_id
            or float(current.get("consuming_lease_until", 0)) > _now().timestamp()
        ):
            return None
        recovered = {
            **current,
            "state": "pending",
            "last_outcome": "retry",
            "last_reason": "consuming_lease_expired",
        }
        recovered.pop("retry_due_at", None)
        recovered.pop("delivery_lease_until", None)
        recovered.pop("consuming_lease_id", None)
        recovered.pop("consuming_lease_until", None)
        claimed = await self._bus.registry_set_if(
            _scope_namespace(scope_ref),
            SCOPE_FIELD,
            json.dumps(recovered, separators=(",", ":")),
            expected=raw_record,
            ttl_secs=self._remaining_ttl(float(current.get("expires_at", 0))),
        )
        return recovered if claimed else None

    async def _recover_expired_consuming_records(self) -> None:
        """Replay the dedicated outbox, at startup and after delayed expiry."""
        refs = await self._bus.registry_getall(SCOPE_INDEX_NAMESPACE)
        for index, ref in enumerate(refs):
            if not ref.startswith("wscope_"):
                continue
            try:
                raw_record = await self._bus.registry_get(
                    _scope_namespace(ref),
                    SCOPE_FIELD,
                )
                if raw_record is None:
                    await self._bus.registry_del(SCOPE_INDEX_NAMESPACE, ref)
                    continue
                record = json.loads(raw_record)
                if not isinstance(record, dict):
                    continue
                if record.get("state") in TERMINAL_STATES:
                    await self._bus.registry_del(SCOPE_INDEX_NAMESPACE, ref)
                    continue
                if record.get("state") == "consuming":
                    # AgentScope's distributed session lock also protects a
                    # running session during a delayed heartbeat.
                    from agentscope.app.message_bus import MessageBusKeys

                    if await self._bus.is_locked(MessageBusKeys.session_lock(record["session_id"])):
                        continue
                    recovered = await self._recover_expired_consuming(record)
                    if recovered is None:
                        continue
                elif record.get("state") in {"pending", "retry_scheduled"}:
                    recovered = record
                else:
                    continue
                await self._redeliver(recovered)
            except asyncio.CancelledError:
                raise
            except Exception:
                _logger.exception("AgentScope wakeup recovery failed for %s", ref)
            if index % 64 == 63:
                await asyncio.sleep(0)

    async def _redeliver(
        self,
        record: dict[str, Any],
    ) -> None:
        """Fence enqueue attempts while leaving the outbox recoverable.

        Delivery is at least once. Only consuming CAS grants execution;
        a crash before/after queue_push never removes the pending outbox.
        """
        from agentscope.app.message_bus import MessageBusKeys

        scope_ref = record.get("scope_ref")
        if not isinstance(scope_ref, str):
            return
        raw_record = await self._bus.registry_get(_scope_namespace(scope_ref), SCOPE_FIELD)
        if raw_record is None:
            return
        try:
            current = json.loads(raw_record)
        except (TypeError, ValueError):
            return
        if (
            not isinstance(current, dict)
            or current.get("state") not in {"pending", "retry_scheduled"}
            or current.get("trigger_id") != record.get("trigger_id")
            or current.get("attempt") != record.get("attempt")
        ):
            return
        now = _now().timestamp()
        if float(current.get("expires_at", 0)) <= now:
            await self._record_outcome(current, state="scope_expired", reason="scope_expired")
            return
        if float(current.get("retry_due_at", 0)) > now or float(current.get("delivery_lease_until", 0)) > now:
            return
        payload = current.get("queued_payload")
        if not isinstance(payload, dict):
            return
        claimed = {
            **current,
            "delivery_lease_until": now + DELIVERY_LEASE_SECONDS,
        }
        success = await self._bus.registry_set_if(
            _scope_namespace(scope_ref),
            SCOPE_FIELD,
            json.dumps(claimed, separators=(",", ":")),
            expected=raw_record,
            ttl_secs=self._remaining_ttl(float(current.get("expires_at", 0))),
        )
        if success:
            await self._bus.queue_push(MessageBusKeys.wakeup_queue(), payload)
            await self._bus.publish(MessageBusKeys.wakeup_signal(), {})

    async def _record_outcome(
        self,
        record: dict[str, Any],
        *,
        state: str,
        reason: str,
        preserve_terminal: bool = False,
    ) -> None:
        current = await self._bus.registry_get(_scope_namespace(record["scope_ref"]), SCOPE_FIELD)
        if current is None:
            return
        try:
            data = json.loads(current)
        except (TypeError, ValueError):
            return
        if not isinstance(data, dict) or data.get("trigger_id") != record.get("trigger_id"):
            return
        current_state = data.get("state")
        if preserve_terminal:
            state = current_state
        elif data != record:
            return
        updated = {
            **data,
            "state": state,
            "last_outcome": state,
            "last_reason": reason,
        }
        await self._bus.registry_set_if(
            _scope_namespace(record["scope_ref"]),
            SCOPE_FIELD,
            json.dumps(updated, separators=(",", ":")),
            expected=current,
            ttl_secs=self._remaining_ttl(float(data.get("expires_at", 0))),
        )

    async def _mark_terminal(self, record: dict[str, Any], state: str) -> None:
        """Let only the worker that owns the consuming lease finalize the run."""
        scope_ref = record.get("scope_ref")
        lease_id = record.get("consuming_lease_id")
        if not isinstance(scope_ref, str) or not isinstance(lease_id, str):
            return
        raw_record = await self._bus.registry_get(_scope_namespace(scope_ref), SCOPE_FIELD)
        if raw_record is None:
            return
        try:
            current = json.loads(raw_record)
        except (TypeError, ValueError):
            return
        if (
            not isinstance(current, dict)
            or current.get("state") != "consuming"
            or current.get("trigger_id") != record.get("trigger_id")
            or current.get("attempt") != record.get("attempt")
            or current.get("consuming_lease_id") != lease_id
        ):
            _logger.warning(
                "Ignoring stale AgentScope wakeup terminal state %s for %s",
                state,
                scope_ref,
            )
            return
        terminal = {
            **current,
            "state": state,
            "last_outcome": state,
            "last_reason": state,
        }
        await self._bus.registry_set_if(
            _scope_namespace(scope_ref),
            SCOPE_FIELD,
            json.dumps(terminal, separators=(",", ":")),
            expected=raw_record,
            ttl_secs=self._remaining_ttl(float(current.get("expires_at", 0))),
        )
