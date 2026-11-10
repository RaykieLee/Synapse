# F44 第一阶段稳定根工作台独立验收

**结论：未通过，待修复及补验。** 根路由已具备稳定工作台和显式导航的基本行为；聚焦 UI 测试与归档 API 验收通过。发现目录部分失败时成功目录未总能保留的实现缺口，且多项指定状态、实际窄屏、键盘/读屏和英语浏览器场景没有运行时证据，因此不能将 F44 标记完成。

## 验收基线与执行环境

- 验收依据：`AGENTS.md`、`docs/tenancy-contract.md`、`docs/ux/workspace-home-overview.md`、`docs/development-status.md` 的 F44 条目及实现回执 `ctx_579c7e7adf77`。
- 前端命令：在 `apps/web` 执行 `pnpm exec vitest run --browser.headless src/routes/_authenticated/-index.test.tsx src/features/workspaces/problem-state.test.ts`；结果 **2 个文件、18 项通过**，Chromium headless。输出有 TanStack Router route export 提示及两条 `overlapping act()` 控制台错误；Vitest 退出码为 0。
- UI 测试身份/作用域：全为测试内 mock actor `actor-a`；目录是内存 fixture，包含 Tenant A/member 下的一个 active workspace 和 Tenant B/admin 下的一个 archived workspace。不是登录会话，也没有调用真实 API。
- 后端命令：在 `apps/api` 执行 `.venv\Scripts\python.exe -m pytest tests/verification/test_f06b_archived_workspace.py -q`；结果 **1 passed**。使用真实 FastAPI routes/TestClient、临时 SQLite/migrations 和测试 token，不访问生产数据库；测试同时创建不同 tenant、owner/admin/member/viewer/platform actor。出现一个现有 Alembic `path_separator` 弃用警告。
- 浏览器尺寸：Vitest browser 配置只指定 Chromium，没有为本轮测试设置 320px 或 390px viewport。两种尺寸均未验收；没有独立访问已登录运行实例。

## 逐项结果

| 检查项 | 结果 | 证据与范围 |
| --- | --- | --- |
| 登录后根路由稳定，不自动进入最近/首个/唯一 Workspace | 部分通过 | mock UI 用例断言有两个 Workspace 且无最近项时停留在“工作台”、`navigate` 未调用。源码 `apps/web/src/routes/_authenticated/index.tsx` 只有 `openWorkspace` 显式点击处理调用导航；最近项仅用于工作台按钮。最近/首个/唯一三种实际目录组合未分别运行，不是服务端登录端到端证据。 |
| Tenant 分组、active/archived、名称、slug、状态、角色 | 部分通过 | mock 两 Tenant 用例检查两个 Tenant 分组、active/archived 标题；源码卡片渲染空间名、slug、状态及 Workspace role。没有专门断言每字段可见、同 Tenant 多空间、同名空间或未加入空间行为。 |
| 显式进入及“继续”只对当前目录项提供入口 | 部分通过 | mock 点击 active link 后验证保存 actor 最近项并导航到 `/w/workspace-active`；另一用例验证 recent ID 不在当前 mock 目录时不展示“继续”。前端目录先从服务端 `GET /tenants` 与 `GET /workspaces?include_archived=true` 获取并按 actor 缓存，最近项只作提示；未模拟伪造/损坏 localStorage 对象或服务端实时撤权竞争。 |
| 加载中、租户目录失败、Workspace 目录失败、独立重试 | 部分通过/待修复 | 源码提供 `aria-busy`、`aria-live="polite"` 加载态和按失败目录显示的重试按钮；现有 UI 用例只注入 tenantQuery 错误并验证 alert、非空态及重试 tenant refetch。没有独立执行 Workspace query 错误、加载中、重试后恢复或两 query 组合测试。并且 UX 契约要求部分失败时保留成功目录：当 tenant query 失败而 workspace query 成功时，`directory.tsx` 无 Tenant 映射可用；根页错误分支中的 `WorkspaceSection` 会因缺 Tenant 名而丢弃卡片，只剩错误/“暂无此状态”内容，未满足“成功目录保留”。 |
| 空目录 | 部分通过 | mock UI 用例将 workspace 列表置空，验证显示“当前账号没有可访问的 Workspace”，且没有目录错误文案。没有真实 API 空目录浏览器场景。 |
| 仅归档目录、归档项不自动进入 | 部分通过 | UI 源码将归档项分区并提示不会自动进入；导航仅发生于明确点按。真实 API 测试验证仅 owner/admin 可列出自己仍有成员关系的 archived workspace；member/viewer 和非成员 platform admin 不因 `include_archived=true` 获得归档项。没有“仅归档”的 UI fixture，也未在浏览器点按归档项。 |
| 多租户/多空间及真实授权目录 | 部分通过 | UI mock 展示两个 Tenant，但每 Tenant 只有一个 Workspace。后端临时 SQLite 验证 workspace 查询同时要求 active WorkspaceMember、TenantMember 和 Tenant，并隔离不同租户；`include_archived=true` 只向 active workspace owner/admin 返回已授权归档项，platform admin 非成员返回空。多租户 UI 和全角色 UI 没有绑定同一真实 API 会话。 |
| 最近项失效不扩权 | 部分通过 | UI mock 只将 recent workspace ID 替换为目录中不存在的 ID，确认不显示继续入口；后端 F06b 验证 API 仅按真实成员目录返回工作区。没有跨 actor 复用缓存、同 ID 伪造属性或撤权后的真实浏览器请求测试。 |
| 320px/390px 移动布局与触控 | 未验收 | 本轮没有设置指定 viewport 或触控设备。代码使用单列卡片、窄屏纵向布局和 `min-h-11`（44 CSS px）按钮，是静态样式证据，不代表实际尺寸、溢出或触控验证。 |
| 键盘与屏幕阅读器 | 部分通过/未验收 | 源码使用语义 `main/header/section/article`、层级标题、原生 Link/Button、`role="alert"`、加载 `aria-live`，进入按钮目标高度为 44px。没有键盘 Tab/Enter/Escape 顺序、焦点可见性、NVDA/VoiceOver 等实际读屏或自动化 a11y 扫描记录。 |
| 中文/英文 | 部分通过/未验收 | `apps/web/src/lib/i18n.ts` 有工作台、状态、角色、目录失败/重试和空态英文词条；但本轮没有切换 locale 并渲染浏览器。错误态 `aria-label="已加载的租户目录"` 是未本地化的硬编码中文（`index.tsx`），英语读屏状态可能仍读中文。 |
| 概览 API、真实指标及真实权限矩阵 | 未实现/明确排除 | 依据 UX/API 设计和 `development-status.md` F44：当前没有 Workspace overview 聚合 API，也无批准的真实指标清单；本阶段不得渲染模板数值或将缺失/失败伪装为 0。现有 Tenant/Workspace 目录不是 overview API。F06b 的真实临时 DB 覆盖归档列表授权，但不等于完整后端权限矩阵或生产验收。 |

## 真实接口与模拟边界

- 前端 `useWorkspaceDirectory(true)` 分别请求租户目录和 Workspace 目录；`loadAllPages` 以 page size 100 继续分页，Workspace 查询带 `include_archived=true`。UI 聚焦测试 mock 这两份数据及 actor，证明组件分支而非 HTTP/服务端集成。
- 归档 Workspace API 验收是真实 FastAPI 服务逻辑及临时 SQLite 数据，不是 mock；其证据见 `docs/verification/F06b-archived-workspace.md`。它覆盖列表授权、租户隔离、归档角色过滤及归档工作区被业务上下文拒绝，不覆盖生产数据库并发或当前根工作台浏览器集成。
- 本轮没有 overview 请求/统计值；不把目录 `total`、列表长度或 mock fixtures 当成业务指标。

## 待修复与复验

1. 修复或明确设计“Tenant 目录失败、Workspace 目录成功”的部分失败呈现：保留成功目录可用信息，不把缺少 Tenant 映射误报为“暂无此状态”；错误范围与重试仍须清晰，不能用未确认目录项作为进入/继续授权依据。
2. 对 Workspace 目录失败（含先前缓存数据）、Tenant 目录失败、双目录失败、各自独立重试成功增加行为验证，检查失败时不会显示误导性空列表或未确认入口。
3. 补验最近/首个/唯一目录、仅归档、同 Tenant 多 Workspace、Tenant member 未加入 Workspace、无空间和 multi-tenant 真实浏览器场景；保留 actor 与服务端作用域证据。
4. 使用真实 320px、390px 浏览器 viewport 验证布局/滚动/目标尺寸；实际键盘遍历及屏幕阅读器验证；切换中文/英文并检查可见文案与 accessible name。修复英语错误态的中文 `aria-label` 后复验。
5. Overview API、真实指标定义及真实后端完整角色/错误权限矩阵仍为单独待规划和验收范围；不应由本阶段根工作台验收推断完成。

本报告只记录验收，不修改产品实现。除本报告外，工作区原有未提交改动保持不动。
