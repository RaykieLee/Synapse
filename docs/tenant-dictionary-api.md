# 租户字典 API 契约

F15a moves dictionary types and their values into tenant scope. These endpoints do not implement global system parameters or the system navigation dictionary.

## 授权与隔离

All routes require an authenticated global account and an active membership in the `{tenant_id}` path tenant. Only built-in tenant `owner` and `admin` roles can call any dictionary management endpoint. A custom member role does not expand this management surface. Platform administrators do not bypass membership. The API derives `tenant_id` from `TenantContext`; request bodies cannot choose it.

Queries, counts, uniqueness checks and mutations are constrained by `tenant_scope`. Dictionary values are attached to a type with a composite `(dict_type_id, tenant_id)` foreign key, so a value cannot refer to a type in another tenant. A type or value ID from another tenant returns `404 RESOURCE_NOT_FOUND` to avoid confirming cross-tenant resource existence. All JSON resource IDs are decimal strings.

## Dictionary types

Base path: `/api/v1/tenants/{tenant_id}/dict/types`

| 方法 | 路径 | 行为 |
| --- | --- | --- |
| `GET` | `/types?page=1&page_size=20&dict_name=&dict_type=&status=` | Filtered, ordered, paginated type list: `{items,total,page,page_size}` |
| `POST` | `/types/reorder` | Set order of the complete type set |
| `POST` | `/types` | Create type |
| `GET` | `/types/{dict_type_id}` | Read type |
| `PATCH` | `/types/{dict_type_id}` | Update name, key, order, enabled state, or remark |
| `DELETE` | `/types/{dict_type_id}` | Delete an empty type; a type with values returns `409 DICT_TYPE_HAS_DATA` |

Type create fields: `dict_name`, `dict_type`, `order_num?`, `status?`, `remark?`. Type keys use letters, digits, underscore, period, and hyphen; they begin with a letter. Within one tenant, both `dict_type` and `dict_name` are unique. The same key or name may be used by another tenant. Status is `0` (enabled) or `1` (disabled).

Type reorder request uses `items: [{dict_type_id, order_num}]`. IDs must be unique and cover every type in the current tenant exactly once; otherwise the API returns `422 DUPLICATE_DICT_TYPE_ID` or `409 DICT_TYPE_REORDER_SET_MISMATCH`.

## Dictionary values

Base path: `/api/v1/tenants/{tenant_id}/dict/types/{dict_type_id}/data`

| 方法 | 路径 | 行为 |
| --- | --- | --- |
| `GET` | `/data?page=1&page_size=20&dict_label=&status=` | List values for this tenant type, ordered by `dict_sort` |
| `POST` | `/data` | Create a value for this type |
| `POST` | `/data/reorder` | Set the order of the complete value set |
| `GET` | `/data/{dict_data_id}` | Read a value |
| `PATCH` | `/data/{dict_data_id}` | Update label, value, sort, display classes, default state, enabled state, or remark |
| `DELETE` | `/data/{dict_data_id}` | Delete a value |

Value create fields: `dict_sort?`, `dict_label`, `dict_value`, `css_class?`, `list_class?`, `is_default?`, `status?`, `remark?`. `is_default` is `Y` or `N`; status is `0` or `1`. `dict_value` is unique within its dictionary type. The route fixes the parent type; clients cannot provide a tenant or move a value to a different type.

Reorder request:

```json
{
  "items": [
    { "dict_data_id": "31", "dict_sort": 10 },
    { "dict_data_id": "32", "dict_sort": 20 }
  ]
}
```

The item IDs must be unique and must contain every value belonging to that type exactly once. Partial or foreign ID sets return `409 DICT_REORDER_SET_MISMATCH`; duplicate IDs return `422 DUPLICATE_DICT_DATA_ID`.

## 错误

- `401 AUTHENTICATION_REQUIRED`: no valid global account session.
- `403 MEMBERSHIP_INACTIVE` or `403 FORBIDDEN`: tenant membership is inactive or caller is not its built-in owner/admin.
- `404 RESOURCE_NOT_FOUND`: type/value is missing or outside the active tenant scope.
- `409 DICT_TYPE_CONFLICT`: duplicate type name/key.
- `409 DICT_VALUE_CONFLICT`: duplicate value within a type.
- `409 DICT_TYPE_HAS_DATA`: type cannot be deleted while it contains values.
- `409 DICT_TYPE_REORDER_SET_MISMATCH`: type reorder IDs do not match the current complete tenant set.
- `409 DICT_REORDER_SET_MISMATCH`: value reorder IDs do not match the current complete type set.
- `422 VALIDATION_ERROR`: invalid request fields.

Successful create, update, and read responses return the resource object. Timestamps are RFC 3339 UTC; audit actor IDs and all resource IDs are decimal strings. List endpoints return pagination metadata as above.
