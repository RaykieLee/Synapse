# 租户动态导航 API

Status: F13d1 implementation contract. This read-only endpoint returns the current authenticated tenant member's eligible navigation tree from tenant menu metadata. It does not mutate menus, define role grants, or replace the built-in application navigation.

## 端点与授权

`GET /api/v1/tenants/{tenant_id}/menus/visible-tree` resolves the path tenant through the authenticated user's active membership and active tenant state. The endpoint returns all eligible menus to built-in tenant owners and admins. An ordinary member receives only eligible menus assigned through that member's active custom role and the tenant's `tenant_role_menus` grants. A missing, disabled, or soft-deleted custom role produces an empty tree. Platform administrator status alone grants no tenant access.

All role, grant, and menu reads are constrained to the resolved tenant. Missing or cross-tenant references fail closed; they are never used to derive menu visibility. Workspace role grants do not affect this API.

## 可见性规则

Only menus with `status="0"`, `visible="0"`, `del_flag=false`, and `menu_type` `M` (directory) or `C` (page) are navigation candidates. Action entries (`F`) and hidden, disabled, or soft-deleted entries are omitted. For ordinary members, a menu must also be explicitly included in the active custom role's menu grant set.

A candidate is returned only if it is a root or every ancestor is also a candidate authorized for the actor. This prevents a child grant from exposing a child beneath a hidden, disabled, deleted, or unauthorized parent. An assigned child whose parent is not eligible is omitted along with any descendants that depend on it.

## Response

```json
{
  "tenant_id": "42",
  "membership_version": 17,
  "items": [
    {
      "menu_id": "8",
      "parent_id": null,
      "menu_name": "Reports",
      "order_num": 10,
      "path": "/reports",
      "component": "reports/index",
      "query": null,
      "is_frame": 1,
      "is_cache": 0,
      "menu_type": "C",
      "visible": "0",
      "perms": null,
      "icon": "chart",
      "children": []
    }
  ]
}
```

The server sends `Cache-Control: private, no-store`. Clients can include `membership_version` in their tenant navigation cache key and discard cached navigation when it changes. Custom role assignment, role status/definition changes, role-menu grant replacement, and tenant membership changes advance this version under their existing mutation contracts.

## 错误 and boundaries

The API uses the standard `application/problem+json` envelope. Unauthenticated calls return 401; inactive/missing tenant membership fails with the tenant context's 403/409 semantics. The response contains no disabled/deleted menu records, role identifiers, assignment records, or other tenant members' data. This contract describes API behavior; it is not a verification result.
