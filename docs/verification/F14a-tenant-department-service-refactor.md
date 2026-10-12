# F14a 租户部门 Service 化验收

## 当前结论

F14a 租户部门后端已完成渐进式 service 化。部门列表、详情、树、创建、更新、重排和软删除的 HTTP 路径、请求字段、响应字段、状态码、错误码和字符串 ID 契约保持不变；本次不改变 F14b 前端行为。

## 方案与边界

- 数据归属仍为租户级资源；每个查询和写入都从已验证的 `TenantContext` 注入 `tenant_id`。
- `app/api/tenant_departments.py` 只负责依赖注入、查询参数、请求/响应模型、创建状态码和 204 响应。
- `app/schemas/tenant_departments.py` 集中保存原有输入校验、平铺响应、递归树响应和重排响应契约。
- `app/services/tenant_departments.py` 负责 owner/admin 权限、租户作用域、父节点状态、同租户名称冲突、循环检测、祖先路径刷新、子节点保护、软删除和 `flush()`。
- service 返回不可变结果对象，不拼 HTTP 响应字典；业务异常通过全局 service error 映射为原有 problem 响应。
- service/router 均不显式调用 `commit()`、`rollback()` 或抛出 `HTTPException`；请求级 `get_db()` 继续拥有事务边界。
- F14b 无新增 UX 设计范围；为验证当前 wire contract，使用真实 API、Vite 和 Chromium 重新跑过现有部门页面流程。Windows runner 的 `pnpm`、绝对路径、子进程和 SQLite engine 清理问题单独在 `21a38a1` 修复。

## 验证结果

在 F14a 工作树中运行：

```powershell
cd apps/api
.\.venv\Scripts\python.exe -m pytest -q tests\verification\test_f14a_tenant_departments.py
.\.venv\Scripts\python.exe -m compileall app
.\.venv\Scripts\python.exe -m pytest -q
cd ..\web
pnpm build
pnpm exec eslint .
```

浏览器验收使用 Docker Redis `7.4.11`（`127.0.0.1:16381`）并运行：

```powershell
cd apps/api
$env:SYNAPSE_AGENTSCOPE_REDIS_PORT='16381'
.\.venv\Scripts\python.exe tests\verification\run_f14b_tenant_department_frontend.py
```

结果：

- F14a 定向 API 回归：`1 passed, 2 warnings`
- F14b 真实 API/Vite/Chromium：`F14b tenant department frontend verification passed`，进程退出码 `0`
- 默认 API 套件：`23 passed, 25 deselected, 37 warnings`
- `compileall app`：通过
- `pnpm build`：通过
- ESLint：退出码 `0`，`0 errors、24 warnings`
- router/service 边界扫描：通过；F14a router/service 不含 `HTTPException`、显式 `commit()` 或显式 `rollback()`

## 覆盖范围与限制

定向 API 和浏览器验收覆盖：

- 两个租户的同名部门、跨租户详情/更新/删除/父节点拒绝；
- owner/admin 管理权限，普通成员、无租户成员资格的平台管理员和外租户成员拒绝；
- 平铺搜索与状态筛选、递归树、禁用节点过滤；
- root/child/grandchild 的 `ancestors` 生成，移动祖先和重排后的后代路径刷新；
- 同租户名称冲突、禁用/软删除父节点拒绝、循环检测；
- 有 active 子节点时禁止删除，叶节点软删除；
- 租户复合自引用外键和 SQLite foreign key enforcement；
- 前端部门列表/树/创建/编辑/移动/排序/隔离主路径。

本次未验证生产数据库、多进程 PostgreSQL 锁行为或新的部门 UX；这些不属于 service 化改动范围。
