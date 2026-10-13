# F27b Phase 1 Team Orchestration Re-acceptance

Date: 2026-10-13

Scope: re-acceptance after the task-selection, interrupt-state, authorization,
tenant/workspace integrity, and active-run concurrency fixes. Product code was
not modified during this acceptance. This report supplements
`F27b-team-orchestration-acceptance-report.md`.

## Verdict

The previously blocking control-plane defects are fixed and accepted:

1. Explicit task selection now requires a non-empty, unique, known,
   dependency-closed set.
2. Interrupt requests are idempotent and remain non-terminal as
   `interrupt_requested` until a real executor confirms convergence.
3. Team creation/update authorization protects creator-owned draft teams.
4. Team/run records enforce tenant/workspace consistency with composite foreign
   keys.
5. A database-level partial unique constraint prevents more than one active run
   per team.

F27b Phase 1 is still not complete as a real execution feature. AgentScope worker creation, model execution, tool execution, live member progress, and executor acknowledgement are not implemented.

Recommended ledger status:

```text
F27b
状态：控制面授权、完整性和并发约束已修复并复验通过；当前仍为 durable_control_only；真实 AgentScope worker/model 执行未接入
```

## Fixed Blockers

| Blocker | Result | Evidence |
| --- | --- | --- |
| `task_ids` selection semantics | PASS | Focused test passed for empty selection and non-closed dependency selection. Service code also rejects duplicate and unknown IDs before snapshot creation. |
| Interrupt idempotency and non-terminal semantics | PASS | Focused test passed: first request returns `interrupt_requested`, leaves tasks pending, exposes `interrupt_confirmation_pending`, and a duplicate request preserves the run version and event list. |

### Task selection details

- `task_ids is None`: selects all persisted tasks.
- `task_ids=[]`: rejected with `At least one task must be selected`.
- Duplicate IDs: rejected by the service's uniqueness check.
- Unknown IDs: rejected when the selected set is not a subset of the team's task IDs.
- Missing recursive dependencies: rejected with `Selected tasks must include their full dependency closure`.
- Snapshot creation happens only after runtime validation, so a non-closed selection cannot create a dangling dependency snapshot.
- The Pydantic contract also rejects an empty list during normal HTTP validation; the focused service test uses `model_construct` to verify the service invariant independently.

### Interrupt details

- A first interrupt request changes only the run status to `interrupt_requested` and increments `run_version`.
- Active task/member snapshots are not marked as completed or interrupted by the control plane.
- Capabilities expose `can_interrupt=false` and `interrupt_confirmation_pending=true`.
- Repeating the request while `interrupt_requested` returns the existing snapshot without adding an event or changing `run_version`.
- The run remains active for start-conflict purposes until a future executor confirms a terminal outcome.

## Commands and Results

All commands were executed from `D:\Projects\MyPorject\Synapse\synapse-repo`.

Focused backend tests:

```powershell
cd apps/api
.\.venv\Scripts\python.exe -m pytest -q tests/verification/test_f27b_team_orchestration.py
```

Result:

```text
6 passed in 1.79s
```

The focused tests directly cover:

- durable run creation;
- repeated start idempotency;
- first interrupt request;
- repeated interrupt request;
- `interrupt_requested` non-terminal state;
- empty task selection;
- non-closed dependency selection;
- Workspace scoping;
- exact AgentScope agent authorization;
- create/update authorization and creator protection;
- composite tenant/workspace foreign-key integrity;
- database-level one-active-run enforcement and `IntegrityError` mapping.

API full suite:

```powershell
.\.venv\Scripts\python.exe -m pytest -q
```

Result:

```text
40 passed, 26 deselected, 42 warnings in 42.30s
```

The warnings are existing Alembic configuration deprecation warnings. No test failed.

Fresh migration chain:

```text
0001 -> ... -> 0018
```

Result: a fresh SQLite database upgraded successfully through
`0018_model_provider_management` after applying the F27b composite foreign keys
and one-active-run constraint.

API compilation:

```powershell
.\.venv\Scripts\python.exe -m compileall -q app
```

Result: passed with exit code 0.

Frontend production build:

```powershell
cd ..\web
pnpm build
```

Result: passed; TypeScript and Vite build completed with 2859 modules transformed.

F27b frontend lint:

```powershell
pnpm exec eslint src/api/team-orchestration.ts src/features/workspaces/teams-page.tsx
```

Result: passed with no errors or warnings.

Whitespace check:

```powershell
cd ..\..
git diff --check
```

Result: no whitespace errors. Git only reported existing line-ending conversion warnings.

## UI and Capability Boundary

The frontend does not claim that a real worker has executed:

- The page labels the run as `durable_control_only`.
- The page states that AgentScope worker/model execution is not connected.
- `interrupt_requested` is displayed as “中断请求已提交，等待执行器确认”.
- Pause/resume controls are not exposed.
- The API returns `can_execute=false`, `can_pause=false`, and `can_resume=false`.
- Interrupt confirmation is represented separately from a terminal `interrupted` status.

## Remaining Boundaries

The following remain outside the accepted control-plane result:

- AgentScope team/member session creation.
- Real model-provider resolution and model calls.
- Real tool execution.
- Dispatching team tasks to workers.
- Worker-generated progress and event synchronization.
- Executor acknowledgement that changes `interrupt_requested` to `interrupted`.
- Worker retry, timeout, cancellation, checkpoint, and recovery behavior.
- Redis/message-bus end-to-end delivery for team runs.
- Real concurrent multi-Workspace execution isolation.
- Browser-level authenticated interaction acceptance for narrow-screen and keyboard scenarios.
- Production-database concurrency behavior beyond the accepted SQLite/focused
  constraint evidence.

The passing build and tests therefore confirm the durable Synapse control plane only; they do not confirm real AI execution.

## Worktree Note

The repository contained unrelated uncommitted parallel F26/F27/F32 changes before this acceptance. No product files were reverted, cleaned, or modified during the re-acceptance. Only this verification report was added.
