# 租户角色定义 API

Status: F12a/F12c implementation contract. This API manages custom tenant role definitions, permission sets, and one optional custom role assignment per ordinary tenant member. It does not implement menus, global/platform roles, or Workspace role management. Built-in `owner`, `admin`, and `member` tenant membership roles remain the existing `TenantMember.tenant_role` values; Workspace `owner/admin/member/viewer` remain `WorkspaceMember.workspace_role`. A custom definition is always returned with `scope: "tenant"` and cannot grant `platform_admin`.

## 授权与租户隔离

Role-definition endpoints are under `/api/v1/tenants/{tenant_id}/roles`. They use `get_tenant_context` and require the existing `tenant_member:manage` permission, which is granted to active tenant owners/admins only. Assignment `PUT` and `DELETE` endpoints also require a built-in tenant owner/admin. Assignment `GET` is available to those managers for eligible member targets, and read-only to an active ordinary member only when `{user_id}` is their own account ID. Other-member reads remain forbidden. Platform administrator status alone does not bypass tenant membership checks. Queries use the trusted tenant context with `tenant_scope`; role reads, edits, deletes and member-role lookups filter against the derived tenant ID. A foreign tenant's role ID or member ID is not exposed to a caller without access and returns `404 RESOURCE_NOT_FOUND` where scope checks apply.

## 数据契约

Role IDs and tenant IDs in JSON are decimal strings. Role status is `active` or `disabled`, corresponding to the old Synapt role status values `0` and `1`. `role_key` is a lowercase stable identifier. Built-in tenant/workspace role identifiers and `platform_admin` are reserved. `permissions` is an explicit, unique set drawn from the currently supported tenant permission catalog:

- `tenant:read`
- `tenant:update`
- `tenant:archive`
- `tenant_member:manage`

These values are stored with the role definition. F12c applies an assigned role's permission set only when the target has built-in tenant role `member`; built-in owner/admin permissions remain unchanged. Menu IDs from Synapt's `sys_role_menu` are not migrated because Synapse menu management is outside this scope.

## 端点

| 方法/路径 | 契约 |
| --- | --- |
| `GET /api/v1/tenants/{tenant_id}/roles?page=1&page_size=20&search=&status=` | Tenant-scoped pagination. `page_size` maximum 100. Optional search matches role name/key; optional status filters active/disabled. Returns `{items,total,page,page_size}`. Soft-deleted rows are excluded. |
| `POST /api/v1/tenants/{tenant_id}/roles` | Create a role. Body: `{role_name,role_key,role_sort?,status?,permissions?,remark?}`. Returns 201 and the role object. Creator and tenant are assigned by the server. |
| `GET /api/v1/tenants/{tenant_id}/roles/{role_id}` | Read a role in the current tenant only. |
| `PATCH /api/v1/tenants/{tenant_id}/roles/{role_id}` | Partial update of role name/key/order/status/permissions/remark. Empty updates and explicit null for required fields are rejected. |
| `DELETE /api/v1/tenants/{tenant_id}/roles/{role_id}` | Soft-delete the role and return 204. |
| `GET /api/v1/tenants/{tenant_id}/members/{user_id}/custom-role` | Owner/admin may read an eligible tenant member's assignment. An active ordinary member may read only their own. Returns `{user_id,role:null}` if absent or if its role is disabled/soft-deleted. Self-read grants no assignment or revoke authority. |
| `PUT /api/v1/tenants/{tenant_id}/members/{user_id}/custom-role` | Assign or replace the member's single custom role. Body: `{role_id:"12"}`. Repeating the same assignment is idempotent. |
| `DELETE /api/v1/tenants/{tenant_id}/members/{user_id}/custom-role` | Revoke the custom assignment; absent assignment is an idempotent 204. |

Assignment endpoints require an active tenant owner or admin by built-in `TenantMember.tenant_role`, even if a custom permission set contains `tenant_member:manage`. The target must be an active, non-deleted global user with active membership in this tenant and built-in role `member`. Owner/admin rows are protected from assignment. Role and member IDs are scoped to the route tenant; foreign IDs return 404. Only active, non-soft-deleted roles may be assigned. One custom role per member is enforced by a unique database constraint. Disabled/deleted roles immediately contribute no permissions; role status, deletion, permission changes, assignment and revocation increment `Tenant.membership_version` when they affect an assigned role/member. The assignment never changes `TenantMember.tenant_role`, `WorkspaceMember.workspace_role`, or workspace permissions.

Role response shape:

```json
{
  "role_id": "12",
  "tenant_id": "3",
  "scope": "tenant",
  "role_name": "Billing reviewer",
  "role_key": "billing_reviewer",
  "role_sort": 10,
  "status": "active",
  "permissions": ["tenant:read"],
  "remark": null,
  "created_by": "8",
  "updated_by": "8",
  "created_at": "2026-10-01T00:00:00+00:00",
  "updated_at": "2026-10-01T00:00:00+00:00"
}
```

## 错误

Errors use the app's `application/problem+json` envelope. Common codes: 401 `AUTHENTICATION_REQUIRED`, 403 `FORBIDDEN`/`MEMBERSHIP_INACTIVE`, 404 `RESOURCE_NOT_FOUND`, 409 `ROLE_CONFLICT`, 422 `VALIDATION_ERROR`, 400 `CONTEXT_MISMATCH`, and 409 `TENANT_INACTIVE`. A duplicate role name/key in the tenant returns 409; different tenants may use the same name/key. Cross-tenant role IDs do not expose their existence.

## 存储

Alembic revision `0004_tenant_roles` adds `tenant_roles`, a tenant-owned table with unique `(tenant_id, role_name)` and `(tenant_id, role_key)` constraints, permission JSON, status, soft-delete marker, actor IDs, and timestamps. Soft-deleted unique identifiers remain reserved by the database. The previous Synapt `sys_role` table was global and coupled permissions to menus; no global role or menu association data is copied into this tenant table.

Alembic revision `0005_tenant_member_roles` adds `tenant_member_roles`, with one row per `(tenant_id,user_id)`, composite foreign keys tying both member and role to that same tenant, assigning actor and timestamp. Assignment rows are physically removed on revoke; role definitions remain soft-deleted. Tenant context resolves custom grants from the database on each request and falls back to the built-in member baseline if the assignment's role is disabled/deleted.
