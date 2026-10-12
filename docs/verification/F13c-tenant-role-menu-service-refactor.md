# F13c 租户角色菜单授权 Service 化验收

## 当前结论

F13c 的角色-菜单授权业务已完成渐进式 service 化。GET/PUT 路径、请求字段、响应字段、状态码、错误码和字符串 ID 契约保持不变；本次只调整后端分层，不新增前端 UX 范围。

## 方案与边界

- `app/api/tenant_role_menus.py` 只负责路由、依赖注入、请求模型和响应模型。
- `app/schemas/tenant_role_menus.py` 集中保存菜单 ID 请求校验和响应契约。
- `app/services/tenant_role_menus.py` 负责 owner/admin 权限边界、角色和菜单租户作用域、有效状态校验、历史失效关联读取、关联替换、`membership_version` 递增和 `flush()`。
- service 使用 savepoint 与 SQLite 写锁重试处理并发替换；请求级 `get_db()` 负责成功提交和异常回滚。
- service 不抛 `HTTPException`；业务异常由全局错误映射转换为 HTTP 响应。
- 未引入 repository 层，也未混入 F13e 前端、F13d2 动态侧栏或其他业务域。

## 验证结果

在 `main` 的 `9da290e` 之后的工作树中运行：

```powershell
cd apps/api
.\.venv\Scripts\python.exe -m pytest -q tests\verification\test_f13c_tenant_role_menus.py
.\.venv\Scripts\python.exe -m compileall app
.\.venv\Scripts\python.exe -m pytest -q
cd ..\web
pnpm build
pnpm exec eslint .
```

结果：

- F13c 定向回归：`1 passed, 2 warnings`
- 默认 API 套件：`23 passed, 25 deselected, 37 warnings`
- `compileall app`：通过
- `pnpm build`：通过
- ESLint：退出码 `0`，`0 errors、24 warnings`
- router/service 边界扫描：通过；F13c router/service 不含 `HTTPException`、显式 `commit()` 或显式 `rollback()`

## 覆盖范围与限制

定向验收覆盖：

- owner/admin 读取和替换，普通成员、无租户成员资格的平台管理员及外租户成员拒绝；
- 当前租户 active role、active/未删除 menu 过滤；
- 外租户、缺失、禁用、软删除 role/menu 的安全 `404`；
- 正十进制字符串、唯一性和 500 条上限校验；
- 历史失效关联可读取，但 PUT 只能写入当前租户 active menu；
- 相同集合幂等、有效变化单次递增 `membership_version`；
- 并发不同集合替换的串行收敛；
- role/menu 租户复合外键及 SQLite foreign key enforcement。

本次未验证生产数据库、多进程 PostgreSQL 锁行为、真实模型推理或新的前端 UX；这些不属于 F13c service 化范围。
