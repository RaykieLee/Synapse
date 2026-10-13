# F27b Control-Plane Independent HTTP Reacceptance

Date: 2026-10-13. This replaces the earlier acceptance verdict with results
from the repaired team integrity and ownership-loop implementation.

Scope: read-only product verification following
`docs/architecture/f27b-control-plane-integrity-follow-up.md`. Only this
report and the independent
`apps/api/tests/verification/test_f27b_control_plane_http_acceptance.py`
were edited by this verifier. Existing team tests, services, models, schemas,
routers, migrations, UI, Model/Wakeup documentation, and runtime databases
were not edited. No commits were created.

## Verdict and verified finding

**The five integrity repairs and the Redis loop-affinity repair pass their
reacceptance checks. Final F27b control-plane acceptance remains blocked by
one independently reproduced P1 in simultaneous SQLite start requests.**

### P1: a genuine active-run race returns HTTP 500 instead of 409

Product locations: `apps/api/app/services/team_orchestration.py:309` and
`apps/api/app/services/team_orchestration.py:416`, particularly the predicate
at line 424.

Two authenticated HTTP requests, backed by different real SQLite sessions
and different idempotency keys, pass the initial no-active-run check together.
A barrier in the labeled authorization fixture synchronizes this point;
neither SQLAlchemy queries nor flushes are mocked. SQLite's partial unique
index rejects one actual insert with:

```text
UNIQUE constraint failed: team_runs.team_id
```

`_is_one_active_run_integrity_error()` recognizes only the named index
`uq_team_runs_one_active`. SQLite's actual column-based diagnostic is not
recognized, so the original `IntegrityError` propagates and is converted to
`500 INTERNAL_ERROR`. The observed responses were `[202, 500]`, rather than
`[202, 409]`. Exactly one active row persisted, so the database safety
invariant held while the HTTP conflict contract failed.

This reproduced in the independent module and again in the combined F27b
run. The failing regression is
`test_simultaneous_http_starts_return_conflict_with_one_active_sqlite_row`
in the independent test at line 706. The SQLite driver error is captured
through an Engine error event, without substituting a synthetic exception.
No product fix was made. The existing focused exception-mapping test uses a
synthetic message containing the index name and does not cover this diagnostic.

## Executed commands and actual results

Commands below ran from `D:\Projects\MyPorject\Synapse\synapse-repo\apps\api`.

Combined default F27b suites, including the extended independent test:

```powershell
.\.venv\Scripts\python.exe -m pytest -q tests/verification/test_f27b_team_orchestration.py tests/verification/test_f27b_team_invariants.py tests/verification/test_f27b_control_plane_http_acceptance.py tests/verification/test_f27b_agent_authorization_loop.py --tb=short
```

Result: **22 passed, 1 failed, 1 deselected, 9 warnings in 20.86s**.
The only failure is the P1 simultaneous-start case above; the deselected test
is the live Redis test, run explicitly below. Warnings are Alembic's existing
`path_separator` deprecation.

| Separately executed check | Actual result |
| --- | --- |
| `python -m pytest -q tests/verification/test_f27b_team_orchestration.py --tb=short` | 8 passed, 1 warning |
| `python -m pytest -q tests/verification/test_f27b_team_invariants.py --tb=short` | 5 passed |
| `python -m pytest -q tests/verification/test_f27b_agent_authorization_loop.py --tb=short` | 3 passed, 1 deselected |
| `python -m pytest -q tests/verification/test_f27b_control_plane_http_acceptance.py -s --tb=short` | 6 passed, 1 failed, 8 warnings |
| `python -m compileall -q app` | Exit 0 |
| AST inspection of team router and service for `.commit()` / `.rollback()` calls | Neither file contains an explicit call |

The Python commands in the table used `apps/api/.venv/Scripts/python.exe`.
The full API suite, web build/lint, and browser acceptance were **not rerun for
this final product state**; no previous full-suite or UI result is carried
forward as current evidence.

## Passing integrity and migration scenarios

All five original real-SQLite regressions passed, with the following additional
independent checks against a file-backed database created by Alembic:

| Repair/check | Passing evidence |
| --- | --- |
| Team-local task identity | Two HTTP-created teams reuse the same explicit task IDs and both return 201; tasks use a composite PK containing `task_id` and `team_id` in metadata and migration. |
| Duplicate IDs inside a team | HTTP create returns 400 `INVALID_TEAM_DEFINITION`, and the team count remains unchanged. |
| Returned member IDs in PATCH | Tasks-only HTTP PATCH accepts owners from the preceding team response and retains member IDs; members-only PATCH also retains those IDs for the same agents and preserves task content. |
| Cross-team task owner | HTTP PATCH with another team's returned member ID returns 400 without changing the draft; a direct insert with an existing foreign member is rejected by the migrated SQLite FK. |
| Same-tenant, different-Workspace run | A direct run insert using an existing team and an existing different Workspace is rejected by the migrated SQLite FK. |
| Fresh schema | Upgrade from an empty temporary SQLite database through current head `0018_model_provider_management` succeeds. |
| Upgrade from 0016 | Upgrade from `0016_tenant_validity` through head succeeds with seeded users, tenant, Workspaces, and four Workspace memberships preserved. |
| Schema matches metadata | All four team tables match ORM columns/types/nullability, primary keys, unique constraints, foreign keys including delete actions, and indexes including the active-run predicate. |
| No accidental constraint removals | Every table present at 0016 retains its column/default, PK, FK, unique/check constraint, and index signature after upgrade. All modeled team constraints are present. |
| FK enforcement | `PRAGMA foreign_keys=1` and `PRAGMA foreign_key_check` returns no violations in both upgrade paths. |
| Request transaction rollback | A labeled test service raises a controlled domain error after the real PATCH flush; the next request sees the original name/version/member/task snapshot, with both child collections restored. |

Specifically, the schema checks retain:

- `uq_team_definitions_workspace_actor_name` and the expanded
  `uq_team_definitions_scope`;
- `fk_team_definitions_workspace_tenant`;
- the member-to-team FK and `uq_team_member_definition_scope`;
- the task-to-team FK and composite
  `fk_team_task_owner_scope(owner_member_id, team_id)`;
- `uq_team_runs_team_idempotency`;
- composite `fk_team_runs_team_scope(team_id, tenant_id, workspace_id)`;
- `fk_team_runs_workspace_tenant`;
- `uq_team_runs_one_active`, covering `preparing`, `running`, and
  `interrupt_requested`;
- team/run tenant and creator/updater user FKs as declared in metadata.

The older team/tenant-only run FK and supporting unique tuple are replaced
by the stronger triple containing Workspace, rather than leaving a missing
ownership check. The task-to-team FK missing from the earlier draft migration
is present in this final draft.

Migration 0017 remains an uncommitted initial migration. Per the parent's
runtime-database check, the actual runtime database is still at 0016; this
verifier upgraded only disposable acceptance databases. A database that has
already applied an older draft 0017 would need an incremental migration;
these fresh-upgrade tests do not prove such an upgrade path.

## Passing core HTTP scenarios and fixture labels

The independent core suite uses the real parent FastAPI app, JWT verification,
Workspace membership/header dependencies, SQLite sessions, and `get_db`
request transactions. Core agent existence checks use the explicitly labeled
`ControlledAgentAuthorization` allowlist of synthetic agents; this is not
real AgentScope agent discovery.

Passing scenarios are missing-auth 401; missing/wrong-header 400; owner
create/list/get/PATCH; member/viewer shared reads; member/viewer create, PATCH,
start, and interrupt denials; cross-Workspace team lookup 404; preservation of
omitted PATCH collections; start 202 with the asserted `Location`; same-key
idempotency; sequential distinct-key 409; member run reads; owner interrupt
to non-terminal `interrupt_requested`; pending task snapshots and confirmation
capability; repeated interrupt preserving the version and event sequence;
JSON event replay; and finite one-shot SSE replay.

A terminal first run permits a distinct second run. The terminal status is
set directly by the acceptance fixture in its disposable database; executor
completion is not simulated as a product capability. The earlier sequential
two-session conflict check passes. Simultaneous competing inserts preserve
one active row but fail the HTTP conflict response as documented above.

## Separate real Redis ownership-loop evidence

```powershell
.\.venv\Scripts\python.exe -m pytest -q -m redis tests/verification/test_f27b_agent_authorization_loop.py -s --tb=short
```

Result: **1 passed, 3 deselected in 3.39s**, using real Redis at
`127.0.0.1:16381`, DB13, and random namespace
`synapse-f27b-auth-loop:c8c3498192ca477086f420c49f62957c:`.
The test removes only its generated namespace on the owning loop.

The live test opens actual AgentScope `RedisStorage` wrapped by
`WorkspaceSessionStorage` under an asynchronous child-style lifespan and
invokes the actual `AgentScopeAgentAuthorization` from a synchronous FastAPI
worker route. Repeated owned-agent checks pass; foreign Workspace, tenant,
actor, and missing-agent checks deny; concurrent actor requests maintain
scope isolation; and context is restored afterward. The owner and route
thread IDs differ. The adapter at
`apps/api/app/integrations/team_agent_authorization.py:46` uses
`anyio.from_thread.run`.

The three default loop tests separately cover a loop-bound memory fixture,
context reset/recovery after lookup failure, and fail-closed plain synchronous
callers without the application loop. The legacy scoped-agent unit test now
runs inside an AnyIO worker and passes. This evidence accepts Redis lookup
loop affinity and scoping; the live test supplies controlled context inputs
and is not a full real-Redis team-route/JWT/model execution acceptance.

## Scope boundary

Accepted behavior remains `durable_control_only`. Real AgentScope workers,
member sessions, model/provider calls, tools, task dispatch, live progress,
executor interrupt acknowledgement, timeout/retry/recovery, and team live SSE
remain pending. Event `stream=true` is one-shot replay. Production-database
concurrency beyond the measured SQLite scenarios, cross-process execution,
UI acceptance, and migration of previously applied draft 0017 databases are
outside this result. The new P1 prevents a blanket HTTP-no-500 acceptance.
