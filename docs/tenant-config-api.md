# 租户参数配置 API

Status: F16a implementation contract. This API migrates parameter configuration into tenant-owned storage. It preserves configuration name/key/value, group, frontend-publication flag, enabled state, remark, and audit metadata. Each tenant has an independent key namespace; this migration does not import global `sys_config` records.

## 范围与授权

All routes are under `/api/v1/tenants/{tenant_id}/configs` and resolve the tenant through the authenticated user's active membership. Platform administrator status alone does not grant tenant access. Configuration listing, detail, create, update, and delete require the built-in tenant role `owner` or `admin`. Custom tenant roles do not grant configuration-management access.

`GET /public` is available to any authenticated active member of the path tenant. It returns only configurations with `is_frontend=true`, `is_sensitive=false`, and `status="0"`. It is the only non-manager read route and never returns a sensitive value. There is no unauthenticated or global public configuration endpoint.

## Sensitive values

`is_sensitive` is explicit and defaults to false. Sensitive configurations cannot also set `is_frontend=true`. The manager list always returns `config_value: null` and `value_redacted: true` for sensitive rows. Create and update responses also redact sensitive values. The manager detail route `GET /{config_id}` is the only response that reveals a sensitive value, and only to a built-in owner/admin; it sends `Cache-Control: private, no-store`.

The API does not log configuration values or include values in conflict/validation details. Sensitive values are never selected by the public endpoint. Clients should avoid writing values into application logs or analytics and should keep secret detail responses out of persistent client caches.

## 数据契约

Configuration and tenant IDs are decimal strings. `config_key` is limited to 100 characters and must match `^[A-Za-z][A-Za-z0-9_.-]{0,99}$`. It is unique within a tenant; the same key can exist in another tenant. Values are strings up to 10,000 characters. `status` preserves Synapt's `0` enabled / `1` disabled convention. `is_frontend` means eligible for the member-readable endpoint only when enabled and non-sensitive. `group_name` defaults to an empty string. Actor IDs and timestamps are supplied by the server.

## 端点

| 方法/路径 | 契约 |
| --- | --- |
| `GET /api/v1/tenants/{tenant_id}/configs/public` | Authenticated member read of enabled, frontend-enabled, non-sensitive values. Returns `{tenant_id, items:[{key,value,group}]}`. |
| `GET /api/v1/tenants/{tenant_id}/configs?page=1&page_size=20&config_name=&config_key=&group_name=&status=&is_sensitive=` | Owner/admin paginated list; optional substring and status/sensitivity filters. Sensitive values are redacted. Returns `{items,total,page,page_size}`. |
| `POST /api/v1/tenants/{tenant_id}/configs` | Owner/admin create. Body: `config_name`, `config_key`, `config_value`; optional `group_name`, `is_frontend`, `is_sensitive`, `status`, `remark`. Returns 201. Sensitive value is redacted in the response. |
| `GET /api/v1/tenants/{tenant_id}/configs/{config_id}` | Owner/admin detail. Returns the value, including sensitive values, with `Cache-Control: private, no-store`. |
| `PATCH /api/v1/tenants/{tenant_id}/configs/{config_id}` | Owner/admin partial update of all mutable configuration fields. Sensitive values remain redacted in the mutation response. |
| `DELETE /api/v1/tenants/{tenant_id}/configs/{config_id}` | Owner/admin hard-delete; returns 204. |

All ID lookups apply `tenant_scope`; missing and foreign-tenant IDs both return 404 `RESOURCE_NOT_FOUND`. Duplicate keys return 409 `CONFIG_KEY_CONFLICT`; setting both `is_sensitive` and `is_frontend` returns 422 `SENSITIVE_CONFIG_CANNOT_BE_FRONTEND`. Errors use the standard `application/problem+json` envelope.

## 存储 and migration

Alembic revision `0010_tenant_configs` follows `0009_tenant_dictionaries` and creates `tenant_configs` with a tenant/key unique constraint, tenant index, string value storage, sensitivity/publication flags, status, and audit fields. Tenant deletion cascades to its configurations. No global configuration records are copied into tenant storage.
