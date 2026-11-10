# F44 修复后根工作台独立复验

**复验日期：2026-11-09（Asia/Shanghai）**  
**总 verdict：因环境不足待实际验收。** 部分目录失败修复的聚焦浏览器用例及相关后端上下文检查通过；但 archived-only、Workspace-only 失败、英语浏览器渲染、320/390px、键盘交互和读屏器均缺少本轮运行时证据，不能判为 UX 验收通过。

## 依据与执行证据

- 阅读并遵循 `AGENTS.md`、`docs/tenancy-contract.md`、`docs/tenant-optimization-principles-and-gap-review.md` 第 2、3、7 节、`docs/ux/workspace-home-overview.md`、初验报告 `docs/verification/F44-workspace-home-acceptance.md`，并对照修复 dispatch `ctx_5921a14e74de` 的任务回执/范围记录。
- 前端命令（仓库根目录）：`pnpm --dir apps/web exec vitest run --browser.headless src/routes/_authenticated/-index.test.tsx`；**1 file passed，6 tests passed，exit 0**。Chromium headless。输出含 TanStack Router `AuthenticatedHome` 导出提示，以及两条 `overlapping act()` console error；未导致用例失败。
- 后端命令（`apps/api`）：`.\.venv\Scripts\python.exe -m pytest tests/verification/test_f06_workspace_backend.py -q`；**1 passed**。使用临时 SQLite、生成的测试账号/token、FastAPI TestClient 和测试路由；出现一条 Alembic 弃用警告。
- 后端命令（`apps/api`）：`.\.venv\Scripts\python.exe -m pytest tests/verification/test_f06b_archived_workspace.py -q`；**1 passed**。同样使用临时数据库/测试身份；没有生产凭据或生产数据。
- UI fixture 的模拟身份为 `actor-a`；Tenant/Workspace 查询与导航均为测试 mock，不是登录会话或真实 API。fixture 有 Tenant A 的 active/member Workspace 和 Tenant B 的 archived/admin Workspace。两项后端测试是本地临时数据的真实 FastAPI 路由/上下文依赖检查，不是生产环境验收。
- 修复回执在 `docs/development-status.md` 记载实现者定向测试 6/6 及 build 成功；本复验重新运行并确认 6/6。build 结果只作实现记录，不作为 UX 验收依据，本轮未以 build 替代交互检查。
- 修复任务范围记录仅允许修改 `apps/web/src/routes/_authenticated/index.tsx`、`apps/web/src/routes/_authenticated/-index.test.tsx`、必要时 `apps/web/src/lib/i18n.ts`；当前工作区另有新增 `apps/web/src/features/workspaces/workbench-messages.ts`，属于任务范围外的变更。这里只登记该范围差异，不修改它。

## 逐项复验

| 检查项 | Verdict | 证据、数据/身份范围与局限 |
| --- | --- | --- |
| Tenant 目录失败而 Workspace 目录成功（含 active、archived） | **通过（mock UI）** | 上述 Vitest 命令中 `keeps active and archived workspace results when tenant loading fails` 断言两个 Workspace 状态区、`Active Workspace` 与 `Archived Workspace` 卡片都可见；fixture 属于 `actor-a`，仅模拟目录结果。见 `apps/web/src/routes/_authenticated/-index.test.tsx:208`。 |
| 不把成功 Workspace 目录当成已确认 Tenant 目录 | **通过（mock UI）** | 同一用例断言“租户名称暂不可用”可见，旧 Tenant ID 标签不显示，且不显示“当前账号没有可访问的 Workspace”。错误说明明示失败目录不代表权限或无 Workspace。没有真实 Tenant 目录响应可用于确认实际服务数据映射。见 `apps/web/src/routes/_authenticated/-index.test.tsx:208`。 |
| 部分失败错误仍可见、重试范围准确 | **通过（Tenant 失败路径）** | 用例断言 alert、租户目录失败文案及“重试租户目录”可见，“重试 Workspace 目录”不可见；点击后仅断言 Tenant query 的 `refetch` 调用一次。Workspace query 成功，所以该重试目标与模拟故障一致。Workspace-only 失败的对称重试路径没有独立浏览器用例，列为待验。见 `apps/web/src/routes/_authenticated/-index.test.tsx:208`。 |
| 部分失败时隐藏最近继续 | **通过（mock UI）** | 将最近 Workspace 预置为当前 active fixture 后，部分失败用例断言“继续上次访问的 Workspace”不存在；来源是测试内存值，不是验证 localStorage 篡改或撤权竞争。见 `apps/web/src/routes/_authenticated/-index.test.tsx:208`。 |
| 显式进入，不自动导航 | **通过（mock UI）** | 正常目录用例停留在工作台并断言未调用导航；点击“进入 Workspace”后才记录最近项并导航到 `/w/workspace-active`。该导航由 mock 捕获，不是浏览器中的真实受保护路由访问。见 `apps/web/src/routes/_authenticated/-index.test.tsx:141`、`:154`、`:174`。 |
| `/w/{id}` 的授权边界不依赖缓存/本地 ID | **通过（代码与 API 依赖检查；端到端待验）** | `apps/web/src/features/workspaces/context.tsx:154` 的 `validateWorkspaceRoute` 对目标 ID 调用 `getWorkspace`；`apps/web/src/api/workspaces.ts:104` 将其请求发送到 `/workspaces/{id}` 并带同 ID 的 `X-Workspace-ID`。动态 `/w/$workspaceId` 路由的 `beforeLoad` 调用该校验。F06 后端 TestClient 检查服务端上下文、Tenant/Workspace 成员和上下文错误；F06b 检查 archived Workspace 即使 owner 也会以 `409 WORKSPACE_INACTIVE` 被拒作业务上下文。测试使用临时数据库和生成身份，测试路由验证共享上下文依赖，不是 UI 导航到真实 `/w/{id}` 的端到端测试；本结论不把最近项或客户端目录视为授权。 |
| 正常目录、空目录、最近项及失败/空态区分 | **通过（mock UI，已覆盖组合）** | 六项测试覆盖正常 Tenant/Workspace fixture、成功空 Workspace 列表、Tenant 失败且 Workspace 列表空时不误报空态、最近项存在/不在当前目录时的显示差异。所有查询仍为测试 mock。见 `apps/web/src/routes/_authenticated/-index.test.tsx:141`、`:190`、`:197`、`:258`。 |
| archived-only 目录、Workspace-only 失败及其重试 | **待验** | 当前聚焦 suite 没有 archived-only fixture，也没有 Tenant 成功而 Workspace 目录失败的独立运行时用例。F06b 的 API 归档列表/上下文行为不是这两个根工作台 UI 状态的替代证据。 |
| 中文/英文可访问名称与状态信息 | **中文部分通过；英文待验** | 中文 Vitest 断言通过工作台、状态分组、进入链接名称及错误文案；`workbench-messages.ts` 存在四条英文错误/fallback 映射，但本轮没有切换英语 locale 渲染验证名称、回退和状态消息。 |
| aria 标签静态检查 | **通过（静态检查）** | 检查 `apps/web/src/routes/_authenticated/index.tsx` 未发现硬编码 `aria-label`；当前以可见文本、`aria-labelledby`（分组/最近项）、`role=alert` 和加载态 `aria-live=polite` 提供语义。静态 DOM/代码检查不能证明浏览器辅助技术实际播报正确。 |
| 320px/390px、键盘导航、读屏器 | **待验** | 本轮 Vitest headless 命令未指定或断言 320px/390px viewport，也未执行 Tab/Enter 键盘流程；没有可用于此页面的人工登录浏览器会话。屏幕阅读器不在当前运行环境中，未测试。 |

## 最终判断

局部回归目标——Tenant 目录失败时保留成功 Workspace、明确显示未知 Tenant 名称、保留精确失败提示/重试、隐藏最近继续，并保持显式点击进入——由 mock UI 聚焦测试覆盖且通过。后端上下文依赖测试也支持“客户端路径/头部和本地最近项不授予访问权限”的边界，但 UI 导航本身未接真实服务端。依据 UX 与验收规则，缺少 Workspace-only 失败、archived-only、英语运行时、窄屏/键盘及读屏证据，故整体结论为 **因环境不足待实际验收**，不是 build-only 通过，也不是生产验收。
