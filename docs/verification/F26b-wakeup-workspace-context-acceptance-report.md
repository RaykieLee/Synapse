# F26b WakeupDispatcher WorkspaceContext Acceptance Report

Date: 2026-10-13
Repository: `D:\Projects\MyPorject\Synapse\synapse-repo`
Branch: `main`
Working-tree HEAD at review start: `77da0fa`
AgentScope: installed project environment; source pin was not independently changed
Runtime: Windows, project `.venv`, Redis `127.0.0.1:16381`

## Conclusion

F26b-backend is **not complete**. The scoped trigger contract is partially
implemented and the focused contract tests pass, but there is no evidence of a
real background AgentScope completion. Several acceptance requirements are also
not implemented or not observable:

- context binding/reset is exercised on the successful controlled path;
- revoked tenant membership is rejected before scoped storage access;
- schema-2 scope records and real Redis queue transport work;
- retry identity, terminal retry handling, rejection outcomes, and real
  background completion are not sufficiently implemented or verified;
- no claim is made that HTTP enqueue success means a completed AgentScope run.

## Commands and Results

All commands below were run from the stated working tree.

### Controlled contract fixture

```powershell
Set-Location D:\Projects\MyPorject\Synapse\synapse-repo\apps\api
.\.venv\Scripts\python.exe -m pytest -q tests/verification/test_f26c_wakeup_scope.py
```

Result: **PASS** — `3 passed in 5.21s`.

The three passing tests cover:

1. server-created schema-2 payload and scope record ordering;
2. inactive tenant membership rejected before storage access (`storage.calls == 0`);
3. verified context visible inside the spawned run and reset in the caller
   task after dispatch.

```powershell
.\.venv\Scripts\python.exe -m compileall -q `
  app/integrations/agentscope_wakeup.py `
  app/integrations/agentscope.py `
  tests/verification/test_f26c_wakeup_scope.py
```

Result: **PASS** — `compileall=PASS`.

### Real Redis/AgentScope MessageBus boundary

A one-shot inline runner used the real `agentscope.app.message_bus.RedisMessageBus`
against `127.0.0.1:16381`, database 14, and a unique synthetic tenant/workspace
scope. It:

- pinged Redis;
- called `enqueue_scoped_trigger`;
- observed a real wakeup stream entry with `schema=2`;
- read the server-owned scope record through the real MessageBus;
- drained exactly one real queue entry;
- deleted only the generated scope key.

Result: **PASS**:

```text
redis_ping=PASS
queue_entry_schema= 2
scope_record_exists= True
queue_drain_count= 1
scope_cleanup= True
```

This is a B-level transport check only. It does not prove SQL authorization
against real tenant rows or a real AgentScope background run.

### Runtime installation seam

```powershell
.\.venv\Scripts\python.exe - <<'PY'
from app.integrations.agentscope_wakeup import (
    ScopedWakeupDispatcher,
    enqueue_scoped_trigger,
    install_scoped_wakeup_runtime,
)
import agentscope.app._bus_ops as bus_ops
import agentscope.app._lifespan as lifespan
import agentscope.app._service._chat as chat

install_scoped_wakeup_runtime()
assert lifespan.WakeupDispatcher is ScopedWakeupDispatcher
assert bus_ops.enqueue_run_trigger is enqueue_scoped_trigger
assert chat.enqueue_run_trigger is enqueue_scoped_trigger
print("runtime_install=PASS")
PY
```

PowerShell used an equivalent stdin runner. Result: **PASS** — all three
identity checks passed.

## Acceptance Cases

| Case | Status | Evidence and limitation |
| --- | --- | --- |
| AC-01 legal external-result trigger reaches `run_completed` | BLOCKED | No real background AgentScope completion runner; controlled test only observes `Chat.run` context |
| AC-02 confirm parked tool call | NOT VERIFIED | No dedicated contract or real parked-run completion test |
| AC-03 interrupt | NOT VERIFIED | No dedicated backend dispatcher test |
| AC-04 tampered scope fields | NOT VERIFIED | Code compares payload fields, but no independent adversarial test |
| AC-05 scope reference points at another Workspace | NOT VERIFIED | No cross-record scope test |
| AC-06 cross-Workspace replay/isolation | NOT VERIFIED | No two-Workspace real storage/dispatcher test |
| AC-07 tenant membership revoked after enqueue | PASS (A) | `test_dispatch_rejects_revoked_membership_before_storage_access`; real DB race not tested |
| AC-08 Workspace membership revoked/downgraded | PARTIAL | Active Workspace membership is checked; revoked/downgrade matrix is not tested |
| AC-09 tenant inactive | NOT VERIFIED | Code has a fail-closed predicate; no dedicated test |
| AC-10 Workspace inactive | NOT VERIFIED | Code has a fail-closed predicate; no dedicated test |
| AC-11 deleted/changed session owner | PARTIAL | Scoped storage result is checked; no adversarial storage/DB test |
| AC-12 agent/session mismatch | PARTIAL | Code checks bindings; no dedicated mismatch test |
| AC-13 reply already resolved/duplicate result | NOT VERIFIED | No parked-reply authority or duplicate-result test |
| AC-14 duplicate trigger/competing dispatcher | PARTIAL | `registry_set_if` gives a controlled claim; no real competing-consumer test |
| AC-15 session lock retry | NOT VERIFIED | No retry test; retry counter and bounded retry behavior are absent |
| AC-16 Redis/DB transient failure | NOT VERIFIED | No fault-injection test |
| AC-17 expired/malformed/legacy payload | PARTIAL | Schema and expiry checks exist; rejection outcome/quarantine is not observable |
| AC-18 exception/cancel/shutdown cleanup | PARTIAL | `finally` reset is present; exception/cancel tests are absent |
| AC-19 real AgentScope background completion | BLOCKED | No deterministic model/tool fixture or completion report |
| AC-20 real duplicate after completion | BLOCKED | Depends on AC-19 |
| AC-21 concurrent runs in two Workspaces | BLOCKED | No real concurrent background run evidence |
| AC-22 HTTP accepted then final outcome | BLOCKED | Transport acceptance is shown, but no `spawned`/`run_completed` outcome chain |

## Required Security Checks

### Context bind/reset

The implementation binds a freshly reconstructed `WorkspaceContext` around
the `ChatService.run` coroutine and resets the original token in `finally`.
The controlled success test passed this behavior. Exception and cancellation
paths are not independently exercised.

### Revocation before storage

The implementation checks tenant, Workspace, actor, tenant membership,
Workspace membership, active status, and tenant membership version before
binding context for `WorkspaceSessionStorage`. The revoked tenant-member
fixture confirmed that storage was not called. This is the strongest verified
security result in this review.

### Scoped storage

The real Redis transport test confirms schema-2 trigger and scope-record
transport. The controlled storage spy confirms a verified context is present
for storage reads. A real two-Workspace storage isolation run was not
available in this acceptance.

### Retry identity

This requirement currently has a blocking implementation gap. `_schedule_retry`
requeues the original `payload` unchanged. It does not increment `attempt`, cap
attempts, enforce retry exhaustion, or transition an expired/rejected scope to
a terminal observable outcome. The original `trigger_id` and `scope_ref` are
preserved, which is correct, but insufficient for the full retry contract.

### Cross-Workspace leakage

No cross-Workspace leakage was observed in the controlled tests or the isolated
Redis transport check. This is not a complete proof: AC-05, AC-06, AC-21, and
real background storage access remain untested.

## Defects and Gaps Blocking Completion

1. **No C-level completion evidence.** A deterministic AgentScope model/tool
   fixture and a runner that proves `accepted -> spawned -> run_completed` are
   missing. The previous observed fail-closed `WorkspaceContext` error is
   therefore not shown to be resolved.
2. **Retry state machine is incomplete.** Retry payloads keep the same attempt
   forever; there is no maximum-attempt/TTL terminal path or `retry_exhausted`
   outcome.
3. **Rejections are not observable.** `_verify_payload` returns `None` for
   malformed, expired, revoked, mismatched, and inactive cases without marking
   the scope record rejected or emitting a reason/correlation outcome.
4. **The acceptance surface is too narrow.** Only three contract tests exist;
   payload tampering, Workspace revocation, inactive resources, agent mismatch,
   duplicate triggers, lock retry, fault injection, and reset-on-error/cancel
   are not independently covered.
5. **Upstream coupling remains.** `install_scoped_wakeup_runtime` replaces
   AgentScope private module symbols (`_bus_ops`, `_service._chat`, and
   `_lifespan`). This is a version-coupled compatibility patch and requires a
   pinned-version compatibility test before production completion.

## Recommended `docs/development-status.md` Status

Keep:

```text
F26b-backend | AgentScope WakeupDispatcher WorkspaceContext 安全传播与后台恢复
状态：实现进行中；A 级最小 contract 通过，B 级 Redis transport 通过，C 级真实后台完成待验收
```

Do not mark F26b-backend complete. Keep the existing F26b frontend status
separate from this backend result. F27b implementation should remain blocked
on the backend completion decision unless its first slice is explicitly
limited to read-only/team-definition behavior that does not depend on wakeup
resume.

## Cleanup and Integrity

- No `FLUSHDB` or `FLUSHALL` was used.
- The real Redis check drained its generated queue entry and deleted its exact
  generated scope key.
- Product source was not modified by this acceptance review.
- `git diff --check` completed without whitespace errors; line-ending warnings
  from Git were unrelated to this report.
