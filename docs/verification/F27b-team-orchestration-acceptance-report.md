# F27b Phase 1 Team Orchestration Acceptance Report

Date: 2026-10-13

Scope: independent acceptance of the current F27b Phase 1 control-plane implementation. Product code was not modified during this acceptance.

## Verdict

Control-plane acceptance is partial, not complete.

- Passed: tenant and Workspace request scoping, draft definition validation, agent ownership seam, partial PATCH preservation by code path, basic dependency validation, idempotent start, durable snapshot/event persistence, frontend contract/build, and explicit `durable_control_only` disclosure.
- Blocked: `task_ids` subset semantics and interrupt convergence semantics.
- Not in scope for a passing control-plane result: real AgentScope worker creation, model execution, tool execution, member-session orchestration, and live worker-generated progress.

Recommended ledger status:

```text
F27b
状态：控制面实现部分通过；存在 task_ids 依赖闭包与 interrupt 终态语义阻塞；真实 AgentScope worker/model 执行未接入
```

Do not mark F27b Phase 1 complete.

## Acceptance Matrix

| Case | Result | Evidence / reason |
| --- | --- | --- |
| Tenant isolation | PASS with coverage gap | `_workspace_access()` requires active tenant membership and queries team/run using tenant and Workspace IDs. No cross-tenant HTTP integration test was present. |
| Workspace isolation | PASS | `_workspace_access()` and `_access()` bind the team to both path Workspace and tenant; focused test rejects a foreign Workspace lookup. |
| Active membership and status checks | PASS by inspection | Tenant, Workspace, tenant membership, and Workspace membership must all be active. |
| Real agent ownership validation | PASS at adapter contract level; integration gap | `AgentScopeAgentAuthorization` binds a verified composite context and lists only prefixed agents. The focused test covers exact existence and fail-closed missing agents, but does not exercise the live Redis-backed app wiring. |
| Exactly one leader / unique agents | PASS | `_validate_definition()` rejects zero/multiple leaders and duplicate agent IDs. |
| Task owner validation | PASS | Owners must resolve to a team member ID or member agent ID. |
| Dependency references and cycle validation | PASS for full team definitions | `_validate_definition()` requires dependency IDs to exist in the submitted team and detects cycles. |
| Partial PATCH preservation | PASS by code inspection; test gap | `update_team()` reconstructs omitted members/tasks from persistence before replacing children. No focused assertion proves that a name-only or members-only PATCH preserves the omitted collection. |
| Team version conflict | PASS | `expected_version` is checked under a row lock. |
| Idempotent start | PASS | The `(team_id, idempotency_key)` lookup returns the original run; focused test verifies repeated start returns the same run ID. |
| Active-run conflict | PASS by inspection; test gap | A second key is rejected while a run is `preparing` or `running`; no focused assertion covers the distinct-key conflict. |
| `task_ids` subset membership | PASS | Unknown task IDs are rejected. |
| `task_ids` dependency closure | FAIL / BLOCKER | A selected task may depend on an unselected task. `_validate_runtime()` only checks membership in the team, and `_snapshot()` drops unselected tasks, leaving a dangling dependency in the run snapshot. An empty list also produces a run with zero tasks. |
| Durable run snapshot | PASS | The run stores a JSON snapshot with team version, members, selected tasks, task state, and execution mode. |
| Durable event history | PASS for persistence/replay | Start and interrupt append sequenced events to `events_json`; the events endpoint returns the stored list. |
| Scoped events | PASS for authorization; limited streaming | The events endpoint reuses Workspace/team/run access checks. `stream=true` is a one-shot replay stream, not a live event subscription. |
| Interrupt authorization | PASS | Only Workspace owner/admin roles can interrupt. |
| Interrupt idempotency | PASS for repeated terminal request | Terminal runs return the existing snapshot without adding another event. |
| Interrupt semantics | FAIL / BLOCKER | `interrupt_run()` immediately sets the run to `interrupted` and changes running members/tasks to `interrupted`. The design requires an interrupt request, executor convergence, and a pending-member outcome when convergence is not confirmed. |
| Explicit execution boundary | PASS | API and UI expose `execution_mode=durable_control_only`; capabilities set `can_execute=false`, `can_pause=false`, and `can_resume=false`. |
| Real AgentScope worker/model execution | NOT IMPLEMENTED | No worker/session creation, model call, tool call, or real member progress path is invoked by `start_run()`. |
| Frontend API contract | PASS | Typed API functions cover list/create/start/get run/interrupt/events with Workspace headers and idempotency key generation. |
| Frontend UX disclosure | PASS | The team page says real AgentScope worker/model execution is not connected and hides pause/resume controls. |

## Commands and Results

Executed from `D:\Projects\MyPorject\Synapse\synapse-repo`.

Focused backend tests:

```powershell
cd apps/api
.\.venv\Scripts\python.exe -m pytest -q tests/verification/test_f27b_team_orchestration.py
```

Result:

```text
3 passed in 2.08s
```

Backend full suite:

```powershell
.\.venv\Scripts\python.exe -m pytest -q
```

Result:

```text
37 passed, 26 deselected, 42 warnings in 39.74s
```

Frontend production build:

```powershell
cd ..\web
pnpm build
```

Result: passed; TypeScript build and Vite production build completed successfully, with 2858 modules transformed.

F27b frontend lint:

```powershell
pnpm exec eslint src/api/team-orchestration.ts src/features/workspaces/teams-page.tsx
```

Result: passed with no reported errors or warnings.

Changed-file whitespace check:

```powershell
cd ..\..
git diff --check
```

Result: no whitespace errors. Git emitted only existing line-ending conversion warnings for unrelated modified files.

## Blocking Defects and Gaps

### 1. Selected task dependencies can dangle

`TeamStart.task_ids` is documented as selecting a task subset, but the implementation does not define or enforce dependency closure. For a task `B` depending on `A`, starting with `task_ids=["B"]` creates a snapshot containing `B` with `depends_on=["A"]` and no `A`. This violates the design requirement that dependencies belong to the same run.

The implementation should either:

1. reject a non-closed subset with a stable validation error; or
2. expand the selection to include all transitive dependencies and report the expanded selection.

An empty explicit subset should also be rejected unless the API explicitly defines it as “run nothing”.

### 2. Interrupt marks execution as converged without an executor

The current implementation changes the run and active members/tasks directly to `interrupted`. That is acceptable only for a durable control-plane simulation, but it contradicts the specified interrupt protocol, which requires `interrupt_requested`, executor acknowledgement, timeout handling, and a distinct pending-member outcome.

Until a worker exists, the safer Phase 1 behavior is to represent a request state explicitly and avoid claiming that running work has stopped.

### 3. Missing focused assertions

The current three-test file does not independently assert:

- name-only PATCH preserves members and tasks;
- members-only or tasks-only PATCH preserves the omitted collection;
- a second idempotency key receives `RUN_ALREADY_ACTIVE`;
- explicit `task_ids` selection and dependency closure;
- cross-tenant access using two active tenants;
- live app wiring from the AgentScope gateway/storage to the ownership adapter;
- event replay ordering after a second database session reads the run.

### 4. Streaming is replay, not live aggregation

`GET /events?stream=true` emits the events currently stored and then closes. It is scoped and useful for replay, but it is not a live team event stream and does not aggregate AgentScope member-session events. This is acceptable only while the implementation remains explicitly control-plane-only.

## Control Plane vs Real Execution

The accepted evidence proves durable Synapse-owned configuration and run-control behavior in SQLite, plus frontend compilation and typed contract shape. It does not prove:

- AgentScope team/member session creation;
- model-provider resolution or model calls;
- tool execution;
- worker retry or checkpoint recovery;
- real member status transitions;
- Redis/message-bus event delivery;
- end-to-end progress from AgentScope sessions into team snapshots.

The UI and API correctly expose `durable_control_only`; this boundary should remain until those paths have independent acceptance evidence.
