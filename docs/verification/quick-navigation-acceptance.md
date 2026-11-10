# Quick Navigation 独立验收

日期：2026-11-10（Asia/Shanghai）  
总体结论：**失败**。聚焦测试全部通过，但发现租户上下文尚未确认时错误显示“全局导航”；另有若干请求覆盖项未被本轮测试验证。此报告只验证快速导航，不代表全局导航或整个产品验收通过。

## 验收范围与证据边界

- 独立检查当前工作树的快速导航组件、共享导航 selector、Workspace directory switch、聚焦测试与 UX 契约。实现任务 `task_3b521168352c` 已完成；实现者自报结果不作为本报告通过证据。
- 测试身份及接口数据均为模拟：actor `actor-1`、Tenant `Northwind`、Workspace `Research Room`、`membership_version=17`、可见菜单响应及 TanStack Query/Router/API 状态均由 Vitest mocks 提供。没有联系真实 API、数据库、账号或权限服务；这不是实际授权证据。
- Vitest 浏览器配置使用 Playwright Chromium；测试默认设置 `zh-CN`，并有一例切换至 `en` 检查英文 scope 标签和中文导航标签匹配。窄屏断言在 `320×844` 与 `390×844` CSS 像素下执行。

## 聚焦测试

从 `apps/web` 执行：

```text
pnpm exec vitest run --browser.headless src/context/search-provider.test.tsx src/features/workspaces/directory.quick-navigation.test.tsx src/components/layout/data/sidebar-data.test.ts
```

结果：Vitest `4.1.4`；3 个测试文件通过，28/28 测试通过；耗时 `7.84s`（transform 0ms、import 2.21s、tests 4.39s）；退出码 0。没有运行全项目构建、全量 health check 或其他非聚焦测试。

## 逐项结果

| 检查项 | 判定 | 独立证据与局限 |
| --- | --- | --- |
| 复用唯一已授权动态菜单来源 | 通过 | `command-menu.tsx` 调用 `selectAuthorizedNavigationCandidates(navigation.data, contextScope)`，动态菜单结果只由 selector 输出加入候选；query key 包含 actor、tenant、workspace、membership version，数据来自 visible-tree 请求。测试验证 key 和 `/tenants/tenant-1/menus/visible-tree`。selector 对缺失/未验证 scope、Tenant/version 不匹配返回 `null`；没有第二份动态菜单权限逻辑。见 `apps/web/src/components/command-menu.tsx:285`、`:313`、`:368` 与 `apps/web/src/components/layout/data/sidebar-data.ts:65`。模拟响应无法证明后端正确过滤权限。 |
| 未验证/陈旧 scope 无动态候选；已验证空菜单与未解析区分 | 通过 | selector 测试确认 `null` scope、`verified:false`、Tenant/version 不匹配为 `null`，而 verified `items:[]` 为 `[]`；UI 区分 mismatch、loading、成功空菜单。路由 scope/actor 改变测试断言查询字词及旧结果立即清空。未模拟网络请求迟到返回竞态。见 `apps/web/src/components/layout/data/sidebar-data.test.ts:107`、`:129`、`apps/web/src/context/search-provider.test.tsx:422`、`:459`。 |
| 租户上下文解析期间 scope 标签正确 | **失败** | `docs/ux/command-search-context.md:39`、`:50` 规定解析中不显示错误 scope 名称。`command-menu.tsx:643` 的 fallback 在识别 Tenant 路由但 `tenantContextReady=false`、且没有 Workspace 路由 ID 时会显示 `text('global-scope')`；同组件可同时显示“正在确认当前租户…”。未确认的 Tenant 页面因此被标成 Global。未修改实现；应单独派发修复并复验 Tenant pending/error 路径。 |
| 仅搜索可见导航元数据及当前 actor 已确认目录 | 通过（模拟） | 动态标题/面包屑来自 selector 候选；Workspace 候选仅在 directory 查询成功、actor 确认且 Workspace Tenant 有效时产生。actor 变化测试清除旧结果；目录测试检验当前 actor。没有真实服务端 directory / authorization 请求。见 `apps/web/src/components/command-menu.tsx:386`、`:400` 与 `apps/web/src/context/search-provider.test.tsx:191`、`:459`。 |
| Workspace 切换沿用授权目录流程 | 通过（模拟） | 快速导航调用现有 `useWorkspaceSwitch(directory)`；测试证明未知 Workspace 和 actor 不匹配时拒绝导航，当前目录内目标才导航到 `/w/workspace-1`。目录为模拟成功数据；未验证真实切换 API 或目的页权限。见 `apps/web/src/features/workspaces/directory.quick-navigation.test.tsx:84`。 |
| 最近 Workspace ID 不能注入候选 | 部分通过 | 代码先在 confirmed directory 中校验 recent ID，再用其排序；测试验证伪造 `hidden-workspace` recent 元数据不显示。没有正向断言有效最近项排在首位。见 `apps/web/src/components/command-menu.tsx:400`、`:405` 和 `apps/web/src/context/search-provider.test.tsx:271`。 |
| 不新增聊天/文件/用户/任务/Agent run/业务内容搜索 | 通过（测试范围） | 测试确认不创建上述资源查询 key、不调用通用 API，并显示只搜授权导航的说明。代码仅在导航标题、别名、面包屑上过滤；没有内容索引或全文 API。结论限于 Quick Navigation 路径。见 `apps/web/src/context/search-provider.test.tsx:523` 与 `apps/web/src/components/command-menu.tsx:59`。 |
| Loading、部分错误、空菜单/空目录、失败与 retry 区分 | 通过（状态呈现）；retry 恢复未覆盖 | 测试断言上下文确认、动态菜单 loading、固定项保留、导航/目录错误及各自 Retry、成功空动态菜单和目录空态；加载/失败时不误报无匹配。Retry 会调用相应 `refetch`，但未验证重试后成功加载闭环。见 `apps/web/src/context/search-provider.test.tsx:291`、`:328`、`:351`、`:374`、`:389`、`:403`。 |
| 中文子串、英文大小写不敏感与动态标签 | 通过（匹配逻辑）；真实标签源模拟 | `filterQuickNavigationEntries` 测试验证中文子串 `设置`、英文小写 `profile` 匹配，并验证未索引路径样式字段不匹配；组件测试以模拟 visible-tree 动态菜单 `自定义入口` 搜索并导航。见 `apps/web/src/context/search-provider.test.tsx:191`、`:492`。 |
| 本地化 scope/result 标签 | 部分通过 | `zh-CN` 测试覆盖 Workspace 加载、空态、错误/重试文案；英文界面断言 `Current workspace: Research Room · Northwind`，且仍能匹配中文动态标签。Tenant scope 正常态和 Global scope 无独立断言；Tenant 未解析标签存在上述失败。 |
| 快捷键、方向键、Home/End、Enter、Escape 与焦点恢复 | 部分通过 | 正向 `Ctrl+K` 由测试 helper 打开；`ArrowDown`+`Enter` 激活候选；`Home`/`End` 选择首尾，`Escape` 关闭并恢复触发按钮焦点。未单独测 `Meta+K` 正向打开、`ArrowUp`、持续键盘遍历。aria-keyshortcuts 声明不等于行为覆盖。见 `apps/web/src/context/search-provider.test.tsx:199`、`:631` 与 `apps/web/src/components/search.tsx:28`。 |
| 编辑控件、IME 和 overlay 快捷键冲突 | 通过（合成事件） | 测试验证焦点在 input、`isComposing=true` 及已有 dialog overlay 时 Ctrl+K 不打开。使用 DOM/KeyboardEvent 模拟，无真实输入法或辅助硬件。见 `apps/web/src/context/search-provider.test.tsx:594`。 |
| 320/390px 响应行为 | 通过（有限布局断言） | Chromium 测试检查 dialog 宽度不超过 viewport、文档无横向溢出、关闭按钮可见，视口为 `320×844` 和 `390×844`；结束时恢复 `1280×900`。未测触屏、其他高度、安全区、200% 缩放或真机。见 `apps/web/src/context/search-provider.test.tsx:575`。 |

## 未覆盖与后续

- 没有读屏器、键盘-only 人工验收、触屏/真机、200% 缩放或浏览器组合测试；没有 Tenant scope 正向结果、Meta+K/ArrowUp 正向测试、有效 recent 排序断言、迟到响应竞态、retry 成功闭环测试。
- 所有身份、菜单、directory、API 状态都是 mock；不能作为真实租户隔离、Workspace 成员关系、菜单授权或目的地 API 权限的服务端证据。服务端仍须对每个目的地请求重新鉴权。
- 本轮未修改产品实现或测试；发现项仅记录为独立修复任务输入。聚焦测试通过不抵消 scope-label 缺陷，当前结论为**失败，不予独立验收通过**。
