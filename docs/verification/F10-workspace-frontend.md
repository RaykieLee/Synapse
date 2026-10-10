# F10 Workspace 前端验收

**结果：** 实现开发者修复一个早期构建阻断后，验收通过。测试使用一次性 SQLite 数据库、真实 FastAPI API、Vite 开发服务器和无头 Playwright Chromium。

## 复现

运行器为 [run_f10_workspace_frontend.py](../../apps/api/tests/verification/run_f10_workspace_frontend.py)；浏览器流程为 [f10_workspace_frontend.mjs](../../apps/api/tests/verification/f10_workspace_frontend.mjs)。

```sh
cd Synapse/apps/api
.venv/bin/python tests/verification/run_f10_workspace_frontend.py
```

运行器先执行 `pnpm build`，创建临时 SQLite 数据库并迁移至当前 Alembic head，填充三个租户及多个账户/workspaces，在空闲本地端口启动 uvicorn 和 Vite，然后通过 Chromium 驱动真实 UI。运行结束会停止 API 和 Vite 进程树并丢弃数据库。

## 构建记录

首次构建在 `apps/web/src/features/workspaces/directory.tsx:85` 出现两个 TS18047 错误（`recent` 可能为 null）。实现开发者添加了显式 null 检查。之后的 `pnpm build` 均通过，最终完整运行器也成功。

最终结果：`F10 workspace frontend verification passed`（运行器退出码 0）。完整命令也成功完成 production `tsc -b && vite build`、临时数据库迁移以及 Vite/Playwright 浏览器流程。本验收者未修改产品代码。

2026-10-11 回归：Workspace API 集中到 `apps/web/src/api/workspaces.ts`、后端迁移到 `WorkspaceService` 后复验通过。本地 SQLite 后端套件 `23 passed`、`pnpm build` 通过、定向 ESLint 无错误，真实浏览器运行器再次输出 `F10 workspace frontend verification passed`。本次运行按测试环境设置关闭 AgentScope 与 scheduler，只验证 Workspace 管理链路。

## 浏览器中已验证

- 左上角 Workspace 切换器按租户分组空间，可搜索 workspace 名称，并可在 Alpha 与 Beta 租户间导航。
- Tenant admin 可从切换器创建 Workspace；创建者进入新空间后成为 owner。
- 成员管理可将已有 active tenant member 加入新 Workspace。向该成员转移 owner 成功；API 回读确认新 owner 和原 owner（现为 admin）。
- 可通过设置页归档并恢复新 Workspace。
- 直接导航到其他租户中无权访问的 Workspace 会被拒绝，并重定向到可访问的 Workspace。
- 不同租户中属于同一账户的空间，其成员列表展示对应租户的 owner，不会显示另一租户的 owner。此项通过切换路由后渲染真实、互相隔离的 API 数据进行验证。
- 导航至 Alpha，使其 ID 成为 actor 最近访问的 Workspace 后，Alpha tenant owner 通过真实 API 移除 actor 的租户成员身份。actor 直接重访时回退至 Beta，最近访问的 Workspace 也不再指向已撤权的 Alpha。此项覆盖成员撤权后的恢复路径。

## 范围与限制

为构造真实多租户关系图，tenant/workspace memberships 和账户直接写入临时数据库。待测的 Workspace 创建、成员管理、owner 转移、归档和租户成员移除均通过 UI/浏览器调用真实 API。此项验证本地 Vite 环境下的 Chromium，不覆盖其他浏览器或生产托管。后端 Workspace 契约和归档列表访问分别见 F06 与 F06b 报告。
