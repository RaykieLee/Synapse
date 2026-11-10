# Workspace 不可访问恢复独立验收

验收日期：2026-11-10  
验收范围：`/w/{workspaceId}` 访问验证失败后的原地状态、恢复操作、最近空间与敏感查询隔离。  
总体结论：**未通过（发现一项缓存隔离缺口；真实服务端授权验收仍受环境限制）**。

## 实现回执与范围

`docs/development-status.md:31` 记录实现任务 `task_f15e8c9a294d` 已完成，并记录模拟响应测试 `31/31`、Vite build 通过以及完整 build 曾被并行设置 TS2554 阻塞。本次独立验收复跑同一组聚焦测试，结果仍为 `31/31`。当前工作区中与本功能对应的修改/新增文件为 `apps/web/src/features/workspaces/context.tsx`、`apps/web/src/routes/_authenticated/w/$workspaceId/route.tsx`、`apps/web/src/features/workspaces/workspace-recovery-messages.ts` 和 `apps/web/src/features/workspaces/context.test.tsx`；`directory.tsx` 同时有其他 Workspace 导航工作区改动，本报告不将其归属到 F15。

验收遵循 `docs/tenancy-contract.md` 的全局账号、TenantMember、WorkspaceMember 分离及服务端授权原则，并按 `docs/tenant-optimization-principles-and-gap-review.md` 第 2、3、7 节核查数据作用域、失败状态、可恢复交互和独立证据。UX 对照为 `docs/ux/architecture-authorization-context.md` 与 `docs/ux/inaccessible-workspace-recovery.md`。

## 聚焦测试

命令（工作目录 `apps/web`）：

```text
pnpm exec vitest run --browser.headless src/features/workspaces/context.test.tsx src/features/workspaces/problem-state.test.ts
```

结果：Vitest `4.1.4`，Chromium headless，2 个 test files 通过、31 个 tests 通过，耗时 `2.67s`。测试替换 `fetch` 返回模拟目录、Workspace 与 Problem 响应；使用模拟 `actor-1`、localStorage、QueryClient 和自建 TanStack memory router，不连接真实 API 或真实登录会话。多数恢复 UI 场景设为 `zh-CN`；另有一例验证英文的 `RESOURCE_NOT_FOUND` 文案。测试文件和设置均未指定 viewport，因此没有小屏/移动端响应式验收；也没有真实键盘导航或屏幕阅读器测试。

本次没有运行 build、全项目健康检查或额外测试。实现台账中的 build 结果是实现方回执，不是本次独立验收证据。

## 检查结果

| 检查项 | 判定 | 证据与局限 |
| --- | --- | --- |
| 保留目标路由并隐藏未验证的私有内容 | 通过（模拟） | Workspace route 已不再注册 `beforeLoad` 重定向；`WorkspaceRouteLayout` 在验证中不渲染 `Outlet`，失败时呈现恢复页。`context.test.tsx:198-283` 对模拟 403/404/409 检查 URL 仍为 `/w/11/private`，并断言私有内容、detail 与受限名称未显示。测试使用自建路由，不是实际应用路由的浏览器深链验收。 |
| 按稳定 Problem code 区分访问撤销、资源不可用、范围停用、上下文冲突与一般拒绝 | 通过（模拟） | `workspace-recovery-messages.ts:59-82` 分别映射 `MEMBERSHIP_INACTIVE`、`WORKSPACE_MEMBERSHIP_REQUIRED`、`RESOURCE_NOT_FOUND`、`TENANT_INACTIVE`、`WORKSPACE_INACTIVE`、`CONTEXT_MISMATCH`/`WORKSPACE_CONTEXT_REQUIRED` 与 `FORBIDDEN`。未知 403/404/409 回退至通用 `requestFailed`。`context.test.tsx:198-210` 覆盖撤权、资源不可用、两个停用状态、一般拒绝、未知 403/404/409 和上下文冲突；`problem-state.test.ts` 另覆盖缺少上下文及 status/code 组合。 |
| 未知拒绝、网络、超时与 5xx 的可恢复状态 | 通过（部分模拟） | 失败页为未知原因仍提供重试和目录入口；`context.test.tsx:285-316` 模拟断网和 503，确认保留 URL、隐藏旧内容且保留最近项。`problem-state.test.ts:19` 覆盖 `REQUEST_TIMEOUT` 的分类，但没有模拟真实超时传输；没有真实服务端 5xx。 |
| 重试、显式目录恢复与不自动切换 | 通过（模拟） | `context.tsx:300-308` 提供“查看可访问空间”和“重试”；`context.tsx:238-260` 仅在用户点击后导航到 `/`。`context.test.tsx:318-359` 验证重试留在原路由且请求方法全为 GET，并验证点击目录入口后才进入模拟的服务端目录。实际工作台 `routes/_authenticated/index.tsx:210-249` 对目录失败提供错误提示与各自重试；本次未对生产路由与其目录错误态做集成浏览器测试。 |
| 401 登录返回路径与不重放写操作 | 通过（模拟） | `context.tsx:130-143` 将 401 交回登录边界，并对 `returnTo` 做站内相对路径限制（`context.tsx:67-71`）；`context.test.tsx:384-395` 验证返回 `/sign-in?redirect=/w/11/private`。重试测试确认此流程只重发 GET 检查。401 与登录态均由 fixture 模拟，未验证实际认证提供方、会话恢复或恶意输入的完整测试矩阵。 |
| 最近 Workspace 清理范围 | 通过（模拟） | 仅已知不可访问稳定 code 进入清理逻辑（`context.tsx:156-162`）；只有最近项 ID 等于当前 route ID 才删除。`context.test.tsx:198-283` 覆盖明确拒绝时匹配项删除、普通拒绝/未知 code 保留；`context.test.tsx:371-382` 覆盖最近项属于另一个 Workspace 时保留。未覆盖多标签页并发 localStorage 更新。 |
| 敏感缓存仅清当前 actor/tenant/Workspace | **未通过：发现条件性清理缺口** | 已知 Workspace 时，`context.tsx:52-65,164-179` 限定 actor、tenant、Workspace，并要求是 scoped query；测试确认其他 tenant、actor 与 Workspace 缓存不变（`context.test.tsx:225-281`）。但清理被包在 `if (targetWorkspace)` 内，而 `targetWorkspace` 只从当前目录或匹配的最近项推导（`context.tsx:86-88,164-169`）。若该拒绝响应到达时两者都没有对应 Workspace 记录，当前 Workspace 的私有缓存即使仍在 QueryClient 中也不会被移除。已运行测试只种入匹配的最近项，未覆盖此分支；这是静态代码路径发现，未通过额外修改测试或产品代码复现。 |
| 双语、隐私文案与辅助技术语义 | 部分通过 | 恢复消息提供中英文版本（`workspace-recovery-messages.ts:21-56`）；测试验证中文状态文案和一个英文资源不可用状态（`context.test.tsx:183-195,361-369`），mock 断言没有原始 detail/受限名称。状态/错误分别使用 `role=status`/`role=alert`，失败后尝试将焦点移至 `h1`，动作使用原生 Button（`context.tsx:262-310`）。没有逐状态英文 UI 测试、实际 Tab/Enter 操作、读屏软件或语言朗读验证；viewport 未设定。 |
| 真实服务端授权撤销 | 环境受限，未验收 | 本次全程使用模拟 API/身份；没有真实后端、已认证生产路由或服务端成员撤销证据。因此不宣称真实权限撤销已通过。 |

## 发现与后续

1. 修复任务应处理 `targetWorkspace` 无法由目录或匹配最近项解析时，明确拒绝后的当前 actor/Workspace 敏感缓存隔离；保持对其他 actor、tenant 和 Workspace 缓存的隔离。之后补一个没有可解析 Workspace 元数据但已存在目标 query cache 的聚焦回归测试，再由独立验证者复验。
2. 本次自动化证据支持路由恢复、已知 code 分类、匹配最近项处理、读 GET 重试、显式导航及基本隐私文案；它只证明模拟行为，不证明后端授权正确或撤销即时生效。
3. 移动端、完整键盘交互、真实屏幕阅读器、逐状态英文和真实 401/网络超时仍需各自补充验证证据。
