# F26b scoped WakeupDispatcher reacceptance

Date: 2026-10-13. Reviewed source: current working tree following `77da0fa`
and baseline fixture repair `98abf71`.

## Result and boundary

The dispatcher contract and real Redis/SQLite/scoped-storage paths pass.
Independent evidence is recorded in
[the durability acceptance](F26b-wakeup-durability-independent-20261013.md).
F26b-backend still requires real AgentScope ChatService/model/tool background
resume acceptance. The B-level ChatService in this run is a controlled fixture.

The adapter uses the pinned AgentScope commit
`72f3f6fa0b2fc38b8517f408ab616f0f2bd229e6`. It installs a temporary private
compatibility seam in `_bus_ops`, `_service._chat`, and `_lifespan`; a startup
signature check and hook-identity regression detect the observed API boundary.
No installed `.venv` source is edited.

## Repairs and delivery semantics

- Enqueue derives actor/tenant/Workspace from trusted ContextVar state and
  saves its scope/outbox before registering it in the recovery index and
  publishing the queue entry. IDs, kind, and input are compared with that
  server-owned outbox before execution.
- Invalid or forged transport records a separate rejection outcome. It cannot
  change the legitimate scope into rejected, consuming, or completed.
- Consume-time SQL revalidation checks active user, tenant, Workspace, tenant
  membership, Workspace membership, and membership version. Scoped agent and
  session reads happen only under this new verified context.
- A consuming claim has a random lease ID. Live runs renew it; stale workers
  cannot finalize a newer claim. Spawn failures release their own claim with
  CAS and enter bounded retry.
- Retry intent, attempt, due time, and canonical payload are durable. Delivery
  claims leave that intent in place until consumption. Crashing before or
  after queue push cannot erase the remaining outbox.
- Startup and periodic recovery inspect the dedicated Synapse index. Each
  unexpired scope has its own hash field; the former 512-entry eviction scheme
  has been removed. The reader never scans unrelated Redis keys. Missing and
  terminal scopes are removed from the index, and processing yields between
  batches. `registry_getall` still reads the current index into memory; high
  throughput may require a future paginated index implementation.
- Recovery waits for consuming leases and AgentScope session locks to expire.
  A task completing after another worker acquires the lease cannot overwrite
  its state. ContextVar tokens reset in success, failure, and cancellation.
- Delivery is at least once. Consuming CAS and AgentScope's distributed session
  lock prevent the tested duplicate dispatch patterns. This does not claim
  exactly-once external tool side effects under arbitrary network partitions.

The scope includes a short-lived canonical outbox payload for recovery. Input
is retained under the same server-side Redis access boundary as the queue;
credentials are not included and inputs are never logged. New protocol readers
are deployed together; mixed old/new dispatcher deployments are not accepted.

## Reproducible verification

Run from `apps/api` using its `.venv`:

```powershell
.venv\Scripts\python.exe -m pytest -q tests/verification/test_f26c_wakeup_scope.py
.venv\Scripts\python.exe -m pytest -q -m redis tests/verification/test_f26b_wakeup_redis.py
.venv\Scripts\python.exe -m compileall -q app
```

Contract result: `27 passed in 3.69s` (independent rerun: `27 passed in 3.62s`).
Real infrastructure result: `1 passed in 5.59s` (independent rerun:
`1 passed in 5.51s`).

The deterministic feedback loop first produced five failing dispatcher
regressions: lost pending delivery, restart before lease expiry, live lock
retry remaining duplicate, index eviction, and duplicate long-running dispatch.
Four additional malformed-transport cases also failed before the fix. The
regressions pass on the repaired source. The forged-input fixture was corrected
to use AgentScope's actual list-of-content-blocks Msg contract before acceptance.

The real infrastructure test uses Redis `7.4.11` at `127.0.0.1:16381`, DB 12,
a random test-only namespace, actual AgentScope RedisMessageBus and RedisStorage,
WorkspaceSessionStorage, real SQLite, and actual ChatRunRegistry tasks. It
verifies concurrent Workspace contexts, synthetic message persistence, lock
retry after release, lost-queue/retry recovery, forged-scope isolation, and
SQL membership revocation after enqueue. Cleanup deletes only its own prefixed
keys; neither `FLUSHDB` nor `FLUSHALL` is used.

## Remaining acceptance

- Real ChatService, Agent, model, tools, parked reply ownership, and final reply
  persistence through HTTP external-result/HITL resume are still pending.
- `completed` here means the dispatch coroutine returned. AgentScope may
  internally handle a model error; real execution acceptance must inspect its
  persisted reply-end events and messages rather than this outcome alone.
- A-level DB/bus fixtures do not model Redis TTL or arbitrary concurrent CAS
  races. B-level probes cover the listed scenarios, not Redis clustering,
  process kill recovery, production topology, or real PostgreSQL concurrency.
- The F32 SQL model bindings and F27b team worker are separate pending runtime
  integrations; these checks do not accept them.

Rollback restores the previous application version while preserving the scope
records for diagnosis. Do not consume scoped triggers with an unscoped reader
or relax storage's missing-context rejection. Coordinate the dispatcher rollout
and drain/quiesce old workers; pending records have a five-minute scope TTL.
