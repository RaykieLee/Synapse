# Workspace 路由查询数据流独立验收（3/8）

- 验收日期：2026-11-19
- 工作树：`C:/Users/Lenovo/orca/workspaces/synapse-repo/前端技术栈选型`
- 范围：`context.tsx`、`context.test.tsx`、Workspace 动态路由及 `docs/development-status.md`；只读走查并新增本报告。
- 结论：**部分通过**。共享查询键、mock 场景的单次详情请求、直接 403/404/409 回退和 TypeScript 检查均有通过证据。跨作用域隔离只有代码结构证据，没有动态隔离断言；回退路径也没有直接断言不可访问空间的数据从未呈现。真实撤权及超过 stale time 后的后台重验未在本轮验收。

## 命令与证据

| 命令（工作目录） | 退出码 | 证据 | 局限 |
| --- | ---: | --- | --- |
| `pnpm exec vitest run src/features/workspaces/context.test.tsx --browser.headless`（`apps/web`） | 0 | Vitest Chromium：1 个测试文件、5 个测试通过。`context.test.tsx:195-216` 验证父路由、子路由和布局共用缓存、详情 GET 恰好一次、详情 key 值和 `X-Workspace-ID`；`context.test.tsx:219-242` 对 403/404/409 验证跳转到 active Workspace；`context.test.tsx:245-253` 验证没有可用 Workspace 时返回 `/`。 | 测试中的 `fetch` 全部由 `installApiFixture()` 替代；fixture 不连接 FastAPI、数据库或真实登录会话。路由树由测试构造，未加载生成的文件路由树。 |
| `pnpm exec tsc -b`（`apps/web`） | 0 | 前端 TypeScript composite build 检查完成。 | 只证明当前类型检查通过，不证明服务端授权、浏览器真实会话或后台重验行为。未运行全项目 build。 |
| `rg -n --glob '*.ts' --glob '*.tsx' 'beforeLoad' apps/web/src/routes/_authenticated/w` | 0 | 找到 17 个 Workspace `beforeLoad`：动态路由父级传入 `context.queryClient`，其余 16 个子路由都调用 `validateWorkspaceRoute(params.workspaceId)`。 | 静态清单；子路由文件没有逐个通过真实文件路由浏览器流程。 |
| `rg -n 'workspaceDetailQueryKey|unresolvedWorkspaceDetailQueryKey|sameWorkspaceDetailScope|findAccessibleFallback|workspaceFallbackDestination|detail.error.message|revalidateIfStale|validateWorkspaceRoute|refetchOnMount' apps/web/src/features/workspaces/context.tsx` | 0 | 定位共享 key、路由校验、回退、布局查询和后台重验代码（见下文）。 | 搜索结果本身不是运行时证明。 |
| `rg -n 'shares one scoped detail request|detailRequests\(.11.\)|workspaceDetailQueryKey\(.actor-1|routes a %i|toBe\(.*/w/12|returns to the workbench|localStorage.getItem|Fixture workspace 12' apps/web/src/features/workspaces/context.test.tsx` | 0 | 确认测试含单次 GET、三个错误状态回退、无可用空间时返回工作台及最近空间更新断言。 | 断言没有逐一比较不同 actor/tenant/workspace 的缓存值，也没有显式断言失败 Workspace 的名称或错误详情不曾呈现。 |
| `rg -n 'def get_workspace|service.get_workspace|def _access|header_workspace_id is None|header_workspace_id.isdecimal|tenant.status != .active.|tenant_member.status|workspace_member.status' apps/api/app/api/workspaces.py apps/api/app/services/workspaces.py` | 0 | API 详情路由将当前用户与 header 传给 `WorkspaceService.get_workspace`；service `_access` 核对 URL/header Workspace ID、tenant active、active TenantMember 和 active WorkspaceMember。 | 静态代码检查；未对真实服务发送撤权请求。 |

## 验收明细

### 1. 父路由、子路由和布局的详情 key 与请求去重

**通过。** `context.tsx:44-58` 的 `workspaceDetailQueryKey` 包含 `actorId`、`tenant_id`、`workspace_id` 和 `membership_version`。父动态路由在 `route.tsx:17-18` 把根 `QueryClient` 传给 `validateWorkspaceRoute`；`context.tsx:66-68` 保存该稳定 client，供不带 router context 的子路由复用。根应用在 `main.tsx` 中将同一 `queryClient` 同时传入 Router context 和 `QueryClientProvider`。

`validateWorkspaceRoute` 在 `context.tsx:285-350` 以同一 key 调用 `ensureQueryData`，并在服务端详情的 tenant/workspace/version 与列表 scope 不一致时迁移缓存到服务端返回的 key。布局在 `context.tsx:155-177` 使用 `directory.actorId` 与当前 Workspace 调用相同的 key helper，以路由 Workspace 作为初始数据，并关闭 mount refetch。focused browser test 用父级传 client、子级不传 client 的路由结构验证了 mock 场景只有一次 `GET /api/v1/workspaces/11`。

### 2. actor、tenant、workspace 与 membership version 缓存隔离

**代码结构通过；动态隔离未覆盖。** 详情 key 四个作用域字段分别处于独立 tuple 元素；未解析详情 key 也包含 actor 与 Workspace ID。Workspace directory key 同样按 actor 区分；最近访问空间的 localStorage key 按 actor 命名。布局还要求当前 actor 与路由返回的 `routeActorId` 一致，才会采用 `initialWorkspace`（`context.tsx:155-170`）。按该 key 结构，不同 actor、tenant、Workspace 或 `membership_version` 会落入不同缓存项。

本次 browser test 只使用 `actor-1`、`tenant-7`、Workspace `11`、version `3`，并断言该单一 key 的具体值；没有以同一 QueryClient 放入两个 actor/tenant/workspace/version 的不同响应并验证互不命中。因此隔离结论来自静态 key 走查，而非跨作用域动态测试。

### 3. 403/404/409 回退与资源泄露

**直接路由校验回退通过；无泄露断言及挂载后错误路径未覆盖。** `context.tsx:352-359` 将 403/404/409 转为回退；`context.tsx:112-128` 清除该 actor 的最近 Workspace，只从该 actor 的非归档 directory 中选 active 项，显示通用提示，并跳转到可访问 Workspace 或 `/`。错误在父路由 `beforeLoad` 中抛出 redirect，不会把失败详情作为成功 route context 交给 Workspace 布局。测试对 403/404/409 都验证目的路由 `/w/12`、目标页面可见、失败和目标详情请求次数各为一次；无可用目标的 403 验证回到 `/`。

测试没有断言 `Fixture workspace 11`、Workspace ID 或服务端错误详情不会出现在页面/提示中。另一个布局错误分支 `context.tsx:262-270` 会直接渲染 `detail.error.message`；若挂载后的后台重验返回 403/404/409，错误 effect 会启动回退，但这条短暂错误呈现路径未被本测试覆盖。租户契约要求 API `detail` 不泄露资源是否存在或其他成员隐私（`docs/tenancy-contract.md:91`），但本轮没有通过真实错误响应验证此约束。

### 4. 服务端授权仍是权限边界

**代码边界确认；真实撤权未验。** `GET /workspaces/{workspace_id}` 依赖当前登录用户并调用 service（`apps/api/app/api/workspaces.py:66-73`）；service 的 `get_workspace` 调用 `_access`，核对 `X-Workspace-ID` 与 URL 一致并读取当前 tenant、TenantMember、WorkspaceMember 状态（`apps/api/app/services/workspaces.py:228-239,453-489`）。契约明确 header 只提示上下文、不授予权限，服务端按当前成员状态和动作权限授权（`docs/tenancy-contract.md:19,47,74`）。因此前端缓存 key 和路由回退属于数据流/导航行为，不授予业务 API 权限。

API fixture 只按预设状态响应，没有真实身份凭据、成员撤销并发、真实数据库或真实服务端授权响应；这一项是静态确认，不构成真实服务验收。

## 局限与未覆盖项

- 所有 HTTP 行为由测试 fixture 模拟；没有真实 actor 登录、跨租户访问、成员撤权或服务端 403/404/409 回归。
- 没有等待详情缓存超过 10 秒 stale time，也没有注入 `revalidateIfStale: true` 的后台请求成功/失败。文档状态已将“真实服务撤权与 stale cache 后台重验”列为待验（`docs/development-status.md:197-202`）。
- 未对同一 QueryClient 中多个 actor、tenant、Workspace、membership version 的 query data 做动态隔离断言；未对错误回退后的旧 Workspace 内容作显式不可见断言。
- Browser fixture 使用内存路由，代码走查覆盖了 17 个文件路由 `beforeLoad` 的统一调用模式，但未逐个执行真实文件路由。
- 本轮只运行指定 focused browser test 和 `tsc -b`，未运行全项目构建或 health 检查。
