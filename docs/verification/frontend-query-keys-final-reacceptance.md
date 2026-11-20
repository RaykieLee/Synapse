# Workspace Detail 单次 GET 修复独立复验

- 复验日期：2026-11-19
- 结论：**PASS（限本次 Workspace detail/query-key 范围）**。Sidebar 与 Workspace route context 共享同一 detail key 和 observer stale/refetch 配置；真实 `AuthenticatedLayout` 壳层下的父/子 route、layout 与 sidebar 首屏只发出一次模拟 detail GET。scope 隔离、错误回退及前缀失效证据通过。
- 本轮只新增本报告；未修改产品实现或测试。

## 实现核对

- `apps/web/src/features/workspaces/context.tsx:30-50` 将 stale 时间固定为 10 秒，并通过 `workspaceDetailQueryKey` 调用 workspace key factory。该 key 包含 actor、tenant、workspace、membership version，以及 `workspace/workspace-detail` domain/resource 段；缺省 membership version 归一到 `0`（`apps/web/src/lib/query-keys.ts:105-114`）。
- `apps/web/src/components/layout/app-sidebar.tsx:243-274` 和 `apps/web/src/features/workspaces/context.tsx:147-166` 均使用 `workspaceDetailQueryKey`、`WORKSPACE_QUERY_STALE_TIME` 和 `refetchOnMount: false`。两者从同一 actor-scoped `useWorkspaceDirectory(true)` 解析 workspace scope；route layout 优先使用 actor 匹配的 route context。两处 observer 还继承同一 root `QueryClient` 默认项（`apps/web/src/main.tsx:20-36`）。
- 父 route 的 `validateWorkspaceRoute` 以同一 detail key、10 秒 `staleTime` 和 `revalidateIfStale: true` 调用 `ensureQueryData`；它不设置 mount-always refetch，并对 loader fetch 显式关闭 retry（`apps/web/src/features/workspaces/context.tsx:273-322`）。workspace directory key 也与 `useWorkspaceDirectory(true)` 的 key 参数一致（`apps/web/src/features/workspaces/context.tsx:32-38`; `apps/web/src/features/workspaces/directory.tsx:67-88`）。若返回 detail 的 scope/version 与目录不同，route validator 将数据移入服务端 detail scope key 再清理旧 key（`context.tsx:324-337`）。
- Sidebar 中仍设 `staleTime: 0` / `refetchOnMount: 'always'` 的是独立 tenant-navigation query，不是 workspace detail query（`apps/web/src/components/layout/app-sidebar.tsx:292-315`）；本轮首屏计数证明它不会额外触发 detail GET。

## 验证证据

- `apps/web/src/features/workspaces/context.test.tsx:213-267` 用一个 `QueryClient` 和父/子 route harness，并在 full-shell 分支挂载实际 `AuthenticatedLayout`（包含 `AppSidebar`）。测试 `:315-352` 等待 child context 与 sidebar visible-tree 请求稳定后，断言 `/api/v1/workspaces/11` 的 detail GET 恰为 1 次、detail cache 使用预期 actor/tenant/workspace/membership key，且请求带正确的 `X-Workspace-ID`。
- scope 隔离：`context.test.tsx:354-523` 使用同一 workspace ID 变更 actor、tenant 和 membership version，并另换 workspace；测试确认五个 detail key 唯一、缓存各自返回对应 workspace，模拟请求 scope 也逐项匹配。`apps/web/src/lib/query-keys.test.ts:35-80` 另覆盖 key 层级及 actor、tenant、workspace、membership 的差异。
- 错误回退：`context.test.tsx:525-575` 覆盖 403/404/409 到可访问 active workspace 的回退，并检查私有 workspace 名称/ID 和服务端错误标题/详情未泄露到页面、toast；`:577-649` 检查后台 403 期间先隐藏旧详情、等待回退后切换；`:651-659` 检查无 active accessible workspace 时返回工作台。
- QueryClient 前缀探针：从当前 `src/lib/query-keys.ts` 经 Vite SSR 加载真实 `queryKeys` factory，建立真实 TanStack `QueryClient` 缓存后以 `queryKeys.scope({ actorId: 'actor-1', tenantId: 'tenant-7', workspaceId: '11' })` 执行 `invalidateQueries`。membership version 3 和 4 的该 scope detail 均失效；其他 actor、tenant、workspace 的 detail 均未失效。`models-page.test.tsx:539-557` 另以 workspace scope prefix 验证 membership 变更后只读权限 UI 与敏感编辑表单状态。
- 命令 `pnpm exec vitest run src/features/workspaces/context.test.tsx src/lib/query-keys.test.ts src/features/workspaces/models-page.test.tsx --browser.headless`：退出码 0，3 个 test files、28 个 tests 全部通过。
- 命令 `pnpm exec tsc -b --pretty false`：退出码 0，无 diagnostics。
- `git diff --check` 与 `git diff --cached --check`：均退出码 0，无 whitespace error；Git 对若干既有工作区文件提示 CRLF→LF 转换。两项 Git diff 检查不包含 untracked 报告，报告自身另由 `git diff --no-index --check` 检查。

## 限制

- 请求计数、scope 与回退均在测试 fetch fixture 中验证，没有调用真实 API，也没有验证服务端 tenant/workspace/member 授权、成员撤销后的真实响应或真实权限变更。服务端授权仍是权限边界的权威来源。
- 测试 QueryClient 使用 10 秒 stale 配置，但本轮没有等待真实数据变 stale 后进行线上网络重验；真实生产 API、window-focus 和撤权时序仍待实际环境验收。
- 本轮只复验 Workspace detail/query-key 链路，没有对 `apps/web/src` 其余 feature 目录做全量 query-key 迁移审计。`docs/development-status.md:218-222` 明确记录 QueryKeys 迁移未覆盖其他 feature 目录；这些未迁移或未列入本轮的目录仍属限制，本报告不据此宣称全前端查询键迁移完成。
- 本轮执行 focused tests、TypeScript build-mode 检查与 diff whitespace 检查；未运行全项目 build、全量测试或健康检查。
