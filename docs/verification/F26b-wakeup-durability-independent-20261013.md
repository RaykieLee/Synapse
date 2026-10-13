# F26b Wakeup Durability Independent Acceptance

Date: 2026-10-13
Repository: `D:\Projects\MyPorject\Synapse\synapse-repo`
Worktree: shared `main`, product read-only
Runtime: Windows, Python 3.13.9, `apps/api/.venv`
AgentScope: `2.0.10.dev0`, commit `72f3f6fa0b2fc38b8517f408ab616f0f2bd229e6`
Redis: `127.0.0.1:16381`, Redis 7.4.11, logical DB 12

## Conclusion

The focused durability acceptance passes for the current A-level contract suite
and the requested B-level real Redis/SQLite/scoped-storage fixture:

```text
A contract: PASS — 27 passed in 3.62s
B Redis/SQLite/scopedStorage: PASS — 1 passed in 5.51s
C real ChatService/model/tool execution: PENDING
```

No confirmed runtime product bug was found in the requested invariants. The
conclusion is not a complete F26b backend acceptance because the current
evidence does not include a real `ChatService` background run with a real or
approved deterministic AgentScope model/tool fixture and final persisted
outcome.

The unit file currently contains 27 tests, not the previously stated 23. The
Redis test is marked `redis` and uses the requested live endpoint, random
per-test prefix, DB 12, and cleanup limited to keys owned by that prefix. No
`FLUSHDB` or `FLUSHALL` was used.

## Commands and Results

From `D:\Projects\MyPorject\Synapse\synapse-repo\apps\api`:

```powershell
.\.venv\Scripts\python.exe -m pytest tests/verification/test_f26c_wakeup_scope.py -q
```

Result:

```text
...........................                                              [100%]
27 passed in 3.62s
```

```powershell
.\.venv\Scripts\python.exe -m pytest tests/verification/test_f26b_wakeup_redis.py -m redis -q
```

Result:

```text
.                                                                        [100%]
1 passed in 5.51s
```

Read-only environment probes also passed:

- Redis ping: `True`.
- Redis version: `7.4.11`.
- `git diff --check`: no whitespace errors attributable to this acceptance.
- Test cleanup assertion: all keys matching the random test prefix were gone.

## Acceptance Evidence

### A — Controlled fixtures and contract behavior

Pass evidence from
`apps/api/tests/verification/test_f26c_wakeup_scope.py`:

- The server-owned schema-2 record is written before queue delivery
  (`test_enqueue_writes_server_scope_before_schema_two_payload`).
- Consume-time tenant, workspace, actor, membership status, membership version,
  session, and agent checks occur before the storage fixture is used for revoked
  membership or session/agent mismatch cases.
- A forged scope and a cross-scope replay do not mutate the genuine pending
  record.
- Duplicate delivery is a no-op after one logical spawn.
- Retry preserves `trigger_id`, `scope_ref`, session, and agent identity while
  incrementing only the persisted attempt; bounded exhaustion reaches
  `retry_exhausted`.
- Expired consuming claims recover through trigger/attempt/lease guarded CAS.
- Startup and running-dispatcher recovery re-enqueue a lost queue entry from the
  durable index, including a persisted due retry.
- Heartbeat renewal prevents replay of a long-running claim, and a stale worker
  cannot finalize a newer consuming lease.
- Queue changes to server-owned `kind` or `input` are rejected without storage
  access.
- Success, raised failure, and the parametrized `CancelledError` path reset the
  `WorkspaceContext` after the run.
- Malformed schema/scope/kind/attempt transport leaves the genuine scope
  pending. The installed AgentScope hooks point to the Synapse adapter.

### B — Real Redis, SQLite, and scoped storage

Pass evidence from
`apps/api/tests/verification/test_f26b_wakeup_redis.py`:

- Real AgentScope `RedisMessageBus` queue, registry CAS, publish/subscribe
  transport, and session lock path are used.
- SQLite is temporary and real SQLAlchemy models are used for tenant, workspace,
  actor, tenant membership, and workspace membership.
- `WorkspaceSessionStorage` is the real adapter over real `RedisStorage`; agents,
  sessions, and messages use its workspace-scoped keys.
- Two workspace contexts consume concurrently through the dispatcher fixture and
  produce workspace-specific observations and persisted messages.
- A live Redis session lock causes persisted retry, then completion after lock
  release.
- A crash window after persisted retry state but before queue enqueue is recovered
  from the scope record.
- A forged workspace field is rejected without changing the genuine scope.
- SQL workspace-membership revocation after enqueue rejects pending work before
  another fixture run; persisted messages remain readable only through the
  verified scoped adapter.
- Final Redis cleanup is prefix-only and asserted empty.

### C — Real ChatService/model/tool execution

Pending. The Redis acceptance uses a controlled `FixtureChat.run`, not the real
AgentScope `ChatService.run`, model provider, tool executor, parked external
result, confirm result, or interrupt flow. Therefore the following remain
unverified:

- real backend wakeup through `ChatService.run` to final persisted assistant
  message/event/session state;
- real model/tool context visibility and absence of context-loss errors;
- external-result, confirm, and interrupt resume semantics;
- duplicate behavior after a real completed run;
- concurrent real AgentScope runs in separate workspaces;
- real transient Redis/DB fault injection through every finalization stage.

## Findings

### Confirmed runtime bugs

None found in the requested durability/security invariants. No P0, P1, or P2
runtime defect is supported by the executed evidence.

### P2 acceptance/documentation mismatch

The prior reacceptance document describes a “bounded 512-entry” recovery index,
but the current implementation appends every live scope to one Redis hash and
does not enforce a 512-entry bound:

- `apps/api/app/integrations/agentscope_wakeup.py:100` — `_append_scope_index`
  writes every scope field and refreshes the hash TTL; no cap or eviction is
  implemented.
- `apps/api/app/integrations/agentscope_wakeup.py:852` — recovery scans the
  full index hash.
- `apps/api/tests/verification/test_f26c_wakeup_scope.py:647` — the current
  contract explicitly requires all 520 entries to remain indexed.

This is not an observed unexpired-entry loss; the current test supports the
requested “no unexpired index eviction” property. It is a stale bounded-index
claim and an unbounded-scan/performance risk that should be resolved in the
specification or implementation before using the older report as evidence.

## Test Quality and Cancellation Review

These are evidence limitations, not confirmed product bugs:

- The A-level `_Bus` does not model Redis TTL expiry or atomic Lua behavior, so
  its CAS and recovery assertions are contract checks rather than Redis
  compatibility proof.
- The A-level `_Db.scalar` fixture returns members by call order and ignores the
  SQL predicate. It verifies status branches but cannot catch a swapped or
  malformed membership query.
- The cross-workspace replay A test uses separate fake buses. It proves that the
  target fake record is not changed, but not a same-bus multi-record race.
- The cancellation parametrization makes `Chat.run` raise `CancelledError`;
  it does not cancel an already-running task during heartbeat lease loss or
  dispatcher shutdown. The `finally` reset is therefore covered, but external
  task-cancellation cleanup is not independently proven.
- The B test uses real Redis CAS and scoped storage, but does not run two real
  dispatchers concurrently against the same trigger to observe the winner and
  loser at the transport level.
- The malformed/tampered B check exercises a forged workspace field against real
  storage, while the broader malformed matrix remains A-level.

The focused tests themselves completed without test failures, cancellation
leaks, or cleanup assertion failures.

## Final Status

```text
A: PASS
B: PASS for the stated deterministic Redis/SQLite/scopedStorage fixture
C: PENDING / not accepted
Overall F26b durability acceptance: NOT COMPLETE
```

No existing product or test file was edited by this independent acceptance.
The only owned artifact is this report.
