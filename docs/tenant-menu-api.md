# 租户菜单管理 API

Status: F13a implementation contract. This API manages a tenant-owned navigation/menu tree and its route and permission metadata. It does not implement dynamic frontend navigation, role-to-menu grants, global/system navigation management, or Workspace navigation. Existing built-in application navigation remains independent of `tenant_menus`.

## 范围与授权

All endpoints are under `/api/v1/tenants/{tenant_id}/menus`. The tenant path is resolved through the authenticated user's active membership using `get_tenant_context`; platform administrator status alone does not grant tenant access. Management operations require the built-in tenant membership role `owner` or `admin`. Custom tenant permissions cannot delegate menu administration. Every menu query applies `tenant_scope`; IDs from another tenant and nonexistent IDs both return 404 `RESOURCE_NOT_FOUND`.

## 数据模型

`tenant_menus` is tenant-owned and separate from system navigation. IDs are decimal strings in JSON. `parent_id` is a decimal string or `null` for a root. A composite self-reference ties child and parent to the same tenant. A parent must exist, be active, and not be soft-deleted when a menu is created, moved, or reordered. Self-parenting and cycles return 409 `MENU_CYCLE`. Deleting a menu soft-deletes a leaf only; a menu with active children returns 409 `MENU_HAS_CHILDREN`. Soft-deleted rows are excluded from reads and cannot be selected as a parent.

The migrated route metadata follows Synapt's established field semantics:

- `menu_type`: `M` directory, `C` page, `F` action/button.
- `visible`: `0` visible, `1` hidden.
- `status`: `0` enabled, `1` disabled.
- `is_frame`: `0` external link, `1` internal route; `is_cache`: `0` cacheable, `1` do not cache.
- `path`, `component`, `query`, `perms`, and `icon` store route/permission/navigation metadata. `perms` is metadata only; this API does not enforce it or attach menus to roles.

## 端点

| 方法/路径 | 契约 |
| --- | --- |
| `GET /api/v1/tenants/{tenant_id}/menus?search=&status=` | Flat tenant-scoped list ordered by parent, `order_num`, then ID. Optional name search and `status` (`0` or `1`). |
| `GET /api/v1/tenants/{tenant_id}/menus/tree?include_disabled=true` | Returns `{items:[...]}` nested tree. When false, disabled entries are omitted. |
| `GET /api/v1/tenants/{tenant_id}/menus/{menu_id}` | Read one active, non-deleted menu in this tenant. |
| `POST /api/v1/tenants/{tenant_id}/menus` | Create a menu. Body accepts `menu_name` and optional `parent_id`, `order_num`, `path`, `component`, `query`, `is_frame`, `is_cache`, `menu_type`, `visible`, `status`, `perms`, `icon`, `remark`. Returns 201 and the menu record. Actor and tenant IDs come from trusted context. |
| `PATCH /api/v1/tenants/{tenant_id}/menus/{menu_id}` | Partial update of menu metadata, status, parent, or order. Empty patch is invalid. Setting `parent_id: null` makes the item a root. |
| `POST /api/v1/tenants/{tenant_id}/menus/reorder` | Apply a set of ordering/parent changes atomically. Body: `{ "items": [{"menu_id":"12","parent_id":"3","order_num":1}] }`; `parent_id` may be null. Duplicate IDs, missing/cross-tenant IDs, deleted/inactive parents, or cycles are rejected. |
| `DELETE /api/v1/tenants/{tenant_id}/menus/{menu_id}` | Soft-delete a leaf and return 204. |

Record responses include `menu_id`, `tenant_id`, `menu_name`, `parent_id`, `order_num`, `path`, `component`, `query`, `is_frame`, `is_cache`, `menu_type`, `visible`, `status`, `perms`, `icon`, `remark`, actor IDs, and timestamps. Tree responses include the same fields plus `children`.

## 错误

Errors use the app's `application/problem+json` envelope. Common codes include 401 `AUTHENTICATION_REQUIRED`, 403 `FORBIDDEN`/`MEMBERSHIP_INACTIVE`, 404 `RESOURCE_NOT_FOUND`, 409 `MENU_CYCLE`, `MENU_PARENT_INACTIVE`, `MENU_HAS_CHILDREN`, or `MENU_CONFLICT`, and 422 `VALIDATION_ERROR`. Cross-tenant menu existence is not disclosed.

## 存储 and boundaries

Alembic revision `0006_tenant_menus` creates the tenant menu table, composite parent/tenant reference, tenant index, and soft-delete marker. No legacy global menu rows or `sys_role_menu` associations are copied. The built-in system navigation remains outside this tenant table, and Workspace membership/roles remain unchanged.
