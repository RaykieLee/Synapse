# F12a 租户角色后端 Service 化独立验收

日期：2026-10-12

## 当前结论

F12a 已完成渐进式 service 化并通过独立验收。本次保持现有 HTTP 路由、字段、错误码、状态码、ID 字符串化和权限范围不变，只将租户自定义角色定义的业务规则与事务操作提取到 application service。

F12c 成员角色分配功能在本次作为回归范围验证通过，但 `tenant_member_roles.py` 仍保留旧的显式事务实现；它不属于本次 F12a 改动，后续作为独立域迁移。

## 实施边界

- `apps/api/app/schemas/tenant_roles.py`：集中承载 RoleCreate、RolePatch 和响应模型，保留 `extra="forbid"`、权限白名单、保留 key 和输入校验。
- `apps/api/app/services/tenant_roles.py`：承载角色作用域查询、唯一性、权限检查、软删除、版本递增、冲突映射和 `flush()`。
- `apps/api/app/api/tenant_roles.py`：只负责依赖注入、Query/path/body 参数、response model、HTTP 状态码和返回 service 结果。
- 没有新增路由、迁移、repository 层或前端契约。

## 独立验收证据

执行：

```powershell
cd D:\Projects\MyPorject\Synapse\synapse-repo\apps\api
.\.venv\Scripts\python.exe -m pytest -q `
  tests/verification/test_f12a_tenant_role_api.py `
  tests/verification/test_f12c_tenant_member_roles.py
```

结果：`2 passed, 3 warnings`。

补充独立检查结果：

- `SEARCH_ESCAPING_AND_SCHEMA: PASS`
- `REQUEST_SCOPE_ROLLBACK: PASS`

已核验：

- 创建、列表、详情、更新、软删除与 active/disabled 筛选。
- 跨租户资源按 `404 RESOURCE_NOT_FOUND` 处理。
- `ROLE_CONFLICT`、输入校验和权限白名单保持原契约。
- `%`、`_` 搜索字符按字面量转义；分页 `total` 与列表条件同源。
- `role_id`、`tenant_id`、操作者 ID 均保持十进制字符串。
- 角色被分配时，权限变化、停用和软删除仍递增 `membership_version`。
- F12c 的赋权、替换、撤销、幂等、并发收敛和组合外键回归通过。
- 人为制造 `flush()` 后请求异常时，`get_db()` rollback，数据库没有留下半写入。
- router 不包含 `HTTPException`、`commit()` 或 `rollback()`。
- service 不依赖 FastAPI，不包含 `HTTPException`、`commit()` 或 `rollback()`，只使用 `flush()`。

## 静态与全局门槛

本次实现后的主代理验证：

- API 默认套件：`23 passed, 25 deselected, 37 warnings`
- `compileall app`：通过
- 前端 `pnpm build`：通过
- ESLint：`0 errors, 24 warnings`

这些门槛证明当前代码可运行，不代表整个项目所有功能均已验收通过。

## 限制与后续

- F12c 的 service 化尚未实现；下一项应单独新增 `TenantMemberRoleService`，再迁移其 router。
- 未在本次任务中迁移 tenant menus、role menus 或其他租户域。
- 未验证生产数据库、多进程并发部署或真实外部模型调用。
