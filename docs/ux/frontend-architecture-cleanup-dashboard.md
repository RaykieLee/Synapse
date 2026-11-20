# Dashboard 模板清理 UX 独立审查

状态：只读审查；未修改产品实现。

审查对象：`C:/Users/Lenovo/orca/workspaces/synapse-repo/synapse-arch-cleanup`，基线 `5fe7dc7` 上的未提交 Dashboard diff，以及相关 i18n、卡片、Tabs、路由和导航代码。审查日期：2026-11-19。

## 结论

组件层面的模板清理方向符合目标：Recent Sales 样例已删除，随机图表和虚构流量指标已换成空态，下载按钮与 Reports、Notifications 模板 Tab 已移除；剩余内容使用 Workspace、成员、智能体、任务等中性领域词，并以破折号代替虚构数值。新增静态文案统一经过 `LocalizedText`，对应简体中文词条也已加入。

总体结论：**组件级清理部分通过；空态语义和无障碍语义修正前，不做最终 UX 签收。**另外，此 Dashboard 组件没有接入当前应用的正式路由；按现有文档要求，Dashboard 模板入口已从正式导航移除，因此本次结论限于组件级审查，不代表用户可访问的产品页面已通过验收。

## 分项审查

| 项目 | 结论 | 证据与说明 |
| --- | --- | --- |
| 信息架构 | 通过组件级模板清理 | `apps/web/src/features/dashboard/index.tsx:26-39` 只保留 Overview、Analytics 两个 Tab，没有 Download 按钮或 Reports、Notifications Tab。Recent Sales 组件已删除；`analytics-chart.tsx` 和 `overview.tsx` 不再生成随机数据。Analytics 虽保留为空态占位页，但已改成 Workspace analytics、Activity、Members、Resources、Tasks、Data sources、Resource categories 等中性词，没有旧销售、流量来源或设备假业务内容。若 Analytics 没有后续产品用途，建议等真实能力确定后再决定是否保留这个空白 Tab。 |
| 空态与加载态 | 部分通过 | 各指标用 `—`，Overview、Activity、Analytics 明确显示无数据文案，没有继续伪造 KPI；证据见 `dashboard/index.tsx:41-55`、`components/overview.tsx:5-9`、`components/workspace-activity.tsx:5-9` 和 `components/analytics.tsx:37-59`。但指标文案 `Awaiting workspace data` 可能被理解为请求正在加载；“Connect ... data” 又像是可执行连接动作，而界面没有对应入口。当前是未接入数据的静态占位，应直接说明“数据尚未接入/尚未连通”，避免让用户将其理解成 0 条业务记录、加载中或一个找不到的连接入口。 |
| 中英双语 | 代码路径具备，中文渲染未独立验证 | 新文案均由 `LocalizedText` 渲染；`apps/web/src/lib/i18n.ts:227-244` 有对应英译中词条，英文 locale 保留英文源文案。当前 `index.test.tsx:13-39` 只切到英文并验证英文内容，未覆盖中文切换或中文文案断言。 |
| 权限提示 | 当前未实现，真实接入前必须补齐 | `DashboardEmptyState` 只接收标题、说明并始终渲染同一种状态（`components/empty-state.tsx:4-27`）；Dashboard 没有数据请求、加载/错误/403 分支，所以当前不能区分无权限、尚未接入和 200 空结果。鉴于当前组件未接入数据，这属于未验证项，不应通过臆造权限空态来补齐；连接真实 Workspace API 前，必须按 `docs/tenancy-contract.md` 第 3、4 节将服务端 403/404 与合法空结果分开呈现，且权限判断不能依赖导航可见性。 |
| 移动端 | CSS 结构可预期，未做 390px 渲染 | 390px 小于 `sm` 断点，Overview 与 Analytics 的指标网格会按单列排列；下方内容在 `lg` 前也是单列，横向滚动容器只包住两个 Tab。未见图表固定宽度或会撑开页面的模板数据。空态仍有 `300–350px` 最小高度，窄屏会形成较长的纵向空白；建议给小屏降低最小高度。 |
| 可访问性 | 部分通过，有两项必须修正 | 页面有 `<main>` 和 `<h1>`，Tab 使用 Radix 语义，触发器有可见焦点样式；装饰图标设为 `aria-hidden`，空态带 `role="status"`。但可见卡片标题使用 `CardTitle`，其实现是普通 `div`（`components/ui/card.tsx:30-37`），页面除 `<h1>` 外没有可供标题导航的层级；另 `Dashboard` 声明 `orientation='vertical'`（`dashboard/index.tsx:29-38`），实际 TabList 是 `inline-flex` 横向布局（`components/ui/tabs.tsx:18-29`），语义方向与视觉方向不一致。颜色 token 静态计算：空态小字 `text-muted-foreground` 对卡片底色在浅色约 4.77:1、深色约 7.58:1，满足普通文本 4.5:1；这是基于 CSS token 的计算，不是浏览器实测。 |
| 正式路由与入口 | 当前无用户可达入口，符合既有导航决策 | 路由 `apps/web/src/routes/_authenticated/w/$workspaceId/index.tsx:1-7` 渲染的是 `WorkspaceHome`，Dashboard feature 没有被正式 route 或 sidebar 引用。`docs/tenant-optimization-principles-and-gap-review.md:53-63` 已确认 Dashboard 模板入口从正式导航移除；因此本次改动清理的是保留源码，不应据此宣称实际 Workspace 首页已变更。 |

## 必须修复项

1. **明确空态代表“数据未接入”。** 将 KPI 的 `Awaiting workspace data` 及 Activity 的“暂无动态”统一改为不会混淆加载中、没有记录与未接入的文案。例如：“Workspace data is not connected yet; metrics will appear here when available.” / “工作区数据尚未接入，接入后会在此显示指标。” 若没有真实的数据连接入口，不要用会让用户寻找操作入口的“Connect ...”指令。若以后接入请求，再分别设计 Loading、连接未配置、200 空结果和请求失败。

2. **补上标题语义。** 为 Overview、Workspace activity、Analytics、各 breakdown 等可见区块提供有层级的 `h2`/`h3` 标题，或让卡片标题组件支持语义元素；保留一个页面级 `h1`。空态标题也应参与对应区块结构，而不只是加粗段落。

3. **让 Tab 语义方向和布局一致。** 当前 TabList 是横向视觉布局，应将 Radix Tabs 的 `orientation` 设为 `horizontal`；验收 Tab 的可见焦点、键盘方向键以及读屏宣布的方向与视觉一致。

## 真实数据接入前的验收门槛

- 请求 pending 时才显示加载状态；失败时显示可恢复错误；集成未配置时明确说明数据未接入；服务端返回合法空列表时才显示“暂无记录”。这些状态不能共用同一条空态文案。
- 当前 Workspace 成员有权读取且结果为空时显示空结果；无 Workspace 成员资格或无动作权限时显示明确的无权状态，不展示为“暂无数据”。服务端仍是授权边界，按 `docs/tenancy-contract.md` 的 Workspace 上下文与错误契约处理 403/404。
- 切换到另一 Workspace 后，页面只展示该空间的数据；越权 Workspace 请求不得泄露资源是否存在或其他成员信息。

## 建议项

- 小屏可降低 `Overview`、`WorkspaceActivity`、Analytics 图表占位的 `min-height`，避免无数据时连续出现大面积空白；在 390px 和更窄视口确认单列卡片不会挤压文字。
- 为 `index.test.tsx` 的后续验收场景加入中文切换断言；当前文件只有英文断言，不能作为双语验收证据。本审查未新增或运行测试。
- 如果保留 Analytics Tab，说明其数据接入状态；若当前没有用户价值或实现计划，可等能力可用时再开放，避免留下只有空卡片的导航入口。
- 正式应用的路由/导航验收应覆盖“用户从 Workspace 入口能否到达目标页面”。当前 Dashboard feature 是未挂载的模板代码，按既有决策不要为了让其可达而重新加入正式导航。

## 验收场景

1. 英文与简体中文切换：页标题、Tab、四张指标卡、Analytics 区块、全部空态标题与说明均随 locale 更新；中文没有遗漏或英文残留。
2. 未接入状态：指标不显示任何示例数字、趋势、人员或交易信息；页面清楚说明数据尚未接入，不呈现为正在加载，也不要求用户点击不存在的“连接”操作。
3. 状态区分：分别模拟 pending、服务端 200 空结果、权限 403、服务错误和集成未配置；每种状态的文案和可执行操作符合实际契约。真实 API 未接入前，这项标记为待验收。
4. Workspace 边界：在有权和无权的两个空间分别访问；无权时不以空数据掩盖 403，不泄漏空间或资源存在信息。真实 API 未接入前，这项标记为待验收。
5. 390px 窄屏：指标卡按单列排列，Analytics breakdown 不产生页面级横向溢出；TabList 只有内容实际超宽时才需要横向滚动，焦点环不被容器裁切。
6. 键盘与读屏：可以用键盘到达并切换 Tabs；焦点指示清楚；读屏能按层级浏览页面标题和卡片区块，装饰图标不产生多余名称。
7. 浅色与深色主题：普通文案对背景达到至少 4.5:1；焦点指示清楚且状态不只依赖颜色表达。
8. 模板入口：组件级检查确认没有 Download、Reports、Notifications、Recent Sales 和随机图表；正式导航保持不含 Dashboard 模板入口，除非另有产品决策。

## 局限

- 只读静态审查了目标 worktree 的 Dashboard 未提交 diff 和相关前端/契约代码；没有启动页面、截图或实测 390px 布局，也没有运行测试。
- Dashboard feature 当前未接入正式路由和数据 API，无法实测真实用户入口、加载时序、请求失败、403/404 或 Workspace 切换后的数据隔离。
- 目标 worktree 还包含 Clerk 路由和依赖锁文件等 Dashboard 以外的改动，本报告没有对那些改动做 UX 审查。
