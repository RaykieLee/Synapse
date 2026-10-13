# F27b control-plane integrity follow-up

Date: 2026-10-13. The first team migration is still uncommitted; these repairs
are part of its initial implementation, before worker/model integration.

## Reproduced problems

The real SQLite regressions in `test_f27b_team_invariants.py` failed five
scenarios: reusing a client task ID in another team, duplicate task IDs inside
one team, PATCH using returned member IDs, associating a run with another
Workspace in the same tenant, and assigning a task to another team's member.

## Contracts and ownership

- Existing `/workspaces/{workspace_id}/teams` paths, JSON field names, string
  IDs, response statuses, and error codes stay the same.
- Task identifiers are local to a team. The task identity becomes
  `(team_id, task_id)`. Client dependencies and selected task IDs are already
  resolved inside their owning team; no runtime consumer is attached yet.
- Returned member IDs remain valid for PATCH and stay stable when the same
  agent remains a member. Create and PATCH still accept agent IDs as owner
  aliases; aliases are normalized against this team's current/new members.
- Duplicate task IDs inside one definition raise `INVALID_TEAM_DEFINITION`
  before database writes rather than returning a storage error.
- Database constraints enforce `(team_id, tenant_id, workspace_id)` run
  ownership and `(owner_member_id, team_id)` task ownership. Children are
  deleted in task-before-member order and inserted in parent-first order.
- Request transactions remain owned by `get_db`; services only flush.

## Compatibility, migration, and rollback

Old callers are the typed web team client and the Phase 1 HTTP/service tests.
They already send team-scoped task/dependency IDs; no URL or wire conversion
is needed. Newly widening the owner alias limit to the agent-ID limit only
accepts additional valid IDs, while stored member IDs remain 64 characters.

Migration `0017_team_orchestration` is corrected before its first commit.
Fresh upgrade and upgrade from `0016_tenant_validity` are required checks.
Existing task IDs need no backfill in a fresh deployment. An environment that
already ran an earlier working-tree `0017` must not assume rerunning Alembic
will change its constraints: back up its database and prepare a reviewed
incremental migration before upgrading that environment. Do not recreate a
live database or silently change its Alembic stamp.

Rollback disables the new team routes/UI and preserves the database backup.
The migration's downgrade removes the new team tables and their data; it is
only suitable for disposable acceptance databases. A later schema rollback
to global task uniqueness must first check for duplicate task IDs across
teams and migrate those IDs plus dependency/run snapshots explicitly.

## Acceptance

Require all five real SQLite regressions, the existing team HTTP and
two-session active-run checks, fresh Alembic upgrade, compilation, build, and
lint. Agent authorization fixtures remain labeled. These changes add no
worker, no live SSE, and no real provider/model execution.
