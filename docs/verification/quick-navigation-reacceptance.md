# Quick Navigation 修复独立复验

日期：2026-11-18（Asia/Shanghai）
结论：**通过（限聚焦 UI/selector 测试）**。Tenant 路由上下文 pending/error 不显示 Global 标签、旧 Tenant/Workspace 名称或租户菜单；确认的 Global 路由仍显示 Global。指定浏览器测试通过。本结论不证明生产授权。

## 依据

- `docs/tenancy-contract.md`：全局账号、TenantMember、WorkspaceMember 与各自权限作用域分离；UI 菜单不替代服务端授权。
- `docs/ux/command-search-context.md:38-43`、`:49-53`：scope 源自已确认上下文；解析中、错误或授权失效时隐藏旧名称、菜单及受影响 scope 私有候选。
- 原报告 `docs/verification/quick-navigation-acceptance.md:1-4`（2026-11-10）将 Tenant pending 错误显示“全局导航”列为失败；当时 3 文件、28/28 测试通过，但该缺陷使其未通过验收。

## 结果

| 检查项 | 判定 | 证据与边界 |
| --- | --- | --- |
| Tenant pending 无 Global、旧 Tenant/Workspace 标签或租户菜单 | 通过（mock） | `apps/web/src/context/search-provider.test.tsx:331-343` 在 `/tenants/tenant-1` 将 Tenant 查询设为 loading/未成功；断言有“正在确认当前租户…”，无“全局导航”、`Northwind`、`Research Room`、“成员与邀请”。 |
| Tenant error 无 Global、旧上下文或租户菜单 | 通过（mock） | 同文件 `:345-360` 设 Tenant 查询为 error；断言有“当前导航范围暂时无法确认。”，上述 Global/Tenant/Workspace/菜单文本均不出现。 |
| 确认的 Global 路由仍显示 Global | 通过（mock） | 同文件 `:362-368` 在 `/settings` 断言“全局导航”存在。 |
| API mock 保留导出并允许收集 | 通过 | 同文件 `:74-77` 用 `importOriginal` 保留 `@/lib/api` 原始导出，只覆盖 `api`；`apps/web/src/components/layout/data/sidebar-data.test.ts:2` 导入 `ApiProblem`。本轮成功收集并运行，无缺少 named export 错误。 |
| 指定浏览器测试 | 通过 | Vitest 4.1.4：3 个文件通过，33/33 测试通过，退出码 0，11.83s。 |

## 命令与结果

工作目录：`apps/web`。

1. 原样运行任务命令：

   ```text
   pnpm exec vitest run --browser.headless src/context/search-provider.test.tsx src/features/workspaces/directory.quick-navigation.test.tsx src/components/layout/data/sidebar-data.test.ts
   ```

   退出码 1，未收集测试；pnpm 因非交互终端中的 `ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY` 中止 `node_modules` 重建。

2. 设置 CI 环境变量以完成 pnpm 提示的依赖目录重建后重试：

   ```powershell
   $env:CI='true'; pnpm exec vitest run --browser.headless src/context/search-provider.test.tsx src/features/workspaces/directory.quick-navigation.test.tsx src/components/layout/data/sidebar-data.test.ts
   ```

   依赖重建后首次启动仍以退出码 1 结束，错误为找不到 pnpm 链接路径中的 `@jridgewell/sourcemap-codec/index.js`，没有测试结果。

3. 相同 CI 命令再次运行：`Test Files 3 passed (3)`、`Tests 33 passed (33)`、`Duration 11.83s`，退出码 0。此前启动失败已记录；通过结论依据这次成功运行。

## 限制

- Tenant、actor、目录响应和授权状态均为 mock；未访问真实 API、数据库或授权服务，不证明真实隔离或生产授权。
- 负向断言仅覆盖夹具中的 Global、`Northwind`、`Research Room` 和“成员与邀请”，不穷举所有租户菜单文案/本地化内容。
- 未测试读屏器、键盘-only、触屏/真机或生产环境；未运行全量测试或完整构建。
- 本轮未改代码或测试。pnpm 为测试重建 `apps/web/node_modules`，不属于产品源码变更。
