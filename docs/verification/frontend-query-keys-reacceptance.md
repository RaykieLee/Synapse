# TanStack Query Key 二次合并后独立复验

- 日期：2026-11-19
- 工作区：`C:/Users/Lenovo/orca/workspaces/synapse-repo/前端技术栈选型`
- 结论：**部分通过（Partial）**。Key 分层、跨 scope 隔离、参数分键和 QueryClient prefix invalidation 均有通过证据；最终 `tsc -b` 与 diff 检查通过。完整 `AuthenticatedLayout`/Sidebar + Workspace route 浏览器 harness 实测 `/workspaces/11` detail GET 为 2 次，因此共享同一 key 仍未满足完整 shell 下的单次请求语义。
- 范围：只读复验 query key factory、此次迁移 call sites 和 Workspace context；本 worker 仅更新本报告，没有修改产品实现或仓库测试。浏览器 harness 与自定义 Vitest config 存在系统 `%TEMP%` 下，不属于仓库文件。
- 工作区状态：开始时已有其他 staged、unstaged 和 untracked 改动。它们保留原状，不归因于本复验；扫描与结论只针对下列指定范围，不表示未扫描目录已迁移或验收。

## 命令、退出码、证据与局限

### 1. Focused query keys、Workspace context、models-page tests

- 工作目录：`apps/web`
- 命令：

  ```powershell
  pnpm exec vitest run src/lib/query-keys.test.ts src/features/workspaces/context.test.tsx src/features/workspaces/models-page.test.tsx --browser.headless
  ```

- 退出码：`0`
- 证据：Vitest `v4.1.4`，3 个 test files passed、28 tests passed。覆盖 query key 分层和 scope 对比、Workspace route 上的 detail cache 行为、models 页面查询消费方。
- 局限：这些测试使用浏览器测试 runner 与 fixture/mock API；不代表真实服务端 API/权限行为。完整 shell 请求次数由下方独立 harness 测量。

### 2. QueryClient prefix invalidation 动态探针

- 工作目录：`apps/web`
- 命令（Node `--experimental-strip-types` 直接导入当前 `query-keys.ts`，创建真实 TanStack `QueryClient`）：

  ```powershell
  pnpm exec node --experimental-strip-types --input-type=module -e "import { QueryClient } from '@tanstack/react-query'; import { queryKeys as q } from './src/lib/query-keys.ts'; const s = { actorId: 'actor-a', tenantId: 'tenant-a', workspaceId: 'workspace-11', membershipVersion: 4 }; const keys = { p1: q.agentscope.query(s, ['chat', 'messages'], { page: 1 }), p2: q.agentscope.query(s, ['chat', 'messages'], { page: 2 }), actor: q.agentscope.query({ ...s, actorId: 'actor-b' }, ['chat', 'messages'], { page: 1 }), tenant: q.agentscope.query({ ...s, tenantId: 'tenant-b' }, ['chat', 'messages'], { page: 1 }), workspace: q.agentscope.query({ ...s, workspaceId: 'workspace-12' }, ['chat', 'messages'], { page: 1 }), version: q.agentscope.query({ ...s, membershipVersion: 5 }, ['chat', 'messages'], { page: 1 }), domain: q.workspace.query(s, ['chat', 'messages'], { page: 1 }), resource: q.agentscope.query(s, ['ops', 'schedules'], { page: 1 }) }; const qc = new QueryClient(); for (const [name, key] of Object.entries(keys)) qc.setQueryData(key, { name }); await qc.invalidateQueries({ queryKey: q.agentscope.resource(s, ['chat', 'messages']) }); const after = Object.fromEntries(Object.entries(keys).map(([name, key]) => [name, qc.getQueryState(key)?.isInvalidated ?? null])); const paramsDistinct = JSON.stringify(keys.p1) !== JSON.stringify(keys.p2); console.log(JSON.stringify({ paramsDistinct, after }, null, 2)); const expected = { p1: true, p2: true, actor: false, tenant: false, workspace: false, version: false, domain: false, resource: false }; if (!paramsDistinct || Object.entries(expected).some(([name, value]) => after[name] !== value)) process.exitCode = 1; await qc.clear();"
  ```

- 退出码：`0`
- 输出证据：`paramsDistinct: true`；失效状态为 `p1=true`、`p2=true`，而 `actor/tenant/workspace/version/domain/resource=false`。这证明同 scope 的不同 params 各自成键，`agentscope/chat/messages` prefix 会失效所有该资源下的 params 变体，不会匹配其他 actor、tenant、workspace、membership version、domain 或 resource。
- 局限：探针针对 AgentScope 前缀并使用 inactive cached queries，只验证 TanStack 的失效标记与 prefix 匹配，不触发网络 refetch，也不替代每个迁移 mutation 的集成测试。global/tenant 前缀结构另由 factory 单测覆盖。

### 3. Full shell / Workspace route detail GET harness

- 工作目录：`apps/web`
- 命令（临时测试与 config 位于 `%TEMP%\synapse-querykeys-harness`）：

  ```powershell
  $harnessRoot = Join-Path $env:TEMP 'synapse-querykeys-harness'; pnpm exec vitest run (Join-Path $harnessRoot 'full-shell.test.tsx') --browser.headless --config (Join-Path $harnessRoot 'vite.config.ts') --root $harnessRoot --silent=false --reporter=verbose
  ```

- 退出码：`0`
- 输出证据：1 个浏览器 test passed，并打印 `FULL_SHELL_WORKSPACE_DETAIL_GETS=2`。Harness 用一个 `QueryClient` 和测试 API stub，真实挂载 `AuthenticatedLayout`（包含 `AppSidebar`）、Workspace route `beforeLoad`/`WorkspaceRouteLayout` 及 route child，计数 `GET /api/v1/workspaces/11`。
- 结果：route loader 获取 detail 一次；Sidebar 使用与 route 同结构的 workspace factory detail key，但 `staleTime: 0` 与 `refetchOnMount: 'always'` 使 shell 挂载后再请求一次。route context 则设 `staleTime: 10_000`、`refetchOnMount: false`。故 key identity 已对齐，但 shell 下无法维持单次 GET。
- 局限：临时 browser harness 使用 stub API、程序化路由和精简 root providers；不调用真实后端、不验证生产环境网络或权限数据，也未保留为仓库回归测试。旧的 route-only `context.test.tsx` 断言 parent/child/layout 共享一次请求（见该测试 `:290-315`），但没有 Sidebar；本 harness 补充了 Sidebar 挂载这一缺口。

### 4. 指定迁移 call sites 的 rg 扫描

- 工作目录：`apps/web`
- 命令：

  ```powershell
  rg -n 'queryKeys\.(global|tenant|workspace)|workspaceDetailQueryKey|membershipVersion|membership_version|invalidateQueries' src/components/layout/app-sidebar.tsx src/features/setup/page.tsx src/features/users/index.tsx src/features/tenants/index.tsx src/features/tenants/roles-page.tsx src/features/tenants/components/member-custom-role-query.ts src/features/tenants/components/member-custom-role.tsx src/features/tenants/components/owner-picker.tsx
  ```

- 退出码：`0`
- 证据：
  - Sidebar workspace detail 与 tenant-navigation 使用 workspace factory；nav key scope 带 membership version，并校验返回的 tenant/version 与当前 context 一致（`app-sidebar.tsx:253-275,295-315,355-357`）。
  - setup、users list 与 owner picker 使用 global factory；用户列表刷新用 global resource prefix（`setup/page.tsx:211`; `users/index.tsx:46,129-130`; `owner-picker.tsx:24`）。
  - Tenant list 用 global factory；tenant detail、members、roles、invitations 使用 tenant factory，成员相关资源从 tenant `membership_version` 取 scope（`tenants/index.tsx:164-174,698-756,780-789`）。角色列表/菜单 editor 也携带 membership version 并按 tenant detail、menus、roles resource prefix 失效（`roles-page.tsx:92-119,347-374`）。custom-role query/mutation 使用 tenant key 并失效成员、角色和 detail 查询（`member-custom-role-query.ts:19-30`; `member-custom-role.tsx:59-83`）。
- 局限：这是显式列出的二次迁移 call sites 扫描，不是对 `apps/web/src` 的全量 query-key 审计。其他目录、未列出的调用点以及未迁移区域均不据此宣称完成。

### 5. TypeScript build-mode check

- 工作目录：`apps/web`
- 命令：`pnpm exec tsc -b --pretty false`
- 退出码与结果：首次执行退出码 `1`，报 `src/lib/i18n/dashboard.ts(1,1): TS6192` 和 `(7,7): TS6133`；稍后在本 worker 未改实现/测试的情况下复跑同一命令，退出码 `0`、无 diagnostics。
- 结论采用最后一次成功复跑；首轮错误发生时工作区正有其他 i18n 文件变动，因此记录为并行编辑期间的瞬时失败，不归因于 query-key 实现。由于该工作区存在并行变更，单次成功只证明复跑时状态通过。

### 6. Git whitespace checks

- 工作目录：repository root
- `git diff --check`：退出码 `0`；无 whitespace error，Git 仅报告若干既存 CRLF→LF 转换提示。
- `git diff --cached --check`：退出码 `0`；无 staged whitespace error。
- 局限：Git diff 检查不覆盖 untracked 文件；验收报告本身在原工作区状态中为 untracked，因此此命令不检查本报告内容。

## Key 层级与隔离结论

`apps/web/src/lib/query-keys.ts:54-95` 的 key 结构为：

```text
synapse → actor → tenant|global → workspace|personal → membership → version|unversioned → domain → resource segments → normalized params
```

`queryScopeKey` 加入 actor 与 tenant/global、workspace/personal；`queryContextKey` 增加 membership/version；后续 helper 再加 domain、resource path 和递归规范化 params。`workspaceQueryScope` 从 Workspace 记录取 tenant、workspace、membership version（缺省版本为 `0`，见 `:105-114`）。global、tenant、workspace、AgentScope 四类 factory 导出于 `:130-135`。

`query-keys.test.ts:15-67` 直接断言层级顺序以及 actor、tenant、workspace、membership version 的 key 不相等；`:82-98` 检查 nested params 规范化、排序、undefined 丢弃和 Date 序列化；`:110-163` 覆盖 global/tenant domain 和 prefix 结构、tenant membership version 隔离。动态探针额外证明 page 1 与 page 2 独立成键且 prefix invalidation 只命中预期分支。

## Permission / membership version 结论

Workspace detail key 含 actor、tenant、workspace 和 membership version。Sidebar 的 tenant-navigation key 从当前 workspace scope 构造；只有响应 tenant 与 membership version 均吻合时才渲染导航（`app-sidebar.tsx:295-357`）。Workspace detail 返回版本与目录版本不一致时，context 会失效该 actor 的 workspace directory prefix（`context.tsx:175-190`）。Tenant member/role/invitation 查询使用 tenant membership version，相关 mutation 按成员、角色、菜单和 tenant detail 资源前缀失效缓存（上述 rg 位置）。因此权限版本变化会落入新 scope，旧响应不会被当作新版本的当前导航。

这部分是 key/caller 走查及 cache isolation 测试证据；没有在本轮执行真实租户权限变更、真实服务端授权或 mutation-to-refetch 集成测试。

## 最终验收边界

- **通过**：key hierarchy、跨 actor/tenant/workspace/membership version 隔离、同 scope 参数分键、QueryClient prefix invalidation 动态匹配、指定 global/tenant/workspace call sites、membership-version 权限隔离走查、最终 tsc 和 diff checks。
- **未通过 / 部分**：完整 shell detail 请求单次语义；浏览器 harness 观察到两次 GET，原因是 Sidebar 的 `refetchOnMount: 'always'`/`staleTime: 0`。
- **未声称完成**：未列出的 query consumers/目录、真实 API 与真实权限行为、全前端迁移。没有运行全项目构建或 health 检查。
