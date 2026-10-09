# F12e — 普通成员查看自己的租户自定义角色

**状态：通过**

## 运行

在 `apps/api` 中运行：

```sh
.venv/bin/python tests/verification/run_f12e_self_role_view.py
```

运行器执行 `pnpm build`，创建隔离的 SQLite 数据库并迁移至 Alembic `head`（`0007_tenant_role_menus`），填充两个租户及真实用户/角色/分配，通过 FastAPI `TestClient` 调用 API，然后启动 API 和 Vite 应用执行 Playwright 检查。结果：退出码 `0`；Vite 报告 production build 成功，浏览器流程输出 `F12e self-role view browser verification passed`。

## 已验证

- Active 普通成员可以在两个租户中读取自己的 active 自定义角色；同一 actor 会看到各租户不同的角色分配。
- 成员不能读取其他成员的分配，包括其他租户的用户 ID（`403 FORBIDDEN`）。成员也不能 `PUT` 或 `DELETE` 自己的分配（`403 FORBIDDEN`）。
- Tenant owner 和 admin 仍保有读取符合条件成员分配的既有权限。
- Owner 撤销后，自我读取返回 `{role: null}`。若分配指向 disabled 或软删除的角色定义，也返回 `{role: null}`。
- 浏览器中成员自己的行会显示角色名称或“未分配”；其他成员的自定义角色分配会隐藏。页面不显示自定义角色选择器或撤销操作。
- SPA 在两个租户详情间导航时会分别展示各租户自己的分配；返回第一个租户时恢复对应值，不会泄露缓存数据。

## 范围与限制

验收使用临时 SQLite 数据库、当前 Alembic head、本地 API、Vite 和 Playwright。未修改产品代码。Starlette 发出了已安装 `httpx` TestClient 集成弃用警告，但未影响运行结果。
