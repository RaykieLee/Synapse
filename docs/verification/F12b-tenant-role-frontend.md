# F12b Tenant Role 管理前端验收

状态：通过（Outlet 路由修复后的独立复验）。

## 证据

- 运行器：`apps/api/tests/verification/run_f12b_tenant_roles_frontend.py`
- Playwright 场景：`apps/api/tests/verification/f12b_tenant_roles_frontend.mjs`
- 命令：`cd apps/api && .venv/bin/python tests/verification/run_f12b_tenant_roles_frontend.py`
- 结果：退出码 0；`pnpm build` 通过（`tsc -b` 和 Vite 构建），临时 SQLite 迁移至 Alembic `head`（`0006_tenant_menus`），FastAPI 和 Vite 成功启动，Playwright 输出 `F12b tenant role frontend verification passed`。
- 观察到真实 API 对身份认证、租户详情、角色列表/搜索/分页、创建/更新/状态、冲突及软删除的响应。父路由修复 Outlet 后，角色页可在 `/tenants/{tenant_id}/roles` 正常渲染。

## 已验证的浏览器行为

- 同一个管理账户（Tenant A 的 owner、Tenant B 的 admin）在两个租户角色页之间导航。Tenant A 显示自己的角色标记而不含 Tenant B 数据；Tenant B 显示自己的数据且没有缓存的 Tenant A 标记；返回 Tenant A 后也没有泄露 Tenant B 数据。
- Owner 和 admin 可见角色管理入口。普通租户成员没有入口链接，直接访问路由会显示权限拒绝，API 列表请求返回 403。
- 服务端搜索只返回匹配的一行。分页显示第 1/2 页，第二页显示剩余两个角色。
- 创建操作发送真实 POST payload，字段恰为 `role_name`、`role_key`、`role_sort`、`status`、`permissions` 和 `remark`。选择的权限值恰为 `tenant:read` 和 `tenant_member:manage`。
- 编辑通过 PATCH 更新了角色名称/key。禁用/启用通过 PATCH 完成，active/disabled 过滤器显示服务端结果。
- 重复 role key 导致 API 返回 409，页面显示明确的冲突提示。确认删除后发送 DELETE，并在刷新列表中移除对应行。

## 范围与限制

浏览器验收使用一次性 SQLite 记录和临时本地 API/Vite 服务。只验证此租户角色页及其相关 API 交互，不涉及生产数据库行为或更广泛的租户/成员页面流程。冲突反馈断言期间，浏览器 console 记录了预期的重复角色 409；UI 按预期显示错误。
