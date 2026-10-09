# 租户自定义角色菜单授权 API

Status: F13c implementation contract. This API stores a tenant custom role's selected tenant menus. It does not build dynamic navigation, apply menu grants to runtime requests, or change the system navigation or Workspace role models.

## 授权与作用域

Endpoints are under `/api/v1/tenants/{tenant_id}/roles/{role_id}/menus`. The active tenant context is derived from the authenticated user's membership on every request. Only built-in tenant `owner` and `admin` memberships can read or replace these grants; custom permissions cannot delegate menu-grant management. Platform-admin status alone does not bypass tenant membership. Role, menu, and association queries are tenant scoped. A foreign or missing role/menu ID returns 404 `RESOURCE_NOT_FOUND` without exposing its existence.

## 端点

| 方法/路径 | 契约 |
| --- | --- |
| `GET /api/v1/tenants/{tenant_id}/roles/{role_id}/menus` | Read `{tenant_id, role_id, menu_ids}` for an active, non-soft-deleted custom role in the current tenant. IDs are decimal strings, sorted numerically. Existing links to a menu later disabled or soft-deleted remain visible in the persisted list so an owner/admin can replace the set. |
| `PUT /api/v1/tenants/{tenant_id}/roles/{role_id}/menus` | Replace the complete set. Body: `{"menu_ids":["12","13"]}`; an empty list clears all menu links. Duplicate or non-positive/non-decimal IDs are rejected. Every requested ID must be an active (`status="0"`), non-soft-deleted menu owned by this tenant. Replacement is idempotent: submitting the existing set does not change `membership_version`. |

Disabled or soft-deleted roles are not readable or writable through these endpoints. Disabled/deleted menus, absent IDs, and cross-tenant menu IDs cannot be newly assigned. The list is an association record; this API does not itself filter front-end navigation or enforce the `perms` metadata.

## 原子性与版本控制

The association table has a composite primary key `(tenant_id, role_id, menu_id)` and composite foreign keys to `(role_id,tenant_id)` in `tenant_roles` and `(menu_id,tenant_id)` in `tenant_menus`. This prevents cross-tenant links at the database level when backend FK enforcement is active.

Replacement locks the active role row, reads the prior set, then removes/inserts associations and increments `Tenant.membership_version` once in the same transaction if and only if the set changed. PostgreSQL uses row locks. SQLite uses a write-locking no-op update before reading and retries recognized busy/locked snapshot-upgrade failures after rolling back the stale read transaction. Concurrent replacements serialize; the last successful replacement becomes the stored set and each effective set change advances the version.

Alembic revision `0007_tenant_role_menus` adds the association table and lookup indexes. No legacy `sys_role_menu` data is imported.

## 错误

Errors use the app's `application/problem+json` envelope. Common codes include 401 `AUTHENTICATION_REQUIRED`, 403 `FORBIDDEN`/`MEMBERSHIP_INACTIVE`, 404 `RESOURCE_NOT_FOUND`, 409 `ROLE_MENU_CONFLICT`, and 422 `VALIDATION_ERROR`.
