# 租户定时任务定义 API

Status: F18a/F18b1/F18b2a/F18b2b/F18b2c/F18b3/F18b4/F19a/F19c1 implementation contract. This API stores tenant-owned task definitions and schedules. F18b2a adds an internal dispatcher, F18b2b persistent schedule state, F18b2c the FastAPI lifespan polling loop, F19a persisted run records with tenant-scoped query endpoints, and F19c1 an owner/admin manual trigger endpoint. There is no retry-control endpoint.

## 范围与安全

The API is rooted at `/api/v1/tenants/{tenant_id}/scheduled-tasks`. Every request resolves `TenantContext`, applies `tenant_scope`, and requires an active tenant owner or admin. Ordinary members, inactive members, and non-member platform administrators do not receive a bypass. A foreign task ID is reported as not found.

Definitions accept only an `execution_target` returned by `GET /targets`. Current stable identifiers are:

| 标识符 | 含义 |
| --- | --- |
| `tenant.expire_pending_invitations` | Mark expired pending tenant invitations as expired |
| `tenant.reconcile_attachment_metadata` | Reconcile tenant attachment metadata with local objects |
| `tenant.refresh_resource_summary` | Refresh tenant resource summaries |

These identifiers are explicit allowlisted business targets. The handlers documented below exist as standalone functions and can be called through the internal dispatcher. No Python module/function path, shell command, URL, or arbitrary callable field exists in the definition schema. `parameters` is a bounded flat JSON scalar object; the current three handlers accept only `{}` and other values are rejected by dispatch.

### 内部调度契约

`app.tasks.dispatcher.dispatch_tenant_task(db, task_id, tenant_id)` is an internal-only entry point for a trusted scheduler. Both identifiers must be positive integers supplied by trusted persisted scheduling context. It re-reads the task definition from the database using both IDs, rejects a missing/cross-tenant task, and refuses disabled or soft-deleted definitions. It maps the stored `execution_target` through a closed in-code handler map; callers cannot select a Python function or pass an arbitrary target. The three current targets have no runtime parameters, so only an empty JSON object is accepted; malformed JSON, arrays/scalars, and non-empty objects raise `TaskDispatchError` with a stable `code` (`invalid_invocation`, `task_not_found`, `task_unavailable`, `unsupported_target`, or `invalid_parameters`). Handler/business failures propagate to the internal caller.

Successful calls return a consistent envelope with decimal-string `task_id` and `tenant_id`, stored `execution_target`, `status: "succeeded"`, and target-specific `result`. Invitation expiration uses `{expired_count: number}`; the attachment and resource-summary handlers return their documented result objects. The dispatcher does not implement scheduling, manual HTTP execution, retries, or execution logs.

### 已实现的独立处理函数：邀请过期

`app.tasks.tenant_invitations.expire_pending_invitations(db, tenant_id, now=None)` implements `tenant.expire_pending_invitations`. The function is internal and accepts its tenant ID only from trusted persisted task context; public request data must never be forwarded as the scope. It confirms the tenant exists, then atomically changes only rows matching that tenant, `status=pending`, and `expires_at <= cutoff` to `status=expired`. It returns the number of rows changed. The conditional update is idempotent and safe for concurrent invocations; invitation statuses such as accepted or revoked are untouched. The optional `now` supports deterministic internal callers and naive values are interpreted as UTC.

The handler is a business function invoked only through the closed internal dispatcher described above; it does not start its own scheduler.

### 已实现的独立处理函数：附件元数据核对

`app.tasks.attachments.reconcile_attachment_metadata(db, tenant_id)` implements `tenant.reconcile_attachment_metadata`. It enumerates metadata rows filtered to the trusted tenant ID and checks only each referenced local storage key: key format/path containment, regular-file existence, and actual byte size against `size_bytes`. It returns `metadata_count`, `present_file_count`, `consistent_file_count`, `exception_count`, and the attachment IDs grouped by exception code (`invalid_storage_key`, `storage_path_outside_root`, `missing_file`, `not_regular_file`, `unreadable_file`, `size_mismatch`).

The handler is read-only: the attachment model has no checksum or reconciliation status, so it cannot detect same-size content replacement, and it does not rewrite metadata, remove objects, or scan shared storage for untracked files. It is limited to the current tenant's metadata references.

### 已实现的独立处理函数：资源摘要刷新

`app.tasks.resource_summary.refresh_resource_summary(db, tenant_id, now=None)` implements `tenant.refresh_resource_summary`. The tenant ID must come from trusted persisted task context. It confirms the tenant exists and every source query is explicitly constrained to that tenant. It records these counts: active user memberships (both membership and global user must be active and the user not soft-deleted), active Workspaces, attachments, active dictionary types and values (a value is counted only when both it and its type are active), active configurations, active non-deleted departments, active non-deleted custom roles, active visible non-deleted menus, and enabled non-deleted scheduled task definitions.

The single `tenant_resource_summaries` row per tenant stores the complete counts document as JSON, schema version, and refresh time. Each call recomputes every count and atomically upserts the entire row, replacing any previous summary rather than incrementing counters or updating fields piecemeal. Concurrent calls therefore cannot expose a partially refreshed document. The handler returns the same count set with the tenant ID and refresh timestamp. Its Alembic migration is `0013_tenant_resource_summaries`. The summary is not exposed through an HTTP endpoint.

## Definition fields

| 字段 | 含义 |
| --- | --- |
| `task_id` | Decimal string ID, generated by the server |
| `tenant_id` | Decimal string from the trusted tenant context |
| `task_name` | Required, trimmed, unique within tenant (including soft-deleted names) |
| `description` | Optional, up to 1000 characters |
| `execution_target` | Required allowlisted identifier |
| `parameters` | Optional flat JSON scalar object; at most 32 properties and 8 KiB encoded |
| `schedule_type` | `cron` or `interval` |
| `cron_expression` | Exactly five standard cron fields for `cron` schedules |
| `interval_value`, `interval_unit` | Positive amount and `seconds`, `minutes`, `hours`, `days`, or `weeks` for interval schedules |
| `timezone` | Valid IANA timezone, defaults to `UTC` |
| `enabled` | Whether this definition is enabled; defaults to true |
| `created_by`, `updated_by`, `created_at`, `updated_at` | Server-managed audit fields |

Cron definitions require a parseable five-field cron expression and no interval fields. Interval definitions require both interval fields and no cron expression. The total interval must be between 10 seconds and 365 days. The database also enforces the schedule field pairing and target allowlist.

## 端点

- `GET /targets`: list the explicit execution-target allowlist; tenant owner/admin only.
- `GET /`: filterable paged list. Optional `task_name`, `execution_target`, `schedule_type`, and `enabled`; `page` defaults to 1, `page_size` defaults to 20 and is capped at 100. Returns `items`, `total`, `page`, and `page_size`.
- `POST /`: create a definition. Tenant ID and audit fields are assigned server-side; returns `201` and the full object.
- `GET /{task_id}`: retrieve one active definition in the current tenant.
- `PATCH /{task_id}`: update definition fields or toggle `enabled`; schedule validation applies to the merged complete definition. If a partial patch leaves the merged Cron/interval combination invalid (for example, changing a Cron task to `interval` without clearing the Cron expression and supplying interval fields), the API returns HTTP `422` with code `VALIDATION_ERROR` and a readable field/reason detail. No definition fields are written on that validation failure.
- `DELETE /{task_id}`: soft-delete the definition, disable it, and update audit fields; returns `204`. Its name remains reserved to keep existing execution references unambiguous.
- `POST /{task_id}/runs`: synchronously run one enabled, non-deleted definition now. The request has no body and accepts no handler/target override. It dispatches through the same persisted-definition lookup and closed allowlist as the scheduler, and returns `201` with the newly persisted run record. Handler failures are recorded as a `failed` run with a stable safe error code; the response remains `201` because the manual invocation and its audit record were accepted. A disabled task returns `409 TASK_UNAVAILABLE`; a task with an active scheduled lease returns `409 TASK_ALREADY_RUNNING`; a missing, deleted, or foreign-tenant task returns `404 RESOURCE_NOT_FOUND`.

Manual triggers do not accept an idempotency key: every accepted request is a distinct execution and creates a distinct run record. Simultaneous manual requests for the same task are serialized by a process mutex and database row lock where supported; after the preceding request completes, the waiting request runs as its own invocation. This is serialized execution, not deduplication. The endpoint holds that lock while invoking the handler and therefore may take as long as the handler. A process crash after a handler side effect but before the run is finalized can leave a `running` record; the handler's side effect may have completed, and a later manual request is a new attempt.

The `0012_tenant_scheduled_tasks` migration creates a tenant FK, per-tenant name uniqueness, allowed-target and schedule-shape constraints, enabled/deleted flags, and audit fields. Next-run state, runtime polling, and run records are described below.

## Persistent scheduling state and internal claims

`0014_tenant_task_schedule_state` adds one `tenant_task_schedule_states` row per task definition with the definition fingerprint, UTC `next_run_at`, claimed slot, lease owner/token, lease deadline, and timestamps. `app.tasks.scheduler_state.claim_due_tasks(db, worker_id, now=None, lease_seconds=60, limit=50)` materializes the next due time for enabled, non-deleted definitions using the schedule's IANA timezone for cron and UTC elapsed time for intervals. Newly created or changed tasks are first scheduled after the current time. Missed occurrences are coalesced; successful completion schedules the next occurrence after completion time.

Claiming uses a conditional atomic state update, so concurrent workers cannot claim the same live slot. Returned claims include decimal-string task and tenant IDs, target, slot timestamp, lease owner, a random lease token, and lease deadline. Expired leases can be claimed again with a new token. Task definition fingerprints include `updated_at` and all stored definition fields; a changed, disabled, or deleted task clears stale slot/lease state during scanning, and completion independently rejects a stale claim.

`app.tasks.scheduler_state.complete_task_claim(db, task_id, tenant_id, worker_id, lease_token, succeeded, now=None)` completes only the matching unexpired lease. A successful completion advances `next_run_at` and clears lease fields; a failed completion releases the lease while preserving the due slot for retry. Stable `SchedulerStateError.code` values distinguish invalid input, missing/stale/expired claims, invalidated tasks, and invalid schedules. These are internal functions, not public HTTP routes.

### API process polling lifecycle

The FastAPI lifespan starts `app.tasks.scheduler_runtime.run_scheduler_loop` when `SYNAPSE_SCHEDULED_TASKS_ENABLED=true` (default). It polls one claim at a time per process and invokes only `dispatch_tenant_task`; each handler is followed by claim completion, or lease release on failure. Multiple API processes may run pollers safely because the database claim CAS and lease token arbitrate each due slot. A process crash after a handler side effect but before completion can cause a retry after lease expiry, so handlers must remain idempotent; this provides at-least-once recovery, not exactly-once side effects.

Runtime settings are `SYNAPSE_SCHEDULED_TASK_POLL_INTERVAL_SECONDS` (default `5`, >0 and <=3600), `SYNAPSE_SCHEDULED_TASK_LEASE_SECONDS` (default `300`, 1..86400), and optional `SYNAPSE_SCHEDULED_TASK_WORKER_ID` (identity prefix; the runtime appends host/process/random identity so processes remain distinct). Configure the lease longer than the expected maximum handler duration. On graceful shutdown the polling timer is stopped immediately; a claim returned at the shutdown boundary is released, while an in-flight handler is allowed to finish and complete/release its lease before lifespan exit. If the process is forcibly terminated, lease expiry permits recovery. Run migrations through `0015_tenant_scheduled_task_runs` before enabling the poller so execution records are available. No scheduler setup, execution, or lease operations are exposed over HTTP.

## Execution records and query API

Migration `0015_tenant_scheduled_task_runs` adds one record for each claimed handler attempt. The runtime commits a `running` row before invoking the dispatcher, then sets `finished_at` and `succeeded` or `failed` afterward. Each record includes tenant/task IDs, claimed slot, target, start/end timestamps, a target-limited result summary or a stable error code. The claim token is recorded only as a SHA-256 hash and is never returned by the API. Arbitrary handler output, task parameters, exception messages, and credentials are not persisted. A forced process death may leave a record in `running`; lease recovery can start another attempt, and run records are append-only rather than retroactively rewritten.

The following routes require an active tenant owner or admin and scope every lookup/filter to the current tenant:

- `GET /{task_id}/runs`: paged newest-first records, with optional `status` (`running`, `succeeded`, `failed`), `started_from`, and `started_to` filters. `page` defaults to 1; `page_size` defaults to 20 and is capped at 100.
- `GET /{task_id}/runs/{run_id}`: retrieve one run detail, including its sanitized result summary or error code.
- `POST /{task_id}/runs`: manually invoke the active definition as described above. The returned run object uses the same safe projection as the query endpoints and never includes task parameters or claim token material.

A task ID or run ID belonging to another tenant returns `404 RESOURCE_NOT_FOUND`. Deleted task definitions remain addressable for their execution history. Responses never return the claim token or its stored hash.
