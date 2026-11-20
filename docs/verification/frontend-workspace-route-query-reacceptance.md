# Workspace 路由查询独立复验

- 日期：2026-11-19（Asia/Shanghai）
- 验收范围：`apps/web/src/features/workspaces/context.tsx`、`apps/web/src/features/workspaces/context.test.tsx`、`apps/web/src/routes/_authenticated/w/$workspaceId/route.tsx`
- 复验基线：Git `HEAD` 为 `5fe7dc7`；开始时工作树已有未提交改动。本报告针对当时的当前工作树，不代表该提交单独包含这些改动。
- 总结：指定的前端查询、隔离、错误回退、受控后台重验和静态检查均通过；真实服务端撤权及自然 stale 过期重验仍未验收。

## 验收证据

### 1. 父路由、子路由与布局共用一次详情 GET — 通过

- `apps/web/src/features/workspaces/context.test.tsx:290-315` 用 TanStack memory router 组合父路由 `beforeLoad`、不传 QueryClient 的子路由 `beforeLoad`、`WorkspaceRouteLayout`，并断言进入 Workspace `11` 只产生一次 `GET /api/v1/workspaces/11`。
- 同一测试断言缓存落在 actor `actor-1`、tenant `tenant-7`、Workspace `11`、`membership_version=3` 的详情 key，并确认 `X-Workspace-ID: 11` 和缓存详情值。
- 实际文件路由 `apps/web/src/routes/_authenticated/w/$workspaceId/route.tsx:7-20` 将父路由 `context.queryClient` 交给 `validateWorkspaceRoute`，再将返回的 actor 与 Workspace 传给布局；`apps/web/src/features/workspaces/context.tsx:58-60,284-286` 为不带 router context 的子路由复用同一根 QueryClient。
- 限制：浏览器测试按真实调用顺序建立 memory route harness，没有直接实例化应用生成的文件路由树；实际父路由文件已作静态核对。

### 2. actor、tenant、workspace、membership version 缓存隔离 — 通过

- `apps/web/src/features/workspaces/context.tsx:40-50` 的详情 key 使用 `queryKeys.workspaceScope(actorId, workspace)`；`apps/web/src/lib/query-keys.ts:54-69,105-114` 将 actor、tenant、workspace、membership version 分别纳入 key。
- `apps/web/src/features/workspaces/context.test.tsx:317-486` 在同一 QueryClient 中动态切换 actor、tenant、Workspace ID 和 membership version，构造并核对 5 个作用域组合；每次均核对渲染详情及对应缓存数据，并断言 5 个序列化 key 唯一、请求作用域与预期一致。
- 覆盖的区分包括：同 Workspace 的不同 actor、同 actor/Workspace 的不同 tenant、不同 Workspace，以及相同 Workspace 的 version 1 与 version 2。

### 3. 403/404/409 隐私安全回退 — 通过（mocked API）

- `apps/web/src/features/workspaces/context.test.tsx:488-538` 对 403、404、409 分别执行失败详情请求，断言回退到 actor 可访问的 active Workspace `/w/12`；失败详情及 fallback 详情各请求一次。
- 每种状态均断言显示通用 toast，页面与 toast 均不包含失败 Workspace 名称、ID、模拟服务端标题或详情，并断言最近访问 Workspace 被替换为可访问目标。
- `apps/web/src/features/workspaces/context.test.tsx:614-620` 另验证没有 active fallback 时返回工作台 `/`。实现中的候选目标来自当前 actor 的非归档 Workspace 目录，且仅选择 `active` 项（`apps/web/src/features/workspaces/context.tsx:83-116`）；路由校验仅对 403/404/409 执行该回退（`apps/web/src/features/workspaces/context.tsx:340-347`）。

### 4. 受控后台 403 重验 — 通过（mocked API）

- `apps/web/src/features/workspaces/context.test.tsx:540-612` 先挂载可访问的缓存详情，再通过精确 key 的 `invalidateQueries` 触发活动详情查询重验；将 fallback 目录请求暂停以观察回退完成前的页面状态。
- 暂停期间断言仍在原路由，仅显示通用“当前空间不可访问，正在切换…”提示；页面不显示旧 Workspace 名称、ID、模拟服务端标题/详情，也未提前发 toast。
- 释放 fallback 后断言进入 `/w/12`，失败 Workspace 共 2 次详情 GET（初始加后台重验）、目标 Workspace 1 次详情 GET，最终 toast 仍为通用提示且不泄露上述内容。
- 布局错误分支按状态展示通用提示而不渲染 `ApiProblem` 文本（`apps/web/src/features/workspaces/context.tsx:247-257`）；fallback effect 使用 ref 防止同一错误重复启动回退（`apps/web/src/features/workspaces/context.tsx:149,193-208`）。

### 5. TypeScript 与 diff 检查 — 通过

- 在 `apps/web` 运行 `pnpm exec vitest run --browser.headless src/features/workspaces/context.test.tsx`：1 个测试文件通过，7 个测试通过，退出码 0。
- 在 `apps/web` 运行 `pnpm exec tsc -b --pretty false`：退出码 0，无诊断输出。
- 对本验收涉及的实现、测试、父路由与既有验收报告分别运行 `git diff --check` 及 `git diff --cached --check`：两项均退出码 0，无空白错误。

## 限制与待验收

- 所有 API 响应均由测试中的 `fetch` fixture 模拟；没有真实登录凭据、服务端授权、成员撤销并发、数据库或真实 403/404/409 响应证据。前端隐私断言不等于服务端错误体已通过租户契约验收。
- 后台失败测试通过 `invalidateQueries` 显式触发活动 query 重验；没有等待 `10_000ms` stale time 到期来验证自然的 `revalidateIfStale` 流程（实现配置见 `apps/web/src/features/workspaces/context.tsx:30,316-321`）。
- 仅运行指定 browser 测试、TypeScript build-mode 检查及相关 diff 检查；没有运行全套前端测试、Vite 生产构建或全应用端到端测试。
- 本任务为只读复验；未修改产品实现、测试或 `docs/development-status.md`。除本报告外，不对开始时已有的工作树改动作归属判断。
